import bcrypt from 'bcryptjs';
import adminTemplate from '../../views/admin.ejs';
import agentTemplate from '../../views/agent.ejs';
import designerTemplate from '../../views/designer.ejs';
import laserTemplate from '../../views/laser.ejs';
import routerTemplate from '../../views/router.ejs';

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const html = (value, status = 200, headers = {}) => new Response(value, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const pagePaths = new Set(['/login', '/', '/admin', '/designer', '/laser', '/router', '/agent', '/clients', '/inventory', '/designs', '/agents', '/expenses', '/invoices']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function loginPage(error = '') {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ورشة كازانجي</title><style>body{margin:0;font-family:system-ui;background:#101827;color:#e5e7eb;display:grid;min-height:100vh;place-items:center}.card{width:min(390px,90vw);background:#1f2937;border:1px solid #374151;border-radius:16px;padding:28px}h1{margin-top:0}label{display:block;margin:14px 0 6px}input,button{box-sizing:border-box;width:100%;padding:12px;border-radius:8px;border:1px solid #4b5563;font:inherit}input{background:#111827;color:#fff}button{margin-top:20px;background:#f59e0b;color:#111827;font-weight:700;border:0}.error{background:#7f1d1d;padding:10px;border-radius:8px}</style></head><body><main class="card"><h1>ورشة كازانجي</h1><p>تسجيل الدخول إلى نظام إدارة الورشة</p>${error ? `<p class="error">${esc(error)}</p>` : ''}<form method="post" action="/login"><label>اسم المستخدم</label><input name="username" required autocomplete="username"><label>كلمة المرور</label><input type="password" name="password" required autocomplete="current-password"><button type="submit">دخول</button></form></main></body></html>`;
}
function legacyAdminPage(user) {
  // The old admin screen is intentionally kept as the source of truth for the
  // interface.  It only has one server-side value, so it can be safely filled
  // without bringing the Node/EJS runtime into a Worker.
  return adminTemplate.replace(/<%=\s*user\.name\s*%>/g, esc(user.name));
}
function legacyRolePage(template, user) {
  // Legacy role pages use only a name, a cache-busting asset version, and a
  // few optional navigation tags.  Workers do not need a Node template engine
  // for these safe substitutions.
  return template
    .replace(/<%=\s*user\.name\s*%>/g, esc(user.name))
    .replace(/<%=\s*assetVersion\s*%>/g, 'cloudflare')
    .replace(/<%\s*if\s*\([\s\S]*?\)\s*\{\s*%>|<%\s*}\s*%>/g, '');
}
function appPage(user) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ورشة كازانجي</title><style>
  *{box-sizing:border-box}body{margin:0;font-family:system-ui;background:#f4f6f8;color:#172033}header{background:#152238;color:#fff;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px}.brand{font-weight:800;font-size:20px}.muted{color:#64748b}main{max-width:1280px;margin:auto;padding:24px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;box-shadow:0 1px 2px #0f172a0d}h1,h2{margin:0 0 14px}h2{font-size:18px}label{font-weight:650;display:block;margin:10px 0 5px}input,select,textarea,button{width:100%;font:inherit;padding:10px;border-radius:8px;border:1px solid #cbd5e1;background:#fff}textarea{min-height:74px;resize:vertical}button{cursor:pointer;background:#0f766e;color:#fff;border:0;font-weight:700;margin-top:12px}button.secondary{background:#e2e8f0;color:#172033}button.warn{background:#b45309}.notice{display:none;margin:0 0 16px;padding:12px;border-radius:9px}.notice.ok{display:block;background:#dcfce7;color:#166534}.notice.error{display:block;background:#fee2e2;color:#991b1b}.table-wrap{overflow:auto}.table{width:100%;border-collapse:collapse;min-width:740px}.table th,.table td{padding:10px;text-align:right;border-bottom:1px solid #e2e8f0;vertical-align:top}.badge{display:inline-block;padding:4px 8px;border-radius:999px;background:#e0f2fe;color:#075985;font-size:12px}.small{font-size:13px}.inline{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.inline select,.inline input,.inline button{width:auto;margin:0}.file{max-width:220px}@media(max-width:650px){header{padding:14px;align-items:flex-start;flex-direction:column}main{padding:14px}}
  </style></head><body><header><div><div class="brand">ورشة كازانجي</div><div class="small">مرحبًا ${esc(user.name)} · ${esc(user.role)}</div></div><a href="/logout" style="color:#fff">تسجيل الخروج</a></header><main>
  <div id="notice" class="notice"></div>
  <section class="grid">
    <article class="card"><h2>إضافة عميل</h2><form id="clientForm"><label>الاسم</label><input name="Full_Name" required><label>الهاتف</label><input name="Phone_Number"><label>ملاحظات</label><textarea name="Notes"></textarea><button>حفظ العميل</button></form></article>
    <article class="card"><h2>إضافة خامة للمخزون</h2><form id="inventoryForm"><label>اسم الخامة</label><input name="Material_Name" required><label>السماكة</label><input name="Thickness" placeholder="مثال: 3 مم"><label>الكمية</label><input name="Quantity" type="number" min="0" step="0.01" required><label>تكلفة الوحدة (USD)</label><input name="Cost_Per_Unit" type="number" min="0" step="0.01"><button>حفظ الخامة</button></form></article>
    <article class="card"><h2>طلب جديد</h2><form id="orderForm"><label>العميل</label><select name="Client_ID" id="orderClient" required></select><label>نوع التشغيل</label><select name="Machine_Type"><option value="Laser">ليزر</option><option value="Router">راوتر</option></select><label>الخامة</label><select name="Material_ID" id="orderMaterial"><option value="">بدون خامة</option></select><div class="grid" style="grid-template-columns:1fr 1fr"><div><label>الكمية</label><input name="Material_Qty" type="number" min="0" step="0.01" value="1"></div><div><label>الوحدة</label><select name="Quantity_Unit"><option value="لوح">لوح</option><option value="قطعة">قطعة</option></select></div></div><label>السعر (USD)</label><input name="Price" type="number" min="0" step="0.01"><label>ملاحظات</label><textarea name="Notes"></textarea><button>إنشاء الطلب</button></form></article>
  </section>
  <section class="card" style="margin-top:16px"><div class="inline" style="justify-content:space-between"><h2>الطلبات</h2><button class="secondary" style="width:auto;margin:0" onclick="loadAll()">تحديث</button></div><div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>العميل</th><th>التشغيل</th><th>الكمية</th><th>الحالة</th><th>ملف التصميم</th><th>إجراء</th></tr></thead><tbody id="orders"></tbody></table></div></section>
  <section class="card" style="margin-top:16px"><h2>المخزون</h2><div class="table-wrap"><table class="table"><thead><tr><th>الخامة</th><th>السماكة</th><th>الكمية المتاحة</th><th>تكلفة الوحدة</th></tr></thead><tbody id="inventory"></tbody></table></div></section>
  </main><script>
  const notice=document.getElementById('notice'); const statuses=['قيد التصميم','جاهز للقص','قيد التنفيذ','تم الانتهاء من القص','تم التغليف','تم التسليم'];
  const say=(msg,type='ok')=>{notice.textContent=msg;notice.className='notice '+type;window.scrollTo({top:0,behavior:'smooth'});setTimeout(()=>notice.className='notice',4500)};
  async function api(path,options={}){const res=await fetch(path,{headers:{'content-type':'application/json',...(options.headers||{})},...options});const text=await res.text();let data;try{data=JSON.parse(text)}catch{throw new Error('تعذر قراءة استجابة الخادم')};if(!res.ok)throw new Error(data.error||'تعذر تنفيذ العملية');return data}
  const value=(form,name)=>form.elements[name].value;
  function escapeHtml(x){return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function fillSelect(id,items,label,key){const select=document.getElementById(id);const first=id==='orderMaterial'?'<option value="">بدون خامة</option>':'';select.innerHTML=first+items.map(x=>'<option value="'+x[key]+'">'+escapeHtml(label(x))+'</option>').join('')}
  async function loadAll(){try{const [clients,inventory,orders]=await Promise.all([api('/api/clients'),api('/api/inventory'),api('/api/orders')]);fillSelect('orderClient',clients.clients,x=>x.Full_Name+' '+(x.Phone_Number||''),'Client_ID');fillSelect('orderMaterial',inventory.inventory,x=>x.Material_Name+' — '+(x.Thickness||'')+' ('+x.Quantity+')','Material_ID');document.getElementById('inventory').innerHTML=inventory.inventory.map(x=>'<tr><td>'+escapeHtml(x.Material_Name)+'</td><td>'+escapeHtml(x.Thickness||'—')+'</td><td>'+x.Quantity+'</td><td>$'+x.Cost_Per_Unit+'</td></tr>').join('')||'<tr><td colspan="4" class="muted">لا توجد خامات بعد</td></tr>';document.getElementById('orders').innerHTML=orders.orders.map(orderRow).join('')||'<tr><td colspan="7" class="muted">لا توجد طلبات بعد</td></tr>'}catch(e){say(e.message,'error')}}
  function orderRow(o){const options=statuses.map(s=>'<option '+(o.Status===s?'selected':'')+'>'+s+'</option>').join('');return '<tr><td>#'+o.Task_ID+'</td><td>'+escapeHtml(o.Client_Name||'—')+'</td><td><span class="badge">'+escapeHtml(o.Machine_Type)+'</span></td><td>'+o.Material_Qty+' '+escapeHtml(o.Quantity_Unit||'لوح')+'</td><td><select id="status-'+o.Task_ID+'">'+options+'</select></td><td><input class="file" id="file-'+o.Task_ID+'" type="file" multiple><a class="small" href="/api/files/download/'+o.Task_ID+'"> تحميل</a></td><td><div class="inline"><button onclick="changeStatus('+o.Task_ID+')" style="margin:0">حفظ</button><button class="warn" onclick="uploadFiles('+o.Task_ID+')" style="margin:0">رفع</button></div></td></tr>'}
  async function changeStatus(id){try{const Status=document.getElementById('status-'+id).value;await api('/api/orders/'+id+'/status',{method:'PUT',body:JSON.stringify({Status})});say('تم تحديث حالة الطلب');loadAll()}catch(e){say(e.message,'error')}}
  async function uploadFiles(id){try{const files=document.getElementById('file-'+id).files;if(!files.length)throw new Error('اختر ملفًا واحدًا على الأقل');const form=new FormData();for(const f of files)form.append('files',f);const res=await fetch('/api/files/upload/'+id,{method:'POST',body:form});const d=await res.json();if(!res.ok)throw new Error(d.error||'تعذر رفع الملفات');say('تم رفع ملفات التصميم وتحديث الطلب');loadAll()}catch(e){say(e.message,'error')}}
  document.getElementById('clientForm').onsubmit=async e=>{e.preventDefault();try{const f=e.currentTarget;await api('/api/clients',{method:'POST',body:JSON.stringify({Full_Name:value(f,'Full_Name'),Phone_Number:value(f,'Phone_Number'),Notes:value(f,'Notes')})});f.reset();say('تم حفظ العميل');loadAll()}catch(err){say(err.message,'error')}};
  document.getElementById('inventoryForm').onsubmit=async e=>{e.preventDefault();try{const f=e.currentTarget;await api('/api/inventory',{method:'POST',body:JSON.stringify({Material_Name:value(f,'Material_Name'),Thickness:value(f,'Thickness'),Quantity:Number(value(f,'Quantity')),Cost_Per_Unit:Number(value(f,'Cost_Per_Unit')||0)})});f.reset();say('تم حفظ الخامة');loadAll()}catch(err){say(err.message,'error')}};
  document.getElementById('orderForm').onsubmit=async e=>{e.preventDefault();try{const f=e.currentTarget;await api('/api/orders',{method:'POST',body:JSON.stringify({Client_ID:Number(value(f,'Client_ID')),Machine_Type:value(f,'Machine_Type'),Material_ID:value(f,'Material_ID')?Number(value(f,'Material_ID')):null,Material_Qty:Number(value(f,'Material_Qty')),Quantity_Unit:value(f,'Quantity_Unit'),Price:Number(value(f,'Price')||0),Notes:value(f,'Notes')})});f.reset();say('تم إنشاء الطلب');loadAll()}catch(err){say(err.message,'error')}};
  loadAll();
  </script></body></html>`;
}

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
      if (!found || !await bcrypt.compare(String(form.get('password') || ''), found.Password)) return html(loginPage('اسم المستخدم أو كلمة المرور غير صحيحة'), 401);
      const token = await makeToken(found, env.SESSION_SECRET);
      return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': `workshop_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400` } });
    }
    if (request.method === 'GET' && pagePaths.has(path)) {
      const user = await userFor(request, env);
      if (path === '/login') return user ? Response.redirect(new URL('/', request.url), 302) : html(loginPage());
      if (!user) return Response.redirect(new URL('/login', request.url), 302);
      if (path === '/' && user.Role === 'Designer') return Response.redirect(new URL('/designer', request.url), 302);
      if (path === '/' && user.Role === 'Laser_Op') return Response.redirect(new URL('/laser', request.url), 302);
      if (path === '/' && user.Role === 'Router_Op') return Response.redirect(new URL('/router', request.url), 302);
      if (path === '/' && user.Role === 'Agent') return Response.redirect(new URL('/agent', request.url), 302);
      if (path === '/' && user.Role === 'Admin') return Response.redirect(new URL('/admin', request.url), 302);
      if (path === '/admin' && user.Role === 'Admin') return html(legacyAdminPage({ name: user.Name }));
      if (path === '/agent' && user.Role === 'Agent') return html(legacyRolePage(agentTemplate, { name: user.Name }));
      if (path === '/designer' && user.Role === 'Designer') return html(legacyRolePage(designerTemplate, { name: user.Name }));
      if (path === '/laser' && user.Role === 'Laser_Op') return html(legacyRolePage(laserTemplate, { name: user.Name }));
      if (path === '/router' && user.Role === 'Router_Op') return html(legacyRolePage(routerTemplate, { name: user.Name }));
      return html(appPage({ id: user.User_ID, name: user.Name, role: user.Role, username: user.Username }));
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

    if (path === '/admin/api/admin-stats' && request.method === 'GET') {
      const a = await auth(request, env); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'هذه الصفحة للمدير فقط' }, 403);
      const one = async sql => Number((await env.DB.prepare(sql).first())?.count || 0);
      const [totalUsers, totalClients, totalOrders, totalInvoices, totalExpenses, totalRevenue, pendingUploads, recentLogs] = await Promise.all([
        one('SELECT COUNT(*) AS count FROM Users'), one('SELECT COUNT(*) AS count FROM Clients'),
        one('SELECT COUNT(*) AS count FROM Orders'), one('SELECT COUNT(*) AS count FROM Invoices'),
        env.DB.prepare('SELECT COALESCE(SUM(Amount),0) AS total FROM Expenses').first(),
        env.DB.prepare("SELECT COALESCE(SUM(CASE WHEN Final_Price > 0 THEN Final_Price ELSE Price END),0) AS total FROM Orders WHERE Approval_Status!='rejected'").first(),
        one("SELECT COUNT(*) AS count FROM Order_Files WHERE File_Path LIKE 'pending:%'"),
        env.DB.prepare('SELECT l.*, u.Name AS User_Name FROM System_Logs l LEFT JOIN Users u ON u.User_ID=l.User_ID ORDER BY l.Created_At DESC LIMIT 10').all()
      ]);
      return json({ totalUsers, totalClients, totalOrders, totalInvoices, totalExpenses: Number(totalExpenses?.total || 0), totalRevenue: Number(totalRevenue?.total || 0), pendingUploads, recentLogs: recentLogs.results });
    }

    if (path === '/api/users' && request.method === 'GET') {
      const a = await auth(request, env); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'هذه البيانات للمدير فقط' }, 403);
      return json((await env.DB.prepare('SELECT User_ID, Name, Role, Username, Created_At FROM Users ORDER BY Name').all()).results);
    }

    if (path === '/api/clients/all' && request.method === 'GET') {
      const a = await auth(request, env, 'clients'); if (a.response) return a.response;
      const term = `%${url.searchParams.get('search') || ''}%`;
      return json((await env.DB.prepare('SELECT * FROM Clients WHERE Full_Name LIKE ? OR Phone_Number LIKE ? ORDER BY Full_Name LIMIT 100').bind(term, term).all()).results);
    }

    if (path === '/api/clients') {
      const a = await auth(request, env, 'clients'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const term = `%${url.searchParams.get('search') || ''}%`, agent = a.user.Role === 'Agent';
        const query = `SELECT * FROM Clients WHERE (Full_Name LIKE ? OR Phone_Number LIKE ?) ${agent ? 'AND Created_By=?' : ''} ORDER BY Created_At DESC LIMIT 100`;
        return json({ clients: (await env.DB.prepare(query).bind(term, term, ...(agent ? [a.user.User_ID] : [])).all()).results, page: 1, pages: 1 });
      }
      if (request.method === 'POST') {
        const b = await request.json(); if (!String(b.Full_Name || '').trim()) return json({ error: 'اسم العميل مطلوب' }, 400);
        const result = await env.DB.prepare('INSERT INTO Clients (Full_Name, Phone_Number, Notes, Created_By, Agent_ID) VALUES (?, ?, ?, ?, ?)').bind(b.Full_Name.trim(), b.Phone_Number || '', b.Notes || '', a.user.User_ID, a.user.Role === 'Agent' ? a.user.User_ID : null).run();
        return json({ client: await env.DB.prepare('SELECT * FROM Clients WHERE Client_ID=?').bind(result.meta.last_row_id).first() }, 201);
      }
    }
    const clientRoute = path.match(/^\/api\/clients\/(\d+)(\/orders)?$/);
    if (clientRoute) {
      const a = await auth(request, env, 'clients'); if (a.response) return a.response;
      const clientId = Number(clientRoute[1]);
      const client = await env.DB.prepare('SELECT * FROM Clients WHERE Client_ID=?').bind(clientId).first();
      if (!client) return json({ error: 'العميل غير موجود' }, 404);
      if (a.user.Role === 'Agent' && client.Created_By !== a.user.User_ID) return json({ error: 'لا تملك صلاحية هذا العميل' }, 403);
      if (clientRoute[2] && request.method === 'GET') return json((await env.DB.prepare('SELECT o.*, GROUP_CONCAT(i.Material_Name || \' \' || COALESCE(i.Thickness, \'\')) AS Materials_List FROM Orders o LEFT JOIN Inventory i ON i.Material_ID=o.Material_ID WHERE o.Client_ID=? GROUP BY o.Task_ID ORDER BY o.Created_At DESC').bind(clientId).all()).results);
      if (request.method === 'GET') return json(client);
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => ({})); const name = String(body.Full_Name || '').trim();
        if (!name) return json({ error: 'اسم العميل مطلوب' }, 400);
        await env.DB.prepare('UPDATE Clients SET Full_Name=?, Phone_Number=?, Rating=?, Notes=? WHERE Client_ID=?').bind(name, String(body.Phone_Number || ''), Math.max(1, Math.min(5, Number(body.Rating || 3))), String(body.Notes || ''), clientId).run();
        return json({ success: true, client: await env.DB.prepare('SELECT * FROM Clients WHERE Client_ID=?').bind(clientId).first() });
      }
      if (request.method === 'DELETE') {
        if (a.user.Role !== 'Admin') return json({ error: 'حذف العميل للمدير فقط' }, 403);
        const orders = (await env.DB.prepare('SELECT Task_ID FROM Orders WHERE Client_ID=?').bind(clientId).all()).results;
        for (const order of orders) {
          const files = (await env.DB.prepare('SELECT File_Path FROM Order_Files WHERE Task_ID=?').bind(order.Task_ID).all()).results;
          for (const file of files) if (file.File_Path?.startsWith('r2://')) await env.FILES.delete(file.File_Path.slice(5));
          await env.DB.prepare('DELETE FROM Order_Files WHERE Task_ID=?').bind(order.Task_ID).run();
          await env.DB.prepare('DELETE FROM Orders WHERE Task_ID=?').bind(order.Task_ID).run();
        }
        await env.DB.prepare('DELETE FROM Clients WHERE Client_ID=?').bind(clientId).run();
        return json({ success: true });
      }
    }
    if (path === '/api/inventory') {
      const a = await auth(request, env, 'inventory'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const inventory = (await env.DB.prepare('SELECT * FROM Inventory ORDER BY Material_Name, Thickness').all()).results;
        const legacyPage = /\/(admin|designer|laser|router|agent)(?:\?|$)/.test(request.headers.get('referer') || '');
        return request.headers.get('X-Requested-With') || legacyPage ? json(inventory) : json({ inventory });
      }
      if (request.method === 'POST') {
        if (a.user.Role !== 'Admin') return json({ error: 'إضافة خامات المخزون متاحة للمدير فقط' }, 403);
        const body = await request.json();
        const name = String(body.Material_Name || '').trim(), quantity = Number(body.Quantity);
        if (!name || !Number.isFinite(quantity) || quantity < 0) return json({ error: 'اسم الخامة والكمية الصحيحة مطلوبان' }, 400);
        const result = await env.DB.prepare('INSERT INTO Inventory (Material_Name, Thickness, Quantity, Cost_Per_Unit) VALUES (?, ?, ?, ?)')
          .bind(name, String(body.Thickness || '').trim(), quantity, Math.max(0, Number(body.Cost_Per_Unit || 0))).run();
        return json({ material: await env.DB.prepare('SELECT * FROM Inventory WHERE Material_ID=?').bind(result.meta.last_row_id).first() }, 201);
      }
    }
    const inventoryRoute = path.match(/^\/api\/inventory\/(\d+)$/);
    if (inventoryRoute && request.method === 'PUT') {
      const a = await auth(request, env, 'inventory'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'تعديل المخزون للمدير فقط' }, 403);
      const body = await request.json().catch(() => ({})), name = String(body.Material_Name || '').trim(), quantity = Number(body.Quantity);
      if (!name || !Number.isFinite(quantity) || quantity < 0) return json({ error: 'اسم الخامة والكمية الصحيحة مطلوبان' }, 400);
      await env.DB.prepare('UPDATE Inventory SET Material_Name=?, Thickness=?, Quantity=?, Cost_Per_Unit=? WHERE Material_ID=?').bind(name, String(body.Thickness || ''), quantity, Math.max(0, Number(body.Cost_Per_Unit || 0)), Number(inventoryRoute[1])).run();
      return json({ success: true });
    }

    if (path === '/api/orders') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const s = orderScope(a.user), where = [s.sql], values = [...s.values];
        const statusFilter = url.searchParams.get('status'), machineFilter = url.searchParams.get('machine'), clientFilter = Number(url.searchParams.get('clientId'));
        if (statusFilter) { where.push('o.Status=?'); values.push(statusFilter); }
        if (machineFilter && ['Laser', 'Router'].includes(machineFilter)) { where.push('o.Machine_Type=?'); values.push(machineFilter); }
        if (Number.isInteger(clientFilter) && clientFilter > 0) { where.push('o.Client_ID=?'); values.push(clientFilter); }
        const query = `SELECT o.*, c.Full_Name Client_Name, u.Name Designer_Name, i.Material_Name, i.Thickness FROM Orders o LEFT JOIN Clients c ON c.Client_ID=o.Client_ID LEFT JOIN Users u ON u.User_ID=o.Designer_ID LEFT JOIN Inventory i ON i.Material_ID=o.Material_ID WHERE ${where.join(' AND ')} ORDER BY o.Created_At DESC LIMIT 200`;
        return json({ orders: (await env.DB.prepare(query).bind(...values).all()).results });
      }
      if (request.method === 'POST') {
        const b = await request.json(); if (!b.Client_ID || !['Laser', 'Router'].includes(b.Machine_Type)) return json({ error: 'بيانات الطلب غير مكتملة' }, 400);
        const pending = a.user.Role === 'Agent';
        const finalPrice = Number(b.Final_Price ?? b.Price ?? 0), agentPrice = Number(b.Agent_Price ?? 0), commission = Number(b.Agent_Commission ?? 0);
        const result = await env.DB.prepare("INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Material_ID, Material_Qty, Quantity_Unit, Price, Agent_Price, Agent_Commission, Final_Price, Notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(b.Client_ID, b.Designer_ID || null, a.user.User_ID, b.Machine_Type, pending ? 'بانتظار الموافقة' : 'قيد التصميم', pending ? 'pending' : 'approved', b.Material_ID || null, Number(b.Material_Qty || 0), b.Quantity_Unit === 'قطعة' ? 'قطعة' : 'لوح', finalPrice, agentPrice, commission, finalPrice, b.Notes || '').run();
        const taskId = result.meta.last_row_id;
        const imageIds = Array.isArray(b.Image_IDs) ? b.Image_IDs.map(Number).filter(Number.isInteger).slice(0, 30) : [];
        for (const imageId of imageIds) {
          const image = await env.DB.prepare('SELECT * FROM Agent_Images WHERE Image_ID=?').bind(imageId).first();
          if (image) {
            await env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, 'image', 1, ?)")
              .bind(taskId, image.Original_Name, image.Stored_Name, image.File_Path, image.File_Size, a.user.User_ID).run();
            if (image.Design_ID) {
              const design = await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(image.Design_ID).first();
              if (design?.FilePath) await env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, 0, ?, 'design', 1, ?)")
                .bind(taskId, design.Original_Name, cleanName(design.Original_Name), design.FilePath, `التصميم المرتبط: ${design.Name}`, a.user.User_ID).run();
            }
          }
        }
        const order = await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(taskId).first();
        return json({ Task_ID: taskId, order }, 201);
      }
    }

    if (path === '/api/orders/agent/images' && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const category = String(url.searchParams.get('category') || '').trim();
      const images = (await env.DB.prepare(`SELECT ai.*, d.Name AS Design_Name FROM Agent_Images ai LEFT JOIN Designs d ON d.Design_ID=ai.Design_ID ${category ? 'WHERE ai.Category=?' : ''} ORDER BY ai.Created_At DESC LIMIT 200`).bind(...(category ? [category] : [])).all()).results;
      for (const image of images) image.Materials = (await env.DB.prepare('SELECT i.* FROM Inventory i JOIN Agent_Image_Materials m ON m.Material_ID=i.Material_ID WHERE m.Image_ID=?').bind(image.Image_ID).all()).results;
      return json({ images });
    }
    if (path === '/api/orders/agent/images' && request.method === 'POST') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'رفع صور المكتبة للمدير فقط' }, 403);
      const form = await request.formData(), images = form.getAll('images').filter(file => file instanceof File);
      if (!images.length) return json({ error: 'لم يتم اختيار أي صورة' }, 400);
      if (images.length > 50 || images.some(file => file.size > 10 * 1024 * 1024)) return json({ error: 'الحد الأقصى 50 صورة و10 ميغابايت للصورة' }, 400);
      const category = String(form.get('category') || 'عام').slice(0, 100), saved = [];
      for (const file of images) {
        if (!file.type.startsWith('image/')) return json({ error: 'يُسمح برفع الصور فقط في المكتبة' }, 400);
        const key = `library-images/${crypto.randomUUID()}-${cleanName(file.name)}`;
        await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
        const created = await env.DB.prepare('INSERT INTO Agent_Images (Category, Original_Name, Stored_Name, File_Path, File_Size, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(category, file.name, key.split('/').at(-1), `r2://${key}`, file.size, a.user.User_ID).run();
        saved.push({ Image_ID: created.meta.last_row_id, Original_Name: file.name });
      }
      return json({ success: true, images: saved }, 201);
    }
    if (path === '/api/orders/agent/pricing' && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const pricing = (await env.DB.prepare('SELECT * FROM Product_Pricing WHERE Is_Active=1 ORDER BY Product_Name').all()).results;
      for (const product of pricing) product.Materials = (await env.DB.prepare('SELECT i.*, p.Price FROM Product_Material_Pricing p JOIN Inventory i ON i.Material_ID=p.Material_ID WHERE p.Pricing_ID=? AND p.Is_Active=1').bind(product.Pricing_ID).all()).results;
      return json({ pricing });
    }

    if (path === '/api/orders/pricing') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const pricing = (await env.DB.prepare('SELECT * FROM Product_Pricing WHERE Is_Active=1 ORDER BY Product_Name').all()).results;
        for (const product of pricing) product.Materials = (await env.DB.prepare('SELECT i.*, p.Price FROM Product_Material_Pricing p JOIN Inventory i ON i.Material_ID=p.Material_ID WHERE p.Pricing_ID=? AND p.Is_Active=1').bind(product.Pricing_ID).all()).results;
        return json({ pricing });
      }
      if (request.method === 'POST') {
        if (a.user.Role !== 'Admin') return json({ error: 'إدارة الأسعار للمدير فقط' }, 403);
        const b = await request.json().catch(() => ({})), name = String(b.Product_Name || '').trim();
        const rows = Array.isArray(b.Material_Prices) ? b.Material_Prices.filter(row => Number.isInteger(Number(row.Material_ID)) && Number.isFinite(Number(row.Price)) && Number(row.Price) >= 0) : [];
        if (!name || !rows.length) return json({ error: 'اسم المنتج وخامة واحدة بسعر صحيح مطلوبان' }, 400);
        const created = await env.DB.prepare('INSERT INTO Product_Pricing (Product_Name, Category, Base_Price, Unit, Description) VALUES (?, ?, ?, ?, ?)')
          .bind(name, String(b.Category || '').trim(), Math.max(0, Number(b.Base_Price || 0)), b.Unit === 'قطعة' ? 'قطعة' : 'لوح', String(b.Description || '').trim()).run();
        for (const row of rows) await env.DB.prepare('INSERT INTO Product_Material_Pricing (Pricing_ID, Material_ID, Price) VALUES (?, ?, ?)').bind(created.meta.last_row_id, Number(row.Material_ID), Number(row.Price)).run();
        return json({ success: true, Pricing_ID: created.meta.last_row_id }, 201);
      }
    }
    const pricingDelete = path.match(/^\/api\/orders\/pricing\/(\d+)$/);
    if (pricingDelete && request.method === 'DELETE') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'إدارة الأسعار للمدير فقط' }, 403);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM Product_Material_Pricing WHERE Pricing_ID=?').bind(Number(pricingDelete[1])),
        env.DB.prepare('DELETE FROM Product_Pricing WHERE Pricing_ID=?').bind(Number(pricingDelete[1]))
      ]);
      return json({ success: true });
    }

    const imageMaterials = path.match(/^\/api\/orders\/agent\/images\/(\d+)\/materials$/);
    if (imageMaterials) {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const imageId = Number(imageMaterials[1]);
      if (request.method === 'GET') return json({ materials: (await env.DB.prepare('SELECT i.* FROM Inventory i JOIN Agent_Image_Materials m ON m.Material_ID=i.Material_ID WHERE m.Image_ID=?').bind(imageId).all()).results });
      if (request.method === 'PUT') {
        if (a.user.Role !== 'Admin') return json({ error: 'ربط الخامات للمدير فقط' }, 403);
        const ids = [...new Set((await request.json().catch(() => ({}))).Material_IDs || [])].map(Number).filter(Number.isInteger);
        await env.DB.prepare('DELETE FROM Agent_Image_Materials WHERE Image_ID=?').bind(imageId).run();
        for (const materialId of ids) await env.DB.prepare('INSERT OR IGNORE INTO Agent_Image_Materials (Image_ID, Material_ID) VALUES (?, ?)').bind(imageId, materialId).run();
        return json({ success: true });
      }
    }

    const agentImageFile = path.match(/^\/api\/orders\/agent\/images\/(\d+)\/file$/);
    if (agentImageFile && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const image = await env.DB.prepare('SELECT * FROM Agent_Images WHERE Image_ID=?').bind(Number(agentImageFile[1])).first();
      if (!image?.File_Path?.startsWith('r2://')) return json({ error: 'الصورة غير متاحة' }, 404);
      const object = await env.FILES.get(image.File_Path.slice(5)); if (!object) return json({ error: 'الصورة غير موجودة في التخزين' }, 404);
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `inline; filename="${cleanName(image.Original_Name)}"` } });
    }
    const agentImageDelete = path.match(/^\/api\/orders\/agent\/images\/(\d+)$/);
    if (agentImageDelete && request.method === 'DELETE') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'حذف صور المكتبة للمدير فقط' }, 403);
      const image = await env.DB.prepare('SELECT * FROM Agent_Images WHERE Image_ID=?').bind(Number(agentImageDelete[1])).first();
      if (!image) return json({ error: 'الصورة غير موجودة' }, 404);
      if (image.File_Path?.startsWith('r2://')) await env.FILES.delete(image.File_Path.slice(5));
      await env.DB.prepare('DELETE FROM Agent_Images WHERE Image_ID=?').bind(image.Image_ID).run();
      return json({ success: true });
    }

    if (path === '/api/designs' && request.method === 'POST') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (!['Admin', 'Designer'].includes(a.user.Role)) return json({ error: 'رفع التصاميم للمدير أو المصمم فقط' }, 403);
      const form = await request.formData(), file = form.get('file'), thumbnail = form.get('thumbnail');
      const name = String(form.get('Name') || '').trim();
      if (!name || !(file instanceof File)) return json({ error: 'اسم التصميم وملفه مطلوبان' }, 400);
      if (file.size > 25 * 1024 * 1024) return json({ error: 'حجم ملف التصميم يتجاوز 25 ميغابايت' }, 400);
      const fileKey = `designs/${crypto.randomUUID()}-${cleanName(file.name)}`;
      await env.FILES.put(fileKey, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
      let thumbnailPath = null;
      if (thumbnail instanceof File && thumbnail.size) {
        if (!thumbnail.type.startsWith('image/') || thumbnail.size > 10 * 1024 * 1024) return json({ error: 'الصورة المصغرة يجب أن تكون صورة أصغر من 10 ميغابايت' }, 400);
        const thumbKey = `design-thumbnails/${crypto.randomUUID()}-${cleanName(thumbnail.name)}`;
        await env.FILES.put(thumbKey, thumbnail.stream(), { httpMetadata: { contentType: thumbnail.type } });
        thumbnailPath = `r2://${thumbKey}`;
      }
      const rawPassword = String(form.get('Password') || '');
      const result = await env.DB.prepare('INSERT INTO Designs (Name, Category, Material, Thickness, Width, Height, Unit, Notes, FilePath, Original_Name, ThumbnailPath, Password, CreatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(name, String(form.get('Category') || ''), String(form.get('Material') || ''), String(form.get('Thickness') || ''), Number(form.get('Width') || 0), Number(form.get('Height') || 0), String(form.get('Unit') || 'مم'), String(form.get('Notes') || ''), `r2://${fileKey}`, file.name, thumbnailPath, rawPassword ? await bcrypt.hash(rawPassword, 12) : null, a.user.User_ID).run();
      return json({ success: true, Design_ID: result.meta.last_row_id }, 201);
    }

    if (path === '/api/agents/admin/designs' && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'هذه القائمة للمدير فقط' }, 403);
      const search = `%${String(url.searchParams.get('search') || '').trim()}%`;
      const designs = (await env.DB.prepare(`SELECT d.*, COUNT(ai.Image_ID) AS Image_Count, 1 AS Is_Active FROM Designs d LEFT JOIN Agent_Images ai ON ai.Design_ID=d.Design_ID WHERE d.Name LIKE ? OR d.Category LIKE ? GROUP BY d.Design_ID ORDER BY d.CreatedAt DESC LIMIT 100`).bind(search, search).all()).results;
      return json({ designs, page: 1, pages: 1 });
    }
    const designDelete = path.match(/^\/api\/agents\/admin\/designs\/(\d+)$/);
    if (designDelete && request.method === 'DELETE') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'حذف التصاميم للمدير فقط' }, 403);
      const design = await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(Number(designDelete[1])).first();
      if (!design) return json({ error: 'التصميم غير موجود' }, 404);
      for (const pathValue of [design.FilePath, design.ThumbnailPath]) if (pathValue?.startsWith('r2://')) await env.FILES.delete(pathValue.slice(5));
      await env.DB.prepare('DELETE FROM Designs WHERE Design_ID=?').bind(design.Design_ID).run();
      return json({ success: true });
    }
    const imageDesignLink = path.match(/^\/api\/agents\/admin\/images\/(\d+)\/link-design$/);
    if (imageDesignLink && request.method === 'PUT') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'ربط الصور بالتصاميم للمدير فقط' }, 403);
      const body = await request.json().catch(() => ({})), designId = body.design_id === null ? null : Number(body.design_id);
      if (designId !== null && !Number.isInteger(designId)) return json({ error: 'التصميم المختار غير صالح' }, 400);
      if (designId && !(await env.DB.prepare('SELECT Design_ID FROM Designs WHERE Design_ID=?').bind(designId).first())) return json({ error: 'التصميم غير موجود' }, 404);
      await env.DB.prepare('UPDATE Agent_Images SET Design_ID=? WHERE Image_ID=?').bind(designId, Number(imageDesignLink[1])).run();
      return json({ success: true });
    }
    const designDownload = path.match(/^\/api\/designs\/(\d+)\/download$/);
    if (designDownload && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const design = await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(Number(designDownload[1])).first();
      if (!design?.FilePath?.startsWith('r2://')) return json({ error: 'ملف التصميم غير موجود' }, 404);
      const object = await env.FILES.get(design.FilePath.slice(5)); if (!object) return json({ error: 'الملف غير موجود في التخزين' }, 404);
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename="${cleanName(design.Original_Name)}"` } });
    }

    if (path === '/api/orders/pending' && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'هذه القائمة للمدير فقط' }, 403);
      const query = `SELECT o.*, c.Full_Name AS Client_Name, u.Name AS Agent_Name
        FROM Orders o LEFT JOIN Clients c ON c.Client_ID=o.Client_ID
        LEFT JOIN Users u ON u.User_ID=o.Created_By
        WHERE o.Approval_Status='pending' ORDER BY o.Created_At DESC`;
      return json({ orders: (await env.DB.prepare(query).all()).results });
    }

    const approval = path.match(/^\/api\/orders\/(\d+)\/approve$/);
    if (approval && request.method === 'PUT') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'الموافقة على الطلبات للمدير فقط' }, 403);
      const order = await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(Number(approval[1])).first();
      if (!order || order.Approval_Status !== 'pending') return json({ error: 'الطلب غير موجود أو تمت معالجته' }, 404);
      const body = await request.json().catch(() => ({}));
      if (body.action === 'reject') {
        await env.DB.prepare("UPDATE Orders SET Approval_Status='rejected', Status='مرفوض', Notes=COALESCE(Notes,'') || ?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?")
          .bind(body.reason ? `\nسبب الرفض: ${String(body.reason).slice(0, 500)}` : '', order.Task_ID).run();
        return json({ success: true });
      }
      if (body.action !== 'approve' || !Number.isInteger(Number(body.designer_id))) return json({ error: 'اختر مصممًا صالحًا قبل الموافقة' }, 400);
      const designer = await env.DB.prepare("SELECT User_ID FROM Users WHERE User_ID=? AND Role='Designer'").bind(Number(body.designer_id)).first();
      if (!designer) return json({ error: 'المصمم المختار غير موجود' }, 400);
      await env.DB.prepare("UPDATE Orders SET Approval_Status='approved', Status='قيد التصميم', Designer_ID=?, Agent_Approved_At=CURRENT_TIMESTAMP, Agent_Approved_By=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?")
        .bind(designer.User_ID, a.user.User_ID, order.Task_ID).run();
      return json({ success: true, order: await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(order.Task_ID).first() });
    }

    const status = path.match(/^\/api\/orders\/(\d+)\/status$/);
    if (status && request.method === 'PUT') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response; const order = await accessibleOrder(env, a.user, Number(status[1])); if (!order) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      const next = (await request.json()).Status, valid = ['قيد التصميم', 'جاهز للقص', 'قيد التنفيذ', 'تم الانتهاء من القص', 'تم التغليف', 'تم التسليم']; if (!valid.includes(next)) return json({ error: 'حالة غير صالحة' }, 400);
      if (next === 'تم الانتهاء من القص' && !order.Inventory_Deducted_At && order.Material_ID && Number(order.Material_Qty) > 0) {
        if (!['Admin', 'Laser_Op', 'Router_Op'].includes(a.user.Role)) return json({ error: 'لا تملك صلاحية إتمام القص' }, 403);
        const deduction = await env.DB.prepare('UPDATE Inventory SET Quantity=Quantity-? WHERE Material_ID=? AND Quantity>=?')
          .bind(Number(order.Material_Qty), order.Material_ID, Number(order.Material_Qty)).run();
        if (!deduction.meta.changes) return json({ error: 'كمية المخزون غير كافية لإتمام الطلب' }, 409);
        await env.DB.prepare('UPDATE Orders SET Status=?, Inventory_Deducted_At=CURRENT_TIMESTAMP, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?').bind(next, order.Task_ID).run();
      } else {
        await env.DB.prepare('UPDATE Orders SET Status=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?').bind(next, order.Task_ID).run();
      }
      return json({ order: await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(order.Task_ID).first() });
    }

    const fileRoute = path.match(/^\/api\/files\/(upload|list|download)\/(\d+)$/);
    if (fileRoute) {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response; const action = fileRoute[1], taskId = Number(fileRoute[2]), order = await accessibleOrder(env, a.user, taskId); if (!order) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      if (action === 'list' && request.method === 'GET') {
        const files = (await env.DB.prepare('SELECT * FROM Order_Files WHERE Task_ID=? ORDER BY File_Type, Is_Current DESC, Created_At DESC').bind(taskId).all()).results;
        const legacyPage = /\/(admin|designer|laser|router|agent)(?:\?|$)/.test(request.headers.get('referer') || '');
        return request.headers.get('X-Requested-With') || legacyPage ? json(files) : json({ files });
      }
      if (action === 'upload' && request.method === 'POST') {
        const form = await request.formData(), files = form.getAll('files').filter(x => x instanceof File); if (!files.length) return json({ error: 'لم يتم اختيار ملفات' }, 400);
        let labels = []; try { labels = JSON.parse(String(form.get('labels') || '[]')); } catch { labels = []; }
        let materials = []; try { materials = JSON.parse(String(form.get('materials') || '[]')); } catch { materials = []; }
        const saved = [];
        await env.DB.prepare("UPDATE Order_Files SET Is_Current=0 WHERE Task_ID=? AND File_Type='design'").bind(taskId).run();
        for (const [index, file] of files.slice(0, 20).entries()) {
          const key = `orders/task-${taskId}/${crypto.randomUUID()}-${cleanName(file.name)}`; await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
          const label = String(labels[index] || '').slice(0, 200);
          const inserted = await env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, 'design', 1, ?)").bind(taskId, file.name, key.split('/').at(-1), `r2://${key}`, file.size, label, a.user.User_ID).run(); saved.push({ File_ID: inserted.meta.last_row_id, Original_Name: file.name, File_Path: `r2://${key}` });
        }
        for (const material of Array.isArray(materials) ? materials.slice(0, 20) : []) if (Number.isInteger(Number(material.Material_ID)) && Number(material.Quantity) > 0) await env.DB.prepare('INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)').bind(taskId, Number(material.Material_ID), Number(material.Quantity)).run();
        await env.DB.prepare("UPDATE Orders SET File_Path=?, File_Name=?, Status='جاهز للقص', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?").bind(saved.at(-1).File_Path, saved.at(-1).Original_Name, taskId).run(); return json({ files: saved, count: saved.length });
      }
      if (action === 'download' && request.method === 'GET') {
        const file = await env.DB.prepare("SELECT * FROM Order_Files WHERE Task_ID=? AND File_Type!='image' AND COALESCE(Is_Current,1)=1 ORDER BY Created_At DESC LIMIT 1").bind(taskId).first(); if (!file?.File_Path?.startsWith('r2://')) return json({ error: 'لا يوجد ملف تصميم مخزن في R2 لهذا الطلب' }, 404);
        const object = await env.FILES.get(file.File_Path.slice(5)); if (!object) return json({ error: 'الملف غير موجود' }, 404);
        return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename="${cleanName(file.Original_Name)}"` } });
      }
    }
    const fileById = path.match(/^\/api\/files\/(download-file|image)\/(\d+)$/);
    if (fileById && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const file = await env.DB.prepare('SELECT f.* FROM Order_Files f JOIN Orders o ON o.Task_ID=f.Task_ID WHERE f.File_ID=?').bind(Number(fileById[2])).first();
      if (!file || !await accessibleOrder(env, a.user, file.Task_ID)) return json({ error: 'الملف غير موجود أو غير مصرح' }, 404);
      if (!file.File_Path?.startsWith('r2://')) return json({ error: 'الملف غير متاح' }, 404);
      const object = await env.FILES.get(file.File_Path.slice(5)); if (!object) return json({ error: 'الملف غير موجود في التخزين' }, 404);
      const inline = fileById[1] === 'image';
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${cleanName(file.Original_Name)}"` } });
    }
    const uploadImage = path.match(/^\/api\/files\/upload-image\/(\d+)$/);
    if (uploadImage && request.method === 'POST') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const taskId = Number(uploadImage[1]), order = await accessibleOrder(env, a.user, taskId); if (!order) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      const images = (await request.formData()).getAll('image').filter(file => file instanceof File);
      if (!images.length || images.some(file => !file.type.startsWith('image/') || file.size > 10 * 1024 * 1024)) return json({ error: 'اختر صورًا صالحة بحد أقصى 10 ميغابايت للصورة' }, 400);
      for (const image of images.slice(0, 20)) {
        const key = `orders/task-${taskId}/images/${crypto.randomUUID()}-${cleanName(image.name)}`;
        await env.FILES.put(key, image.stream(), { httpMetadata: { contentType: image.type } });
        await env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, 'image', 1, ?)").bind(taskId, image.name, key.split('/').at(-1), `r2://${key}`, image.size, a.user.User_ID).run();
      }
      return json({ success: true });
    }
    const asset = await env.ASSETS.fetch(request);
    return asset.status === 404 ? json({ error: 'المسار غير موجود' }, 404) : asset;
  }
};
