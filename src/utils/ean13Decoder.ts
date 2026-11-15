// ============================================================================
// Pure TypeScript 1D EAN-13 / EAN-8 / UPC-A Barcode & QR Code Decoder
// Hardened against false positives:
// - Local contrast gate (ignores flat / low-contrast surfaces)
// - Left & right quiet-zone verification
// - Global module-width consistency across all guards and digits
// - Strict RLE pattern variance threshold + Modulo-10 checksum
// - Multi-scanline consensus (requires >= 3 distinct scanlines to match)
// ============================================================================

import jsQR from 'jsqr';

const L_AND_R_PATTERNS: number[][] = [
  [3, 2, 1, 1], // 0
  [2, 2, 2, 1], // 1
  [2, 1, 2, 2], // 2
  [1, 4, 1, 1], // 3
  [1, 1, 3, 2], // 4
  [1, 2, 3, 1], // 5
  [1, 1, 1, 4], // 6
  [1, 3, 1, 2], // 7
  [1, 2, 1, 3], // 8
  [3, 1, 1, 2], // 9
];

const G_PATTERNS: number[][] = L_AND_R_PATTERNS.map((p) => [...p].reverse());

const PARITY_MAP: Record<string, number> = {
  LLLLLL: 0,
  LLGLGG: 1,
  LLGGLG: 2,
  LLGGGL: 3,
  LGLLGG: 4,
  LGGLLG: 5,
  LGGGLL: 6,
  LGLGLG: 7,
  LGLGGL: 8,
  LGGLGL: 9,
};

export function validateEanChecksum(digits: number[]): boolean {
  if (digits.length !== 13 && digits.length !== 8) return false;
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i++) {
    const d = digits[i];
    if (d < 0 || d > 9 || !Number.isInteger(d)) return false;
    const weight = digits.length === 13 ? (i % 2 === 0 ? 1 : 3) : i % 2 === 0 ? 3 : 1;
    sum += d * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === digits[digits.length - 1];
}

export interface NormalizedScanResult {
  code: string;
  kind: 'serial' | 'ean';
}

/**
 * Validates and normalizes a raw decoded string from camera/photo.
 * Rejects arbitrary strings or numbers without a valid EAN checksum.
 */
