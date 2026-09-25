const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');

function d1(database) {
  const prepare = (sql, values = []) => ({
    bind(...parameters) { return prepare(sql, parameters); },
    async first() { return (await this.all()).results[0] || null; },
    async all() {
      const statement = database.prepare(sql);
      statement.bind(values);
      const results = [];
      while (statement.step()) results.push(statement.getAsObject());
      statement.free();
      return { results };
    },
    async run() {
      const statement = database.prepare(sql);
      statement.bind(values);
      statement.step();
      statement.free();
      return { meta: { last_row_id: database.exec('SELECT last_insert_rowid()')[0].values[0][0] } };
    }
  });
  return { prepare };
}

function r2() {
  const objects = new Map();
  return {
    objects,
    async put(key, stream, options = {}) {
      objects.set(key, { bytes: await new Response(stream).arrayBuffer(), ...options });
    },
    async get(key) {
      const item = objects.get(key);
      return item && { body: new Blob([item.bytes]).stream(), size: item.bytes.byteLength, httpMetadata: item.httpMetadata };
    },
    async delete(key) { objects.delete(key); }
  };
}

function workerWithCustomOrders(handleCustomOrders) {
  const source = fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'src', 'worker.mjs'), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace('export default {', 'const cloudflareWorker = {');
  const context = {
    bcrypt, crypto: webcrypto, Request, Response, Headers, FormData, File, Blob, URL,
    TextEncoder, TextDecoder, atob, btoa, console,
    landingHtml: '', handleCustomOrders,
    handleDesignsApi: async () => null, handleAgentsApi: async () => null
  };
  return vm.runInNewContext(`${source}\ncloudflareWorker`, context, { filename: 'worker.mjs' });
}

test('custom upload persists in R2, admin starts the order, and its assigned designer can list and download the attachment', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  database.exec(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'migrations', '0001_initial.sql'), 'utf8'));
  const hash = bcrypt.hashSync('test-password', 4);
  for (const [name, role] of [['agent', 'Agent'], ['admin', 'Admin'], ['designer', 'Designer'], ['other-agent', 'Agent']]) {
    database.run('INSERT INTO Users (Name,Role,Username,Password) VALUES (?,?,?,?)', [name, role, name, hash]);
  }
  database.run("INSERT INTO Clients (Full_Name,Created_By,Agent_ID) VALUES ('عميل الوكيل',1,1)");
  database.run("INSERT INTO Clients (Full_Name,Created_By,Agent_ID) VALUES ('عميل وكيل آخر',4,4)");

  const { handleCustomOrders } = await import('../cloudflare/src/custom-orders.mjs');
  const env = { DB: d1(database), FILES: r2(), SESSION_SECRET: 'test-only-secret' };
  const worker = workerWithCustomOrders(handleCustomOrders);
  const call = (route, cookie = '', options = {}) => worker.fetch(new Request(`https://example.test${route}`, {
    ...options, headers: { ...(options.headers || {}), cookie }
  }), env);
  const sessions = {};
  for (const username of ['agent', 'admin', 'designer']) {
    const response = await call('/api/auth/login', '', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password: 'test-password' })
    });
    assert.equal(response.status, 200, username);
    sessions[username] = response.headers.get('set-cookie').split(';')[0];
  }

  const form = new FormData();
  form.set('name', 'واجهة مخصصة');
  form.set('description', 'مطلوب تعديل الأبعاد');
  form.append('customDesignFiles', new File(['DXF reference bytes'], 'reference.dxf', { type: 'application/dxf' }));
  const uploaded = await call('/api/agents/my/custom-design', sessions.agent, { method: 'POST', body: form });
  const uploadBody = await uploaded.json();
  assert.equal(uploaded.status, 201, JSON.stringify(uploadBody));
  const requestId = uploadBody.custom_design_id;
  const custom = await env.DB.prepare('SELECT * FROM Agent_Custom_Designs WHERE Custom_Design_ID=?').bind(requestId).first();
  const [attachment] = JSON.parse(custom.Image_Path);
  assert.equal(custom.Status, 'pending');
  assert.equal(attachment.name, 'reference.dxf');
  assert.ok(env.FILES.objects.has(attachment.path.slice(5)));

  const foreign = await call(`/api/agents/admin/custom-requests/${requestId}/status`, sessions.admin, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'in_progress', designer_id: 3, client_id: 2, machine_type: 'Laser' })
  });
  assert.equal(foreign.status, 403);
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS count FROM Orders').first()).count, 0);

  const started = await call(`/api/agents/admin/custom-requests/${requestId}/status`, sessions.admin, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'in_progress', designer_id: 3, client_id: 1, machine_type: 'Laser' })
  });
  const startBody = await started.json();
  assert.equal(started.status, 200, JSON.stringify(startBody));
  const orderId = startBody.order_id;
  const order = await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(orderId).first();
  assert.equal(order.Client_ID, 1);
  assert.equal(order.Designer_ID, 3);
  assert.equal(order.Status, 'قيد التصميم');
  assert.equal(order.Approval_Status, 'approved');

  const designerOrders = await call('/api/orders', sessions.designer);
  assert.equal(designerOrders.status, 200);
  assert.ok((await designerOrders.json()).orders.some(item => item.Task_ID === orderId));
  const listed = await call(`/api/files/list/${orderId}`, sessions.designer);
  assert.equal(listed.status, 200);
  const files = (await listed.json()).files;
  assert.equal(files.length, 1);
  assert.equal(files[0].File_Path, attachment.path);
  assert.equal(files[0].Upload_Type, 'agent_custom');
  const downloaded = await call(`/api/files/download-file/${files[0].File_ID}`, sessions.designer);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), 'DXF reference bytes');
});

