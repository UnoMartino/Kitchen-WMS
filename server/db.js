const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DEFAULT_DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'kitchen.db');
const DEFAULT_PRINTER_URL = process.env.PRINTER_API_URL || 'http://10.10.20.2:8769/print';

const DEFAULT_LOCATIONS = [
  'Lodówka',
  'Zamrażarka',
  'Spiżarnia',
  'Szafka',
  'Blat'
];

const DEFAULT_CATEGORIES = [
  'Nabiał i jaja',
  'Mięso i ryby',
  'Warzywa i owoce',
  'Pieczywo',
  'Suche i sypkie',
  'Konserwy i przetwory',
  'Przyprawy i sosy',
  'Napoje',
  'Mrożonki',
  'Gotowe dania',
  'Inne'
];

let dbInstance = null;

function getDb(customPath) {
  if (dbInstance && !customPath) return dbInstance;
  const targetPath = customPath || DEFAULT_DB_PATH;
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(targetPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  initSchema(db);
  if (!customPath) {
    dbInstance = db;
  }
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serial_number TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      ean TEXT DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Inne',
      location TEXT NOT NULL DEFAULT 'Spiżarnia',
      quantity REAL NOT NULL DEFAULT 1,
      initial_quantity REAL NOT NULL DEFAULT 1,
      unit TEXT NOT NULL DEFAULT 'szt.',
      expiry_date TEXT,
      is_opened INTEGER NOT NULL DEFAULT 0,
      opened_at TEXT,
      days_after_opening INTEGER,
      image_url TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      ingredients_text TEXT DEFAULT '',
      printed_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_serial ON inventory_items(serial_number);
    CREATE INDEX IF NOT EXISTS idx_inventory_expiry ON inventory_items(expiry_date);
    CREATE INDEX IF NOT EXISTS idx_inventory_location ON inventory_items(location);
    CREATE INDEX IF NOT EXISTS idx_inventory_category ON inventory_items(category);
    CREATE INDEX IF NOT EXISTS idx_inventory_ean ON inventory_items(ean);

    CREATE TABLE IF NOT EXISTS ean_catalog (
      ean TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      brand TEXT DEFAULT '',
      category TEXT DEFAULT 'Inne',
      default_location TEXT DEFAULT 'Spiżarnia',
      default_quantity REAL DEFAULT 1,
      default_unit TEXT DEFAULT 'szt.',
      default_shelf_life_days INTEGER,
      ingredients_text TEXT DEFAULT '',
      image_url TEXT DEFAULT '',
      nutriscore TEXT DEFAULT '',
      source TEXT DEFAULT 'local',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      serial_number TEXT,
      item_name TEXT,
      details TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const now = new Date().toISOString();
  ensureDefaultSettings(db, now);

  seedPolishEanCatalog(db, now);
  repairInventoryPackageSizes(db);
}

function ensureDefaultSettings(db, now = new Date().toISOString()) {
  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `);

  insertSetting.run('serial_seq', '0', now);
  insertSetting.run('printer_api_url', DEFAULT_PRINTER_URL, now);
  insertSetting.run('printer_auto_print', 'true', now);
  insertSetting.run('printer_qr_mode', 'serial', now);
  insertSetting.run('printer_qr_base_url', '', now);
  insertSetting.run('expiry_warning_days', '7', now);
  insertSetting.run('locations', JSON.stringify(DEFAULT_LOCATIONS), now);
  insertSetting.run('categories', JSON.stringify(DEFAULT_CATEGORIES), now);
}

function normalizeStringList(input, fallbackList) {
  let arr = [];
  if (Array.isArray(input)) {
    arr = input;
  } else if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) arr = parsed;
      else arr = input.split(',').map((s) => s.trim());
    } catch (_) {
      arr = input.split(',').map((s) => s.trim());
    }
  }
  const seen = new Set();
  const clean = [];
  for (const item of arr) {
    const str = String(item || '').trim();
    if (str && !seen.has(str)) {
      seen.add(str);
      clean.push(str);
    }
  }
  return clean.length > 0 ? clean : [...fallbackList];
}

function getLocations(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'locations'`).get();
  if (!row) return [...DEFAULT_LOCATIONS];
  return normalizeStringList(row.value, DEFAULT_LOCATIONS);
}

function getCategories(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'categories'`).get();
  if (!row) return [...DEFAULT_CATEGORIES];
  return normalizeStringList(row.value, DEFAULT_CATEGORIES);
}

function setLocations(db, locationsInput, { renameFrom, renameTo } = {}) {
  const now = new Date().toISOString();
  const clean = normalizeStringList(locationsInput, DEFAULT_LOCATIONS);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('locations', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(clean), now);

  if (renameFrom && renameTo && renameFrom !== renameTo) {
    db.prepare(`UPDATE inventory_items SET location = ?, updated_at = ? WHERE location = ?`).run(
      renameTo,
      now,
      renameFrom
    );
    db.prepare(`UPDATE ean_catalog SET default_location = ?, updated_at = ? WHERE default_location = ?`).run(
      renameTo,
      now,
      renameFrom
    );
  }
  return clean;
}

function setCategories(db, categoriesInput, { renameFrom, renameTo } = {}) {
  const now = new Date().toISOString();
  const clean = normalizeStringList(categoriesInput, DEFAULT_CATEGORIES);
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ('categories', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(JSON.stringify(clean), now);

  if (renameFrom && renameTo && renameFrom !== renameTo) {
    db.prepare(`UPDATE inventory_items SET category = ?, updated_at = ? WHERE category = ?`).run(
      renameTo,
      now,
      renameFrom
    );
    db.prepare(`UPDATE ean_catalog SET category = ?, updated_at = ? WHERE category = ?`).run(
      renameTo,
      now,
      renameFrom
    );
  }
  return clean;
}

/**
 * Converts a 1-based sequence integer into AAA-1111 format.
 */
function sequenceToSerial(seqNum) {
  const n = Number(seqNum);
  if (!Number.isInteger(n) || n < 1 || n > 175742424) {
    throw new Error(`Sequence number out of range: ${seqNum}`);
  }
  const numPart = ((n - 1) % 9999) + 1;
  const letterIdx = Math.floor((n - 1) / 9999);

  const c3 = letterIdx % 26;
  const c2 = Math.floor(letterIdx / 26) % 26;
  const c1 = Math.floor(letterIdx / (26 * 26)) % 26;

  const letters =
    String.fromCharCode(65 + c1) +
    String.fromCharCode(65 + c2) +
    String.fromCharCode(65 + c3);
  const digits = String(numPart).padStart(4, '0');
  return `${letters}-${digits}`;
}

/**
 * Parses a serial string like AAA-0001 back to its 1-based sequence integer, or null if invalid.
 */
function serialToSequence(serial) {
  if (typeof serial !== 'string') return null;
  const match = serial.trim().toUpperCase().match(/^([A-Z]{3})-(\d{4})$/);
  if (!match) return null;
  const [, letters, digits] = match;
  const numPart = parseInt(digits, 10);
  if (numPart < 1 || numPart > 9999) return null;

  const c1 = letters.charCodeAt(0) - 65;
  const c2 = letters.charCodeAt(1) - 65;
  const c3 = letters.charCodeAt(2) - 65;
  const letterIdx = c1 * 26 * 26 + c2 * 26 + c3;
  return letterIdx * 9999 + numPart;
}

/**
 * Normalize user or scanner input into AAA-1111 if possible.
 */
function extractSerialNumber(rawInput) {
  if (!rawInput || typeof rawInput !== 'string') return null;
  const trimmed = rawInput.trim();

  const fullMatch = trimmed.toUpperCase().match(/\b([A-Z]{3})-?(\d{4})\b/);
  if (fullMatch) {
    const num = parseInt(fullMatch[2], 10);
    if (num >= 1 && num <= 9999) {
      return `${fullMatch[1]}-${fullMatch[2]}`;
    }
  }

  const shortDigits = trimmed.match(/^(\d{1,4})$/);
  if (shortDigits) {
    const num = parseInt(shortDigits[1], 10);
    if (num >= 1 && num <= 9999) {
      return `AAA-${String(num).padStart(4, '0')}`;
    }
  }

  return null;
}

function generateNextSerial(db) {
  const getSeq = db.prepare(`SELECT value FROM settings WHERE key = 'serial_seq'`);
  const updateSeq = db.prepare(`UPDATE settings SET value = ?, updated_at = ? WHERE key = 'serial_seq'`);
  const checkExists = db.prepare(`SELECT 1 FROM inventory_items WHERE serial_number = ?`);

  const row = getSeq.get();
  let seq = row ? parseInt(row.value, 10) || 0 : 0;
  let candidate = '';

  do {
    seq += 1;
    candidate = sequenceToSerial(seq);
  } while (checkExists.get(candidate));

  updateSeq.run(String(seq), new Date().toISOString());
  return candidate;
}

function peekNextSerial(db) {
  const getSeq = db.prepare(`SELECT value FROM settings WHERE key = 'serial_seq'`);
  const checkExists = db.prepare(`SELECT 1 FROM inventory_items WHERE serial_number = ?`);
  const row = getSeq.get();
  let seq = row ? parseInt(row.value, 10) || 0 : 0;
  let candidate = '';
  do {
    seq += 1;
    candidate = sequenceToSerial(seq);
  } while (checkExists.get(candidate));
  return candidate;
}

function getSettings(db) {
  const rows = db.prepare(`SELECT key, value FROM settings`).all();
  const result = {};
  for (const r of rows) {
    result[r.key] = r.value;
  }
  result.locations = getLocations(db);
  result.categories = getCategories(db);
  return result;
}

function updateSettings(db, patch) {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const scalarKeys = [
    'printer_api_url',
    'printer_auto_print',
    'printer_qr_mode',
    'printer_qr_base_url',
    'expiry_warning_days',
    'serial_seq'
  ];
  for (const key of scalarKeys) {
    if (patch[key] !== undefined && patch[key] !== null) {
      upsert.run(key, String(patch[key]).trim(), now);
    }
  }
  if (patch.locations !== undefined) {
    setLocations(db, patch.locations, patch.rename_location || {});
  }
  if (patch.categories !== undefined) {
    setCategories(db, patch.categories, patch.rename_category || {});
  }
  return getSettings(db);
}

function logActivity(db, action, serialNumber, itemName, detailsObj = {}) {
  const stmt = db.prepare(`
    INSERT INTO activity_log (action, serial_number, item_name, details, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(
    action,
    serialNumber || '',
    itemName || '',
    JSON.stringify(detailsObj),
    new Date().toISOString()
  );
}

function seedPolishEanCatalog(db, now) {
  const countRow = db.prepare(`SELECT COUNT(*) AS cnt FROM ean_catalog`).get();
  if (countRow && countRow.cnt > 0) return;

  const polishProducts = [
    {
      ean: '5900512300108',
      name: 'Mleko UHT Łaciate 3,2%',
      brand: 'Łaciate (Mlekpol)',
      category: 'Nabiał i jaja',
      default_location: 'Lodówka',
      default_quantity: 1000,
      default_unit: 'ml',
      default_shelf_life_days: 14,
      ingredients_text: 'mleko krowie 3,2% tłuszczu'
    },
    {
      ean: '5900512300115',
      name: 'Mleko UHT Łaciate 2,0%',
      brand: 'Łaciate (Mlekpol)',
      category: 'Nabiał i jaja',
      default_location: 'Lodówka',
      default_quantity: 1000,
      default_unit: 'ml',
      default_shelf_life_days: 14,
      ingredients_text: 'mleko krowie 2,0% tłuszczu'
    },
    {
      ean: '5900783000059',
      name: 'Majonez Kielecki',
      brand: 'WSP Społem Kielce',
      category: 'Przyprawy i sosy',
      default_location: 'Lodówka',
      default_quantity: 310,
      default_unit: 'g',
      default_shelf_life_days: 60,
      ingredients_text: 'olej rzepakowy, woda, żółtko jaja kurzego 7%, ocet, gorczyca, cukier, sól, przyprawy'
    },
    {
      ean: '5900397010017',
      name: 'Serek Wiejski Naturalny',
      brand: 'Piątnica',
      category: 'Nabiał i jaja',
      default_location: 'Lodówka',
      default_quantity: 200,
      default_unit: 'g',
      default_shelf_life_days: 10,
      ingredients_text: 'ziarna twarogu, śmietanka, sól'
    },
    {
      ean: '5900397732087',
      name: 'Twaróg Półtłusty Krajanka',
      brand: 'Piątnica',
      category: 'Nabiał i jaja',
      default_location: 'Lodówka',
      default_quantity: 250,
      default_unit: 'g',
      default_shelf_life_days: 10,
      ingredients_text: 'mleko pasteryzowane, kultury bakterii mlekowych'
    },
    {
      ean: '5900820000011',
      name: 'Masło Polskie Ekstra 82%',
      brand: 'Mlekovita',
      category: 'Nabiał i jaja',
      default_location: 'Lodówka',
      default_quantity: 200,
      default_unit: 'g',
      default_shelf_life_days: 21,
      ingredients_text: 'śmietanka pasteryzowana, zawartość tłuszczu 82%'
    },
    {
      ean: '5900073010119',
      name: 'Makaron Świderki (Fusilli)',
      brand: 'Lubella',
      category: 'Suche i sypkie',
      default_location: 'Spiżarnia',
      default_quantity: 400,
      default_unit: 'g',
      default_shelf_life_days: 365,
      ingredients_text: 'mąka makaronowa pszenna durum'
    },
    {
      ean: '5900073010034',
      name: 'Makaron Spaghetti',
      brand: 'Lubella',
      category: 'Suche i sypkie',
      default_location: 'Spiżarnia',
      default_quantity: 400,
      default_unit: 'g',
      default_shelf_life_days: 365,
      ingredients_text: 'mąka makaronowa pszenna durum'
    },
    {
      ean: '5900385000006',
      name: 'Ketchup Łagodny',
      brand: 'Kotlin',
      category: 'Przyprawy i sosy',
      default_location: 'Lodówka',
      default_quantity: 450,
      default_unit: 'g',
      default_shelf_life_days: 90,
      ingredients_text: 'pomidory, cukier, ocet, skrobia modyfikowana, sól, przyprawy'
    },
    {
      ean: '5900300540044',
      name: 'Ketchup Pikantny',
      brand: 'Pudliszki',
      category: 'Przyprawy i sosy',
      default_location: 'Lodówka',
      default_quantity: 480,
      default_unit: 'g',
      default_shelf_life_days: 90,
      ingredients_text: 'przecier pomidorowy, cukier, ocet, sól, przyprawy ostre'
    },
    {
      ean: '5900300542154',
      name: 'Kukurydza Złocista Konserwowa',
      brand: 'Bonduelle / Pudliszki',
      category: 'Konserwy i przetwory',
      default_location: 'Spiżarnia',
      default_quantity: 400,
      default_unit: 'g',
      default_shelf_life_days: 730,
      ingredients_text: 'kukurydza ziarnista, woda, sól'
    },
    {
      ean: '5900635000015',
      name: 'Mąka Pszenna Tortowa Typ 450',
      brand: 'Szymanowska',
      category: 'Suche i sypkie',
      default_location: 'Spiżarnia',
      default_quantity: 1000,
      default_unit: 'g',
      default_shelf_life_days: 300,
      ingredients_text: 'bielmo ziarna pszenicy 100%, mąka pszenna typ 450'
    },
    {
      ean: '5900668011002',
      name: 'Cukier Biały Kryształ',
      brand: 'Polski Cukier',
      category: 'Suche i sypkie',
      default_location: 'Spiżarnia',
      default_quantity: 1000,
      default_unit: 'g',
      default_shelf_life_days: 730,
      ingredients_text: 'cukier buraczany biały 100%'
    },
    {
      ean: '5900249010127',
      name: 'Olej Rzepakowy Kujawski',
      brand: 'Kujawski',
      category: 'Przyprawy i sosy',
      default_location: 'Spiżarnia',
      default_quantity: 1000,
      default_unit: 'ml',
      default_shelf_life_days: 365,
      ingredients_text: 'olej rzepakowy z pierwszego tłoczenia'
    },
    {
      ean: '5900497311007',
      name: 'Woda Mineralna Niegazowana',
      brand: 'Żywiec Zdrój',
      category: 'Napoje',
      default_location: 'Spiżarnia',
      default_quantity: 1500,
      default_unit: 'ml',
      default_shelf_life_days: 180,
      ingredients_text: 'naturalna woda źródlana'
    },
    {
      ean: '5901086000043',
      name: 'Płatki Owsiane Górskie',
      brand: 'Kupiec',
      category: 'Suche i sypkie',
      default_location: 'Spiżarnia',
      default_quantity: 500,
      default_unit: 'g',
      default_shelf_life_days: 240,
      ingredients_text: 'płatki owsiane 100%'
    },
    {
      ean: '5900852002106',
      name: 'Ryż Biały Długoziarnisty',
      brand: 'Sonko',
      category: 'Suche i sypkie',
      default_location: 'Spiżarnia',
      default_quantity: 400,
      default_unit: 'g',
      default_shelf_life_days: 365,
      ingredients_text: 'ryż biały długoziarnisty 4x100g'
    },
    {
      ean: '5900334000248',
      name: 'Sok 100% Pomarańczowy',
      brand: 'Tymbark',
      category: 'Napoje',
      default_location: 'Lodówka',
      default_quantity: 1000,
      default_unit: 'ml',
      default_shelf_life_days: 90,
      ingredients_text: 'sok pomarańczowy z zagęszczonego soku 100%'
    },
    {
      ean: '5900107003117',
      name: 'Czekolada Gorzka Klasyczna 64%',
      brand: 'E.Wedel',
      category: 'Inne',
      default_location: 'Szafka',
      default_quantity: 90,
      default_unit: 'g',
      default_shelf_life_days: 270,
      ingredients_text: 'miazga kakaowa, cukier, kakao o obniżonej zawartości tłuszczu, tłuszcz kakaowy'
    },
    {
      ean: '5901135000017',
      name: 'Ogórki Kiszone Domowe',
      brand: 'Krakus',
      category: 'Konserwy i przetwory',
      default_location: 'Spiżarnia',
      default_quantity: 850,
      default_unit: 'g',
      default_shelf_life_days: 365,
      ingredients_text: 'ogórki, woda, sól, koper, czosnek, chrzan'
    }
  ];

  const insert = db.prepare(`
    INSERT OR IGNORE INTO ean_catalog (
      ean, name, brand, category, default_location,
      default_quantity, default_unit, default_shelf_life_days,
      ingredients_text, image_url, nutriscore, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', 'seed', ?)
  `);

  for (const item of polishProducts) {
    insert.run(
      item.ean,
      item.name,
      item.brand,
      item.category,
      item.default_location,
      item.default_quantity,
      item.default_unit,
      item.default_shelf_life_days,
      item.ingredients_text,
      now
    );
  }
}

function normalizeSearchText(input) {
  if (!input) return '';
  return String(input)
    .toLocaleLowerCase('pl-PL')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();
}

function syncEanPackageSize(db, rawEan, packageQuantity, unit) {
  const ean = String(rawEan || '').replace(/\D/g, '').trim();
  const pkgQty = Number(packageQuantity);
  if (!ean || ean.length < 8 || !Number.isFinite(pkgQty) || pkgQty <= 1) return;

  const cleanUnit = String(unit || '').trim() || 'szt.';
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE ean_catalog
    SET default_quantity = ?,
        default_unit = ?,
        updated_at = ?
    WHERE ean = ?
  `).run(pkgQty, cleanUnit, now, ean);

  const mismatchedRows = db
    .prepare(`
      SELECT id, quantity, initial_quantity
      FROM inventory_items
      WHERE ean = ? AND initial_quantity <= 1
    `)
    .all(ean);

  const updateItemStmt = db.prepare(`
    UPDATE inventory_items
    SET quantity = ?, initial_quantity = ?, unit = ?, updated_at = ?
    WHERE id = ?
  `);

  for (const row of mismatchedRows) {
    const curQty = Number(row.quantity) || 1;
    let newQty = curQty;
    let newInitial = pkgQty;
    if (curQty <= 1) {
      newQty = Math.max(0.01, Math.round(curQty * pkgQty * 100) / 100);
      newInitial = Math.max(newQty, pkgQty);
    } else {
      newQty = curQty;
      newInitial = Math.max(curQty, pkgQty);
    }
    updateItemStmt.run(newQty, newInitial, cleanUnit, now, row.id);
  }
}

function repairInventoryPackageSizes(db) {
  const eanGroups = db
    .prepare(`
      SELECT ean, MAX(initial_quantity) AS max_init, MAX(quantity) AS max_qty
      FROM inventory_items
      WHERE LENGTH(ean) >= 8
      GROUP BY ean
      HAVING max_init > 1 OR max_qty > 1
    `)
    .all();

  for (const group of eanGroups) {
    const unitRow = db
      .prepare(`
        SELECT unit
        FROM inventory_items
        WHERE ean = ? AND (initial_quantity > 1 OR quantity > 1)
        ORDER BY CASE WHEN initial_quantity > 1 THEN 0 ELSE 1 END, updated_at DESC
        LIMIT 1
      `)
      .get(group.ean);
    const maxPkgQty = Math.max(Number(group.max_init) || 0, Number(group.max_qty) || 0);
    if (maxPkgQty > 1) {
      syncEanPackageSize(db, group.ean, maxPkgQty, unitRow ? unitRow.unit : 'szt.');
    }
  }

  const catalogMismatches = db
    .prepare(`
      SELECT DISTINCT i.ean, c.default_quantity, c.default_unit
      FROM inventory_items i
      JOIN ean_catalog c ON c.ean = i.ean
      WHERE i.initial_quantity <= 1 AND c.default_quantity > 1
    `)
    .all();

  for (const row of catalogMismatches) {
    syncEanPackageSize(db, row.ean, row.default_quantity, row.default_unit);
  }

  db.prepare(`
    UPDATE inventory_items
    SET initial_quantity = MAX(0.01, quantity)
    WHERE quantity > initial_quantity OR initial_quantity <= 0
  `).run();
}

function createBadRequestError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

function exportDatabasePayload(db) {
  const settingsRows = db
    .prepare(`SELECT key, value, updated_at FROM settings ORDER BY key ASC`)
    .all();
  const inventoryItems = db
    .prepare(`SELECT * FROM inventory_items ORDER BY id ASC`)
    .all();
  const eanCatalog = db
    .prepare(`SELECT * FROM ean_catalog ORDER BY ean ASC`)
    .all();
  const activityLog = db
    .prepare(`SELECT * FROM activity_log ORDER BY id ASC`)
    .all();

  return {
    format: 'kitchen-wms-backup',
    version: 1,
    exported_at: new Date().toISOString(),
    counts: {
      inventory_items: inventoryItems.length,
      ean_catalog: eanCatalog.length,
      settings: settingsRows.length,
      activity_log: activityLog.length
    },
    data: {
      settings: settingsRows,
      inventory_items: inventoryItems,
      ean_catalog: eanCatalog,
      activity_log: activityLog
    }
  };
}

function normalizeImportedInventoryRow(row, now) {
  const name = String((row && row.name) || '').trim();
  if (!name) {
    throw createBadRequestError('Nieprawidłowy rekord produktu w pliku kopii (brak nazwy).');
  }
  const qty = Math.max(0.01, Number(row.quantity) || 1);
  const rawInit = Number(row.initial_quantity);
  const initQty = Number.isFinite(rawInit) && rawInit > 0 ? Math.max(qty, rawInit) : qty;

  return {
    id: Number.isInteger(Number(row.id)) && Number(row.id) > 0 ? Number(row.id) : null,
    serial_number: String(row.serial_number || '').trim().toUpperCase(),
    name,
    brand: String(row.brand || '').trim(),
    ean: String(row.ean || '').replace(/\D/g, '').trim(),
    category: String(row.category || 'Inne').trim() || 'Inne',
    location: String(row.location || DEFAULT_LOCATIONS[0]).trim() || DEFAULT_LOCATIONS[0],
    quantity: qty,
    initial_quantity: initQty,
    unit: String(row.unit || 'szt.').trim() || 'szt.',
    expiry_date: row.expiry_date ? String(row.expiry_date).trim() : null,
    is_opened: row.is_opened ? 1 : 0,
    opened_at: row.opened_at ? String(row.opened_at) : null,
    days_after_opening:
      row.days_after_opening !== undefined &&
      row.days_after_opening !== null &&
      !Number.isNaN(Number(row.days_after_opening))
        ? parseInt(row.days_after_opening, 10)
        : null,
    image_url: String(row.image_url || '').trim(),
    notes: String(row.notes || '').trim(),
    ingredients_text: String(row.ingredients_text || '').trim(),
    printed_at: row.printed_at ? String(row.printed_at) : null,
    created_at: row.created_at ? String(row.created_at) : now,
    updated_at: row.updated_at ? String(row.updated_at) : now
  };
}

function importDatabasePayload(db, payload, { mode = 'replace' } = {}) {
  if (mode !== 'replace' && mode !== 'merge') {
    throw createBadRequestError('Nieprawidłowy tryb importu (dozwolone: replace, merge).');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw createBadRequestError('Nieprawidłowy format pliku kopii zapasowej JSON.');
  }
  if (payload.format && payload.format !== 'kitchen-wms-backup') {
    throw createBadRequestError('Nieobsługiwany format pliku kopii zapasowej.');
  }
  const data = payload.data;
  if (!data || typeof data !== 'object' || !Array.isArray(data.inventory_items)) {
    throw createBadRequestError('Plik kopii nie zawiera poprawnych danych produktów.');
  }

  const settingsRows = Array.isArray(data.settings) ? data.settings : [];
  const catalogRows = Array.isArray(data.ean_catalog) ? data.ean_catalog : [];
  const activityRows = Array.isArray(data.activity_log) ? data.activity_log : [];

  const now = new Date().toISOString();
  const normalizedItems = data.inventory_items.map((row) => normalizeImportedInventoryRow(row, now));

  const stats = {
    mode,
    inventory_imported: 0,
    inventory_skipped: 0,
    inventory_renamed: 0,
    catalog_imported: 0,
    activity_imported: 0,
    settings_imported: 0
  };
  let importedMaxSeq = 0;

  db.exec('BEGIN IMMEDIATE TRANSACTION;');
  try {
    const insertSettingStmt = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    const insertCatalogStmt = db.prepare(`
      INSERT INTO ean_catalog (
        ean, name, brand, category, default_location,
        default_quantity, default_unit, default_shelf_life_days,
        ingredients_text, image_url, nutriscore, source, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ean) DO UPDATE SET
        name = excluded.name,
        brand = excluded.brand,
        category = excluded.category,
        default_location = excluded.default_location,
        default_quantity = excluded.default_quantity,
        default_unit = excluded.default_unit,
        default_shelf_life_days = excluded.default_shelf_life_days,
        ingredients_text = excluded.ingredients_text,
        image_url = excluded.image_url,
        nutriscore = excluded.nutriscore,
        source = excluded.source,
        updated_at = excluded.updated_at
    `);

    const insertItemStmt = db.prepare(`
      INSERT INTO inventory_items (
        id, serial_number, name, brand, ean, category, location,
        quantity, initial_quantity, unit, expiry_date,
        is_opened, opened_at, days_after_opening,
        image_url, notes, ingredients_text, printed_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertActivityStmt = db.prepare(`
      INSERT INTO activity_log (id, action, serial_number, item_name, details, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    if (mode === 'replace') {
      db.exec(`
        DELETE FROM inventory_items;
        DELETE FROM ean_catalog;
        DELETE FROM settings;
        DELETE FROM activity_log;
      `);
      const hasSeqTable = db
        .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'`)
        .get();
      if (hasSeqTable) {
        db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('inventory_items', 'activity_log');`);
      }

      for (const s of settingsRows) {
        if (!s || !s.key) continue;
        insertSettingStmt.run(
          String(s.key),
          String(s.value !== undefined && s.value !== null ? s.value : ''),
          s.updated_at ? String(s.updated_at) : now
        );
        stats.settings_imported += 1;
      }
      ensureDefaultSettings(db, now);

      for (const c of catalogRows) {
        const cleanEan = String((c && c.ean) || '').replace(/\D/g, '').trim();
        const catName = String((c && c.name) || '').trim();
        if (!cleanEan || !catName) continue;
        insertCatalogStmt.run(
          cleanEan,
          catName,
          String(c.brand || '').trim(),
          String(c.category || 'Inne').trim() || 'Inne',
          String(c.default_location || DEFAULT_LOCATIONS[0]).trim() || DEFAULT_LOCATIONS[0],
          Number(c.default_quantity) > 0 ? Number(c.default_quantity) : 1,
          String(c.default_unit || 'szt.').trim() || 'szt.',
          c.default_shelf_life_days ? Number(c.default_shelf_life_days) : null,
          String(c.ingredients_text || '').trim(),
          String(c.image_url || '').trim(),
          String(c.nutriscore || '').trim(),
          String(c.source || 'local').trim() || 'local',
          c.updated_at ? String(c.updated_at) : now
        );
        stats.catalog_imported += 1;
      }

      for (const item of normalizedItems) {
        const serial = item.serial_number || generateNextSerial(db);
        insertItemStmt.run(
          item.id,
          serial,
          item.name,
          item.brand,
          item.ean,
          item.category,
          item.location,
          item.quantity,
          item.initial_quantity,
          item.unit,
          item.expiry_date,
          item.is_opened,
          item.opened_at,
          item.days_after_opening,
          item.image_url,
          item.notes,
          item.ingredients_text,
          item.printed_at,
          item.created_at,
          item.updated_at
        );
        stats.inventory_imported += 1;
      }

      for (const act of activityRows) {
        if (!act || !act.action) continue;
        const detailsStr =
          typeof act.details === 'string' ? act.details : JSON.stringify(act.details || {});
        const actId = Number.isInteger(Number(act.id)) && Number(act.id) > 0 ? Number(act.id) : null;
        insertActivityStmt.run(
          actId,
          String(act.action),
          String(act.serial_number || ''),
          String(act.item_name || ''),
          detailsStr,
          act.created_at ? String(act.created_at) : now
        );
        stats.activity_imported += 1;
      }
    } else {
      // mode === 'merge'
      const mergedLocations = [...getLocations(db)];
      const mergedCategories = [...getCategories(db)];
      const appendUnique = (arr, vals) => {
        for (const v of vals) {
          const str = String(v || '').trim();
          if (str && !arr.includes(str)) arr.push(str);
        }
      };

      const insertSettingIgnoreStmt = db.prepare(`
        INSERT OR IGNORE INTO settings (key, value, updated_at)
        VALUES (?, ?, ?)
      `);

      for (const s of settingsRows) {
        if (!s || !s.key) continue;
        const key = String(s.key);
        if (key === 'locations') {
          appendUnique(mergedLocations, normalizeStringList(s.value, []));
        } else if (key === 'categories') {
          appendUnique(mergedCategories, normalizeStringList(s.value, []));
        } else if (key === 'serial_seq') {
          importedMaxSeq = Math.max(importedMaxSeq, parseInt(String(s.value || '0'), 10) || 0);
        } else {
          const info = insertSettingIgnoreStmt.run(
            key,
            String(s.value !== undefined && s.value !== null ? s.value : ''),
            s.updated_at ? String(s.updated_at) : now
          );
          if (info.changes > 0) stats.settings_imported += 1;
        }
      }

      for (const item of normalizedItems) {
        if (item.location) appendUnique(mergedLocations, [item.location]);
        if (item.category) appendUnique(mergedCategories, [item.category]);
      }

      insertSettingStmt.run('locations', JSON.stringify(mergedLocations), now);
      insertSettingStmt.run('categories', JSON.stringify(mergedCategories), now);

      const getCatalogStmt = db.prepare(
        `SELECT ean, default_quantity, source FROM ean_catalog WHERE ean = ?`
      );
      for (const c of catalogRows) {
        const cleanEan = String((c && c.ean) || '').replace(/\D/g, '').trim();
        const catName = String((c && c.name) || '').trim();
        if (!cleanEan || !catName) continue;
        const existingCat = getCatalogStmt.get(cleanEan);
        const importedQty = Number(c.default_quantity) > 0 ? Number(c.default_quantity) : 1;
        const shouldUpsert =
          !existingCat ||
          (existingCat.default_quantity <= 1 && importedQty > 1) ||
          (existingCat.source !== 'user' && c.source === 'user');
        if (shouldUpsert) {
          insertCatalogStmt.run(
            cleanEan,
            catName,
            String(c.brand || '').trim(),
            String(c.category || 'Inne').trim() || 'Inne',
            String(c.default_location || DEFAULT_LOCATIONS[0]).trim() || DEFAULT_LOCATIONS[0],
            importedQty,
            String(c.default_unit || 'szt.').trim() || 'szt.',
            c.default_shelf_life_days ? Number(c.default_shelf_life_days) : null,
            String(c.ingredients_text || '').trim(),
            String(c.image_url || '').trim(),
            String(c.nutriscore || '').trim(),
            String(c.source || 'local').trim() || 'local',
            c.updated_at ? String(c.updated_at) : now
          );
          stats.catalog_imported += 1;
        }
      }

      const findSerialStmt = db.prepare(
        `SELECT id, name, ean, created_at FROM inventory_items WHERE serial_number = ?`
      );
      for (const item of normalizedItems) {
        let targetSerial = item.serial_number;
        const existingItem = targetSerial ? findSerialStmt.get(targetSerial) : null;
        if (existingItem) {
          const isSameItem =
            existingItem.name === item.name &&
            (existingItem.ean || '') === item.ean &&
            (existingItem.created_at || '') === item.created_at;
          if (isSameItem) {
            stats.inventory_skipped += 1;
            continue;
          }
          targetSerial = generateNextSerial(db);
          stats.inventory_renamed += 1;
        } else if (!targetSerial) {
          targetSerial = generateNextSerial(db);
        }

        insertItemStmt.run(
          null,
          targetSerial,
          item.name,
          item.brand,
          item.ean,
          item.category,
          item.location,
          item.quantity,
          item.initial_quantity,
          item.unit,
          item.expiry_date,
          item.is_opened,
          item.opened_at,
          item.days_after_opening,
          item.image_url,
          item.notes,
          item.ingredients_text,
          item.printed_at,
          item.created_at,
          item.updated_at
        );
        stats.inventory_imported += 1;
      }

      const findActStmt = db.prepare(
        `SELECT 1 FROM activity_log WHERE action = ? AND serial_number = ? AND created_at = ? LIMIT 1`
      );
      for (const act of activityRows) {
        if (!act || !act.action) continue;
        const action = String(act.action);
        const serialNum = String(act.serial_number || '');
        const createdAt = act.created_at ? String(act.created_at) : now;
        if (findActStmt.get(action, serialNum, createdAt)) continue;
        const detailsStr =
          typeof act.details === 'string' ? act.details : JSON.stringify(act.details || {});
        insertActivityStmt.run(
          null,
          action,
          serialNum,
          String(act.item_name || ''),
          detailsStr,
          createdAt
        );
        stats.activity_imported += 1;
      }
    }

    const seqRow = db.prepare(`SELECT value FROM settings WHERE key = 'serial_seq'`).get();
    let maxSeq = Math.max(seqRow ? parseInt(seqRow.value, 10) || 0 : 0, importedMaxSeq);
    for (const row of db.prepare(`SELECT serial_number FROM inventory_items`).all()) {
      const seq = serialToSequence(row.serial_number);
      if (seq && seq > maxSeq) maxSeq = seq;
    }
    for (const row of db.prepare(`SELECT serial_number FROM activity_log`).all()) {
      const seq = serialToSequence(row.serial_number);
      if (seq && seq > maxSeq) maxSeq = seq;
    }
    insertSettingStmt.run('serial_seq', String(maxSeq), now);

    repairInventoryPackageSizes(db);
    db.exec('COMMIT;');
  } catch (err) {
    db.exec('ROLLBACK;');
    throw err;
  }

  return stats;
}

module.exports = {
  DEFAULT_LOCATIONS,
  DEFAULT_CATEGORIES,
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
  logActivity,
  normalizeSearchText,
  syncEanPackageSize,
  exportDatabasePayload,
  importDatabasePayload
};