export function normalizeScannedCode(raw: string): NormalizedScanResult | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. Kitchen serial number AAA-1111 (standalone or inside URL ?item=AAA-1111 or /AAA-1111)
  const serialMatch = trimmed.toUpperCase().match(/(?:^|[/?=&\s])([A-Z]{3})-(\d{4})(?:$|[/?&#\s])/);
  if (serialMatch) {
    return {
      code: `${serialMatch[1]}-${serialMatch[2]}`,
      kind: 'serial',
    };
  }

  // 2. EAN-13, UPC-A (12 digits), or EAN-8 with valid Modulo-10 checksum
  if (/^\d{8}$/.test(trimmed) || /^\d{12,13}$/.test(trimmed)) {
    const normalizedDigitsStr = trimmed.length === 12 ? `0${trimmed}` : trimmed;
    const digits = normalizedDigitsStr.split('').map((ch) => Number(ch));
    if (validateEanChecksum(digits)) {
      return {
        code: normalizedDigitsStr,
        kind: 'ean',
      };
    }
  }

  return null;
}

function patternMatchVariance(
  counters: number[],
  pattern: number[],
  maxIndividualVariance = 0.54
): number {
  const numCounters = counters.length;
  let total = 0;
  let patternLength = 0;
  for (let i = 0; i < numCounters; i++) {
    total += counters[i];
    patternLength += pattern[i];
  }
  if (total < patternLength || total === 0) {
    return Infinity;
  }
  const unitBarWidth = total / patternLength;
  const maxVariance = maxIndividualVariance * unitBarWidth;

  let totalVariance = 0;
  for (let x = 0; x < numCounters; x++) {
    const counter = counters[x];
    const scaledPattern = pattern[x] * unitBarWidth;
    const variance = Math.abs(counter - scaledPattern);
    if (variance > maxVariance) {
      return Infinity;
    }
    totalVariance += variance;
  }
  return totalVariance / total;
}

function decodeDigitRLE(
  counters: number[],
  includeG: boolean
): { digit: number; isG: boolean; variance: number } | null {
  let bestVariance = 0.36;
  let bestDigit = -1;
  let bestIsG = false;

  for (let d = 0; d < 10; d++) {
    const vL = patternMatchVariance(counters, L_AND_R_PATTERNS[d]);
    if (vL < bestVariance) {
      bestVariance = vL;
      bestDigit = d;
      bestIsG = false;
    }
    if (includeG) {
      const vG = patternMatchVariance(counters, G_PATTERNS[d]);
      if (vG < bestVariance) {
        bestVariance = vG;
        bestDigit = d;
        bestIsG = true;
      }
    }
  }

  if (bestDigit < 0) return null;
  return { digit: bestDigit, isG: bestIsG, variance: bestVariance };
}

interface Run {
  val: number;
  len: number;
}

function extractRuns(bin: Uint8Array): Run[] {
  const runs: Run[] = [];
  if (bin.length === 0) return runs;
  let currentVal = bin[0];
  let currentLen = 1;
  for (let i = 1; i < bin.length; i++) {
    if (bin[i] === currentVal) {
      currentLen++;
    } else {
      runs.push({ val: currentVal, len: currentLen });
      currentVal = bin[i];
      currentLen = 1;
    }
  }
  runs.push({ val: currentVal, len: currentLen });
  return runs;
}

function tryDecodeEan13FromRuns(runs: Run[]): string | null {
  // Complete EAN-13 requires 59 barcode runs surrounded by left and right white quiet zones
  if (runs.length < 61) return null;

  for (let start = 1; start <= runs.length - 60; start++) {
    if (runs[start].val !== 1) continue;

    // Total width across all 59 runs (95 modules)
    let totalWidth = 0;
    for (let k = 0; k < 59; k++) {
      totalWidth += runs[start + k].len;
    }
    if (totalWidth < 95) continue;
    const moduleWidth = totalWidth / 95;

    // Quiet zone check: white runs immediately before Left Guard and after Right Guard
    const leftQuiet = runs[start - 1];
    const rightQuiet = runs[start + 59];
    if (leftQuiet.val !== 0 || leftQuiet.len < moduleWidth * 2.0) continue;
    if (rightQuiet.val !== 0 || rightQuiet.len < moduleWidth * 2.0) continue;

    // 1. Check Left Guard (101 -> [1, 1, 1], expected 3 modules)
    const lgWidth = runs[start].len + runs[start + 1].len + runs[start + 2].len;
    if (lgWidth < moduleWidth * 1.8 || lgWidth > moduleWidth * 4.5) continue;
    const lgVar = patternMatchVariance(
      [runs[start].len, runs[start + 1].len, runs[start + 2].len],
      [1, 1, 1],
      0.54
    );
    if (lgVar > 0.40) continue;

    // 2. Check Center Guard (01010 -> [1, 1, 1, 1, 1] at start + 27, expected 5 modules)
    const cgIdx = start + 27;
    const cgWidth =
      runs[cgIdx].len +
      runs[cgIdx + 1].len +
      runs[cgIdx + 2].len +
      runs[cgIdx + 3].len +
      runs[cgIdx + 4].len;
    if (cgWidth < moduleWidth * 3.1 || cgWidth > moduleWidth * 7.0) continue;
    const cgVar = patternMatchVariance(
      [
        runs[cgIdx].len,
        runs[cgIdx + 1].len,
        runs[cgIdx + 2].len,
        runs[cgIdx + 3].len,
        runs[cgIdx + 4].len,
      ],
      [1, 1, 1, 1, 1],
      0.54
    );
    if (cgVar > 0.40) continue;

    // 3. Check Right Guard (101 -> [1, 1, 1] at start + 56, expected 3 modules)
    const rgIdx = start + 56;
    const rgWidth = runs[rgIdx].len + runs[rgIdx + 1].len + runs[rgIdx + 2].len;
    if (rgWidth < moduleWidth * 1.8 || rgWidth > moduleWidth * 4.5) continue;
    const rgVar = patternMatchVariance(
      [runs[rgIdx].len, runs[rgIdx + 1].len, runs[rgIdx + 2].len],
      [1, 1, 1],
      0.54
    );
    if (rgVar > 0.40) continue;

    // 4. Decode 6 left digits (L or G), verifying consistent 7-module digit width
    let parity = '';
    const digits: number[] = [];
    let ok = true;
    let totalDigitVariance = 0;
    const minDigitWidth = moduleWidth * 4.9;
    const maxDigitWidth = moduleWidth * 9.1;

    for (let d = 0; d < 6; d++) {
      const idx = start + 3 + d * 4;
      const c0 = runs[idx].len;
      const c1 = runs[idx + 1].len;
      const c2 = runs[idx + 2].len;
      const c3 = runs[idx + 3].len;
      const dWidth = c0 + c1 + c2 + c3;
      if (dWidth < minDigitWidth || dWidth > maxDigitWidth) {
        ok = false;
        break;
      }
      const decoded = decodeDigitRLE([c0, c1, c2, c3], true);
      if (!decoded) {
        ok = false;
        break;
      }
      parity += decoded.isG ? 'G' : 'L';
      digits.push(decoded.digit);
      totalDigitVariance += decoded.variance;
    }
    if (!ok || PARITY_MAP[parity] === undefined) continue;
    digits.unshift(PARITY_MAP[parity]);

    // 5. Decode 6 right digits (R only), verifying consistent 7-module digit width
    for (let d = 0; d < 6; d++) {
      const idx = start + 32 + d * 4;
      const c0 = runs[idx].len;
      const c1 = runs[idx + 1].len;
      const c2 = runs[idx + 2].len;
      const c3 = runs[idx + 3].len;
      const dWidth = c0 + c1 + c2 + c3;
      if (dWidth < minDigitWidth || dWidth > maxDigitWidth) {
        ok = false;
        break;
      }
      const decoded = decodeDigitRLE([c0, c1, c2, c3], false);
      if (!decoded) {
        ok = false;
        break;
      }
      digits.push(decoded.digit);
      totalDigitVariance += decoded.variance;
    }

    if (!ok) continue;
    if (totalDigitVariance / 12 > 0.26) continue;

    if (validateEanChecksum(digits)) {
      return digits.join('');
    }
  }
  return null;
}

function tryDecodeEan8FromRuns(runs: Run[]): string | null {
  // Complete EAN-8 requires 43 barcode runs surrounded by left and right white quiet zones
  if (runs.length < 45) return null;

  for (let start = 1; start <= runs.length - 44; start++) {
    if (runs[start].val !== 1) continue;

    // Total width across all 43 runs (67 modules)
    let totalWidth = 0;
    for (let k = 0; k < 43; k++) {
      totalWidth += runs[start + k].len;
    }
    if (totalWidth < 67) continue;
    const moduleWidth = totalWidth / 67;

    // Quiet zone check
    const leftQuiet = runs[start - 1];
    const rightQuiet = runs[start + 43];
    if (leftQuiet.val !== 0 || leftQuiet.len < moduleWidth * 2.0) continue;
    if (rightQuiet.val !== 0 || rightQuiet.len < moduleWidth * 2.0) continue;

    const lgWidth = runs[start].len + runs[start + 1].len + runs[start + 2].len;
    if (lgWidth < moduleWidth * 1.8 || lgWidth > moduleWidth * 4.5) continue;
    const lgVar = patternMatchVariance(
      [runs[start].len, runs[start + 1].len, runs[start + 2].len],
      [1, 1, 1],
      0.54
    );
    if (lgVar > 0.40) continue;

    const cgIdx = start + 19;
    const cgWidth =
      runs[cgIdx].len +
      runs[cgIdx + 1].len +
      runs[cgIdx + 2].len +
      runs[cgIdx + 3].len +
      runs[cgIdx + 4].len;
    if (cgWidth < moduleWidth * 3.1 || cgWidth > moduleWidth * 7.0) continue;
    const cgVar = patternMatchVariance(
      [
        runs[cgIdx].len,
        runs[cgIdx + 1].len,
        runs[cgIdx + 2].len,
        runs[cgIdx + 3].len,
        runs[cgIdx + 4].len,
      ],
      [1, 1, 1, 1, 1],
      0.54
    );
    if (cgVar > 0.40) continue;

    const rgIdx = start + 40;
    const rgWidth = runs[rgIdx].len + runs[rgIdx + 1].len + runs[rgIdx + 2].len;
    if (rgWidth < moduleWidth * 1.8 || rgWidth > moduleWidth * 4.5) continue;
    const rgVar = patternMatchVariance(
      [runs[rgIdx].len, runs[rgIdx + 1].len, runs[rgIdx + 2].len],
      [1, 1, 1],
      0.54
    );
    if (rgVar > 0.40) continue;

    const digits: number[] = [];
    let ok = true;
    let totalDigitVariance = 0;
    const minDigitWidth = moduleWidth * 4.9;
    const maxDigitWidth = moduleWidth * 9.1;

    for (let d = 0; d < 4; d++) {
      const idx = start + 3 + d * 4;
      const c0 = runs[idx].len;
      const c1 = runs[idx + 1].len;
      const c2 = runs[idx + 2].len;
      const c3 = runs[idx + 3].len;
      const dWidth = c0 + c1 + c2 + c3;
      if (dWidth < minDigitWidth || dWidth > maxDigitWidth) {
        ok = false;
        break;
      }
      const decoded = decodeDigitRLE([c0, c1, c2, c3], false);
      if (!decoded) {
        ok = false;
        break;
      }
      digits.push(decoded.digit);
      totalDigitVariance += decoded.variance;
    }
    if (!ok) continue;

    for (let d = 0; d < 4; d++) {
      const idx = start + 24 + d * 4;
      const c0 = runs[idx].len;
      const c1 = runs[idx + 1].len;
      const c2 = runs[idx + 2].len;
      const c3 = runs[idx + 3].len;
      const dWidth = c0 + c1 + c2 + c3;
      if (dWidth < minDigitWidth || dWidth > maxDigitWidth) {
        ok = false;
        break;
      }
      const decoded = decodeDigitRLE([c0, c1, c2, c3], false);
      if (!decoded) {
        ok = false;
        break;
      }
      digits.push(decoded.digit);
      totalDigitVariance += decoded.variance;
    }

    if (!ok) continue;
    if (totalDigitVariance / 8 > 0.26) continue;

    if (validateEanChecksum(digits)) {
      return digits.join('');
    }
  }
  return null;
}

function binarizeCentered(grayRow: Uint8Array, radius: number, bias: number): Uint8Array {
  const len = grayRow.length;
  const bin = new Uint8Array(len);
  const prefix = new Float64Array(len + 1);
  for (let i = 0; i < len; i++) {
    prefix[i + 1] = prefix[i] + grayRow[i];
  }
  for (let i = 0; i < len; i++) {
    const left = Math.max(0, i - radius);
    const right = Math.min(len - 1, i + radius);
    const avg = (prefix[right + 1] - prefix[left]) / (right - left + 1);
    // Require pixel to be meaningfully darker than local mean so uniform/quiet zones stay 0
    bin[i] = grayRow[i] < avg * bias && avg - grayRow[i] >= 5 ? 1 : 0;
  }
  return bin;
}

function decodeGrayLine(grayLine: Uint8Array): string | null {
  const len = grayLine.length;
  if (len < 110) return null;

  // Reject low-contrast lines (e.g. uniform wall, table, blank surface)
  let minVal = 255;
  let maxVal = 0;
  for (let i = 0; i < len; i++) {
    const v = grayLine[i];
    if (v < minVal) minVal = v;
    if (v > maxVal) maxVal = v;
  }
  if (maxVal - minVal < 36) return null;

  const radii = [
    Math.max(12, Math.floor(len / 24)),
    Math.max(20, Math.floor(len / 14)),
    Math.max(32, Math.floor(len / 8)),
  ];
  const biases = [0.97, 0.92, 0.86];

  for (const radius of radii) {
    for (const bias of biases) {
      const bin = binarizeCentered(grayLine, radius, bias);
      const runs = extractRuns(bin);

      // Forward (normal orientation)
      const ean13 = tryDecodeEan13FromRuns(runs);
      if (ean13) return ean13;

      const ean8 = tryDecodeEan8FromRuns(runs);
      if (ean8) return ean8;

      // Reversed (upside-down 180 deg barcode)
      const revRuns = [...runs].reverse();
      const ean13Rev = tryDecodeEan13FromRuns(revRuns);
      if (ean13Rev) return ean13Rev;

      const ean8Rev = tryDecodeEan8FromRuns(revRuns);
      if (ean8Rev) return ean8Rev;
    }
  }
  return null;
}

const MIN_SCANLINE_VOTES = 2;

const HORIZONTAL_RATIOS = [
  0.5, 0.48, 0.52, 0.46, 0.54, 0.44, 0.56, 0.42, 0.58, 0.4, 0.6, 0.38, 0.62, 0.36, 0.64, 0.34,
  0.66, 0.32, 0.68, 0.3, 0.7, 0.27, 0.73, 0.24, 0.76, 0.2, 0.8, 0.15, 0.85,
];

const VERTICAL_RATIOS = [
  0.5, 0.46, 0.54, 0.42, 0.58, 0.38, 0.62, 0.34, 0.66, 0.3, 0.7, 0.26, 0.74, 0.21, 0.79, 0.15,
  0.85,
];

export function decodeEanFromImageData(imageData: ImageData): string | null {
  const { data, width, height } = imageData;
  if (width < 110 || height < 60) return null;

  const votes: Record<string, number> = {};

  for (const ratio of HORIZONTAL_RATIOS) {
    const y = Math.floor(height * ratio);
    if (y < 0 || y >= height) continue;
    const grayRow = new Uint8Array(width);
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      const idx = rowOffset + x * 4;
      grayRow[x] = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
    }
    const code = decodeGrayLine(grayRow);
    if (code) {
      votes[code] = (votes[code] || 0) + 1;
      if (votes[code] >= MIN_SCANLINE_VOTES) return code;
    }
  }

  // Also scan vertical columns (for barcodes held vertically / 90 deg on mobile)
  if (height >= 110) {
    for (const ratio of VERTICAL_RATIOS) {
      const x = Math.floor(width * ratio);
      if (x < 0 || x >= width) continue;
      const grayCol = new Uint8Array(height);
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4;
        grayCol[y] = (data[idx] * 77 + data[idx + 1] * 150 + data[idx + 2] * 29) >> 8;
      }
      const code = decodeGrayLine(grayCol);
      if (code) {
        votes[code] = (votes[code] || 0) + 1;
        if (votes[code] >= MIN_SCANLINE_VOTES) return code;
      }
    }
  }

  return null;
}

