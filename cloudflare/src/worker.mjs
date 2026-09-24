import bcrypt from 'bcryptjs';
import ejs from 'ejs';
import loginTemplate from '../../views/login.ejs';
import dashboardTemplate from '../../views/dashboard.ejs';
import adminTemplate from '../../views/admin.ejs';
import designerTemplate from '../../views/designer.ejs';
import laserTemplate from '../../views/laser.ejs';
import routerTemplate from '../../views/router.ejs';
import agentTemplate from '../../views/agent.ejs';
import clientsTemplate from '../../views/clients.ejs';
import inventoryTemplate from '../../views/inventory.ejs';
import designsTemplate from '../../views/designs.ejs';
import agentsTemplate from '../../views/agents.ejs';
import expensesTemplate from '../../views/expenses.ejs';
import invoicesTemplate from '../../views/invoices.ejs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const html = (value, status = 200, headers = {}) => new Response(value, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const templates = { '/login': loginTemplate, '/': dashboardTemplate, '/admin': adminTemplate, '/designer': designerTemplate, '/laser': laserTemplate, '/router': routerTemplate, '/agent': agentTemplate, '/clients': clientsTemplate, '/inventory': inventoryTemplate, '/designs': designsTemplate, '/agents': agentsTemplate, '/expenses': expensesTemplate, '/invoices': invoicesTemplate };