test('linked custom designs cannot target a foreign client or revive delivered and rejected orders', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  database.exec(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'migrations', '0001_initial.sql'), 'utf8'));
  database.run("INSERT INTO Users (Name,Role,Username,Password) VALUES ('agent','Agent','agent','test')");
  database.run("INSERT INTO Users (Name,Role,Username,Password) VALUES ('admin','Admin','admin','test')");
  database.run("INSERT INTO Users (Name,Role,Username,Password) VALUES ('designer','Designer','designer','test')");
  database.run("INSERT INTO Users (Name,Role,Username,Password) VALUES ('other','Agent','other','test')");
  database.run("INSERT INTO Clients (Full_Name,Created_By,Agent_ID) VALUES ('own',1,1)");
  database.run("INSERT INTO Clients (Full_Name,Created_By,Agent_ID) VALUES ('foreign',4,4)");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status) VALUES (2,1,'Laser','بانتظار الموافقة','pending')");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status) VALUES (1,1,'Laser','تم التسليم','approved')");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status) VALUES (1,1,'Laser','مرفوض','rejected')");

  const { handleCustomOrders } = await import('../cloudflare/src/custom-orders.mjs');
  const env = { DB: d1(database), FILES: r2() };
  const agent = { User_ID: 1, Role: 'Agent' };
  const admin = { User_ID: 2, Role: 'Admin' };
  const call = (route, user, options) => {
    const url = new URL(`https://example.test${route}`);
    return handleCustomOrders(new Request(url, options), env, user, url.pathname, url);
  };

  for (const orderId of [1, 2, 3]) {
    const form = new FormData();
    form.set('name', 'طلب مرتبط');
    form.set('order_id', String(orderId));
    const response = await call('/api/agents/my/custom-design', agent, { method: 'POST', body: form });
    assert.equal(response.status, orderId === 1 ? 403 : 409);
  }
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS count FROM Agent_Custom_Designs').first()).count, 0);

  for (const orderId of [1, 2, 3]) {
    database.run('INSERT INTO Agent_Custom_Designs (Agent_ID,Order_ID,Name) VALUES (1,?,?)', [orderId, `old ${orderId}`]);
    const response = await call(`/api/agents/admin/custom-requests/${orderId}/status`, admin, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'in_progress', designer_id: 3 })
    });
    assert.equal(response.status, orderId === 1 ? 400 : 409);
  }
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS count FROM Agent_Custom_Designs WHERE Status!='pending'").first()).count, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS count FROM Orders WHERE Designer_ID IS NOT NULL").first()).count, 0);
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS count FROM Order_Files").first()).count, 0);
});
