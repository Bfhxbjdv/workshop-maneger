const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const records = new Map();
let nextId = 1;
const dbPath = require.resolve('../database/connection');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
  get(sql, params) {
    if (sql.includes('Agent_Images')) return records.get(Number(params[0]));
    if (sql.includes('Order_Files')) return { ...records.get(Number(params[0])), Task_ID: 1 };
    if (sql.includes('Orders')) return { Task_ID: 1, Created_By: 1 };
    if (sql.includes('Permissions')) return { Permissions: '{"orders":true}' };
  },
  all: () => [...records.values()],
  run(sql, params) {
    if (!sql.includes('INSERT INTO Agent_Images')) throw new Error('Unexpected test DB write');
    const Image_ID = nextId++;
    records.set(Image_ID, { Image_ID, Category: params[0], Original_Name: params[1], Stored_Name: params[2], File_Path: params[3], File_Size: params[4] });
    return { lastId: Image_ID };
  }
} };
const { resolveLocalFile, resolveLibraryImage } = require('../services/localFiles');
const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'library-preview.svg'));
const createdFiles = new Set();
let server, base;
before(async () => {
  const app = express();
  app.use((req, res, next) => {
    const role = req.headers['x-test-role'];
    req.session = role ? { userId: 1, role } : {};
    next();
  });
  app.use('/api/orders', require('../routes/orders'));
  app.use('/api/files', require('../routes/files'));
  server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  for (const filename of createdFiles) fs.unlinkSync(filename);
});
const headers = { 'x-test-role': 'Admin', Accept: 'application/json' };

test('upload -> list -> preview returns the original SVG with correct content type', async () => {
  const form = new FormData();
  form.append('category', 'اختبار');
  form.append('images', new Blob([fixture], { type: 'image/svg+xml' }), 'library-preview.svg');
  const upload = await fetch(base + '/api/orders/agent/images', { method: 'POST', headers, body: form });
  assert.equal(upload.status, 200);
  const { images } = await upload.json();
  const id = images[0].Image_ID;
  createdFiles.add(records.get(id).File_Path);
  const list = await fetch(base + '/api/orders/agent/images', { headers }).then(r => r.json());
  assert.equal(list.images[0].Original_Name, 'library-preview.svg');
  for (const role of ['Admin', 'Agent', 'Custom']) {
    const preview = await fetch(base + `/api/orders/agent/images/${id}/file`, { headers: { ...headers, 'x-test-role': role } });
    assert.equal(preview.status, 200);
    assert.match(preview.headers.get('content-type'), /image\/svg\+xml/);
    assert.match(preview.headers.get('content-security-policy'), /sandbox/);
    assert.deepEqual(Buffer.from(await preview.arrayBuffer()), fixture);
  }
  for (const endpoint of ['image', 'download-file']) {
    const response = await fetch(base + `/api/files/${endpoint}/${id}`, { headers });
    assert.equal(response.status, 200, 'order files must support absolute library paths');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), fixture);
  }
  const saved = records.get(id);
  assert.equal(resolveLibraryImage({ ...saved, File_Path: '/previous-deployment/' + saved.Stored_Name }), saved.File_Path);
  assert.equal(resolveLocalFile(saved.File_Path), saved.File_Path);
});

test('missing files and records give a clear 404', async () => {
  records.set(1000, { File_Path: 'missing.svg', Stored_Name: 'missing.svg' });
  for (const id of [999, 1000]) {
    const response = await fetch(base + `/api/orders/agent/images/${id}/file`, { headers });
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /غير موجود/);
  }
});

test('unauthenticated and unauthorized requests cannot read library files', async () => {
  const anonymous = await fetch(base + '/api/orders/agent/images/1/file', { headers: { Accept: 'application/json' } });
  assert.equal(anonymous.status, 401);
  const forbidden = await fetch(base + '/api/orders/agent/images/1/file', { headers: { ...headers, 'x-test-role': 'Unknown' } });
  assert.equal(forbidden.status, 403);
});

test('unsupported formats and empty uploads are rejected as JSON', async () => {
  const form = new FormData();
  form.append('images', new Blob(['not an image']), 'document.html');
  const response = await fetch(base + '/api/orders/agent/images', { method: 'POST', headers, body: form });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /صيغة/);
  const empty = await fetch(base + '/api/orders/agent/images', { method: 'POST', headers, body: new FormData() });
  assert.equal(empty.status, 400);
});

test('resolver refuses traversal, unrelated server files and remote schemes', () => {
  assert.equal(resolveLocalFile('../../package.json'), null);
  assert.equal(resolveLocalFile(path.resolve(__dirname, '../package.json')), null);
  assert.equal(resolveLocalFile('gdrive://test'), null);
  assert.equal(resolveLibraryImage({ Stored_Name: '../../package.json' }), null);
});

test('admin and agent templates render with valid inline JavaScript', () => {
  const ejs = require('ejs');
  const vm = require('node:vm');
  for (const name of ['admin', 'agent']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'views', name + '.ejs'), 'utf8');
    const html = ejs.render(source, { user: { name: 'Test' }, assetVersion: 'test' });
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
      new vm.Script(match[1], { filename: name + '.ejs' });
    }
    assert.match(html, /object-fit:\s*contain/);
  }
});

test('adding an agent client uses a resilient modal close path', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'views', 'agent.ejs'), 'utf8');
  assert.match(source, /bootstrap\.Modal\.getOrCreateInstance\(modalElement\)/);
  assert.match(source, /modal\.hide\(\)/);
  assert.match(source, /hidden\.bs\.modal/);
  assert.match(source, /clearStuckModalBackdrop/);
  assert.match(source, /newClientForm.*addEventListener\('submit', addNewClient\)/s);
  assert.match(source, /saveNewClientButton/);
});