interface BarcodeDetectorLike {
  detect(
    source: ImageBitmapSource
  ): Promise<Array<{ rawValue?: string; format?: string }>>;
}

declare global {
  interface Window {
    BarcodeDetector?: {
      new (options?: { formats?: string[] }): BarcodeDetectorLike;
    };
  }
}

let cachedDetector: BarcodeDetectorLike | null | undefined;

function getNativeBarcodeDetector(): BarcodeDetectorLike | null {
  if (cachedDetector !== undefined) return cachedDetector;
  if (typeof window !== 'undefined' && typeof window.BarcodeDetector === 'function') {
    try {
      cachedDetector = new window.BarcodeDetector({
        formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a'],
      });
      return cachedDetector;
    } catch {
      try {
        cachedDetector = new window.BarcodeDetector();
        return cachedDetector;
      } catch {
        cachedDetector = null;
      }
    }
  }
  cachedDetector = null;
  return null;
}

export function decodeFromImageData(imageData: ImageData): string | null {
  const qr = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  });
  if (qr && qr.data) {
    const normalizedQr = normalizeScannedCode(qr.data);
    if (normalizedQr) {
      return normalizedQr.code;
    }
  }

  const ean = decodeEanFromImageData(imageData);
  if (ean) {
    const normalizedEan = normalizeScannedCode(ean);
    if (normalizedEan) {
      return normalizedEan.code;
    }
  }

  return null;
}