function cookies(request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map(v => v.trim().split('=').map(decodeURIComponent)).filter(v => v[0]));
}
function b64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64(value) { return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)), c => c.charCodeAt(0)); }
async function mac(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))));
}
async function makeToken(user, secret) {
  const head = b64(enc.encode('{"alg":"HS256","typ":"JWT"}'));
  const body = b64(enc.encode(JSON.stringify({ sub: user.User_ID, exp: Math.floor(Date.now() / 1000) + 86400 })));
  return `${head}.${body}.${await mac(`${head}.${body}`, secret)}`;
}
async function userFor(request, env) {
  const token = cookies(request).workshop_session || request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !env.SESSION_SECRET) return null;
  const [head, body, signature] = token.split('.');
  if (!head || !body || !signature || signature !== await mac(`${head}.${body}`, env.SESSION_SECRET)) return null;
  try {
    const data = JSON.parse(dec.decode(unb64(body)));
    if (!data.sub || data.exp < Date.now() / 1000) return null;
    return await env.DB.prepare('SELECT User_ID, Name, Role, Username, Permissions FROM Users WHERE User_ID=?').bind(data.sub).first();
  } catch { return null; }
}
function permitted(user, permission) {
  if (!user) return false;
  if (user.Role === 'Admin') return true;
  if (user.Role === 'Custom') { try { return Boolean(JSON.parse(user.Permissions || '{}')[permission]); } catch { return false; } }
  return ({ Designer: ['orders', 'clients', 'inventory', 'invoices'], Laser_Op: ['orders'], Router_Op: ['orders'], Agent: ['orders', 'clients'] }[user.Role] || []).includes(permission);
}
function orderScope(user) {
  if (user.Role === 'Admin' || permitted(user, 'admin')) return { sql: '1=1', values: [] };
  if (user.Role === 'Designer') return { sql: 'o.Designer_ID=?', values: [user.User_ID] };
  if (user.Role === 'Laser_Op') return { sql: "o.Machine_Type='Laser' AND o.Approval_Status!='pending'", values: [] };
  if (user.Role === 'Router_Op') return { sql: "o.Machine_Type='Router' AND o.Approval_Status!='pending'", values: [] };
  if (user.Role === 'Agent') return { sql: 'o.Created_By=?', values: [user.User_ID] };
  return { sql: '1=0', values: [] };
}
async function auth(request, env, permission) {
  const user = await userFor(request, env);
  if (!user) return { response: json({ error: 'غير مصرح', login: true }, 401) };
  if (permission && !permitted(user, permission)) return { response: json({ error: 'لا تملك الصلاحية' }, 403) };
  return { user };
}
async function accessibleOrder(env, user, id) {
  const scope = orderScope(user);
  return env.DB.prepare(`SELECT o.* FROM Orders o WHERE o.Task_ID=? AND ${scope.sql}`).bind(id, ...scope.values).first();
}
function cleanName(name) { return String(name || 'file').replace(/[^\w.()-]/g, '_').slice(0, 160) || 'file'; }

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { headers: { allow: 'GET, POST, PUT, DELETE, OPTIONS' } });
    if (path === '/api/health') return json({ ok: (await env.DB.prepare('SELECT 1 AS ok').first())?.ok === 1, runtime: 'cloudflare-workers', database: 'd1', storage: 'r2' });

    if (path === '/logout') return new Response(null, { status: 302, headers: { location: '/login', 'set-cookie': 'workshop_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
    if (path === '/login' && request.method === 'POST') {
      const form = await request.formData();
      const found = await env.DB.prepare('SELECT * FROM Users WHERE Username=?').bind(String(form.get('username') || '')).first();
      if (!found || !await bcrypt.compare(String(form.get('password') || ''), found.Password)) return html(ejs.render(loginTemplate, { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }), 401);
      const token = await makeToken(found, env.SESSION_SECRET);
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': `workshop_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400` } });
    }
    if (request.method === 'GET' && templates[path]) {
      const user = await userFor(request, env);
      if (path === '/login') return user ? Response.redirect(new URL('/', request.url), 302) : html(ejs.render(loginTemplate, { error: null }));
      if (!user) return Response.redirect(new URL('/login', request.url), 302);
      if (path === '/' && user.Role === 'Designer') return Response.redirect(new URL('/designer', request.url), 302);
      if (path === '/' && user.Role === 'Laser_Op') return Response.redirect(new URL('/laser', request.url), 302);
      if (path === '/' && user.Role === 'Router_Op') return Response.redirect(new URL('/router', request.url), 302);
      if (path === '/' && user.Role === 'Agent') return Response.redirect(new URL('/agent', request.url), 302);
      return html(ejs.render(templates[path], { user: { id: user.User_ID, name: user.Name, role: user.Role, username: user.Username, permissions: JSON.parse(user.Permissions || '{}') }, assetVersion: 'cloudflare' }));
    }

    if (path === '/api/auth/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const found = await env.DB.prepare('SELECT * FROM Users WHERE Username=?').bind(String(body.username || '')).first();
      if (!found || !body.password || !await bcrypt.compare(String(body.password), found.Password)) return json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }, 401);
      const token = await makeToken(found, env.SESSION_SECRET);
      return json({ user: { id: found.User_ID, name: found.Name, role: found.Role } }, 200, { 'set-cookie': `workshop_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400` });
    }
    if (path === '/api/auth/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': 'workshop_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
    if (path === '/api/auth/me') { const a = await auth(request, env); return a.response || json({ user: a.user }); }

    if (path === '/api/clients') {
      const a = await auth(request, env, 'clients'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const term = `%${url.searchParams.get('search') || ''}%`, agent = a.user.Role === 'Agent';
        const query = `SELECT * FROM Clients WHERE (Full_Name LIKE ? OR Phone_Number LIKE ?) ${agent ? 'AND Created_By=?' : ''} ORDER BY Created_At DESC LIMIT 100`;
        return json({ clients: (await env.DB.prepare(query).bind(term, term, ...(agent ? [a.user.User_ID] : [])).all()).results });
      }
      if (request.method === 'POST') {
        const b = await request.json(); if (!String(b.Full_Name || '').trim()) return json({ error: 'اسم العميل مطلوب' }, 400);
        const result = await env.DB.prepare('INSERT INTO Clients (Full_Name, Phone_Number, Notes, Created_By, Agent_ID) VALUES (?, ?, ?, ?, ?)').bind(b.Full_Name.trim(), b.Phone_Number || '', b.Notes || '', a.user.User_ID, a.user.Role === 'Agent' ? a.user.User_ID : null).run();
        return json({ client: await env.DB.prepare('SELECT * FROM Clients WHERE Client_ID=?').bind(result.meta.last_row_id).first() }, 201);
      }
    }
    if (path === '/api/inventory' && request.method === 'GET') { const a = await auth(request, env, 'inventory'); return a.response || json({ inventory: (await env.DB.prepare('SELECT * FROM Inventory ORDER BY Material_Name, Thickness').all()).results }); }

    if (path === '/api/orders') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const s = orderScope(a.user); const query = `SELECT o.*, c.Full_Name Client_Name, u.Name Designer_Name FROM Orders o LEFT JOIN Clients c ON c.Client_ID=o.Client_ID LEFT JOIN Users u ON u.User_ID=o.Designer_ID WHERE ${s.sql} ORDER BY o.Created_At DESC LIMIT 100`;
        return json({ orders: (await env.DB.prepare(query).bind(...s.values).all()).results });
      }
      if (request.method === 'POST') {
        const b = await request.json(); if (!b.Client_ID || !['Laser', 'Router'].includes(b.Machine_Type)) return json({ error: 'بيانات الطلب غير مكتملة' }, 400);
        const pending = a.user.Role === 'Agent', result = await env.DB.prepare("INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Material_ID, Material_Qty, Quantity_Unit, Price, Notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(b.Client_ID, b.Designer_ID || null, a.user.User_ID, b.Machine_Type, pending ? 'بانتظار الموافقة' : 'قيد التصميم', pending ? 'pending' : 'approved', b.Material_ID || null, Number(b.Material_Qty || 0), b.Quantity_Unit === 'قطعة' ? 'قطعة' : 'لوح', Number(b.Price || 0), b.Notes || '').run();
        return json({ order: await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(result.meta.last_row_id).first() }, 201);
      }
    }

    const status = path.match(/^\/api\/orders\/(\d+)\/status$/);
    if (status && request.method === 'PUT') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response; const order = await accessibleOrder(env, a.user, Number(status[1])); if (!order) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      const next = (await request.json()).Status, valid = ['قيد التصميم', 'جاهز للقص', 'قيد التنفيذ', 'تم الانتهاء من القص', 'تم التغليف', 'تم التسليم']; if (!valid.includes(next)) return json({ error: 'حالة غير صالحة' }, 400);
      await env.DB.prepare('UPDATE Orders SET Status=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?').bind(next, order.Task_ID).run(); return json({ order: await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(order.Task_ID).first() });
    }

    const fileRoute = path.match(/^\/api\/files\/(upload|list|download)\/(\d+)$/);
    if (fileRoute) {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response; const action = fileRoute[1], taskId = Number(fileRoute[2]), order = await accessibleOrder(env, a.user, taskId); if (!order) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      if (action === 'list' && request.method === 'GET') return json({ files: (await env.DB.prepare('SELECT * FROM Order_Files WHERE Task_ID=? ORDER BY File_Type, Is_Current DESC, Created_At DESC').bind(taskId).all()).results });
      if (action === 'upload' && request.method === 'POST') {
        const form = await request.formData(), files = form.getAll('files').filter(x => x instanceof File); if (!files.length) return json({ error: 'لم يتم اختيار ملفات' }, 400);
        const saved = [];
        for (const file of files.slice(0, 20)) {
          const key = `orders/task-${taskId}/${crypto.randomUUID()}-${cleanName(file.name)}`; await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
          await env.DB.prepare("UPDATE Order_Files SET Is_Current=0 WHERE Task_ID=? AND File_Type='design'").bind(taskId).run();
          const inserted = await env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, 'design', 1, ?)").bind(taskId, file.name, key.split('/').at(-1), `r2://${key}`, file.size, a.user.User_ID).run(); saved.push({ File_ID: inserted.meta.last_row_id, Original_Name: file.name, File_Path: `r2://${key}` });
        }
        await env.DB.prepare("UPDATE Orders SET File_Path=?, File_Name=?, Status='جاهز للقص', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?").bind(saved.at(-1).File_Path, saved.at(-1).Original_Name, taskId).run(); return json({ files: saved }, 201);
      }
      if (action === 'download' && request.method === 'GET') {
        const file = await env.DB.prepare("SELECT * FROM Order_Files WHERE Task_ID=? AND COALESCE(Is_Current,1)=1 ORDER BY Created_At DESC LIMIT 1").bind(taskId).first(); if (!file?.File_Path?.startsWith('r2://')) return json({ error: 'لا يوجد ملف مخزن في R2 لهذا الطلب' }, 404);
        const object = await env.FILES.get(file.File_Path.slice(5)); if (!object) return json({ error: 'الملف غير موجود' }, 404);
        return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename="${cleanName(file.Original_Name)}"` } });
      }
    }
    const asset = await env.ASSETS.fetch(request);
    return asset.status === 404 ? json({ error: 'المسار غير موجود' }, 404) : asset;
  }
};
