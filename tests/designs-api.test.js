const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');

const modulePromise = import('../cloudflare/src/designs-api.mjs');
const sqlPromise = initSqlJs();

function d1(database) {
  function prepared(sql, values = []) {
    const execute = () => {
      const statement = database.prepare(sql);
      statement.bind(values);
      return statement;
    };
    return {
      bind(...bound) { return prepared(sql, bound); },
      async first() {
        const statement = execute();
        const row = statement.step() ? statement.getAsObject() : null;
        statement.free();
        return row;
      },
      async all() {
        const statement = execute(), results = [];
        while (statement.step()) results.push(statement.getAsObject());
        statement.free();
        return { results };
      },
      async run() {
        const statement = execute();
        statement.step();
        statement.free();
        const last = database.exec('SELECT last_insert_rowid() AS id')[0].values[0][0];
        return { meta: { last_row_id: last, changes: database.getRowsModified() } };
      }
    };
  }
  return {
    prepare: sql => prepared(sql),
    async batch(statements) {
      database.run('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        database.run('COMMIT');
        return results;
      } catch (error) {
        database.run('ROLLBACK');
        throw error;
      }
    }
  };
}

function r2() {
  const objects = new Map();
  return {
    async put(key, body, options = {}) {
      objects.set(key, { bytes: new Uint8Array(await new Response(body).arrayBuffer()), httpMetadata: options.httpMetadata || {} });
    },
    async get(key) {
      const item = objects.get(key);
      return item ? { body: item.bytes, size: item.bytes.byteLength, httpMetadata: item.httpMetadata } : null;
    },
    async head(key) {
      const item = objects.get(key);
      return item ? { size: item.bytes.byteLength, httpMetadata: item.httpMetadata } : null;
    },
    async delete(key) { objects.delete(key); }
  };
}

async function fixture() {
  const [{ handleDesignsApi }, SQL] = await Promise.all([modulePromise, sqlPromise]);
  const database = new SQL.Database();
  database.exec(fs.readFileSync(path.join(__dirname, '..', 'cloudflare', 'migrations', '0001_initial.sql'), 'utf8'));
  const env = { DB: d1(database), FILES: r2(), SESSION_SECRET: 'test-only-secret' };
  const users = {
    admin: { User_ID: 1, Role: 'Admin' },
    designer: { User_ID: 2, Role: 'Designer' },
    laser: { User_ID: 3, Role: 'Laser_Op' },
    agent: { User_ID: 4, Role: 'Agent' },
    router: { User_ID: 5, Role: 'Router_Op' }
  };
  for (const [name, user] of Object.entries(users)) database.run('INSERT INTO Users (User_ID, Name, Username, Password, Role) VALUES (?, ?, ?, ?, ?)', [user.User_ID, name, name, 'unused', user.Role]);
  database.run('INSERT INTO Clients (Client_ID, Full_Name, Created_By) VALUES (1, ?, 2)', ['Client']);
  database.run('INSERT INTO Designs (Design_ID, Name, FilePath, Original_Name, Password, CreatedBy) VALUES (1, ?, ?, ?, NULL, 1)', ['Open', 'r2://designs/open.dxf', 'open.dxf']);
  database.run('INSERT INTO Designs (Design_ID, Name, FilePath, Original_Name, Password, CreatedBy) VALUES (2, ?, ?, ?, ?, 1)', ['Protected', 'r2://designs/locked.dxf', 'locked.dxf', await bcrypt.hash('secret', 4)]);
  database.run('INSERT INTO Design_Permissions (Design_ID, User_ID) VALUES (2, 3)');
  await env.FILES.put('designs/open.dxf', new Blob(['OPEN']), { httpMetadata: { contentType: 'text/plain' } });
  await env.FILES.put('designs/locked.dxf', new Blob(['LOCKED']), { httpMetadata: { contentType: 'text/plain' } });
  const call = (url, user, options = {}) => handleDesignsApi(new Request(`https://example.test${url}`, options), env, user);
  return { database, env, users, call };
}

test('design list and detail enforce role visibility and never expose password hash', async () => {
  const { database, users, call } = await fixture();
  try {
    const designer = await (await call('/api/designs', users.designer)).json();
    const laser = await (await call('/api/designs', users.laser)).json();
    assert.deepEqual(designer.map(row => row.Design_ID), [1]);
    assert.deepEqual(laser.map(row => row.Design_ID), [2]);
    assert.equal(laser[0].PasswordProtected, true);
    assert.equal('Password' in laser[0], false);
    assert.equal((await call('/api/designs/1', users.laser)).status, 404);
  } finally { database.close(); }
});

