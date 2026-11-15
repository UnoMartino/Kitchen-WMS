const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const {
  getDb,
  getLocations,
  getCategories,
  setLocations,
  setCategories,
  sequenceToSerial,
  serialToSequence,
  extractSerialNumber,
  generateNextSerial,
  peekNextSerial,
  getSettings,
  updateSettings,
  logActivity
} = require('./db');
const { lookupEan, saveToEanCatalog, searchLocalCatalog, normalizeEan } = require('./ean');
const { buildPrintPayload, printLabel, generateQrSvg } = require('./printer');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const DIST_DIR = path.join(__dirname, '..', 'dist');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function getTodayDateString() {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(new Date());
}

function addDaysToDateString(dateStr, days) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + Number(days));
  return dt.toISOString().slice(0, 10);
}

function diffDays(targetDateStr, todayStr = getTodayDateString()) {
  if (!targetDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(targetDateStr)) return null;
  const [ty, tm, td] = targetDateStr.split('-').map(Number);
  const [cy, cm, cd] = todayStr.split('-').map(Number);
  const targetMs = Date.UTC(ty, tm - 1, td);
  const todayMs = Date.UTC(cy, cm - 1, cd);
  return Math.round((targetMs - todayMs) / (1000 * 60 * 60 * 24));
}

