const QRCode = require('qrcode');
const { getSettings, logActivity } = require('./db');

function buildPrintPayload(db, itemOrSerial, requestOrigin = '') {
  const settings = getSettings(db);
  const serial = typeof itemOrSerial === 'string' ? itemOrSerial : itemOrSerial.serial_number;
  const text = serial;

  let qrText = serial;
  const mode = settings.printer_qr_mode || 'serial';
  if (mode === 'url') {
    const base = (settings.printer_qr_base_url || requestOrigin || 'http://localhost:3000').replace(/\/+$/, '');
    qrText = `${base}/?item=${encodeURIComponent(serial)}`;
  }

  return {
    text,
    qr_text: qrText
  };
}

async function printLabel(db, itemOrSerial, { requestOrigin = '', customText, customQrText } = {}) {
  const settings = getSettings(db);
  const printerUrl = (settings.printer_api_url || 'http://10.10.20.2:8769/print').trim();
  const basePayload = buildPrintPayload(db, itemOrSerial, requestOrigin);

  const payload = {
    text: customText || basePayload.text,
    qr_text: customQrText || basePayload.qr_text
  };

  const serial = typeof itemOrSerial === 'string' ? itemOrSerial : itemOrSerial.serial_number;
  const itemName = typeof itemOrSerial === 'object' && itemOrSerial ? itemOrSerial.name : '';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    const response = await fetch(printerUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const responseText = await response.text().catch(() => '');

    if (!response.ok) {
      return {
        ok: false,
        serial_number: serial,
        printer_url: printerUrl,
        payload,
        status: response.status,
        error: `Błąd drukarki (HTTP ${response.status})${responseText ? `: ${responseText.slice(0, 120)}` : ''}`
      };
    }

    const now = new Date().toISOString();
    if (serial) {
      db.prepare(`UPDATE inventory_items SET printed_at = ?, updated_at = ? WHERE serial_number = ?`).run(
        now,
        now,
        serial
      );
    }
    logActivity(db, 'printed', serial, itemName, { printer_url: printerUrl, payload });

    return {
      ok: true,
      serial_number: serial,
      printer_url: printerUrl,
      payload,
      status: response.status
    };
  } catch (err) {
    const isAbort = err && err.name === 'AbortError';
    return {
      ok: false,
      serial_number: serial,
      printer_url: printerUrl,
      payload,
      error: isAbort
        ? `Przekroczono czas oczekiwania na drukarkę (${printerUrl})`
        : `Brak połączenia z drukarką (${printerUrl}): ${err.message || 'nieznany błąd'}`
    };
  }
}

async function generateQrSvg(qrText) {
  return QRCode.toString(String(qrText || ''), {
    type: 'svg',
    margin: 1,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff'
    }
  });
}

module.exports = {
  buildPrintPayload,
  printLabel,
  generateQrSvg
};