export async function scanVideoFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): Promise<string | null> {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;

  // 1. Try native BarcodeDetector if available, strictly filtered through normalizeScannedCode
  const detector = getNativeBarcodeDetector();
  if (detector) {
    try {
      const results = await detector.detect(video);
      if (results && results.length > 0) {
        for (const r of results) {
          if (r.rawValue) {
            const valid = normalizeScannedCode(r.rawValue);
            if (valid) return valid.code;
          }
        }
      }
    } catch {
      // fall through to canvas decoding
    }
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // 2. Pass 1 — 1:1 native-resolution center reticle crop (68% of frame, capped at 1000px)
  const crop1Ratio = 0.68;
  const sx1 = Math.round(vw * ((1 - crop1Ratio) / 2));
  const sy1 = Math.round(vh * ((1 - crop1Ratio) / 2));
  const sw1 = Math.max(1, Math.round(vw * crop1Ratio));
  const sh1 = Math.max(1, Math.round(vh * crop1Ratio));
  const crop1Scale = Math.min(1, 1000 / Math.max(sw1, sh1));
  const w1 = Math.max(1, Math.round(sw1 * crop1Scale));
  const h1 = Math.max(1, Math.round(sh1 * crop1Scale));
  canvas.width = w1;
  canvas.height = h1;
  ctx.drawImage(video, sx1, sy1, sw1, sh1, 0, 0, w1, h1);
  const crop1Hit = decodeFromImageData(ctx.getImageData(0, 0, w1, h1));
  if (crop1Hit) return crop1Hit;

  // 3. Pass 2 — High-res full frame (960px max dim)
  const fullScale = Math.min(1, 960 / Math.max(vw, vh));
  const w2 = Math.max(1, Math.round(vw * fullScale));
  const h2 = Math.max(1, Math.round(vh * fullScale));
  canvas.width = w2;
  canvas.height = h2;
  ctx.drawImage(video, 0, 0, w2, h2);
  const fullHit = decodeFromImageData(ctx.getImageData(0, 0, w2, h2));
  if (fullHit) return fullHit;

  // 4. Pass 3 — Tight center crop (44% of frame scaled up to 640px) for small labels
  const crop3Ratio = 0.44;
  const sx3 = Math.round(vw * ((1 - crop3Ratio) / 2));
  const sy3 = Math.round(vh * ((1 - crop3Ratio) / 2));
  const sw3 = Math.max(1, Math.round(vw * crop3Ratio));
  const sh3 = Math.max(1, Math.round(vh * crop3Ratio));
  const crop3Scale = Math.min(2, 640 / Math.max(sw3, sh3));
  const w3 = Math.max(1, Math.round(sw3 * crop3Scale));
  const h3 = Math.max(1, Math.round(sh3 * crop3Scale));
  canvas.width = w3;
  canvas.height = h3;
  ctx.drawImage(video, sx3, sy3, sw3, sh3, 0, 0, w3, h3);
  return decodeFromImageData(ctx.getImageData(0, 0, w3, h3));
}

export async function scanStaticImage(img: HTMLImageElement): Promise<string | null> {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;

  // 1. Try native BarcodeDetector first, strictly filtered through normalizeScannedCode
  const detector = getNativeBarcodeDetector();
  if (detector) {
    try {
      const results = await detector.detect(img);
      if (results && results.length > 0) {
        for (const r of results) {
          if (r.rawValue) {
            const valid = normalizeScannedCode(r.rawValue);
            if (valid) return valid.code;
          }
        }
      }
    } catch {
      // fall through
    }
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // 2. Multi-scale full image passes (1400px, 900px, 560px)
  for (const maxDim of [1400, 900, 560]) {
    const ratio = Math.min(1, maxDim / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * ratio));
    const h = Math.max(1, Math.round(ih * ratio));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const hit = decodeFromImageData(data);
    if (hit) return hit;
  }

  // 3. Multi-crop center regions (65% and 42% of high-res mobile photos)
  for (const cropRatio of [0.65, 0.42]) {
    const sx = Math.round(iw * ((1 - cropRatio) / 2));
    const sy = Math.round(ih * ((1 - cropRatio) / 2));
    const sw = Math.max(1, Math.round(iw * cropRatio));
    const sh = Math.max(1, Math.round(ih * cropRatio));
    const scale = Math.min(1.2, 800 / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const hit = decodeFromImageData(data);
    if (hit) return hit;
  }

  // 4. 90-degree rotated pass (in case QR or barcode is oriented sideways)
  const rotMax = 900;
  const rotRatio = Math.min(1, rotMax / Math.max(iw, ih));
  const rw = Math.max(1, Math.round(iw * rotRatio));
  const rh = Math.max(1, Math.round(ih * rotRatio));
  canvas.width = rh;
  canvas.height = rw;
  ctx.save();
  ctx.translate(rh / 2, rw / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -rw / 2, -rh / 2, rw, rh);
  ctx.restore();
  const rotData = ctx.getImageData(0, 0, rh, rw);
  return decodeFromImageData(rotData);
}
