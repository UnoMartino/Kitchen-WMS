const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { sequenceToSerial, serialToSequence, extractSerialNumber } = require('../server/db');
const { createAppServer } = require('../server/index');

async function runTests() {
  console.log('1. Testowanie generatora numerów seryjnych AAA-1111...');
  assert.equal(sequenceToSerial(1), 'AAA-0001');
  assert.equal(sequenceToSerial(2), 'AAA-0002');
  assert.equal(sequenceToSerial(9999), 'AAA-9999');
  assert.equal(sequenceToSerial(10000), 'AAB-0001');
  assert.equal(sequenceToSerial(259974), 'AAZ-9999');
  assert.equal(sequenceToSerial(259975), 'ABA-0001');
  assert.equal(serialToSequence('AAA-0001'), 1);
  assert.equal(serialToSequence('AAB-0001'), 10000);

  assert.equal(extractSerialNumber('AAA-0001'), 'AAA-0001');
  assert.equal(extractSerialNumber('https://example.com/ABC-1234'), 'ABC-1234');
  assert.equal(extractSerialNumber('http://10.10.20.2:3000/?item=AAA-0042'), 'AAA-0042');
  assert.equal(extractSerialNumber('1'), 'AAA-0001');
  assert.equal(extractSerialNumber('0015'), 'AAA-0015');

  console.log('2. Uruchamianie testowego serwera API drukarki i serwera aplikacji...');
  const printedPayloads = [];
  const mockPrinterServer = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/print') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        printedPayloads.push(JSON.parse(body));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'printed' }));
      });
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  await new Promise((resolve) => mockPrinterServer.listen(0, '127.0.0.1', resolve));
  const printerPort = mockPrinterServer.address().port;
  const mockPrinterUrl = `http://127.0.0.1:${printerPort}/print`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kitchen-wms-test-'));
  const dbPath = path.join(tmpDir, 'test.db');

  const { server } = createAppServer(dbPath);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const appPort = server.address().port;
  const baseUrl = `http://127.0.0.1:${appPort}`;

  try {
    // Configure mock printer URL in settings
    const setRes = await fetch(`${baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        printer_api_url: mockPrinterUrl,
        printer_auto_print: 'true',
        printer_qr_mode: 'serial'
      })
    });
    assert.equal(setRes.status, 200);

    console.log('3. Testowanie konfigurowalnych lokalizacji i kategorii (/api/taxonomy oraz /api/settings)...');
    const taxGet = await fetch(`${baseUrl}/api/taxonomy`).then((r) => r.json());
    assert.ok(Array.isArray(taxGet.locations));
    assert.ok(Array.isArray(taxGet.categories));

    const customLocations = ['Lodówka', 'Spiżarnia', 'Piwnica', 'Balkon'];
    const customCategories = ['Nabiał i jaja', 'Mięso i wędliny', 'Domowe przetwory'];
    const taxPut = await fetch(`${baseUrl}/api/taxonomy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: customLocations,
        categories: customCategories
      })
    }).then((r) => r.json());
    assert.equal(taxPut.ok, true);
    assert.deepEqual(taxPut.locations, customLocations);
    assert.deepEqual(taxPut.categories, customCategories);

    console.log('4. Testowanie polskiej bazy EAN (5900512300108 - Mleko Łaciate)...');
    const eanRes = await fetch(`${baseUrl}/api/ean/5900512300108`);
    const eanData = await eanRes.json();
    assert.equal(eanData.found, true);
    assert.equal(eanData.product.is_polish_ean, true);
    assert.match(eanData.product.name, /Mleko UHT Łaciate/i);

    console.log('5. Testowanie dodawania produktu i automatycznego wydruku etykiety QR (AAA-0001)...');
    const addRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: eanData.product.name,
        brand: eanData.product.brand,
        ean: '5900512300108',
        category: 'Nabiał i jaja',
        location: 'Lodówka',
        quantity: 1000,
        unit: 'ml',
        expiry_date: '2026-11-16',
        ingredients_text: eanData.product.ingredients_text,
        batch_count: 1,
        auto_print: true
      })
    });
    assert.equal(addRes.status, 201);
    const addData = await addRes.json();
    assert.equal(addData.count, 1);
    assert.equal(addData.items[0].serial_number, 'AAA-0001');
    assert.equal(printedPayloads.length, 1);
    assert.deepEqual(printedPayloads[0], {
      text: 'AAA-0001',
      qr_text: 'AAA-0001'
    });

    console.log('6. Testowanie dodawania seryjnego (batch_count = 3 -> AAA-0002, AAA-0003, AAA-0004)...');
    const batchRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Serek Wiejski Piątnica',
        brand: 'Piątnica',
        ean: '5900397010017',
        category: 'Nabiał i jaja',
        location: 'Lodówka',
        quantity: 200,
        unit: 'g',
        expiry_date: '2026-11-13',
        batch_count: 3,
        auto_print: true
      })
    });
    const batchData = await batchRes.json();
    assert.equal(batchData.count, 3);
    assert.deepEqual(
      batchData.items.map((i) => i.serial_number),
      ['AAA-0002', 'AAA-0003', 'AAA-0004']
    );
    assert.equal(printedPayloads.length, 4);

    console.log('7. Testowanie dodruku pojedynczego i seryjnego (lista oraz zakres Od-Do)...');
    const singleReprintRes = await fetch(`${baseUrl}/api/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_number: 'AAA-0001', copies: 2 })
    }).then((r) => r.json());
    assert.equal(singleReprintRes.ok, true);
    assert.equal(singleReprintRes.copies, 2);
    assert.equal(printedPayloads.length, 6);

    const batchListReprint = await fetch(`${baseUrl}/api/print/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial_numbers: ['AAA-0001', 'AAA-0003'], copies: 1 })
    }).then((r) => r.json());
    assert.equal(batchListReprint.ok, true);
    assert.equal(batchListReprint.printed_count, 2);
    assert.equal(printedPayloads.length, 8);

    const batchRangeReprint = await fetch(`${baseUrl}/api/print/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_serial: '2', to_serial: '4', copies: 1 })
    }).then((r) => r.json());
    assert.equal(batchRangeReprint.ok, true);
    assert.equal(batchRangeReprint.printed_count, 3);
    assert.equal(printedPayloads.length, 11);

    console.log('8. Testowanie wyszukiwania po skanie QR, częściowego zużycia, usunięcia i przywracania...');
    const scanLookup = await fetch(`${baseUrl}/api/items/by-serial/AAA-0001`).then((r) => r.json());
    assert.equal(scanLookup.found, true);
    assert.equal(scanLookup.item.serial_number, 'AAA-0001');

    const partialRes = await fetch(`${baseUrl}/api/items/by-serial/AAA-0001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'consume_partial', fraction: 0.5 })
    }).then((r) => r.json());
    assert.equal(partialRes.item.quantity, 500);
    assert.equal(partialRes.item.percent_remaining, 50);
    assert.equal(partialRes.item.is_opened, true);

    const delRes = await fetch(`${baseUrl}/api/items/by-serial/AAA-0001`, {
      method: 'DELETE'
    }).then((r) => r.json());
    assert.equal(delRes.ok, true);
    assert.ok(delRes.activity_id);

    const restoreRes = await fetch(`${baseUrl}/api/activity/${delRes.activity_id}/restore`, {
      method: 'POST'
    }).then((r) => r.json());
    assert.equal(restoreRes.ok, true);
    assert.equal(restoreRes.item.serial_number, 'AAA-0001');

    const closeRes = await fetch(`${baseUrl}/api/items/by-serial/AAA-0001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'close' })
    }).then((r) => r.json());
    assert.equal(closeRes.ok, true);
    assert.equal(closeRes.item.is_opened, false);
    assert.equal(closeRes.item.opened_at, null);

    const openAgainRes = await fetch(`${baseUrl}/api/items/by-serial/AAA-0001`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'open' })
    }).then((r) => r.json());
    assert.equal(openAgainRes.ok, true);
    assert.equal(openAgainRes.item.is_opened, true);
    assert.ok(openAgainRes.item.opened_at);
    assert.equal(openAgainRes.item.expiry_date, closeRes.item.expiry_date);
    assert.equal(openAgainRes.item.effective_expiry_date, closeRes.item.effective_expiry_date);
    assert.equal(openAgainRes.item.days_remaining, closeRes.item.days_remaining);

    const noExpiryRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Sól kamienna',
        category: 'Przyprawy',
        location: 'Spiżarnia',
        expiry_date: null,
        quantity: 1,
        unit: 'op.',
        auto_print: false
      })
    }).then((r) => r.json());
    assert.equal(noExpiryRes.ok, true);
    assert.equal(noExpiryRes.count, 1);
    assert.equal(noExpiryRes.items[0].expiry_date, null);
    assert.equal(noExpiryRes.items[0].effective_expiry_date, null);
    assert.equal(noExpiryRes.items[0].days_remaining, null);
    assert.equal(noExpiryRes.items[0].expiry_status, 'none');

    console.log('8b. Testowanie wyszukiwarki PL, wielkości opakowań po EAN i powiązanych sztuk...');
    const fusilliRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Makaron Świderki (Fusilli)',
        brand: 'Lubella',
        ean: '5900073010119',
        category: 'Suche i sypkie',
        location: 'Spiżarnia',
        quantity: 400,
        unit: 'g',
        auto_print: false
      })
    }).then((r) => r.json());
    assert.equal(fusilliRes.ok, true);

    const mayoRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Majonez Kielecki',
        brand: 'Społem',
        ean: '5900783000059',
        category: 'Przyprawy i sosy',
        location: 'Lodówka',
        quantity: 310,
        unit: 'g',
        ingredients_text: 'olej rzepakowy, woda, żółtko jaja, gorczyca',
        auto_print: false
      })
    }).then((r) => r.json());
    assert.equal(mayoRes.ok, true);

    // Wyszukiwanie z polskimi znakami i bez znaków diakrytycznych
    const searchLacPl = await fetch(`${baseUrl}/api/items?q=${encodeURIComponent('łaciate')}`).then((r) => r.json());
    assert.ok(searchLacPl.items.some((it) => it.serial_number === 'AAA-0001'));

    const searchLacAscii = await fetch(`${baseUrl}/api/items?q=${encodeURIComponent('laciate')}`).then((r) => r.json());
    assert.ok(searchLacAscii.items.some((it) => it.serial_number === 'AAA-0001'));

    const searchSwiderkiPl = await fetch(`${baseUrl}/api/items?q=${encodeURIComponent('świderki')}`).then((r) => r.json());
    assert.ok(searchSwiderkiPl.items.some((it) => it.name.includes('Świderki')));

    const searchSwiderkiAscii = await fetch(`${baseUrl}/api/items?q=${encodeURIComponent('swiderki')}`).then((r) => r.json());
    assert.ok(searchSwiderkiAscii.items.some((it) => it.name.includes('Świderki')));

    // Brak fałszywych dopasowań ze składników (ingredients_text) oraz pojedynczych cyfr jako AAA-0002
    const searchIngredient = await fetch(`${baseUrl}/api/items?q=${encodeURIComponent('gorczyca')}`).then((r) => r.json());
    assert.equal(searchIngredient.items.length, 0);

    const searchDigitTwo = await fetch(`${baseUrl}/api/items?q=2`).then((r) => r.json());
    assert.ok(!searchDigitTwo.items.some((it) => it.serial_number === 'AAA-0002'));

    // Testowanie częściowego zużycia -25% z 100 g -> 75 / 100 g oraz naprawy opakowań EAN
    const pack100Res = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Przyprawa testowa 100g',
        category: 'Przyprawy',
        location: 'Spiżarnia',
        quantity: 100,
        unit: 'g',
        auto_print: false
      })
    }).then((r) => r.json());
    assert.equal(pack100Res.ok, true);
    const pack100Item = pack100Res.items[0];
    const pack100Consume = await fetch(`${baseUrl}/api/items/${pack100Item.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'consume_partial', fraction: 0.25 })
    }).then((r) => r.json());
    assert.equal(pack100Consume.item.quantity, 75);
    assert.equal(pack100Consume.item.initial_quantity, 100);
    assert.equal(pack100Consume.item.percent_remaining, 75);

    // Dwie sztuki z tym samym niestandardowym EAN dodane błędnie jako quantity=1 -> edycja jednej naprawia katalog i drugą sztukę
    const sharedEan = '5909998887771';
    const eanBatchRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kasza gryczana testowa',
        ean: sharedEan,
        category: 'Suche i sypkie',
        location: 'Spiżarnia',
        quantity: 1,
        unit: 'g',
        batch_count: 2,
        auto_print: false
      })
    }).then((r) => r.json());
    assert.equal(eanBatchRes.count, 2);
    const [firstEanItem, secondEanItem] = eanBatchRes.items;
    assert.equal(firstEanItem.same_ean_count, 1);
    assert.equal(firstEanItem.same_ean_items.length, 1);

    const editedFirst = await fetch(`${baseUrl}/api/items/${firstEanItem.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        quantity: 75,
        initial_quantity: 100,
        unit: 'g'
      })
    }).then((r) => r.json());
    assert.equal(editedFirst.ok, true);
    assert.equal(editedFirst.item.quantity, 75);
    assert.equal(editedFirst.item.initial_quantity, 100);
    assert.equal(editedFirst.item.percent_remaining, 75);

    // Druga sztuka tego samego EAN powinna zostać automatycznie przeskalowana do 100 / 100 g
    const secondLookup = await fetch(
      `${baseUrl}/api/items/by-serial/${encodeURIComponent(secondEanItem.serial_number)}`
    ).then((r) => r.json());
    assert.equal(secondLookup.item.quantity, 100);
    assert.equal(secondLookup.item.initial_quantity, 100);
    assert.equal(secondLookup.item.same_ean_count, 1);

    // Katalog EAN zapamiętał wielkość opakowania 100 g i auto-uzupełnia kolejną sztukę
    const eanMeta = await fetch(`${baseUrl}/api/ean/${sharedEan}`).then((r) => r.json());
    assert.equal(eanMeta.found, true);
    assert.equal(eanMeta.product.default_quantity, 100);
    assert.equal(eanMeta.product.default_unit, 'g');

    const thirdEanRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Kasza gryczana testowa',
        ean: sharedEan,
        category: 'Suche i sypkie',
        location: 'Spiżarnia',
        quantity: 1,
        unit: 'szt.',
        auto_print: false
      })
    }).then((r) => r.json());
    assert.equal(thirdEanRes.items[0].quantity, 100);
    assert.equal(thirdEanRes.items[0].initial_quantity, 100);
    assert.equal(thirdEanRes.items[0].unit, 'g');
    assert.equal(thirdEanRes.items[0].same_ean_count, 2);
    assert.equal(thirdEanRes.items[0].same_ean_items.length, 2);
    assert.ok(
      thirdEanRes.items[0].same_ean_items.every((sib) => sib.id !== thirdEanRes.items[0].id)
    );

    console.log('8c. Testowanie eksportu i importu bazy danych (replace oraz merge)...');
    const exportRes = await fetch(`${baseUrl}/api/database/export`);
    assert.equal(exportRes.status, 200);
    assert.match(
      exportRes.headers.get('content-disposition') || '',
      /attachment;\s*filename="spizarnia-baza-\d{4}-\d{2}-\d{2}\.json"/i
    );
    const exportedBackup = await exportRes.json();
    assert.equal(exportedBackup.format, 'kitchen-wms-backup');
    assert.equal(exportedBackup.version, 1);
    assert.ok(exportedBackup.data.inventory_items.length >= 5);
    assert.equal(exportedBackup.counts.inventory_items, exportedBackup.data.inventory_items.length);

    // Nieprawidłowy format importu zwraca 400
    const badImportRes = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'replace', backup: { format: 'invalid', data: {} } })
    });
    assert.equal(badImportRes.status, 400);

    // Dodaj tymczasowy produkt i przetestuj import w trybie merge (z kolizją numeru i nową lokalizacją)
    const tempAddRes = await fetch(`${baseUrl}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Tymczasowy produkt przed importem',
        category: 'Inne',
        location: 'Spiżarnia',
        quantity: 2,
        unit: 'szt.',
        auto_print: false
      })
    }).then((r) => r.json());
    const tempItem = tempAddRes.items[0];
    const existingItemOne = exportedBackup.data.inventory_items[0];

    const mergePayload = {
      format: 'kitchen-wms-backup',
      version: 1,
      data: {
        settings: [],
        ean_catalog: [],
        activity_log: [],
        inventory_items: [
          existingItemOne,
          {
            serial_number: tempItem.serial_number,
            name: 'Produkt scalony z kolizją numeru',
            category: 'Inne',
            location: 'Piwniczka',
            quantity: 3,
            initial_quantity: 3,
            unit: 'szt.'
          }
        ]
      }
    };
    const mergeRes = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'merge', backup: mergePayload })
    }).then((r) => r.json());
    assert.equal(mergeRes.ok, true);
    assert.equal(mergeRes.stats.inventory_skipped, 1);
    assert.equal(mergeRes.stats.inventory_imported, 1);
    assert.equal(mergeRes.stats.inventory_renamed, 1);
    assert.ok(mergeRes.settings.locations.includes('Piwniczka'));

    const afterMergeItems = await fetch(`${baseUrl}/api/items`).then((r) => r.json());
    assert.ok(afterMergeItems.items.some((i) => i.name === 'Tymczasowy produkt przed importem'));
    assert.ok(afterMergeItems.items.some((i) => i.name === 'Produkt scalony z kolizją numeru'));

    // Pełne odtworzenie wyeksportowanego backupu w trybie replace
    const replaceRes = await fetch(`${baseUrl}/api/database/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'replace', backup: exportedBackup })
    }).then((r) => r.json());
    assert.equal(replaceRes.ok, true);
    assert.equal(replaceRes.stats.inventory_imported, exportedBackup.counts.inventory_items);
    assert.ok(!replaceRes.settings.locations.includes('Piwniczka'));

    const afterReplaceItems = await fetch(`${baseUrl}/api/items`).then((r) => r.json());
    assert.equal(afterReplaceItems.items.length, exportedBackup.counts.inventory_items);
    assert.ok(!afterReplaceItems.items.some((i) => i.name === 'Tymczasowy produkt przed importem'));

    console.log('9. Testowanie usunięcia zakładki/endpointu Składniki oraz serwowania frontendu Vite...');
    const removedIngredientsRes = await fetch(`${baseUrl}/api/ingredients/check`, {
      method: 'POST'
    });
    assert.equal(removedIngredientsRes.status, 404);

    const indexHtmlRes = await fetch(`${baseUrl}/`);
    assert.equal(indexHtmlRes.status, 200);
    const htmlText = await indexHtmlRes.text();
    assert.match(htmlText, /theme-color/i);
    assert.match(htmlText, /#f2f2f7/i);
    assert.match(htmlText, /#000000/i);

    console.log('10. Testowanie dekodera kodów QR i EAN-13 (zdjęcie oraz klatki wideo na żywo)...');
    await runScannerDecoderTests();

    console.log('Wszystkie testy API, dekodera i integracji Vite przeszły pomyślnie.');
  } finally {
    server.close();
    mockPrinterServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function loadScannerModule() {
  const ts = require('typescript');
  const { createRequire } = require('node:module');
  const decoderPath = path.join(__dirname, '..', 'src', 'utils', 'ean13Decoder.ts');
  const tsSource = fs.readFileSync(decoderPath, 'utf8');
  const { outputText } = ts.transpileModule(tsSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  });
  const mod = { exports: {} };
  const fn = new Function('module', 'exports', 'require', 'window', outputText);
  fn(mod, mod.exports, createRequire(decoderPath), {});
  return mod.exports;
}

function makeSolidImageData(width, height, r = 245, g = 245, b = 245) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

function drawQrIntoImage(imageData, text, { offsetX, offsetY, modulePx, invert = false }) {
  const QRCode = require('qrcode');
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const fg = invert ? 245 : 15;
  const bg = invert ? 20 : 245;

  const pad = 3 * modulePx;
  const totalPx = n * modulePx + pad * 2;
  for (let dy = 0; dy < totalPx; dy++) {
    const py = offsetY + dy;
    if (py < 0 || py >= imageData.height) continue;
    for (let dx = 0; dx < totalPx; dx++) {
      const px = offsetX + dx;
      if (px < 0 || px >= imageData.width) continue;
      const mx = Math.floor((dx - pad) / modulePx);
      const my = Math.floor((dy - pad) / modulePx);
      const isDark = mx >= 0 && my >= 0 && mx < n && my < n && Boolean(qr.modules.data[my * n + mx]);
      const val = isDark ? fg : bg;
      const idx = (py * imageData.width + px) * 4;
      imageData.data[idx] = val;
      imageData.data[idx + 1] = val;
      imageData.data[idx + 2] = val;
      imageData.data[idx + 3] = 255;
    }
  }
}

function encodeEan13Bits(ean13) {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

  const first = Number(ean13[0]);
  const pattern = PARITY[first];
  let bits = '101';
  for (let i = 0; i < 6; i++) {
    const d = Number(ean13[1 + i]);
    bits += pattern[i] === 'L' ? L[d] : G[d];
  }
  bits += '01010';
  for (let i = 7; i < 13; i++) {
    bits += R[Number(ean13[i])];
  }
  bits += '101';
  return bits;
}

function drawEan13IntoImage(imageData, code, { offsetX, offsetY, barWidth, barHeight }) {
  const bits = encodeEan13Bits(code);
  for (let y = 0; y < barHeight; y++) {
    const py = offsetY + y;
    if (py < 0 || py >= imageData.height) continue;
    for (let i = 0; i < bits.length; i++) {
      const val = bits[i] === '1' ? 12 : 246;
      for (let bx = 0; bx < barWidth; bx++) {
        const px = offsetX + i * barWidth + bx;
        if (px < 0 || px >= imageData.width) continue;
        const idx = (py * imageData.width + px) * 4;
        imageData.data[idx] = val;
        imageData.data[idx + 1] = val;
        imageData.data[idx + 2] = val;
        imageData.data[idx + 3] = 255;
      }
    }
  }
}

function createMockCanvasFromFrame(frame) {
  let buf = makeSolidImageData(1, 1);
  const ctx = {
    drawImage(_src, sx, sy, sw, sh, dx, dy, dw, dh) {
      buf = makeSolidImageData(dw, dh);
      for (let y = 0; y < dh; y++) {
        const srcY = Math.min(frame.height - 1, Math.max(0, Math.floor(sy + (y * sh) / dh)));
        for (let x = 0; x < dw; x++) {
          const srcX = Math.min(frame.width - 1, Math.max(0, Math.floor(sx + (x * sw) / dw)));
          const sIdx = (srcY * frame.width + srcX) * 4;
          const dIdx = ((dy + y) * dw + (dx + x)) * 4;
          buf.data[dIdx] = frame.data[sIdx];
          buf.data[dIdx + 1] = frame.data[sIdx + 1];
          buf.data[dIdx + 2] = frame.data[sIdx + 2];
          buf.data[dIdx + 3] = frame.data[sIdx + 3];
        }
      }
    },
    getImageData(x, y, w, h) {
      assert.equal(x, 0);
      assert.equal(y, 0);
      assert.equal(w, buf.width);
      assert.equal(h, buf.height);
      return buf;
    }
  };
  return {
    width: 0,
    height: 0,
    getContext() {
      return ctx;
    }
  };
}

async function runScannerDecoderTests() {
  const { normalizeScannedCode, decodeFromImageData, scanVideoFrame } = loadScannerModule();

  assert.deepEqual(normalizeScannedCode('https://kitchen.local/item?s=aaa-0001'), {
    code: 'AAA-0001',
    kind: 'serial'
  });
  assert.deepEqual(normalizeScannedCode('5901234123457'), {
    code: '5901234123457',
    kind: 'ean'
  });
  assert.equal(normalizeScannedCode('przypadkowy napis'), null);

  // Jednorodne tło bez kontrastu nie powinno generować fałszywych odczytów
  assert.equal(decodeFromImageData(makeSolidImageData(320, 240)), null);

  // QR standardowy oraz odwrócony (biały na ciemnym tle)
  const qrImg = makeSolidImageData(320, 320);
  drawQrIntoImage(qrImg, 'AAA-0001', { offsetX: 50, offsetY: 50, modulePx: 6 });
  assert.equal(decodeFromImageData(qrImg), 'AAA-0001');

  const invertedQrImg = makeSolidImageData(320, 320, 20, 20, 20);
  drawQrIntoImage(invertedQrImg, 'KAT-0012', { offsetX: 50, offsetY: 50, modulePx: 6, invert: true });
  assert.equal(decodeFromImageData(invertedQrImg), 'KAT-0012');

  // Kod EAN-13 ze wszystkimi liniami skanowania
  const eanImg = makeSolidImageData(420, 200);
  drawEan13IntoImage(eanImg, '5901234123457', { offsetX: 65, offsetY: 45, barWidth: 3, barHeight: 110 });
  assert.equal(decodeFromImageData(eanImg), '5901234123457');

  // Symulacja klatki wideo HD na żywo z małym kodem QR w centrum (wymusza 1:1 crop bez degradacji)
  const hdQrFrame = makeSolidImageData(1280, 720);
  drawQrIntoImage(hdQrFrame, 'BBB-0042', { offsetX: 560, offsetY: 280, modulePx: 5 });
  const qrLiveRes = await scanVideoFrame(
    { readyState: 4, videoWidth: 1280, videoHeight: 720 },
    createMockCanvasFromFrame(hdQrFrame)
  );
  assert.equal(qrLiveRes, 'BBB-0042');

  // Symulacja klatki wideo HD na żywo z kodem EAN-13
  const hdEanFrame = makeSolidImageData(1280, 720);
  drawEan13IntoImage(hdEanFrame, '5901234123457', { offsetX: 495, offsetY: 290, barWidth: 3, barHeight: 140 });
  const eanLiveRes = await scanVideoFrame(
    { readyState: 4, videoWidth: 1280, videoHeight: 720 },
    createMockCanvasFromFrame(hdEanFrame)
  );
  assert.equal(eanLiveRes, '5901234123457');
}

runTests().catch((err) => {
  console.error('Błąd testów:', err);
  process.exit(1);
});
