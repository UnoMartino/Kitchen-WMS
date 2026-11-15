const { getLocations, getCategories } = require('./db');

function normalizeEan(raw) {
  if (!raw) return '';
  return String(raw).replace(/\D/g, '').trim();
}

function isPolishEan(ean) {
  const clean = normalizeEan(ean);
  return clean.length === 13 && clean.startsWith('590');
}

function parseQuantityAndUnit(rawQuantity, productQuantity, productQuantityUnit) {
  if (productQuantity && !Number.isNaN(Number(productQuantity))) {
    const num = Number(productQuantity);
    const u = normalizeUnit(productQuantityUnit || 'g');
    return { quantity: num, unit: u };
  }

  if (typeof rawQuantity === 'string' && rawQuantity.trim()) {
    const match = rawQuantity.trim().match(/(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l|cl|szt|opak)/i);
    if (match) {
      let val = parseFloat(match[1].replace(',', '.'));
      let unit = match[2].toLowerCase();
      if (unit === 'cl') {
        val = val * 10;
        unit = 'ml';
      } else if (unit === 'szt') {
        unit = 'szt.';
      } else if (unit === 'opak') {
        unit = 'opak.';
      }
      return { quantity: val, unit };
    }
  }

  return { quantity: 1, unit: 'szt.' };
}

function normalizeUnit(u) {
  const clean = String(u || '').toLowerCase().trim();
  if (['g', 'gram', 'grams', 'gr'].includes(clean)) return 'g';
  if (['kg', 'kilogram'].includes(clean)) return 'kg';
  if (['ml', 'milliliter'].includes(clean)) return 'ml';
  if (['l', 'litr', 'liter', 'ltr'].includes(clean)) return 'l';
  if (['cl'].includes(clean)) return 'ml';
  if (['opak', 'opak.', 'pack'].includes(clean)) return 'opak.';
  if (['porcje', 'porcja'].includes(clean)) return 'porcje';
  return 'szt.';
}

function mapCategoryAndLocation(db, categoriesText = '', tags = [], name = '') {
  const combined = `${categoriesText} ${(tags || []).join(' ')} ${name}`.toLowerCase();
  const configuredLocations = getLocations(db);
  const configuredCategories = getCategories(db);

  const pickLoc = (preferred) =>
    configuredLocations.includes(preferred) ? preferred : configuredLocations[0] || 'Spiżarnia';
  const pickCat = (preferred) =>
    configuredCategories.includes(preferred)
      ? preferred
      : configuredCategories[configuredCategories.length - 1] || 'Inne';

  if (/mrożon|frozen|lody|ice-cream|mrozon/.test(combined)) {
    return { category: pickCat('Mrożonki'), location: pickLoc('Zamrażarka'), shelfLifeDays: 180 };
  }
  if (/mleko|nabiał|dairy|ser|twaróg|jogurt|kefir|śmietan|masło|butter|cheese|milk|yogurt|jaj/.test(combined)) {
    return { category: pickCat('Nabiał i jaja'), location: pickLoc('Lodówka'), shelfLifeDays: 14 };
  }
  if (/mięso|wędlin|kiełbas|szynk|drób|kurczak|wołowin|wieprzow|ryb|łosoś|tuńczyk|meat|fish|sausage|poultry/.test(combined)) {
    return { category: pickCat('Mięso i ryby'), location: pickLoc('Lodówka'), shelfLifeDays: 5 };
  }
  if (/warzyw|owoc|pomidor|ogórek|sałat|jabłk|banan|ziemniak|marchew|cebula|vegetable|fruit|produce/.test(combined)) {
    return { category: pickCat('Warzywa i owoce'), location: pickLoc('Lodówka'), shelfLifeDays: 7 };
  }
  if (/chleb|pieczyw|bułk|bagietk|toast|bread|bakery/.test(combined)) {
    return { category: pickCat('Pieczywo'), location: pickLoc('Szafka'), shelfLifeDays: 4 };
  }
  if (/napój|napoje|woda|sok|nektar|cola|syrop|kawa|herbat|beverage|drink|water|juice/.test(combined)) {
    return { category: pickCat('Napoje'), location: pickLoc('Spiżarnia'), shelfLifeDays: 180 };
  }
  if (/sos|ketchup|majonez|musztard|olej|oliwa|ocet|przypraw|sól|pieprz|zioła|sauce|condiment|spice|oil/.test(combined)) {
    return { category: pickCat('Przyprawy i sosy'), location: pickLoc('Spiżarnia'), shelfLifeDays: 180 };
  }
  if (/konserw|słoik|kukurydz|groszek|fasol|przecier|dżem|powidł|kiszon|canned|pickled|jam/.test(combined)) {
    return { category: pickCat('Konserwy i przetwory'), location: pickLoc('Spiżarnia'), shelfLifeDays: 365 };
  }
  if (/makaron|ryż|kasza|mąka|cukier|płatki|musli|zboż|pasta|rice|flour|cereal|dry/.test(combined)) {
    return { category: pickCat('Suche i sypkie'), location: pickLoc('Spiżarnia'), shelfLifeDays: 365 };
  }
  if (/danie|pierogi|zupa|pizza|gotowe|ready-meal/.test(combined)) {
    return { category: pickCat('Gotowe dania'), location: pickLoc('Lodówka'), shelfLifeDays: 7 };
  }
  return { category: pickCat('Inne'), location: pickLoc('Spiżarnia'), shelfLifeDays: 30 };
}

