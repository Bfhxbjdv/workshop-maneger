const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

function loadWorker() {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'src', 'worker.mjs'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default {', 'const cloudflareWorker = {');
  const template = name => fs.readFileSync(path.join(__dirname, '..', 'views', `${name}.ejs`), 'utf8');
  const context = {
    bcrypt, crypto: webcrypto, Request, Response, Headers, FormData, File, Blob, URL,
    TextEncoder, TextDecoder, atob, btoa, console,
    landingHtml: '', adminTemplate: template('admin'), agentTemplate: template('agent'), designerTemplate: template('designer'),
    laserTemplate: template('laser'), routerTemplate: template('router'), clientsTemplate: template('clients'), inventoryTemplate: template('inventory'),
    invoicesTemplate: template('invoices'), usersTemplate: template('users'), expensesTemplate: template('expenses'), designsTemplate: template('designs'),
    clientTemplate: template('client'), accountTemplate: template('account'), agentsTemplate: template('agents'), agentDetailTemplate: template('agent-detail'),
    handleCustomOrders: async () => null,
    handleDesignsApi: async () => null, handleAgentsApi: async () => null
  };
  return vm.runInNewContext(`${source}\ncloudflareWorker`, context, { filename: 'worker.mjs' });
}

function d1(sqlDb) {
  function statement(sql, values = []) {
    const execute = () => {
      const prepared = sqlDb.prepare(sql);
      prepared.bind(values);
      const rows = [];
      while (prepared.step()) rows.push(prepared.getAsObject());
      prepared.free();
      const metadata = sqlDb.exec('SELECT changes() AS changes, last_insert_rowid() AS last_row_id')[0].values[0];
      return { rows, meta: { changes: metadata[0], last_row_id: metadata[1] } };
    };
    return {
      sql, values,
      bind(...parameters) { return statement(sql, parameters); },
      async first() { return execute().rows[0] || null; },
      async all() { return { results: execute().rows }; },
      async run() { return execute(); }
    };
  }
  return {
    prepare: sql => statement(sql),
    async batch(statements) {
      sqlDb.run('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        sqlDb.run('COMMIT');
        return results;
      } catch (error) { sqlDb.run('ROLLBACK'); throw error; }
    }
  };
}

function r2() {
  const objects = new Map();
  return {
    objects,
    async put(key, stream, options = {}) {
      objects.set(key, { data: await new Response(stream).arrayBuffer(), ...options });
    },
    async get(key) {
      const object = objects.get(key);
      return object ? { body: new Blob([object.data]).stream(), size: object.data.byteLength, httpMetadata: object.httpMetadata, customMetadata: object.customMetadata } : null;
    },
    async delete(key) { objects.delete(key); }
  };
}

test('agent quantity reaches designer and laser; cut deducts once and delivery totals once', async () => {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();
  sqlDb.exec(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'migrations', '0001_initial.sql'), 'utf8'));
  const hash = bcrypt.hashSync('test-password', 4);
  for (const [name, role] of [['admin', 'Admin'], ['designer', 'Designer'], ['laser', 'Laser_Op'], ['agent', 'Agent']]) {
    sqlDb.run('INSERT INTO Users (Name,Role,Username,Password) VALUES (?,?,?,?)', [name, role, name, hash]);
  }
  sqlDb.run("INSERT INTO Agent_Profiles (User_ID, Status) VALUES (4, 'active')");
  sqlDb.run('INSERT INTO Clients (Full_Name,Created_By) VALUES (?,?)', ['عميل اختبار', 4]);
  sqlDb.run('INSERT INTO Inventory (Material_Name,Quantity,Cost_Per_Unit) VALUES (?,?,?)', ['لوح MDF', 50, 3]);
  sqlDb.run("INSERT INTO Product_Pricing (Product_Name,Unit,Base_Price) VALUES ('قص','لوح',100)");
  sqlDb.run('INSERT INTO Product_Material_Pricing (Pricing_ID,Material_ID,Price) VALUES (1,1,100)');
  sqlDb.run("INSERT INTO Designs (Name,FilePath,Original_Name,CreatedBy) VALUES ('تصميم','r2://designs/base.dxf','base.dxf',1)");
  sqlDb.run("INSERT INTO Agent_Images (Category,Original_Name,Stored_Name,File_Path,File_Size,Uploaded_By,Design_ID) VALUES ('عام','test.webp','test.webp','r2://library/test.webp',4,1,1)");
  const env = { DB: d1(sqlDb), FILES: r2(), SESSION_SECRET: 'test-only-secret', ASSETS: { fetch: async () => new Response('', { status: 404 }) } };
  await env.FILES.put('library/test.webp', new Blob(['test']).stream(), { httpMetadata: { contentType: 'image/webp' } });
  await env.FILES.put('designs/base.dxf', new Blob(['base']).stream(), { httpMetadata: { contentType: 'application/dxf' } });
  const worker = loadWorker();
  const base = 'https://example.test';
  const call = (url, cookie, options = {}) => worker.fetch(new Request(base + url, { ...options, headers: { ...(options.headers || {}), cookie } }), env);
  const sessions = {};
  for (const username of ['admin', 'designer', 'laser', 'agent']) {
    const form = new FormData(); form.set('username', username); form.set('password', 'test-password');
    const response = await call('/login', '', { method: 'POST', body: form });
    assert.equal(response.status, 302);
    sessions[username] = response.headers.get('set-cookie').split(';')[0];
  }
  for (const route of ['/designs', '/account', '/agents', '/agents/4', '/client/1']) {
    const page = await call(route, sessions.admin);
    assert.equal(page.status, 200, route);
    assert.doesNotMatch(await page.text(), /<%[=-]?/, route);
  }

  const createdResponse = await call('/api/orders', sessions.agent, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ Client_ID: 1, Machine_Type: 'Laser', Image_IDs: [1], Quantities: { 1: 20 }, Pricing_ID: 1, Material_ID: 1, Quantity_Unit: 'لوح', Agent_Commission: 5 })
  });
  assert.equal(createdResponse.status, 201);
  const taskId = (await createdResponse.json()).Task_ID;
  const pending = (await (await call('/api/orders', sessions.agent)).json()).orders[0];
  assert.equal(pending.Material_Qty, 20);
  assert.equal(pending.Status, 'بانتظار الموافقة');
  const premature = await call(`/api/orders/${taskId}/status`, sessions.agent, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Status: 'تم التسليم' }) });
  assert.equal(premature.status, 403);

  const approved = await call(`/api/orders/${taskId}/approve`, sessions.admin, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'approve', designer_id: 2 }) });
  assert.equal(approved.status, 200);
  const commission = await env.DB.prepare('SELECT Commission_Amount, Status FROM Agent_Commissions WHERE Order_ID=?').bind(taskId).first();
  assert.equal(commission.Commission_Amount, 5);
  assert.equal(commission.Status, 'pending');
  assert.equal((await (await call('/api/orders', sessions.designer)).json()).orders[0].Material_Qty, 20);

  const designForm = new FormData();
  designForm.append('files', new File(['new-design'], 'latest.dxf', { type: 'application/dxf' }));
  designForm.set('materials', JSON.stringify([{ Material_ID: 1, Quantity: 12 }]));
  const upload = await call(`/api/files/upload/${taskId}`, sessions.designer, { method: 'POST', body: designForm });
  assert.equal(upload.status, 200, await upload.text());
  const ready = (await (await call('/api/orders?status=جاهز%20للقص&machine=Laser', sessions.laser)).json()).orders[0];
  assert.equal(ready.Material_Qty, 20);
  assert.equal(ready.Materials[0].Quantity, 12);
  assert.equal(ready.File_Count, 1);
  const downloaded = await call(`/api/files/download/${taskId}`, sessions.laser);
  assert.equal(await downloaded.text(), 'new-design');

  const complete = () => call(`/api/orders/${taskId}/status`, sessions.laser, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Status: 'تم الانتهاء من القص' }) });
  assert.equal((await complete()).status, 200);
  assert.equal((await complete()).status, 200);
  assert.equal((await env.DB.prepare('SELECT Quantity FROM Inventory WHERE Material_ID=1').first()).Quantity, 38);
  const deliver = () => call(`/api/orders/${taskId}/status`, sessions.laser, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Status: 'تم التسليم' }) });
  assert.equal((await deliver()).status, 200);
  assert.equal((await deliver()).status, 200);
  assert.equal((await env.DB.prepare('SELECT Total_Spent FROM Clients WHERE Client_ID=1').first()).Total_Spent, 105);
  assert.equal((await env.DB.prepare('SELECT Quantity FROM Inventory WHERE Material_ID=1').first()).Quantity, 38);
  const logResponse = await call('/admin/api/logs', sessions.admin);
  assert.equal(logResponse.status, 200);
  const loggedActions = (await logResponse.json()).logs.map(entry => entry.Action);
  assert.ok(loggedActions.includes('design_uploaded'));
  assert.ok(loggedActions.includes('cut_completed'));
  assert.ok(loggedActions.includes('order_delivered'));

  const deleted = await call(`/api/orders/${taskId}`, sessions.admin, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.ok(env.FILES.objects.has('library/test.webp'));
  assert.ok(env.FILES.objects.has('designs/base.dxf'));
  await env.DB.prepare("UPDATE Agent_Profiles SET Status='inactive' WHERE User_ID=4").run();
  assert.equal((await call('/api/auth/me', sessions.agent)).status, 401);
  const disabledLogin = new FormData(); disabledLogin.set('username', 'agent'); disabledLogin.set('password', 'test-password');
  assert.equal((await call('/login', '', { method: 'POST', body: disabledLogin })).status, 401);
});
