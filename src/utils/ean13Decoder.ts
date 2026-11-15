// ============================================================================
// Pure TypeScript 1D EAN-13 / EAN-8 / UPC-A Barcode Decoder
// Uses run-length pattern matching (immune to cumulative module drift)
// Supports horizontal, vertical (90 deg), and upside-down (180 deg) barcodes
// ============================================================================

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
    const weight = digits.length === 13 ? (i % 2 === 0 ? 1 : 3) : i % 2 === 0 ? 3 : 1;
    sum += d * weight;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === digits[digits.length - 1];
}

function patternMatchVariance(
  counters: number[],
  pattern: number[],
  maxIndividualVariance = 0.75
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
  let bestVariance = 0.52;
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
  // Complete EAN-13 requires 59 runs starting at a black bar (val === 1)
  if (runs.length < 59) return null;

  for (let start = 0; start <= runs.length - 59; start++) {
    if (runs[start].val !== 1) continue;

    // 1. Check Left Guard (101 -> [1, 1, 1])
    const lgVar = patternMatchVariance(
      [runs[start].len, runs[start + 1].len, runs[start + 2].len],
      [1, 1, 1],
      0.85
    );
    if (lgVar > 0.55) continue;

    // 2. Check Center Guard (01010 -> [1, 1, 1, 1, 1] at start + 27)
    const cgIdx = start + 27;
    const cgVar = patternMatchVariance(
      [
        runs[cgIdx].len,
        runs[cgIdx + 1].len,
        runs[cgIdx + 2].len,
        runs[cgIdx + 3].len,
        runs[cgIdx + 4].len,
      ],
      [1, 1, 1, 1, 1],
      0.85
    );
    if (cgVar > 0.55) continue;

    // 3. Check Right Guard (101 -> [1, 1, 1] at start + 56)
    const rgIdx = start + 56;
    const rgVar = patternMatchVariance(
      [runs[rgIdx].len, runs[rgIdx + 1].len, runs[rgIdx + 2].len],
      [1, 1, 1],
      0.85
    );
    if (rgVar > 0.55) continue;

    // 4. Decode 6 left digits (L or G)
    let parity = '';
    const digits: number[] = [];
    let ok = true;

    for (let d = 0; d < 6; d++) {
      const idx = start + 3 + d * 4;
      const decoded = decodeDigitRLE(
        [runs[idx].len, runs[idx + 1].len, runs[idx + 2].len, runs[idx + 3].len],
        true
      );
      if (!decoded) {
        ok = false;
        break;
      }
      parity += decoded.isG ? 'G' : 'L';
      digits.push(decoded.digit);
    }
    if (!ok || PARITY_MAP[parity] === undefined) continue;
    digits.unshift(PARITY_MAP[parity]);

    // 5. Decode 6 right digits (R only)
    for (let d = 0; d < 6; d++) {
      const idx = start + 32 + d * 4;
      const decoded = decodeDigitRLE(
        [runs[idx].len, runs[idx + 1].len, runs[idx + 2].len, runs[idx + 3].len],
        false
      );
      if (!decoded) {
        ok = false;
        break;
      }
      digits.push(decoded.digit);
    }

    if (ok && validateEanChecksum(digits)) {
      return digits.join('');
    }
  }
  return null;
}