async function fetchOpenFoodFacts(db, ean) {
  const endpoints = [
    `https://pl.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json`,
    `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(ean)}.json`
  ];

  for (const url of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Kitchen-WMS-PL/2.0 (https://localhost; contact@localhost)',
          'Accept': 'application/json'
        },
        signal: controller.signal
      });
      clearTimeout(timeout);

      if (!res.ok) continue;
      const data = await res.json();
      if (data && data.status === 1 && data.product) {
        const p = data.product;
        const name = (
          p.product_name_pl ||
          p.product_name ||
          p.generic_name_pl ||
          p.generic_name ||
          ''
        ).trim();

        if (!name) continue;

        const brand = (p.brands || '').split(',')[0].trim();
        const ingredients = (p.ingredients_text_pl || p.ingredients_text || '').trim();
        const imageUrl = p.image_front_small_url || p.image_url || '';
        const nutriscore = (p.nutriscore_grade || '').toUpperCase();
        const { quantity, unit } = parseQuantityAndUnit(
          p.quantity,
          p.product_quantity,
          p.product_quantity_unit
        );
        const { category, location, shelfLifeDays } = mapCategoryAndLocation(
          db,
          p.categories || '',
          p.categories_tags || [],
          name
        );

        return {
          ean,
          name,
          brand,
          category,
          default_location: location,
          default_quantity: quantity,
          default_unit: unit,
          default_shelf_life_days: shelfLifeDays,
          ingredients_text: ingredients,
          image_url: imageUrl,
          nutriscore,
          is_polish_ean: isPolishEan(ean),
          source: 'openfoodfacts-pl'
        };
      }
    } catch (_) {
      // Try next endpoint
    }
  }
  return null;
}