test('laser and router cannot read unassigned library designs or other users permissions', async () => {
  const { database, users, call } = await fixture();
  try {
    database.run('INSERT INTO Design_Permissions (Design_ID, User_ID) VALUES (2, 5)');
    const routerList = await (await call('/api/designs', users.router)).json();
    assert.deepEqual(routerList.map(row => row.Design_ID), [2]);
    assert.equal(routerList[0].PermittedUsers.length, 1);
    assert.equal(routerList[0].PermittedUsers[0].User_ID, users.router.User_ID);
    const laserDetail = await (await call('/api/designs/2', users.laser)).json();
    assert.deepEqual(laserDetail.PermittedUsers.map(member => member.User_ID), [users.laser.User_ID]);
    const adminDetail = await (await call('/api/designs/2', users.admin)).json();
    assert.equal(adminDetail.PermittedUsers.length, 2);
    assert.equal((await call('/api/designs/1/download', users.laser)).status, 404);
    assert.equal((await call('/api/designs/1/file', users.router)).status, 404);
  } finally { database.close(); }
});

test('protected file opens only after password verification for the same user', async () => {
  const { database, users, call, env } = await fixture();
  try {
    const before = await call('/api/designs/2/file', users.laser);
    assert.equal(before.status, 403);
    const wrong = await call('/api/designs/2/verify-password', users.laser, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Password: 'wrong' }) });
    assert.equal(wrong.status, 403);
    const verified = await call('/api/designs/2/verify-password', users.laser, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ Password: 'secret' }) });
    assert.equal(verified.status, 200);
    const cookie = verified.headers.get('set-cookie').split(';')[0];
    const opened = await call('/api/designs/2/file', users.laser, { headers: { cookie } });
    assert.equal(opened.status, 200);
    assert.equal(await opened.text(), 'LOCKED');
    const otherUser = await call('/api/designs/2/file', users.admin, { headers: { cookie } });
    assert.equal(otherUser.status, 403);
  } finally { database.close(); }
});

test('batch upload keeps sparse thumbnail positions and returns usable design IDs', async () => {
  const { database, users, call, env } = await fixture();
  try {
    const form = new FormData();
    form.append('files', new File(['DXF A'], 'a.dxf', { type: 'text/plain' }));
    form.append('files', new File(['DXF B'], 'b.dxf', { type: 'text/plain' }));
    form.append('thumbs', new File(['PNG'], 'thumb.png', { type: 'image/png' }));
    form.append('thumbIndexes', JSON.stringify([1]));
    form.append('items', JSON.stringify([{ Name: 'A' }, { Name: 'B' }]));
    const response = await call('/api/designs/batch', users.admin, { method: 'POST', body: form });
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.count, 2);
    const first = await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(payload.created[0]).first();
    const second = await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(payload.created[1]).first();
    assert.equal(first.ThumbnailPath, null);
    assert.match(second.ThumbnailPath, /^r2:\/\/design-thumbnails\//);
  } finally { database.close(); }
});

test('adding a ready design creates an order that awaits cutting quantity', async () => {
  const { database, users, call, env } = await fixture();
  try {
    const response = await call('/api/designs/1/add-to-order', users.designer, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ Client_ID: 1, Machine_Type: 'Laser' })
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    const order = await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(payload.Task_ID).first();
    assert.equal(order.Status, 'قيد التصميم');
    const files = (await env.DB.prepare('SELECT * FROM Order_Files WHERE Task_ID=?').bind(payload.Task_ID).all()).results;
    assert.equal(files.length, 1);
    assert.equal(files[0].File_Path, 'r2://designs/open.dxf');
  } finally { database.close(); }
});

test('admin can edit, grant permission, and delete after unlinking library images', async () => {
  const { database, users, call, env } = await fixture();
  try {
    const edit = new FormData();
    edit.append('Name', 'Open Revised');
    edit.append('Category', 'Panels');
    edit.append('thumbnail', new File(['THUMB'], 'thumb.png', { type: 'image/png' }));
    assert.equal((await call('/api/designs/1', users.admin, { method: 'PUT', body: edit })).status, 200);
    const updated = await (await call('/api/designs/1', users.admin)).json();
    assert.equal(updated.Name, 'Open Revised');
    assert.equal(updated.Category, 'Panels');
    assert.match(updated.ThumbnailPath, /^r2:\/\/design-thumbnails\//);

    const permissions = await call('/api/designs/1/permissions', users.admin, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userIds: [3] })
    });
    assert.equal(permissions.status, 200);
    const laser = await (await call('/api/designs', users.laser)).json();
    assert.deepEqual(laser.map(row => row.Design_ID), [2, 1]);

    database.run('INSERT INTO Agent_Images (Category, Original_Name, Stored_Name, File_Path, Design_ID) VALUES (?, ?, ?, ?, 1)', ['عام', 'image.png', 'image.png', 'r2://image']);
    assert.equal((await call('/api/designs/1', users.admin, { method: 'DELETE' })).status, 409);
    database.run('UPDATE Agent_Images SET Design_ID=NULL WHERE Design_ID=1');
    assert.equal((await call('/api/designs/1', users.admin, { method: 'DELETE' })).status, 200);
    assert.equal(await env.FILES.head('designs/open.dxf'), null);
  } finally { database.close(); }
});
