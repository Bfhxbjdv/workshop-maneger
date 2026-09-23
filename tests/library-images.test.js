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
  assert.match(routes, /DESIGN_EXTENSIONS/);
  assert.match(routes, /limits: \{ fileSize: 25 \* 1024 \* 1024/);
  assert.match(admin, /<input[^>]*type="file"[^>]*id="designFile"/);
  assert.match(admin, /formData\.append\('file', file, file\.name\)/);
  assert.match(admin, /fetch\('\/api\/designs', \{ method: 'POST'/);
  assert.doesNotMatch(admin, /id="designFilePath"/);
});