function enrichItem(row, warningDays = 7, todayStr = getTodayDateString()) {
  if (!row) return null;

  let effectiveExpiry = row.expiry_date || null;
  let openedExpiry = null;

  if (row.is_opened && row.opened_at && row.days_after_opening) {
    const openedDateOnly = String(row.opened_at).slice(0, 10);
    openedExpiry = addDaysToDateString(openedDateOnly, row.days_after_opening);
    if (openedExpiry && (!effectiveExpiry || openedExpiry < effectiveExpiry)) {
      effectiveExpiry = openedExpiry;
    }
  }

  const daysRemaining = diffDays(effectiveExpiry, todayStr);
  let expiryStatus = 'none';
  if (daysRemaining !== null) {
    if (daysRemaining < 0) expiryStatus = 'expired';
    else if (daysRemaining === 0) expiryStatus = 'today';
    else if (daysRemaining <= 3) expiryStatus = 'urgent';
    else if (daysRemaining <= warningDays) expiryStatus = 'soon';
    else expiryStatus = 'ok';
  }

  const initialQty = row.initial_quantity > 0 ? row.initial_quantity : row.quantity || 1;
  const percentRemaining = Math.max(0, Math.min(100, Math.round((row.quantity / initialQty) * 100)));

  return {
    ...row,
    is_opened: Boolean(row.is_opened),
    effective_expiry_date: effectiveExpiry,
    opened_expiry_date: openedExpiry,
    days_remaining: daysRemaining,
    expiry_status: expiryStatus,
    percent_remaining: percentRemaining
  };
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error('Payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (_) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function getRequestOrigin(req) {
  const host = req.headers.host || `localhost:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return `${proto}://${host}`;
}

function createAppServer(customDbPath) {
  const db = getDb(customDbPath);

  const server = http.createServer(async (req, res) => {
    try {
      const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = reqUrl.pathname;
      const method = req.method.toUpperCase();

      // Health check
      if (pathname === '/api/health' && method === 'GET') {
        return sendJson(res, 200, {
          ok: true,
          today: getTodayDateString(),
          next_serial: peekNextSerial(db)
        });
      }

      // Taxonomy (configurable locations & categories)
      if (pathname === '/api/taxonomy' && method === 'GET') {
        return sendJson(res, 200, {
          locations: getLocations(db),
          categories: getCategories(db)
        });
      }

      if (pathname === '/api/taxonomy' && method === 'PUT') {
        const body = await parseJsonBody(req);
        if (body.locations !== undefined) {
          setLocations(db, body.locations, body.rename_location || {});
        }
        if (body.categories !== undefined) {
          setCategories(db, body.categories, body.rename_category || {});
        }
        return sendJson(res, 200, {
          ok: true,
          locations: getLocations(db),
          categories: getCategories(db)
        });
      }

      // Dashboard & summary stats
      if (pathname === '/api/stats' && method === 'GET') {
        const settings = getSettings(db);
        const warningDays = parseInt(settings.expiry_warning_days || '7', 10) || 7;
        const todayStr = getTodayDateString();
        const allRows = db.prepare(`SELECT * FROM inventory_items`).all();
        const enriched = allRows.map((r) => enrichItem(r, warningDays, todayStr));

        let expiredCount = 0;
        let expiring3dCount = 0;
        let expiring7dCount = 0;
        let openedCount = 0;

        const locations = getLocations(db);
        const categories = getCategories(db);
        const byLocation = {};
        for (const loc of locations) byLocation[loc] = 0;
        const byCategory = {};
        for (const cat of categories) byCategory[cat] = 0;

        for (const item of enriched) {
          if (item.is_opened) openedCount += 1;
          if (item.days_remaining !== null) {
            if (item.days_remaining < 0) expiredCount += 1;
            if (item.days_remaining >= 0 && item.days_remaining <= 3) expiring3dCount += 1;
            if (item.days_remaining >= 0 && item.days_remaining <= warningDays) expiring7dCount += 1;
          }
          byLocation[item.location] = (byLocation[item.location] || 0) + 1;
          byCategory[item.category] = (byCategory[item.category] || 0) + 1;
        }

        return sendJson(res, 200, {
          total_items: enriched.length,
          expired_count: expiredCount,
          expiring_3d_count: expiring3dCount,
          expiring_7d_count: expiring7dCount,
          attention_count: expiredCount + expiring7dCount,
          opened_count: openedCount,
          warning_days: warningDays,
          next_serial: peekNextSerial(db),
          today: todayStr,
          locations,
          categories,
          by_location: byLocation,
          by_category: byCategory
        });
      }

      // List & search inventory items
      if (pathname === '/api/items' && method === 'GET') {
        const settings = getSettings(db);
        const warningDays =
          parseInt(reqUrl.searchParams.get('days') || settings.expiry_warning_days || '7', 10) || 7;
        const q = (reqUrl.searchParams.get('q') || '').trim();
        const location = (reqUrl.searchParams.get('location') || '').trim();
        const category = (reqUrl.searchParams.get('category') || '').trim();
        const status = (reqUrl.searchParams.get('status') || 'all').trim();
        const sort = (reqUrl.searchParams.get('sort') || 'expiry_asc').trim();

        const conditions = [];
        const params = [];

        if (location && location !== 'all') {
          conditions.push(`location = ?`);
          params.push(location);
        }
        if (category && category !== 'all') {
          conditions.push(`category = ?`);
          params.push(category);
        }
        if (q) {
          const normalizedSerial = extractSerialNumber(q);
          const qLike = `%${q.toLowerCase()}%`;
          if (normalizedSerial) {
            conditions.push(`(
              UPPER(serial_number) = ?
              OR LOWER(serial_number) LIKE ?
              OR LOWER(name) LIKE ?
              OR LOWER(brand) LIKE ?
              OR ean LIKE ?
              OR LOWER(category) LIKE ?
              OR LOWER(notes) LIKE ?
              OR LOWER(ingredients_text) LIKE ?
            )`);
            params.push(normalizedSerial, qLike, qLike, qLike, qLike, qLike, qLike, qLike);
          } else {
            conditions.push(`(
              LOWER(serial_number) LIKE ?
              OR LOWER(name) LIKE ?
              OR LOWER(brand) LIKE ?
              OR ean LIKE ?
              OR LOWER(category) LIKE ?
              OR LOWER(notes) LIKE ?
              OR LOWER(ingredients_text) LIKE ?
            )`);
            params.push(qLike, qLike, qLike, qLike, qLike, qLike, qLike);
          }
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const rows = db.prepare(`SELECT * FROM inventory_items ${whereClause}`).all(...params);
        const todayStr = getTodayDateString();
        let items = rows.map((r) => enrichItem(r, warningDays, todayStr));

        if (status === 'expiring') {
          items = items.filter((i) => i.days_remaining !== null && i.days_remaining <= warningDays);
        } else if (status === 'expired') {
          items = items.filter((i) => i.days_remaining !== null && i.days_remaining < 0);
        } else if (status === 'soon_only') {
          items = items.filter(
            (i) => i.days_remaining !== null && i.days_remaining >= 0 && i.days_remaining <= warningDays
          );
        } else if (status === 'urgent') {
          items = items.filter((i) => i.days_remaining !== null && i.days_remaining <= 3);
        } else if (status === 'opened') {
          items = items.filter((i) => i.is_opened);
        } else if (status === 'fresh') {
          items = items.filter((i) => i.days_remaining === null || i.days_remaining > warningDays);
        }

        items.sort((a, b) => {
          if (sort === 'created_desc') {
            return b.created_at.localeCompare(a.created_at) || b.id - a.id;
          }
          if (sort === 'name_asc') {
            return a.name.localeCompare(b.name, 'pl');
          }
          if (sort === 'serial_asc') {
            return a.serial_number.localeCompare(b.serial_number);
          }
          const da = a.days_remaining === null ? 999999 : a.days_remaining;
          const dbVal = b.days_remaining === null ? 999999 : b.days_remaining;
          if (da !== dbVal) return da - dbVal;
          return a.name.localeCompare(b.name, 'pl');
        });

        return sendJson(res, 200, {
          items,
          total: items.length,
          today: todayStr,
          warning_days: warningDays
        });
      }

      // Lookup item by serial number
      if (pathname.startsWith('/api/items/by-serial/') && method === 'GET') {
        const rawSerial = decodeURIComponent(pathname.slice('/api/items/by-serial/'.length));
        const serial = extractSerialNumber(rawSerial);
        if (!serial) {
          return sendJson(res, 400, {
            found: false,
            error: `Nieprawidłowy format numeru seryjnego: "${rawSerial}" (oczekiwano formatu AAA-1111).`
          });
        }

        const row = db.prepare(`SELECT * FROM inventory_items WHERE serial_number = ?`).get(serial);
        if (!row) {
          const lastLog = db
            .prepare(`
              SELECT * FROM activity_log
              WHERE serial_number = ?
              ORDER BY id DESC LIMIT 1
            `)
            .get(serial);

          return sendJson(res, 404, {
            found: false,
            serial_number: serial,
            last_activity: lastLog
              ? {
                  ...lastLog,
                  details: safeParseJson(lastLog.details)
                }
              : null,
            error: `Produkt o numerze ${serial} nie znajduje się w magazynie.`
          });
        }

        const settings = getSettings(db);
        const warningDays = parseInt(settings.expiry_warning_days || '7', 10) || 7;
        const item = enrichItem(row, warningDays);
        const printPayload = buildPrintPayload(db, item, getRequestOrigin(req));
        const qrSvg = await generateQrSvg(printPayload.qr_text);

        return sendJson(res, 200, {
          found: true,
          item,
          qr_svg: qrSvg,
          print_payload: printPayload
        });
      }

      // Add new item (or batch of items)
      if (pathname === '/api/items' && method === 'POST') {
        const body = await parseJsonBody(req);
        const name = String(body.name || '').trim();
        if (!name) {
          return sendJson(res, 400, { error: 'Nazwa produktu jest wymagana.' });
        }

        const locations = getLocations(db);
        const categories = getCategories(db);

        const brand = String(body.brand || '').trim();
        const ean = normalizeEan(body.ean || '');
        const category = String(body.category || categories[0] || 'Inne').trim();
        const location = String(body.location || locations[0] || 'Spiżarnia').trim();
        const quantity = Math.max(0.01, Number(body.quantity) || 1);
        const initialQuantity = Math.max(quantity, Number(body.initial_quantity) || quantity);
        const unit = String(body.unit || 'szt.').trim();
        const expiryDate = body.expiry_date ? String(body.expiry_date).trim() : null;
        const isOpened = body.is_opened ? 1 : 0;
        const openedAt = isOpened ? new Date().toISOString() : null;
        const daysAfterOpening = body.days_after_opening ? parseInt(body.days_after_opening, 10) : null;
        const imageUrl = String(body.image_url || '').trim();
        const notes = String(body.notes || '').trim();
        const ingredientsText = String(body.ingredients_text || '').trim();
        const batchCount = Math.min(50, Math.max(1, parseInt(body.batch_count || '1', 10) || 1));

        const settings = getSettings(db);
        const shouldAutoPrint =
          body.auto_print !== undefined
            ? Boolean(body.auto_print)
            : settings.printer_auto_print === 'true';

        if (ean && ean.length >= 8) {
          saveToEanCatalog(db, {
            ean,
            name,
            brand,
            category,
            default_location: location,
            default_quantity: quantity,
            default_unit: unit,
            ingredients_text: ingredientsText,
            image_url: imageUrl,
            source: 'user'
          });
        }

        const now = new Date().toISOString();
        const insertStmt = db.prepare(`
          INSERT INTO inventory_items (
            serial_number, name, brand, ean, category, location,
            quantity, initial_quantity, unit, expiry_date,
            is_opened, opened_at, days_after_opening,
            image_url, notes, ingredients_text, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const createdItems = [];
        db.exec('BEGIN IMMEDIATE TRANSACTION;');
        try {
          for (let i = 0; i < batchCount; i++) {
            const serialNumber = generateNextSerial(db);
            const result = insertStmt.run(
              serialNumber,
              name,
              brand,
              ean,
              category,
              location,
              quantity,
              initialQuantity,
              unit,
              expiryDate,
              isOpened,
              openedAt,
              daysAfterOpening,
              imageUrl,
              notes,
              ingredientsText,
              now,
              now
            );
            const row = db
              .prepare(`SELECT * FROM inventory_items WHERE id = ?`)
              .get(result.lastInsertRowid);
            logActivity(db, 'added', serialNumber, name, {
              location,
              category,
              quantity,
              unit,
              expiry_date: expiryDate
            });
            createdItems.push(row);
          }
          db.exec('COMMIT;');
        } catch (txErr) {
          db.exec('ROLLBACK;');
          throw txErr;
        }

        const warningDays = parseInt(settings.expiry_warning_days || '7', 10) || 7;
        const origin = getRequestOrigin(req);
        const enrichedItems = [];
        const printResults = [];

        for (const item of createdItems) {
          let printRes = null;
          if (shouldAutoPrint) {
            printRes = await printLabel(db, item, { requestOrigin: origin });
            printResults.push(printRes);
          }
          const updatedRow = db.prepare(`SELECT * FROM inventory_items WHERE id = ?`).get(item.id);
          const payload = buildPrintPayload(db, updatedRow, origin);
          const qrSvg = await generateQrSvg(payload.qr_text);
          enrichedItems.push({
            ...enrichItem(updatedRow, warningDays),
            qr_svg: qrSvg,
            print_payload: payload,
            print_result: printRes
          });
        }

        return sendJson(res, 201, {
          ok: true,
          count: enrichedItems.length,
          items: enrichedItems,
          print_results: printResults,
          next_serial: peekNextSerial(db)
        });
      }

      // Update item by ID or by serial
      if (
        (pathname.startsWith('/api/items/') && method === 'PATCH') ||
        (pathname.startsWith('/api/items/by-serial/') && method === 'PATCH')
      ) {
        let existing = null;
        if (pathname.startsWith('/api/items/by-serial/')) {
          const rawSerial = decodeURIComponent(pathname.slice('/api/items/by-serial/'.length));
          const serial = extractSerialNumber(rawSerial);
          existing = serial
            ? db.prepare(`SELECT * FROM inventory_items WHERE serial_number = ?`).get(serial)
            : null;
        } else {
          const id = parseInt(pathname.slice('/api/items/'.length), 10);
          existing = id ? db.prepare(`SELECT * FROM inventory_items WHERE id = ?`).get(id) : null;
        }

        if (!existing) {
          return sendJson(res, 404, { error: 'Nie znaleziono produktu w magazynie.' });
        }

        const body = await parseJsonBody(req);
        const now = new Date().toISOString();
        const settings = getSettings(db);
        const warningDays = parseInt(settings.expiry_warning_days || '7', 10) || 7;

        if (body.action === 'open') {
          const daysAfter =
            body.days_after_opening !== undefined
              ? parseInt(body.days_after_opening, 10) || null
              : existing.days_after_opening || 3;
          db.prepare(`
            UPDATE inventory_items
            SET is_opened = 1, opened_at = ?, days_after_opening = ?, updated_at = ?
            WHERE id = ?
          `).run(now, daysAfter, now, existing.id);

          logActivity(db, 'opened', existing.serial_number, existing.name, {
            days_after_opening: daysAfter
          });

          const updated = db.prepare(`SELECT * FROM inventory_items WHERE id = ?`).get(existing.id);
          return sendJson(res, 200, { ok: true, item: enrichItem(updated, warningDays) });
        }

        if (body.action === 'consume_partial') {
          let newQty = existing.quantity;
          if (body.fraction) {
            const delta = existing.initial_quantity * Number(body.fraction);
            newQty = Math.round((existing.quantity - delta) * 100) / 100;
          } else if (body.delta !== undefined) {
            newQty = Math.round((existing.quantity - Number(body.delta)) * 100) / 100;
          } else if (body.quantity !== undefined) {
            newQty = Number(body.quantity);
          }

          if (newQty <= 0) {
            db.prepare(`DELETE FROM inventory_items WHERE id = ?`).run(existing.id);
            const logStmt = db.prepare(`
              INSERT INTO activity_log (action, serial_number, item_name, details, created_at)
              VALUES (?, ?, ?, ?, ?)
            `);
            const logRes = logStmt.run(
              'consumed',
              existing.serial_number,
              existing.name,
              JSON.stringify({ snapshot: existing }),
              now
            );
            return sendJson(res, 200, {
              ok: true,
              deleted: true,
              serial_number: existing.serial_number,
              activity_id: logRes.lastInsertRowid,
              message: `Produkt ${existing.name} (${existing.serial_number}) został całkowicie zużyty i usunięty z magazynu.`
            });
          }

          const markOpened = body.mark_opened !== false ? 1 : existing.is_opened;
          const openedAt = !existing.is_opened && markOpened ? now : existing.opened_at;

          db.prepare(`
            UPDATE inventory_items
            SET quantity = ?, is_opened = ?, opened_at = ?, updated_at = ?
            WHERE id = ?
          `).run(newQty, markOpened, openedAt, now, existing.id);

          logActivity(db, 'updated', existing.serial_number, existing.name, {
            previous_quantity: existing.quantity,
            new_quantity: newQty,
            unit: existing.unit
          });

          const updated = db.prepare(`SELECT * FROM inventory_items WHERE id = ?`).get(existing.id);
          return sendJson(res, 200, { ok: true, item: enrichItem(updated, warningDays) });
        }

        const updatedFields = {
          name: body.name !== undefined ? String(body.name).trim() : existing.name,
          brand: body.brand !== undefined ? String(body.brand).trim() : existing.brand,
          ean: body.ean !== undefined ? normalizeEan(body.ean) : existing.ean,
          category: body.category !== undefined ? String(body.category).trim() : existing.category,
          location: body.location !== undefined ? String(body.location).trim() : existing.location,
          quantity: body.quantity !== undefined ? Math.max(0.01, Number(body.quantity)) : existing.quantity,
          initial_quantity:
            body.initial_quantity !== undefined
              ? Math.max(0.01, Number(body.initial_quantity))
              : existing.initial_quantity,
          unit: body.unit !== undefined ? String(body.unit).trim() : existing.unit,
          expiry_date:
            body.expiry_date !== undefined
              ? body.expiry_date
                ? String(body.expiry_date).trim()
                : null
              : existing.expiry_date,
          is_opened:
            body.is_opened !== undefined ? (body.is_opened ? 1 : 0) : existing.is_opened,
          opened_at:
            body.is_opened !== undefined
              ? body.is_opened
                ? existing.opened_at || now
                : null
              : existing.opened_at,
          days_after_opening:
            body.days_after_opening !== undefined
              ? body.days_after_opening
                ? parseInt(body.days_after_opening, 10)
                : null
              : existing.days_after_opening,
          notes: body.notes !== undefined ? String(body.notes).trim() : existing.notes,
          ingredients_text:
            body.ingredients_text !== undefined
              ? String(body.ingredients_text).trim()
              : existing.ingredients_text
        };

        db.prepare(`
          UPDATE inventory_items
          SET name = ?, brand = ?, ean = ?, category = ?, location = ?,
              quantity = ?, initial_quantity = ?, unit = ?, expiry_date = ?,
              is_opened = ?, opened_at = ?, days_after_opening = ?,
              notes = ?, ingredients_text = ?, updated_at = ?
          WHERE id = ?
        `).run(
          updatedFields.name,
          updatedFields.brand,
          updatedFields.ean,
          updatedFields.category,
          updatedFields.location,
          updatedFields.quantity,
          updatedFields.initial_quantity,
          updatedFields.unit,
          updatedFields.expiry_date,
          updatedFields.is_opened,
          updatedFields.opened_at,
          updatedFields.days_after_opening,
          updatedFields.notes,
          updatedFields.ingredients_text,
          now,
          existing.id
        );

        logActivity(db, 'updated', existing.serial_number, updatedFields.name, {
          location: updatedFields.location,
          quantity: updatedFields.quantity,
          unit: updatedFields.unit,
          expiry_date: updatedFields.expiry_date
        });

        const updated = db.prepare(`SELECT * FROM inventory_items WHERE id = ?`).get(existing.id);
        return sendJson(res, 200, { ok: true, item: enrichItem(updated, warningDays) });
      }

      // Delete / consume item by ID or by serial
      if (
        (pathname.startsWith('/api/items/') && method === 'DELETE') ||
        (pathname.startsWith('/api/items/by-serial/') && method === 'DELETE')
      ) {
        let existing = null;
        if (pathname.startsWith('/api/items/by-serial/')) {
          const rawSerial = decodeURIComponent(pathname.slice('/api/items/by-serial/'.length));
          const serial = extractSerialNumber(rawSerial);
          existing = serial
            ? db.prepare(`SELECT * FROM inventory_items WHERE serial_number = ?`).get(serial)
            : null;
        } else {
          const id = parseInt(pathname.slice('/api/items/'.length), 10);
          existing = id ? db.prepare(`SELECT * FROM inventory_items WHERE id = ?`).get(id) : null;
        }

        if (!existing) {
          return sendJson(res, 404, { error: 'Produkt nie został znaleziony lub został już usunięty.' });
        }

        const reason = reqUrl.searchParams.get('reason') || 'consumed';
        db.prepare(`DELETE FROM inventory_items WHERE id = ?`).run(existing.id);

        const now = new Date().toISOString();
        const logRes = db
          .prepare(`
            INSERT INTO activity_log (action, serial_number, item_name, details, created_at)
            VALUES (?, ?, ?, ?, ?)
          `)
          .run(
            reason === 'deleted' ? 'deleted' : 'consumed',
            existing.serial_number,
            existing.name,
            JSON.stringify({ snapshot: existing }),
            now
          );

        return sendJson(res, 200, {
          ok: true,
          deleted: existing,
          activity_id: logRes.lastInsertRowid,
          message: `Usunięto ${existing.name} (${existing.serial_number}) z magazynu.`
        });
      }

      // Restore deleted item from activity_log
      if (pathname.match(/^\/api\/activity\/\d+\/restore$/) && method === 'POST') {
        const actId = parseInt(pathname.split('/')[3], 10);
        const logRow = db.prepare(`SELECT * FROM activity_log WHERE id = ?`).get(actId);
        if (!logRow) {
          return sendJson(res, 404, { error: 'Nie znaleziono wpisu w historii.' });
        }
        const details = safeParseJson(logRow.details);
        const snap = details && details.snapshot;
        if (!snap || !snap.serial_number) {
          return sendJson(res, 400, { error: 'Ten wpis nie zawiera migawki produktu do przywrócenia.' });
        }

        const alreadyExists = db
          .prepare(`SELECT id FROM inventory_items WHERE serial_number = ?`)
          .get(snap.serial_number);
        if (alreadyExists) {
          return sendJson(res, 409, {
            error: `Produkt o numerze ${snap.serial_number} już znajduje się w magazynie.`
          });
        }

        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO inventory_items (
            serial_number, name, brand, ean, category, location,
            quantity, initial_quantity, unit, expiry_date,
            is_opened, opened_at, days_after_opening,
            image_url, notes, ingredients_text, printed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          snap.serial_number,
          snap.name,
          snap.brand || '',
          snap.ean || '',
          snap.category || 'Inne',
          snap.location || 'Spiżarnia',
          snap.quantity || 1,
          snap.initial_quantity || snap.quantity || 1,
          snap.unit || 'szt.',
          snap.expiry_date || null,
          snap.is_opened ? 1 : 0,
          snap.opened_at || null,
          snap.days_after_opening || null,
          snap.image_url || '',
          snap.notes || '',
          snap.ingredients_text || '',
          snap.printed_at || null,
          snap.created_at || now,
          now
        );

        logActivity(db, 'restored', snap.serial_number, snap.name, {});
        const restored = db
          .prepare(`SELECT * FROM inventory_items WHERE serial_number = ?`)
          .get(snap.serial_number);
        return sendJson(res, 200, {
          ok: true,
          item: enrichItem(restored),
          message: `Przywrócono ${snap.name} (${snap.serial_number}).`
        });
      }

      // Polish EAN Database lookup
      if (pathname.startsWith('/api/ean/') && method === 'GET') {
        const code = decodeURIComponent(pathname.slice('/api/ean/'.length));
        const forceRefresh = reqUrl.searchParams.get('refresh') === '1';
        const lookupResult = await lookupEan(db, code, { forceRefresh });

        const cleanEan = normalizeEan(code);
        const existingInStock = cleanEan
          ? db
              .prepare(`SELECT * FROM inventory_items WHERE ean = ? ORDER BY expiry_date ASC`)
              .all(cleanEan)
              .map((r) => enrichItem(r))
          : [];

        return sendJson(res, 200, {
          ...lookupResult,
          in_stock_count: existingInStock.length,
          in_stock_items: existingInStock
        });
      }

      // Local Polish EAN Catalog search / autocomplete
      if (pathname === '/api/catalog' && method === 'GET') {
        const q = reqUrl.searchParams.get('q') || '';
        const items = searchLocalCatalog(db, q, 20);
        return sendJson(res, 200, { items });
      }

      // Print / Reprint QR Label(s) (Single or Batch) via Printer API
      if ((pathname === '/api/print' || pathname === '/api/print/batch') && method === 'POST') {
        const body = await parseJsonBody(req);
        const origin = getRequestOrigin(req);
        const copies = Math.min(20, Math.max(1, parseInt(body.copies || '1', 10) || 1));
        const previewOnly = Boolean(body.preview_only);

        let serialList = [];

        if (body.from_serial && body.to_serial) {
          const fromNorm = extractSerialNumber(body.from_serial);
          const toNorm = extractSerialNumber(body.to_serial);
          const startSeq = serialToSequence(fromNorm);
          const endSeq = serialToSequence(toNorm);
          if (!startSeq || !endSeq) {
            return sendJson(res, 400, {
              error: 'Nieprawidłowy format zakresu numerów seryjnych (wymagany format AAA-1111).'
            });
          }
          if (startSeq > endSeq) {
            return sendJson(res, 400, {
              error: 'Początkowy numer seryjny musi być mniejszy lub równy końcowemu.'
            });
          }
          if (endSeq - startSeq + 1 > 100) {
            return sendJson(res, 400, {
              error: 'Maksymalny rozmiar pojedynczej serii dodruku to 100 etykiet.'
            });
          }
          for (let seq = startSeq; seq <= endSeq; seq++) {
            serialList.push(sequenceToSerial(seq));
          }
        } else if (Array.isArray(body.serial_numbers) && body.serial_numbers.length > 0) {
          serialList = body.serial_numbers
            .map((s) => extractSerialNumber(String(s)) || String(s).trim())
            .filter(Boolean);
        } else if (typeof body.serial_numbers === 'string' && body.serial_numbers.trim()) {
          serialList = body.serial_numbers
            .split(/[\n,;]+/)
            .map((s) => extractSerialNumber(s) || s.trim())
            .filter(Boolean);
        }

        if (serialList.length > 0 || pathname === '/api/print/batch') {
          if (serialList.length === 0 && body.serial_number) {
            serialList = [extractSerialNumber(body.serial_number) || String(body.serial_number).trim()];
          }
          if (serialList.length === 0) {
            return sendJson(res, 400, {
              error: 'Wybierz co najmniej jeden numer seryjny do dodruku.'
            });
          }
          if (serialList.length > 100) {
            return sendJson(res, 400, {
              error: 'Maksymalna liczba pozycji w jednym dodruku seryjnym to 100.'
            });
          }

          const labels = [];
          const results = [];
          let printedCount = 0;
          let failedCount = 0;

          for (const rawSerial of serialList) {
            const serial = extractSerialNumber(rawSerial) || rawSerial;
            const item = db
              .prepare(`SELECT * FROM inventory_items WHERE serial_number = ?`)
              .get(serial);
            const payload = buildPrintPayload(db, item || serial, origin);
            const qrSvg = await generateQrSvg(payload.qr_text);

            for (let c = 0; c < copies; c++) {
              let printRes = null;
              if (!previewOnly) {
                printRes = await printLabel(db, item || serial, { requestOrigin: origin });
                results.push(printRes);
                if (printRes.ok) printedCount += 1;
                else failedCount += 1;
              }
              labels.push({
                serial_number: serial,
                name: item ? item.name : 'Etykieta seryjna',
                qr_svg: qrSvg,
                print_payload: payload,
                print_result: printRes
              });
            }
          }

          const allOk = previewOnly || failedCount === 0;
          return sendJson(res, allOk ? 200 : 207, {
            ok: allOk,
            batch: true,
            preview_only: previewOnly,
            total_labels: labels.length,
            printed_count: printedCount,
            failed_count: failedCount,
            copies,
            labels,
            results
          });
        }

        if (body.serial_number) {
          const serial = extractSerialNumber(body.serial_number) || body.serial_number;
          const item = db
            .prepare(`SELECT * FROM inventory_items WHERE serial_number = ?`)
            .get(serial);
          const payload = buildPrintPayload(db, item || serial, origin);
          const qrSvg = await generateQrSvg(body.qr_text || payload.qr_text);

          const results = [];
          let lastResult = null;
          for (let c = 0; c < copies; c++) {
            lastResult = await printLabel(db, item || serial, {
              requestOrigin: origin,
              customText: body.text,
              customQrText: body.qr_text
            });
            results.push(lastResult);
          }

          const allOk = results.every((r) => r.ok);
          return sendJson(res, allOk ? 200 : 502, {
            ...lastResult,
            ok: allOk,
            copies,
            qr_svg: qrSvg,
            item_name: item ? item.name : '',
            results
          });
        }

        if (body.text) {
          const result = await printLabel(db, body.text, {
            requestOrigin: origin,
            customText: body.text,
            customQrText: body.qr_text || body.text
          });
          return sendJson(res, result.ok ? 200 : 502, result);
        }

        return sendJson(res, 400, {
          error: 'Wymagany numer seryjny (serial_number), lista (serial_numbers) lub tekst etykiety (text).'
        });
      }

      // Get QR Code SVG for any serial or text
      if (pathname.startsWith('/api/qr/') && method === 'GET') {
        const rawSerial = decodeURIComponent(pathname.slice('/api/qr/'.length));
        const serial = extractSerialNumber(rawSerial) || rawSerial;
        const payload = buildPrintPayload(db, serial, getRequestOrigin(req));
        const svg = await generateQrSvg(payload.qr_text);
        return sendJson(res, 200, {
          serial_number: serial,
          payload,
          qr_svg: svg
        });
      }

      // Settings GET & PUT
      if (pathname === '/api/settings' && method === 'GET') {
        return sendJson(res, 200, {
          settings: getSettings(db),
          next_serial: peekNextSerial(db)
        });
      }

      if (pathname === '/api/settings' && method === 'PUT') {
        const body = await parseJsonBody(req);
        const updated = updateSettings(db, body);
        return sendJson(res, 200, {
          ok: true,
          settings: updated,
          next_serial: peekNextSerial(db)
        });
      }

      // Activity log GET
      if (pathname === '/api/activity' && method === 'GET') {
        const limit = Math.min(100, parseInt(reqUrl.searchParams.get('limit') || '30', 10) || 30);
        const rows = db
          .prepare(`SELECT * FROM activity_log ORDER BY id DESC LIMIT ?`)
          .all(limit)
          .map((r) => ({
            ...r,
            details: safeParseJson(r.details)
          }));
        return sendJson(res, 200, { activity: rows });
      }

      // Serve built Vite SPA from dist/ (or public/ fallback)
      let relativePath = pathname === '/' ? '/index.html' : pathname;
      if (/^\/[A-Za-z]{3}-\d{4}$/.test(pathname)) {
        relativePath = '/index.html';
      }

      const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, '');
      const distFile = path.join(DIST_DIR, safePath);
      const publicFile = path.join(PUBLIC_DIR, safePath);

      const targetFile =
        distFile.startsWith(DIST_DIR) && fs.existsSync(distFile) && fs.statSync(distFile).isFile()
          ? distFile
          : publicFile.startsWith(PUBLIC_DIR) &&
              fs.existsSync(publicFile) &&
              fs.statSync(publicFile).isFile()
            ? publicFile
            : null;

      if (targetFile) {
        const ext = path.extname(targetFile).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        return fs.createReadStream(targetFile).pipe(res);
      }

      // SPA fallback to dist/index.html for non-API GET routes
      const distIndex = path.join(DIST_DIR, 'index.html');
      if (method === 'GET' && !pathname.startsWith('/api/') && fs.existsSync(distIndex)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return fs.createReadStream(distIndex).pipe(res);
      }

      return sendJson(res, 404, { error: 'Nie znaleziono zasobu.' });
    } catch (err) {
      console.error('Server error:', err);
      return sendJson(res, 500, { error: err.message || 'Wewnętrzny błąd serwera.' });
    }
  });

  return { server, db };
}

function safeParseJson(str) {
  if (!str) return {};
  try {
    return JSON.parse(str);
  } catch (_) {
    return {};
  }
}

if (require.main === module) {
  const { server } = createAppServer();
  server.listen(PORT, HOST, () => {
    console.log(`Spiżarnia WMS działa pod adresem http://${HOST}:${PORT}`);
  });
}

module.exports = { createAppServer, getTodayDateString, diffDays };