function tryDecodeEan8FromRuns(runs: Run[]): string | null {
  // Complete EAN-8 requires 43 runs starting at a black bar (val === 1)
  if (runs.length < 43) return null;

  for (let start = 0; start <= runs.length - 43; start++) {
    if (runs[start].val !== 1) continue;

    const lgVar = patternMatchVariance(
      [runs[start].len, runs[start + 1].len, runs[start + 2].len],
      [1, 1, 1],
      0.8
    );
    if (lgVar > 0.5) continue;

    const cgIdx = start + 19;
    const cgVar = patternMatchVariance(
      [
        runs[cgIdx].len,
        runs[cgIdx + 1].len,
        runs[cgIdx + 2].len,
        runs[cgIdx + 3].len,
        runs[cgIdx + 4].len,
      ],
      [1, 1, 1, 1, 1],
      0.8
    );
    if (cgVar > 0.5) continue;

    const rgIdx = start + 40;
    const rgVar = patternMatchVariance(
      [runs[rgIdx].len, runs[rgIdx + 1].len, runs[rgIdx + 2].len],
      [1, 1, 1],
      0.8
    );
    if (rgVar > 0.5) continue;

    const digits: number[] = [];
    let ok = true;

    for (let d = 0; d < 4; d++) {
      const idx = start + 3 + d * 4;
      const decoded = decodeDigitRLE(
        [runs[idx].len, runs[idx + 1].len, runs[idx + 2].len, runs[idx + 3].len],
        false
      );
      if (!decoded) {
        ok = false;
        break;
      }
      digits.push(decoded.digit);
    }
    if (!ok) continue;

    for (let d = 0; d < 4; d++) {
      const idx = start + 24 + d * 4;
      const decoded = decodeDigitRLE(
        [runs[idx].len, runs[idx + 1].len, runs[idx + 2].len, runs[idx + 3].len],
        false
      );
      if (!decoded) {
        ok = false;
        break;
      }
      digits.push(decoded.digit);
    }

    if (ok && validateEanChecksum(digits)) {
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
    bin[i] = grayRow[i] < avg * bias ? 1 : 0;
  }
  return bin;
}

function decodeGrayLine(grayLine: Uint8Array): string | null {
  const len = grayLine.length;
  if (len < 95) return null;

  const radii = [Math.max(12, Math.floor(len / 24)), Math.max(24, Math.floor(len / 12))];
  const biases = [0.97, 0.92, 1.0];

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

export function decodeEanFromImageData(imageData: ImageData): string | null {
  const { data, width, height } = imageData;
  if (width < 60 || height < 60) return null;

  // Scan 19 horizontal lines across the frame
  const ratios = [
    0.5, 0.45, 0.55, 0.4, 0.6, 0.35, 0.65, 0.3, 0.7, 0.25, 0.75, 0.2, 0.8, 0.48, 0.52, 0.42, 0.58,
    0.15, 0.85,
  ];
  const votes: Record<string, number> = {};

  for (const ratio of ratios) {
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
      if (votes[code] >= 2) return code;
    }
  }

  // Also scan vertical columns (for barcodes held vertically / 90 deg on mobile)
  for (const ratio of ratios) {
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
      if (votes[code] >= 2) return code;
    }
  }

  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

import jsQR from 'jsqr';

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
        formats: ['qr_code', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'],
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
  if (qr && qr.data && qr.data.trim()) {
    return qr.data.trim();
  }

  const ean = decodeEanFromImageData(imageData);
  if (ean) {
    return ean;
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

  // 1. Try native BarcodeDetector if available
  const detector = getNativeBarcodeDetector();
  if (detector) {
    try {
      const results = await detector.detect(video);
      if (results && results.length > 0 && results[0].rawValue) {
        return results[0].rawValue.trim();
      }
    } catch {
      // fall through to canvas decoding
    }
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  // 2. Full frame scaled to max 720px
  const maxDim = 720;
  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const w1 = Math.max(1, Math.round(vw * scale));
  const h1 = Math.max(1, Math.round(vh * scale));
  canvas.width = w1;
  canvas.height = h1;
  ctx.drawImage(video, 0, 0, w1, h1);
  const fullData = ctx.getImageData(0, 0, w1, h1);
  const fullHit = decodeFromImageData(fullData);
  if (fullHit) return fullHit;

  // 3. Center reticle crop (60% of frame) magnified to 520px for small QR / EAN labels
  const cropRatio = 0.6;
  const sx = Math.round(vw * ((1 - cropRatio) / 2));
  const sy = Math.round(vh * ((1 - cropRatio) / 2));
  const sw = Math.max(1, Math.round(vw * cropRatio));
  const sh = Math.max(1, Math.round(vh * cropRatio));
  const targetCropDim = 520;
  const cropScale = Math.min(1.5, targetCropDim / Math.max(sw, sh));
  const w2 = Math.max(1, Math.round(sw * cropScale));
  const h2 = Math.max(1, Math.round(sh * cropScale));
  canvas.width = w2;
  canvas.height = h2;
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w2, h2);
  const cropData = ctx.getImageData(0, 0, w2, h2);
  return decodeFromImageData(cropData);
}

export async function scanStaticImage(img: HTMLImageElement): Promise<string | null> {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return null;

  // 1. Try native BarcodeDetector first
  const detector = getNativeBarcodeDetector();
  if (detector) {
    try {
      const results = await detector.detect(img);
      if (results && results.length > 0 && results[0].rawValue) {
        return results[0].rawValue.trim();
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
