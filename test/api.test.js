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

    console.log('Wszystkie testy API i integracji Vite przeszły pomyślnie.');
  } finally {
    server.close();
    mockPrinterServer.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests().catch((err) => {
  console.error('Błąd testów:', err);
  process.exit(1);
});