async function lookupEan(db, rawEan, { forceRefresh = false } = {}) {
  const ean = normalizeEan(rawEan);
  if (!ean || ean.length < 8 || ean.length > 14) {
    return { found: false, error: 'Nieprawidłowy format kodu EAN (wymagane 8–14 cyfr).' };
  }

  if (!forceRefresh) {
    const cached = db.prepare(`SELECT * FROM ean_catalog WHERE ean = ?`).get(ean);
    if (cached) {
      return {
        found: true,
        product: {
          ...cached,
          is_polish_ean: isPolishEan(ean)
        }
      };
    }
  }

  const remoteProduct = await fetchOpenFoodFacts(db, ean);
  if (remoteProduct) {
    saveToEanCatalog(db, remoteProduct);
    return {
      found: true,
      product: remoteProduct
    };
  }

  const fallbackCached = db.prepare(`SELECT * FROM ean_catalog WHERE ean = ?`).get(ean);
  if (fallbackCached) {
    return {
      found: true,
      product: {
        ...fallbackCached,
        is_polish_ean: isPolishEan(ean)
      }
    };
  }

  return {
    found: false,
    ean,
    is_polish_ean: isPolishEan(ean),
    message: isPolishEan(ean)
      ? 'Nie znaleziono produktu (Polski kod GS1 590) w bazie Open Food Facts. Wpisz dane ręcznie — zostaną zapamiętane w lokalnym katalogu.'
      : 'Nie znaleziono produktu w bazie EAN. Wpisz dane ręcznie — zostaną zapamiętane na przyszłość.'
  };
}

function saveToEanCatalog(db, product) {
  const ean = normalizeEan(product.ean);
  if (!ean || !product.name) return;

  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO ean_catalog (
      ean, name, brand, category, default_location,
      default_quantity, default_unit, default_shelf_life_days,
      ingredients_text, image_url, nutriscore, source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ean) DO UPDATE SET
      name = excluded.name,
      brand = CASE WHEN excluded.brand != '' THEN excluded.brand ELSE ean_catalog.brand END,
      category = CASE WHEN excluded.category != '' THEN excluded.category ELSE ean_catalog.category END,
      default_location = CASE WHEN excluded.default_location != '' THEN excluded.default_location ELSE ean_catalog.default_location END,
      default_quantity = CASE WHEN excluded.default_quantity > 0 THEN excluded.default_quantity ELSE ean_catalog.default_quantity END,
      default_unit = CASE WHEN excluded.default_unit != '' THEN excluded.default_unit ELSE ean_catalog.default_unit END,
      default_shelf_life_days = COALESCE(excluded.default_shelf_life_days, ean_catalog.default_shelf_life_days),
      ingredients_text = CASE WHEN excluded.ingredients_text != '' THEN excluded.ingredients_text ELSE ean_catalog.ingredients_text END,
      image_url = CASE WHEN excluded.image_url != '' THEN excluded.image_url ELSE ean_catalog.image_url END,
      nutriscore = CASE WHEN excluded.nutriscore != '' THEN excluded.nutriscore ELSE ean_catalog.nutriscore END,
      source = excluded.source,
      updated_at = excluded.updated_at
  `);

  upsert.run(
    ean,
    String(product.name).trim(),
    String(product.brand || '').trim(),
    String(product.category || 'Inne').trim(),
    String(product.default_location || 'Spiżarnia').trim(),
    Number(product.default_quantity) || 1,
    String(product.default_unit || 'szt.').trim(),
    product.default_shelf_life_days ? Number(product.default_shelf_life_days) : null,
    String(product.ingredients_text || '').trim(),
    String(product.image_url || '').trim(),
    String(product.nutriscore || '').trim(),
    String(product.source || 'user').trim(),
    now
  );
}

function searchLocalCatalog(db, query, limit = 15) {
  if (!query || !query.trim()) {
    return db.prepare(`SELECT * FROM ean_catalog ORDER BY updated_at DESC LIMIT ?`).all(limit);
  }
  const q = `%${query.trim().toLowerCase()}%`;
  return db.prepare(`
    SELECT * FROM ean_catalog
    WHERE LOWER(name) LIKE ?
       OR LOWER(brand) LIKE ?
       OR ean LIKE ?
    ORDER BY
      CASE WHEN ean LIKE '590%' THEN 0 ELSE 1 END,
      name ASC
    LIMIT ?
  `).all(q, q, q, limit);
}

module.exports = {
  normalizeEan,
  isPolishEan,
  lookupEan,
  saveToEanCatalog,
  searchLocalCatalog
};