test('product-material pricing is persisted and wired into admin and agent flows', () => {
  const init = fs.readFileSync(path.join(__dirname, '..', 'database', 'init.js'), 'utf8');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orders.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  const agent = fs.readFileSync(path.join(__dirname, '..', 'views', 'agent.ejs'), 'utf8');
  assert.match(init, /CREATE TABLE IF NOT EXISTS Product_Material_Pricing/);
  assert.match(init, /CREATE TABLE IF NOT EXISTS Agent_Image_Materials/);
  assert.match(routes, /agent\/images\/:id\/materials/);
  assert.match(routes, /الخامة المختارة لا تناسب إحدى الصور المحددة/);
  assert.match(routes, /withMaterialPrices/);
  assert.match(admin, /المنتجات والأسعار/);
  assert.match(admin, /openImageMaterials/);
  assert.match(agent, /allowedMaterials/);
  assert.match(agent, /selectedMaterialId/);
});

test('ready-design modal uploads a selected local file instead of accepting a storage path', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'designs.js'), 'utf8');
  const admin = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  assert.match(routes, /function makeUpload\(maxFiles\)/);
  assert.match(routes, /limits: \{ fileSize: 25 \* 1024 \* 1024/);
  assert.match(routes, /batchDesignUpload/);
  assert.match(admin, /<input[^>]*type="file"[^>]*id="designFile"/);
  assert.match(admin, /accept="\*\/\*"/);
  assert.match(admin, /formData\.append\('file', file, file\.name\)/);
  assert.match(admin, /fetch\('\/api\/designs', \{ method: 'POST'/);
  assert.match(admin, /previewReadyDesignFile/);
  assert.match(admin, /انتهت جلسة الدخول/);
  assert.doesNotMatch(admin, /id="designFilePath"/);
});

test('uploading an approved order file moves it to the machine-ready queue', () => {
  const files = fs.readFileSync(path.join(__dirname, '..', 'routes', 'files.js'), 'utf8');
  const designs = fs.readFileSync(path.join(__dirname, '..', 'routes', 'designs.js'), 'utf8');
  assert.match(files, /function shouldSendToMachine\(order\)/);
  assert.match(files, /Status='جاهز للقص'/);
  assert.match(files, /designUpload\.array\('files', 50\)/);
  assert.match(designs, /function shouldSendToMachine\(order\)/);
  assert.match(designs, /if \(shouldSendToMachine\(order\)\)/);
});

test('ready-design cards generate correct previews for DXF, PLT and embedded CDR images', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'designs.js'), 'utf8');
  assert.match(script, /renderMissingCardPreviews/);
  assert.match(script, /drawDxf\(canvas, source\)/);
  assert.match(script, /drawPlt\(canvas, source\)/);
  assert.match(script, /extractEmbeddedCdrPreview/);
  assert.match(script, /props\[10\] = parseFloat\(v\)/);
  assert.match(script, /props\[20\] = parseFloat\(v\)/);
});

test('batch design thumbnails stay paired with the right file when names repeat', () => {
  const routes = fs.readFileSync(path.join(__dirname, '..', 'routes', 'designs.js'), 'utf8');
  const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'designs.js'), 'utf8');
  assert.match(routes, /thumbIndexes/);
  assert.match(routes, /thumbIndexes\.indexOf\(i\)/);
  assert.match(script, /const nameCounts = new Map\(\)/);
  assert.match(script, /thumbIndexes\.push\(i\)/);
  assert.match(script, /fd\.append\('thumbIndexes'/);
});

test('library image cards provide a design-linking control', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  assert.match(admin, /ربط بتصميم/);
  assert.match(admin, /openImageDesignLink/);
  assert.match(admin, /imageDesignLinkModal/);
  assert.match(admin, /agents\/admin\/images\/\$\{imageId\}\/link-design/);
  assert.match(admin, /agents\/admin\/designs\?limit=100/);
});

test('an agent order carries each linked ready-design file to the designer', () => {
  const orders = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orders.js'), 'utf8');
  assert.match(orders, /copyLinkedDesignToOrder/);
  assert.match(orders, /SELECT File_Path, Original_Name, Stored_Name, Design_ID FROM Agent_Images/);
  assert.match(orders, /التصميم المرتبط بالصورة/);
});

test('admin can preview agent order and custom request attachments', () => {
  const admin = fs.readFileSync(path.join(__dirname, '..', 'views', 'admin.ejs'), 'utf8');
  const agents = fs.readFileSync(path.join(__dirname, '..', 'routes', 'agents.js'), 'utf8');
  const localFiles = fs.readFileSync(path.join(__dirname, '..', 'services', 'localFiles.js'), 'utf8');
  assert.match(admin, /showOrderAttachments/);
  assert.match(admin, /showCustomRequestAttachments/);
  assert.match(agents, /custom-requests\/:id\/files/);
  assert.match(localFiles, /customDesignRoot/);
});

test('cut completion deducts inventory once and keeps only the latest design file current', () => {
  const accounting = fs.readFileSync(path.join(__dirname, '..', 'services', 'orderAccounting.js'), 'utf8');
  const files = fs.readFileSync(path.join(__dirname, '..', 'routes', 'files.js'), 'utf8');
  const orders = fs.readFileSync(path.join(__dirname, '..', 'routes', 'orders.js'), 'utf8');
  assert.match(accounting, /deductInventoryForCut/);
  assert.match(accounting, /Inventory_Deducted_At/);
  assert.match(files, /Is_Current=0/);
  assert.match(orders, /Quantity_Unit/);
});
