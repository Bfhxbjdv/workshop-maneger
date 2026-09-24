import bcrypt from 'bcryptjs';
import adminTemplate from '../../views/admin.ejs';

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
    if (path === '/api/inventory') {
      const a = await auth(request, env, 'inventory'); if (a.response) return a.response;
      if (request.method === 'GET') return json({ inventory: (await env.DB.prepare('SELECT * FROM Inventory ORDER BY Material_Name, Thickness').all()).results });
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
