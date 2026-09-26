import bcrypt from 'bcryptjs';
import adminTemplate from '../../views/admin.ejs';
import agentTemplate from '../../views/agent.ejs';
import designerTemplate from '../../views/designer.ejs';
import laserTemplate from '../../views/laser.ejs';
import routerTemplate from '../../views/router.ejs';
import clientsTemplate from '../../views/clients.ejs';
import inventoryTemplate from '../../views/inventory.ejs';
import invoicesTemplate from '../../views/invoices.ejs';
import usersTemplate from '../../views/users.ejs';
import expensesTemplate from '../../views/expenses.ejs';
import designsTemplate from '../../views/designs.ejs';
import clientTemplate from '../../views/client.ejs';
import accountTemplate from '../../views/account.ejs';
import agentsTemplate from '../../views/agents.ejs';
import agentDetailTemplate from '../../views/agent-detail.ejs';
import { handleCustomOrders } from './custom-orders.mjs';
import { handleDesignsApi } from './designs-api.mjs';
import { handleAgentsApi } from './agents-api.mjs';
import { landingHtml } from './landing.mjs';

function publicLandingPage() {
  const page = landingHtml
    .replace('مجموعة قزنجي · حلب', 'مجموعة قزنجي')
    .replace('KAZANJI GROUP · ALEPPO', 'KAZANJI GROUP')
    .replace('src="/images/kazanji-bedroom.png"', 'src="/images/kazanji-kitchen.png"')
    .replace('src="/images/kazanji-cnc.png"', 'src="/images/kazanji-panels.png"')
    .replace(/<article class="step"><span class="step-no">(\d+) · <span class="ar">([^<]+)<\/span><span class="en">([^<]+)<\/span><\/span>([\s\S]*?)<\/article>/g,
      (_, number, arabic, english, content) => `<article class="step"><span class="step-no"><b class="step-index">${number}</b><span class="step-label ar">${arabic}</span><span class="step-label en">${english}</span></span><div class="step-copy">${content}</div></article>`);
  return page.replace('</head>', '<link rel="stylesheet" href="/css/landing-layout.css"></head>');
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const json = (value, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', ...headers } });
const html = (value, status = 200, headers = {}) => new Response(value, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', ...headers } });
const privateRedirect = (location, request) => new Response(null, { status: 302, headers: { location: new URL(location, request.url).href, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' } });
const pagePaths = new Set(['/login', '/', '/admin', '/designer', '/laser', '/router', '/agent', '/clients', '/inventory', '/designs', '/agents', '/expenses', '/invoices', '/users', '/account']);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const withImageCompression = page => page.replace('</head>', '<script src="/js/image-compression.js?v=2"></script></head>');
async function concurrently(items, limit, work) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; await work(items[index], index); }
  }));
}
function loginPage(error = '') {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>تسجيل الدخول - مجموعة قزنجي</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"><link rel="stylesheet" href="/css/style.css"></head><body class="login-page"><div class="container"><div class="row justify-content-center align-items-center min-vh-100 py-4"><div class="col-12 col-sm-9 col-md-6 col-lg-5"><main class="card border-0"><div class="card-body p-4 p-md-5"><div class="text-center mb-4"><img class="login-logo" src="/images/kazanji-group-logo.svg" alt="شعار مجموعة قزنجي"><p class="login-brand-name">مجموعة قزنجي</p><h1 class="h4 mt-3">إدارة الورشة</h1><p class="text-muted mb-0">أهلاً بعودتك — سجّل دخولك لمتابعة سير العمل</p></div>${error ? `<div class="alert alert-danger" role="alert">${esc(error)}</div>` : ''}<form method="post" action="/login"><div class="mb-3"><label class="form-label" for="username">اسم المستخدم</label><input class="form-control form-control-lg" id="username" name="username" required autocomplete="username" autofocus></div><div class="mb-3"><label class="form-label" for="password">كلمة المرور</label><input class="form-control form-control-lg" id="password" type="password" name="password" required autocomplete="current-password"></div><button class="btn btn-primary btn-lg w-100" type="submit">دخول إلى النظام</button></form><a href="/" class="d-block text-center mt-4 text-decoration-none" style="color:#826d53">العودة إلى الموقع</a></div></main></div></div></div></body></html>`;
}
function publicLoginPage(error = '') {
  return loginPage(error)
    .replace('<h1 class="h4 mt-3">إدارة الورشة</h1>', '<h1 class="h4 mt-3">تسجيل الدخول</h1>')
    .replace('</head>', '<meta name="robots" content="noindex,nofollow"><link rel="icon" type="image/png" href="/favicon.png"></head>');
}
function legacyLandingPage() {
  return `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>مجموعة قزنجي | حلول الصناعات الخشبية</title><meta name="description" content="مجموعة قزنجي للتصنيع الخشبي، قص الليزر، حفر CNC، تلبيس PVC وإكسسوارات الصناعات الخشبية في حلب.">
<style>
:root{--gold:#A58D6E;--ink:#20201e;--paper:#fbfaf8;--line:#e9e4de}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Tahoma,Arial,sans-serif;overflow-x:hidden}a{text-decoration:none;color:inherit}.wrap{width:min(1120px,calc(100% - 40px));margin:auto}.top{height:88px;display:flex;align-items:center;justify-content:space-between;gap:20px}.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:16px}.brand img{width:37px;height:54px;object-fit:contain}.top-actions{display:flex;align-items:center;gap:10px}.lang{border:0;background:transparent;color:#6a655f;font:inherit;cursor:pointer;padding:10px}.login{border:1px solid var(--gold);border-radius:100px;padding:10px 18px;color:var(--gold);font-weight:700;transition:.2s}.login:hover{background:var(--gold);color:white}.hero{min-height:calc(100vh - 88px);display:grid;place-items:center;position:relative;isolation:isolate}.hero-inner{text-align:center;max-width:780px;padding:48px 0 100px}.eyebrow{color:var(--gold);font-size:13px;letter-spacing:.07em;font-weight:700;margin:0 0 18px}.hero h1{font-size:clamp(38px,7vw,76px);letter-spacing:-.045em;line-height:1.08;margin:0}.hero p{font-size:clamp(17px,2vw,21px);line-height:1.9;color:#66615b;max-width:630px;margin:24px auto 31px}.buttons{display:flex;justify-content:center;gap:12px;flex-wrap:wrap}.cta{padding:14px 24px;border-radius:100px;background:var(--gold);color:#fff;font-weight:800;box-shadow:0 11px 25px #a58d6e33;transition:transform .2s,box-shadow .2s}.cta:hover{transform:translateY(-3px);box-shadow:0 15px 30px #a58d6e55}.more{padding:13px 24px;border:1px solid var(--line);border-radius:100px;font-weight:700;color:#5c5650}.quiet-line{position:absolute;z-index:-1;border:1px solid #a58d6e2b;border-radius:999px;pointer-events:none}.line-a{width:430px;height:430px;right:-225px;top:4%;animation:float 9s ease-in-out infinite}.line-b{width:260px;height:260px;left:-130px;bottom:9%;animation:float 12s ease-in-out -4s infinite}.cursor-glow{position:fixed;z-index:-2;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,#a58d6e18,transparent 68%);left:var(--mx,50%);top:var(--my,40%);transform:translate(-50%,-50%);pointer-events:none;transition:left .22s ease-out,top .22s ease-out}.details{border-top:1px solid var(--line);padding:80px 0 92px}.details-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:72px;align-items:start}.details h2{font-size:clamp(27px,4vw,44px);line-height:1.25;margin:0 0 18px}.details p{color:#6c665f;line-height:1.95;font-size:17px;margin:0}.services{display:grid;gap:0;border-top:1px solid var(--line)}.service{display:flex;justify-content:space-between;gap:20px;padding:17px 0;border-bottom:1px solid var(--line);font-weight:700}.service span{color:var(--gold);font-size:20px}.contact{background:#252522;color:#fff;padding:55px 0}.contact-inner{display:flex;justify-content:space-between;gap:30px;align-items:center}.contact h2{margin:0 0 9px;font-size:30px}.contact p{margin:0;color:#cfcac4;line-height:1.7}.contact-links{display:flex;gap:12px;flex-wrap:wrap}.contact-link{border:1px solid #ffffff33;border-radius:100px;padding:12px 17px;direction:ltr}.footer{background:#252522;color:#aba59d;font-size:13px;padding:0 0 25px}.footer-in{padding-top:22px;border-top:1px solid #ffffff1c;display:flex;justify-content:space-between;gap:16px}.en{display:none;font-family:Arial,sans-serif;direction:ltr}.is-en .ar{display:none}.is-en .en{display:block}.is-en{direction:ltr}.is-en .brand,.is-en .top-actions,.is-en .buttons,.is-en .contact-inner,.is-en .footer-in{direction:ltr}@keyframes float{50%{transform:translateY(18px) translateX(-9px)}}@media(max-width:700px){.wrap{width:min(100% - 28px,1120px)}.top{height:76px}.brand img{width:30px;height:45px}.hero{min-height:calc(100vh - 76px)}.hero-inner{padding:30px 0 60px}.details{padding:60px 0}.details-grid{grid-template-columns:1fr;gap:34px}.contact-inner,.footer-in{align-items:flex-start;flex-direction:column}.contact{padding:42px 0}.line-a{width:290px;height:290px;right:-155px}.line-b{width:210px;height:210px;left:-135px}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.quiet-line{animation:none}.cursor-glow{display:none}.cta{transition:none}}
</style></head><body><div class="cursor-glow" aria-hidden="true"></div><header class="wrap top"><a class="brand" href="/" aria-label="مجموعة قزنجي"><img src="/images/kazanji-group-logo.svg" alt="شعار مجموعة قزنجي"><span class="ar">مجموعة قزنجي</span><span class="en">Kazanji Group</span></a><div class="top-actions"><button class="lang" type="button" onclick="toggleLanguage()"><span class="ar">EN</span><span class="en">العربية</span></button><a class="login" href="/login"><span class="ar">Login</span><span class="en">Login</span></a></div></header>
<main><section class="hero wrap"><i class="quiet-line line-a"></i><i class="quiet-line line-b"></i><div class="hero-inner"><p class="eyebrow ar">مجموعة قزنجي · حلب</p><p class="eyebrow en">KAZANJI GROUP · ALEPPO</p><h1 class="ar">نصنع المساحة<br>التي تتخيلها.</h1><h1 class="en">We shape the spaces<br>you imagine.</h1><p class="ar">نحوّل الخشب والفكرة إلى غرف نوم ومطابخ ومكاتب وحلول دقيقة للنجارين والصناعات الخشبية.</p><p class="en">We turn wood and ideas into bedrooms, kitchens, offices, and precise solutions for carpenters and the wood industry.</p><div class="buttons"><a class="cta" href="https://wa.me/963981163985" target="_blank" rel="noopener"><span class="ar">تواصل معنا عبر واتساب</span><span class="en">Chat with us on WhatsApp</span></a><a class="more" href="#about"><span class="ar">اكتشف خدماتنا</span><span class="en">Explore our services</span></a></div></div></section>
<section id="about" class="details"><div class="wrap details-grid"><div><h2 class="ar">من التصنيع إلى أدقّ تفاصيل الورشة.</h2><h2 class="en">From manufacturing to every detail of the workshop.</h2><p class="ar">نخدم الأفراد والنجارين عبر تصنيع الأثاث الخشبي وحلول الإنتاج المتكاملة، من حلب إلى مشاريعكم الخاصة.</p><p class="en">We serve individuals and carpenters with made-to-order wooden furniture and integrated production solutions from Aleppo to your projects.</p></div><div class="services"><div class="service"><b class="ar">غرف نوم، مطابخ ومكاتب</b><b class="en">Bedrooms, kitchens & offices</b><span>01</span></div><div class="service"><b class="ar">قص ليزر وحفر CNC</b><b class="en">Laser cutting & CNC engraving</b><span>02</span></div><div class="service"><b class="ar">تلبيس PVC</b><b class="en">PVC edge banding</b><span>03</span></div><div class="service"><b class="ar">إكسسوارات بلاستيكية للصناعات الخشبية</b><b class="en">Plastic accessories for wood industries</b><span>04</span></div></div></div></section></main>
<section class="contact" id="contact"><div class="wrap contact-inner"><div><h2 class="ar">لنبدأ مشروعك القادم.</h2><h2 class="en">Let’s start your next project.</h2><p class="ar">حلب — المدينة الصناعية الشيخ نجار · بوابة القصب</p><p class="en">Aleppo — Sheikh Najjar Industrial City · Al-Qasab Gate</p></div><div class="contact-links"><a class="contact-link" href="https://wa.me/963981163985" target="_blank" rel="noopener">WhatsApp</a><a class="contact-link" href="tel:+963981163985">0981163985</a><a class="contact-link" href="mailto:info@kazanjigroup.com">info@kazanjigroup.com</a></div></div></section>
<footer class="footer"><div class="wrap footer-in"><span class="ar">© مجموعة قزنجي</span><span class="en">© Kazanji Group</span><span class="ar">حلب، سوريا</span><span class="en">Aleppo, Syria</span></div></footer>
<script>function toggleLanguage(){const root=document.documentElement;const english=root.classList.toggle('is-en');root.lang=english?'en':'ar';root.dir=english?'ltr':'rtl'}addEventListener('pointermove',e=>{if(matchMedia('(prefers-reduced-motion: reduce)').matches)return;document.body.style.setProperty('--mx',e.clientX+'px');document.body.style.setProperty('--my',e.clientY+'px')},{passive:true})</script></body></html>`;
}
function legacyAdminPage(user) {
  // The old admin screen is intentionally kept as the source of truth for the
  // interface.  It only has one server-side value, so it can be safely filled
  // without bringing the Node/EJS runtime into a Worker.
  return withImageCompression(adminTemplate.replace(/<%=\s*user\.name\s*%>/g, esc(user.name)));
}
function legacyRolePage(template, user) {
  // Legacy role pages use only a name, a cache-busting asset version, and a
  // few optional navigation tags.  Workers do not need a Node template engine
  // for these safe substitutions.
  return withImageCompression(template
    .replace(/<%\s*if\s*\(user\.role === 'Admin' \|\| \(user\.permissions && user\.permissions\.([a-z]+)\)\)\s*\{\s*%>([\s\S]*?)<%\s*}\s*%>/g,
      (_, permission, content) => user.role === 'Admin' || ({ Designer: ['clients', 'inventory', 'invoices'], Agent: ['clients', 'orders'] }[user.role] || []).includes(permission) ? content : '')
    .replace(/<%=\s*\(user\.role === 'Admin' \|\| \(user\.permissions && user\.permissions\.admin\)\) \? '1' : '0'\s*%>/g, user.role === 'Admin' ? '1' : '0')
    .replace(/<%=\s*user\.name\s*%>/g, esc(user.name))
    .replace(/<%=\s*user\.role\s*%>/g, esc(user.role || ''))
    .replace(/<%=\s*user\.username\s*%>/g, esc(user.username || ''))
    .replace(/<%=\s*assetVersion\s*%>/g, 'cloudflare')
    .replace(/<%\s*if\s*\([\s\S]*?\)\s*\{\s*%>|<%\s*}\s*%>/g, ''));
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
    return await env.DB.prepare(`SELECT u.User_ID, u.Name, u.Role, u.Username, u.Permissions
      FROM Users u LEFT JOIN Agent_Profiles ap ON ap.User_ID=u.User_ID
      WHERE u.User_ID=? AND (u.Role!='Agent' OR COALESCE(ap.Status,'active')='active')`).bind(data.sub).first();
  } catch { return null; }
}
function permitted(user, permission) {
  if (!user) return false;
  if (user.Role === 'Admin') return true;
  if (user.Role === 'Custom') { try { return Boolean(JSON.parse(user.Permissions || '{}')[permission]); } catch { return false; } }
  return ({ Designer: ['orders', 'clients', 'inventory', 'invoices'], Laser_Op: ['orders'], Router_Op: ['orders'], Agent: ['orders', 'clients'] }[user.Role] || []).includes(permission);
}
function orderScope(user) {
  if (user.Role === 'Admin' || permitted(user, 'admin') || user.Role === 'Custom' && permitted(user, 'orders')) return { sql: '1=1', values: [] };
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
async function logAction(env, action, userId, details = {}) {
  try {
    await env.DB.prepare('INSERT INTO System_Logs (Action, User_ID, Details) VALUES (?, ?, ?)')
      .bind(action, userId, JSON.stringify(details).slice(0, 2000)).run();
  } catch (error) { console.warn('Unable to record activity:', error); }
}

async function removeUnreferencedR2Files(env, paths) {
  for (const path of new Set(paths.filter(value => value?.startsWith('r2://')))) {
    const reference = await env.DB.prepare(`SELECT
      EXISTS(SELECT 1 FROM Order_Files WHERE File_Path=?) OR
      EXISTS(SELECT 1 FROM Agent_Images WHERE File_Path=?) OR
      EXISTS(SELECT 1 FROM Designs WHERE FilePath=? OR ThumbnailPath=?) OR
      EXISTS(SELECT 1 FROM Agent_Custom_Designs WHERE Thumbnail_Path=? OR INSTR(COALESCE(Image_Path,''),?)>0) AS in_use`)
      .bind(path, path, path, path, path, path).first();
    if (!reference?.in_use) await env.FILES.delete(path.slice(5));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url), path = url.pathname;
    if (request.method === 'OPTIONS') return new Response(null, { headers: { allow: 'GET, POST, PUT, DELETE, OPTIONS' } });
    if (path === '/api/health') return json({ ok: (await env.DB.prepare('SELECT 1 AS ok').first())?.ok === 1 });

    if (path === '/logout') return new Response(null, { status: 302, headers: { location: '/login', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'set-cookie': 'workshop_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' } });
    if (path === '/login' && request.method === 'POST') {
      const form = await request.formData();
      const found = await env.DB.prepare(`SELECT u.* FROM Users u LEFT JOIN Agent_Profiles ap ON ap.User_ID=u.User_ID
        WHERE u.Username=? AND (u.Role!='Agent' OR COALESCE(ap.Status,'active')='active')`).bind(String(form.get('username') || '')).first();
      if (!found || !await bcrypt.compare(String(form.get('password') || ''), found.Password)) return html(publicLoginPage('اسم المستخدم أو كلمة المرور غير صحيحة'), 401);
      const token = await makeToken(found, env.SESSION_SECRET);
      return new Response(null, { status: 302, headers: { location: '/', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'set-cookie': `workshop_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400` } });
    }
    const clientPage = path.match(/^\/client\/(\d+)$/);
    const agentDetailPage = path.match(/^\/agents\/(\d+)$/);
    if (request.method === 'GET' && (pagePaths.has(path) || clientPage || agentDetailPage)) {
      const user = await userFor(request, env);
      if (path === '/login') return user ? privateRedirect('/', request) : html(publicLoginPage());
      if (!user && path === '/') return html(publicLandingPage(), 200, { 'x-robots-tag': url.hostname === 'www.kazanjigroup.com' ? 'index, follow' : 'noindex, nofollow' });
      if (!user) return privateRedirect('/login', request);
      if (path === '/' && user.Role === 'Designer') return privateRedirect('/designer', request);
      if (path === '/' && user.Role === 'Laser_Op') return privateRedirect('/laser', request);
      if (path === '/' && user.Role === 'Router_Op') return privateRedirect('/router', request);
      if (path === '/' && user.Role === 'Agent') return privateRedirect('/agent', request);
      if (path === '/' && user.Role === 'Admin') return privateRedirect('/admin', request);
      if (path === '/admin' && user.Role === 'Admin') return html(legacyAdminPage({ name: user.Name }));
      if (path === '/agent' && user.Role === 'Agent') return html(legacyRolePage(agentTemplate, { name: user.Name, role: user.Role, username: user.Username }));
      if (path === '/designer' && user.Role === 'Designer') return html(legacyRolePage(designerTemplate, { name: user.Name, role: user.Role, username: user.Username }));
      if (path === '/laser' && user.Role === 'Laser_Op') return html(legacyRolePage(laserTemplate, { name: user.Name, role: user.Role, username: user.Username }));
      if (path === '/router' && user.Role === 'Router_Op') return html(legacyRolePage(routerTemplate, { name: user.Name, role: user.Role, username: user.Username }));
      if (path === '/clients' && permitted(user, 'clients')) return html(withImageCompression(clientsTemplate));
      if (clientPage && permitted(user, 'clients')) {
        const clientId = Number(clientPage[1]);
        const client = await env.DB.prepare('SELECT Client_ID, Created_By FROM Clients WHERE Client_ID=?').bind(clientId).first();
        if (!client || user.Role === 'Agent' && Number(client.Created_By) !== Number(user.User_ID)) return html('<h1>العميل غير موجود أو غير مصرح</h1>', 404);
        return html(withImageCompression(clientTemplate.replace(/<%=\s*clientId\s*%>/g, String(clientId))));
      }
      if (path === '/inventory' && permitted(user, 'inventory')) return html(withImageCompression(inventoryTemplate));
      if (path === '/designs' && permitted(user, 'orders')) return html(legacyRolePage(designsTemplate, { name: user.Name, role: user.Role, username: user.Username }));
      if (path === '/account') return html(legacyRolePage(accountTemplate, { name: user.Name, role: user.Role, username: user.Username }));
      if (path === '/invoices' && permitted(user, 'invoices')) return html(withImageCompression(invoicesTemplate.replaceAll('SYP', 'USD')));
      if (path === '/users' && user.Role === 'Admin') return html(withImageCompression(usersTemplate));
      if (path === '/agents' && user.Role === 'Admin') return html(legacyRolePage(agentsTemplate, { name: user.Name, role: user.Role, username: user.Username }));
      if (agentDetailPage && user.Role === 'Admin') {
        const agent = await env.DB.prepare("SELECT User_ID FROM Users WHERE User_ID=? AND Role='Agent'").bind(Number(agentDetailPage[1])).first();
        if (!agent) return html('<h1>الوكيل غير موجود</h1>', 404);
        return html(legacyRolePage(agentDetailTemplate, { name: user.Name, role: user.Role, username: user.Username }));
      }
      if (path === '/expenses' && user.Role === 'Admin') return html(legacyRolePage(expensesTemplate, { name: user.Name }));
      return html(withImageCompression(appPage({ id: user.User_ID, name: user.Name, role: user.Role, username: user.Username })));
    }

    if (path === '/api/auth/login' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const found = await env.DB.prepare(`SELECT u.* FROM Users u LEFT JOIN Agent_Profiles ap ON ap.User_ID=u.User_ID
        WHERE u.Username=? AND (u.Role!='Agent' OR COALESCE(ap.Status,'active')='active')`).bind(String(body.username || '')).first();
      if (!found || !body.password || !await bcrypt.compare(String(body.password), found.Password)) return json({ error: 'اسم المستخدم أو كلمة المرور غير صحيحة' }, 401);
      const token = await makeToken(found, env.SESSION_SECRET);
      return json({ user: { id: found.User_ID, name: found.Name, role: found.Role } }, 200, { 'set-cookie': `workshop_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=86400` });
    }
    if (path === '/api/auth/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': 'workshop_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0' });
    if (path === '/api/auth/me') { const a = await auth(request, env); return a.response || json({ user: a.user }); }
    if (path.startsWith('/api/agents/')) {
      const customResponse = await handleCustomOrders(request, env, await userFor(request, env), path, url);
      if (customResponse) return customResponse;
    }
    if (path === '/api/agents' || path.startsWith('/api/agents/')) {
      const agentResponse = await handleAgentsApi(request, env, await userFor(request, env), path, url);
      if (agentResponse) return agentResponse;
    }
    if (path.startsWith('/api/designs')) {
      const designsResponse = await handleDesignsApi(request, env, await userFor(request, env));
      if (designsResponse) return designsResponse;
    }

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

    if (path === '/admin/api/logs' && request.method === 'GET') {
      const a = await auth(request, env); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'سجل النشاطات للمدير فقط' }, 403);
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const limit = 30;
      const total = Number((await env.DB.prepare('SELECT COUNT(*) AS total FROM System_Logs').first())?.total || 0);
      const pages = Math.max(1, Math.ceil(total / limit));
      const currentPage = Math.min(page, pages);
      const logs = (await env.DB.prepare('SELECT l.*, u.Name AS User_Name FROM System_Logs l LEFT JOIN Users u ON u.User_ID=l.User_ID ORDER BY l.Created_At DESC, l.Log_ID DESC LIMIT ? OFFSET ?').bind(limit, (currentPage - 1) * limit).all()).results;
      return json({ logs, page: currentPage, pages, total });
    }

    if (path === '/admin/api/expenses') {
      const a = await auth(request, env); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'إدارة المصروفات للمدير فقط' }, 403);
      if (request.method === 'GET') {
        const term = `%${String(url.searchParams.get('search') || '').trim()}%`;
        const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
        const pageSize = 30;
        const total = Number((await env.DB.prepare('SELECT COUNT(*) AS count FROM Expenses WHERE Description LIKE ? OR Category LIKE ?').bind(term, term).first())?.count || 0);
        const pages = Math.max(1, Math.ceil(total / pageSize));
        const currentPage = Math.min(page, pages);
        const expenses = (await env.DB.prepare('SELECT * FROM Expenses WHERE Description LIKE ? OR Category LIKE ? ORDER BY Expense_Date DESC, Expense_ID DESC LIMIT ? OFFSET ?').bind(term, term, pageSize, (currentPage - 1) * pageSize).all()).results;
        return json({ expenses, page: currentPage, pages, total });
      }
      if (request.method === 'POST') {
        const body = await request.json().catch(() => ({})), description = String(body.Description || '').trim(), amount = Number(body.Amount);
        if (!description || !Number.isFinite(amount) || amount < 0) return json({ error: 'الوصف والمبلغ الصحيحان مطلوبان' }, 400);
        const created = await env.DB.prepare('INSERT INTO Expenses (Description, Category, Amount, Expense_Date, Notes) VALUES (?, ?, ?, ?, ?)').bind(description, String(body.Category || 'أخرى'), amount, String(body.Expense_Date || new Date().toISOString().slice(0, 10)), String(body.Notes || '')).run();
        return json({ success: true, Expense_ID: created.meta.last_row_id }, 201);
      }
    }
    const expenseRoute = path.match(/^\/admin\/api\/expenses\/(\d+)$/);
    if (expenseRoute && request.method === 'DELETE') {
      const a = await auth(request, env); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'إدارة المصروفات للمدير فقط' }, 403);
      await env.DB.prepare('DELETE FROM Expenses WHERE Expense_ID=?').bind(Number(expenseRoute[1])).run();
      return json({ success: true });
    }

    if (path === '/api/users' && request.method === 'GET') {
      const a = await auth(request, env); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'هذه البيانات للمدير فقط' }, 403);
      return json((await env.DB.prepare('SELECT User_ID, Name, Role, Username, Permissions, Created_At FROM Users ORDER BY Name').all()).results);
    }
    if (path === '/api/users' && request.method === 'POST') {
      const a = await auth(request, env); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'إدارة المستخدمين للمدير فقط' }, 403);
      const body = await request.json().catch(() => ({})), name = String(body.Name || '').trim(), username = String(body.Username || '').trim(), password = String(body.Password || '');
      const roles = new Set(['Admin', 'Designer', 'Laser_Op', 'Router_Op', 'Agent', 'Custom']);
      if (!name || !username || password.length < 8 || !roles.has(body.Role)) return json({ error: 'أدخل الاسم واسم المستخدم وكلمة مرور من 8 أحرف على الأقل والدور الصحيح' }, 400);
      try {
        const created = await env.DB.prepare('INSERT INTO Users (Name, Username, Password, Role, Permissions) VALUES (?, ?, ?, ?, ?)').bind(name, username, await bcrypt.hash(password, 12), body.Role, JSON.stringify(body.Role === 'Custom' && body.Permissions && typeof body.Permissions === 'object' ? body.Permissions : {})).run();
        return json({ success: true, User_ID: created.meta.last_row_id }, 201);
      } catch { return json({ error: 'اسم المستخدم مستخدم بالفعل' }, 409); }
    }
    if (path === '/api/users/me' && request.method === 'PUT') {
      const a = await auth(request, env); if (a.response) return a.response;
      const body = await request.json().catch(() => ({}));
      const current = await env.DB.prepare('SELECT Password, Username FROM Users WHERE User_ID=?').bind(a.user.User_ID).first();
      if (!current || !await bcrypt.compare(String(body.currentPassword || ''), current.Password)) return json({ error: 'كلمة المرور الحالية غير صحيحة' }, 403);
      const username = String(body.newUsername || current.Username).trim(), password = String(body.newPassword || '');
      if (!username || password && password.length < 8) return json({ error: 'اسم المستخدم مطلوب، وكلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' }, 400);
      const duplicate = await env.DB.prepare('SELECT User_ID FROM Users WHERE Username=? AND User_ID<>?').bind(username, a.user.User_ID).first();
      if (duplicate) return json({ error: 'اسم المستخدم مستخدم بالفعل' }, 409);
      await env.DB.prepare('UPDATE Users SET Username=?, Password=COALESCE(?,Password) WHERE User_ID=?').bind(username, password ? await bcrypt.hash(password, 12) : null, a.user.User_ID).run();
      return json({ success: true, username });
    }
    const userRoute = path.match(/^\/api\/users\/(\d+)$/);
    if (userRoute) {
      const a = await auth(request, env); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'إدارة المستخدمين للمدير فقط' }, 403);
      const userId = Number(userRoute[1]), target = await env.DB.prepare('SELECT User_ID, Name, Username, Role, Permissions, Created_At FROM Users WHERE User_ID=?').bind(userId).first();
      if (!target) return json({ error: 'المستخدم غير موجود' }, 404);
      if (request.method === 'GET') return json(target);
      if (request.method === 'PUT') {
        const body = await request.json().catch(() => ({})), name = String(body.Name || '').trim(), username = String(body.Username || '').trim();
        const roles = new Set(['Admin', 'Designer', 'Laser_Op', 'Router_Op', 'Agent', 'Custom']);
        if (!name || !username || !roles.has(body.Role)) return json({ error: 'بيانات المستخدم غير مكتملة' }, 400);
        if (userId === a.user.User_ID && body.Role !== 'Admin') return json({ error: 'لا يمكن إزالة صلاحية المدير من حسابك الحالي' }, 400);
        try {
          const password = String(body.Password || '');
          if (password) {
            if (password.length < 8) return json({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' }, 400);
            await env.DB.prepare('UPDATE Users SET Name=?, Username=?, Password=?, Role=?, Permissions=? WHERE User_ID=?').bind(name, username, await bcrypt.hash(password, 12), body.Role, JSON.stringify(body.Role === 'Custom' && body.Permissions && typeof body.Permissions === 'object' ? body.Permissions : {}), userId).run();
          } else await env.DB.prepare('UPDATE Users SET Name=?, Username=?, Role=?, Permissions=? WHERE User_ID=?').bind(name, username, body.Role, JSON.stringify(body.Role === 'Custom' && body.Permissions && typeof body.Permissions === 'object' ? body.Permissions : {}), userId).run();
          return json({ success: true });
        } catch { return json({ error: 'اسم المستخدم مستخدم بالفعل' }, 409); }
      }
      if (request.method === 'DELETE') {
        if (userId === a.user.User_ID) return json({ error: 'لا يمكن حذف حسابك الحالي' }, 400);
        await env.DB.prepare('DELETE FROM Users WHERE User_ID=?').bind(userId).run();
        return json({ success: true });
      }
    }

    if (path === '/api/clients/all' && request.method === 'GET') {
      const a = await auth(request, env, 'clients'); if (a.response) return a.response;
      const term = `%${url.searchParams.get('search') || ''}%`;
      const agent = a.user.Role === 'Agent';
      return json((await env.DB.prepare(`SELECT Client_ID, Full_Name, Phone_Number FROM Clients WHERE (Full_Name LIKE ? OR Phone_Number LIKE ?) ${agent ? 'AND Created_By=?' : ''} ORDER BY Full_Name LIMIT 100`).bind(term, term, ...(agent ? [a.user.User_ID] : [])).all()).results);
    }

    if (path === '/api/clients') {
      const a = await auth(request, env, 'clients'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const term = `%${url.searchParams.get('search') || ''}%`, agent = a.user.Role === 'Agent';
        const where = `(Full_Name LIKE ? OR Phone_Number LIKE ?) ${agent ? 'AND Created_By=?' : ''}`;
        const params = [term, term, ...(agent ? [a.user.User_ID] : [])];
        const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || (url.searchParams.has('page') ? '20' : '100'), 10) || 20));
        const total = Number((await env.DB.prepare(`SELECT COUNT(*) AS total FROM Clients WHERE ${where}`).bind(...params).first())?.total || 0);
        const clients = (await env.DB.prepare(`SELECT * FROM Clients WHERE ${where} ORDER BY Created_At DESC, Client_ID DESC LIMIT ? OFFSET ?`).bind(...params, limit, (page - 1) * limit).all()).results;
        return json({ clients, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
      }
      if (request.method === 'POST') {
        const b = await request.json().catch(() => ({})); if (!String(b.Full_Name || '').trim()) return json({ error: 'اسم العميل مطلوب' }, 400);
        const rating = Number(b.Rating ?? 3);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json({ error: 'تقييم العميل يجب أن يكون من 1 إلى 5' }, 400);
        const result = await env.DB.prepare('INSERT INTO Clients (Full_Name, Phone_Number, Notes, Rating, Created_By, Agent_ID) VALUES (?, ?, ?, ?, ?, ?)').bind(String(b.Full_Name).trim(), String(b.Phone_Number || ''), String(b.Notes || ''), rating, a.user.User_ID, a.user.Role === 'Agent' ? a.user.User_ID : null).run();
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
        const financial = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM Invoices WHERE Client_ID=?) + (SELECT COUNT(*) FROM Receipts WHERE Client_ID=?) AS total').bind(clientId, clientId).first();
        if (Number(financial?.total) > 0) return json({ error: 'لا يمكن حذف عميل لديه فواتير أو إيصالات محفوظة' }, 409);
        const orders = (await env.DB.prepare('SELECT Task_ID FROM Orders WHERE Client_ID=?').bind(clientId).all()).results;
        const paths = [];
        for (const order of orders) {
          const files = (await env.DB.prepare('SELECT File_Path FROM Order_Files WHERE Task_ID=?').bind(order.Task_ID).all()).results;
          paths.push(...files.map(file => file.File_Path));
          await env.DB.prepare('DELETE FROM Order_Materials WHERE Task_ID=?').bind(order.Task_ID).run();
          await env.DB.prepare('DELETE FROM Order_Files WHERE Task_ID=?').bind(order.Task_ID).run();
          await env.DB.prepare('DELETE FROM Orders WHERE Task_ID=?').bind(order.Task_ID).run();
        }
        await env.DB.prepare('DELETE FROM Clients WHERE Client_ID=?').bind(clientId).run();
        await removeUnreferencedR2Files(env, paths);
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
    if (inventoryRoute && request.method === 'DELETE') {
      const a = await auth(request, env, 'inventory'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'حذف الخامات للمدير فقط' }, 403);
      const materialId = Number(inventoryRoute[1]);
      const used = await env.DB.prepare('SELECT Task_ID FROM Orders WHERE Material_ID=? UNION SELECT Task_ID FROM Order_Materials WHERE Material_ID=? LIMIT 1').bind(materialId, materialId).first();
      if (used) return json({ error: 'لا يمكن حذف خامة مرتبطة بطلبات. عدّلها أو أرشفها أولًا.' }, 409);
      await env.DB.prepare('DELETE FROM Inventory WHERE Material_ID=?').bind(materialId).run();
      return json({ success: true });
    }

    if (path === '/api/invoices') {
      const a = await auth(request, env, 'invoices'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const search = `%${String(url.searchParams.get('search') || '').trim()}%`, status = String(url.searchParams.get('status') || '').trim();
        const where = `(c.Full_Name LIKE ? OR inv.Invoice_Number LIKE ?) ${status ? 'AND inv.Status=?' : ''}`;
        const params = [search, search, ...(status ? [status] : [])];
        const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
        const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || (url.searchParams.has('page') ? '20' : '100'), 10) || 20));
        const total = Number((await env.DB.prepare(`SELECT COUNT(*) AS total FROM Invoices inv JOIN Clients c ON c.Client_ID=inv.Client_ID WHERE ${where}`).bind(...params).first())?.total || 0);
        const invoices = (await env.DB.prepare(`SELECT inv.*, c.Full_Name AS Client_Name, o.Machine_Type FROM Invoices inv JOIN Clients c ON c.Client_ID=inv.Client_ID LEFT JOIN Orders o ON o.Task_ID=inv.Order_Task_ID WHERE ${where} ORDER BY inv.Created_At DESC, inv.Invoice_ID DESC LIMIT ? OFFSET ?`).bind(...params, limit, (page - 1) * limit).all()).results;
        return json({ invoices, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
      }
      if (request.method === 'POST') {
        if (a.user.Role !== 'Admin') return json({ error: 'إنشاء الفواتير للمدير فقط' }, 403);
        const body = await request.json().catch(() => ({})), taskId = Number(body.Order_Task_ID), amount = Number(body.Amount);
        const order = await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(taskId).first();
        if (!order || !Number.isFinite(amount) || amount < 0) return json({ error: 'الطلب والمبلغ الصحيحان مطلوبان' }, 400);
        const invoiceNumber = `INV-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${taskId}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
        const created = await env.DB.prepare('INSERT INTO Invoices (Order_Task_ID, Client_ID, Invoice_Number, Amount, Status) VALUES (?, ?, ?, ?, ?)').bind(taskId, order.Client_ID, invoiceNumber, amount, 'غير مدفوعة').run();
        return json({ Invoice_ID: created.meta.last_row_id, Invoice_Number: invoiceNumber }, 201);
      }
    }
    const invoiceView = path.match(/^\/api\/invoices\/(\d+)\/(view|pdf)$/);
    if (invoiceView && request.method === 'GET') {
      const a = await auth(request, env, 'invoices'); if (a.response) return a.response;
      const invoice = await env.DB.prepare('SELECT inv.*, c.Full_Name AS Client_Name, c.Phone_Number, o.Machine_Type FROM Invoices inv JOIN Clients c ON c.Client_ID=inv.Client_ID LEFT JOIN Orders o ON o.Task_ID=inv.Order_Task_ID WHERE inv.Invoice_ID=?').bind(Number(invoiceView[1])).first();
      if (!invoice) return html('<h1>الفاتورة غير موجودة</h1>', 404);
      const body = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>${esc(invoice.Invoice_Number)}</title><style>body{font-family:system-ui;margin:40px;color:#172033}.card{border:1px solid #ddd;border-radius:12px;padding:28px;max-width:680px;margin:auto}dt{font-weight:700}dd{margin:0 0 16px}h1{color:#0f766e}</style><main class="card"><h1>فاتورة ${esc(invoice.Invoice_Number)}</h1><dl><dt>العميل</dt><dd>${esc(invoice.Client_Name)}</dd><dt>الطلب</dt><dd>#${invoice.Order_Task_ID} · ${esc(invoice.Machine_Type || '')}</dd><dt>المبلغ</dt><dd>$${Number(invoice.Amount).toFixed(2)} USD</dd><dt>الحالة</dt><dd>${esc(invoice.Status)}</dd><dt>التاريخ</dt><dd>${esc(invoice.Created_At)}</dd></dl><button onclick="print()">طباعة</button></main></html>`;
      return html(body);
    }

    if (path === '/api/orders') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (request.method === 'GET') {
        const s = orderScope(a.user), where = [s.sql], values = [...s.values];
        const statusFilter = url.searchParams.get('status'), machineFilter = url.searchParams.get('machine'), clientFilter = Number(url.searchParams.get('clientId'));
        if (statusFilter) { where.push('o.Status=?'); values.push(statusFilter); }
        if (machineFilter && ['Laser', 'Router'].includes(machineFilter)) { where.push('o.Machine_Type=?'); values.push(machineFilter); }
        if (Number.isInteger(clientFilter) && clientFilter > 0) { where.push('o.Client_ID=?'); values.push(clientFilter); }
        const search = String(url.searchParams.get('search') || '').trim();
        if (search) { where.push('(c.Full_Name LIKE ? OR o.Notes LIKE ? OR CAST(o.Task_ID AS TEXT) LIKE ?)'); values.push(...Array(3).fill(`%${search}%`)); }
        const from = 'FROM Orders o LEFT JOIN Clients c ON c.Client_ID=o.Client_ID LEFT JOIN Users u ON u.User_ID=o.Designer_ID LEFT JOIN Inventory i ON i.Material_ID=o.Material_ID';
        const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
        const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '200', 10) || 200));
        const total = Number((await env.DB.prepare(`SELECT COUNT(*) AS total ${from} WHERE ${where.join(' AND ')}`).bind(...values).first())?.total || 0);
        const sortOption = url.searchParams.get('sort');
        const orderBy = sortOption === 'oldest' ? 'o.Created_At ASC, o.Task_ID ASC'
          : sortOption === 'status' ? 'o.Status ASC, o.Created_At DESC, o.Task_ID DESC'
          : sortOption === 'price_desc' ? 'o.Price DESC, o.Created_At DESC, o.Task_ID DESC'
          : sortOption === 'price_asc' ? 'o.Price ASC, o.Created_At DESC, o.Task_ID DESC'
          : 'o.Created_At DESC, o.Task_ID DESC';
        const query = `SELECT o.*, c.Full_Name Client_Name, u.Name Designer_Name, i.Material_Name, i.Thickness,
          (SELECT COUNT(*) FROM Order_Files f WHERE f.Task_ID=o.Task_ID AND f.File_Type='design' AND COALESCE(f.Is_Current,1)=1) AS File_Count
          ${from} WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
        const orders = (await env.DB.prepare(query).bind(...values, limit, (page - 1) * limit).all()).results;
        if (orders.length) {
          const ids = orders.map(order => Number(order.Task_ID));
          const rows = (await env.DB.prepare(`SELECT om.Task_ID, om.Material_ID, om.Quantity, i.Material_Name, i.Thickness FROM Order_Materials om JOIN Inventory i ON i.Material_ID=om.Material_ID WHERE om.Task_ID IN (${ids.map(() => '?').join(',')}) ORDER BY om.ID`).bind(...ids).all()).results;
          const byTask = new Map(ids.map(id => [id, []]));
          for (const row of rows) byTask.get(Number(row.Task_ID))?.push(row);
          for (const order of orders) order.Materials = byTask.get(Number(order.Task_ID)) || [];
        }
        return json({ orders, page, pages: Math.max(1, Math.ceil(total / limit)), total });
      }
      if (request.method === 'POST') {
        const b = await request.json().catch(() => ({}));
        const clientId = Number(b.Client_ID), client = Number.isInteger(clientId) ? await env.DB.prepare('SELECT Client_ID, Created_By FROM Clients WHERE Client_ID=?').bind(clientId).first() : null;
        if (!client || !['Laser', 'Router'].includes(b.Machine_Type)) return json({ error: 'العميل أو نوع التشغيل غير صالح' }, 400);
        if (a.user.Role === 'Agent' && Number(client.Created_By) !== Number(a.user.User_ID)) return json({ error: 'لا يمكنك إنشاء طلب لعميل وكيل آخر' }, 403);
        const pending = a.user.Role === 'Agent';
        const unit = b.Quantity_Unit === 'قطعة' ? 'قطعة' : 'لوح';
        const imageIds = [...new Set(Array.isArray(b.Image_IDs) ? b.Image_IDs.map(Number) : [])].filter(Number.isInteger);
        if (imageIds.length > 30) return json({ error: 'الحد الأقصى 30 صورة لكل طلب' }, 400);
        const quantities = b.Quantities && typeof b.Quantities === 'object' ? b.Quantities : {};
        const imageQuantities = imageIds.map(id => Number(quantities[id]));
        if (pending && (!imageIds.length || imageQuantities.some(qty => !Number.isFinite(qty) || qty <= 0))) return json({ error: 'اختر صورة واحدة على الأقل وحدد كمية صحيحة لكل صورة' }, 400);
        const requestedQty = pending ? imageQuantities.reduce((sum, qty) => sum + qty, 0) : Number(b.Material_Qty || 0);
        const suppliedMaterials = Array.isArray(b.Materials) ? b.Materials.slice(0, 20) : [];
        const materials = suppliedMaterials.map(row => ({ Material_ID: Number(row.Material_ID), Quantity: Number(row.Quantity) }));
        if (materials.some(row => !Number.isInteger(row.Material_ID) || row.Material_ID <= 0 || !Number.isFinite(row.Quantity) || row.Quantity <= 0)) return json({ error: 'إحدى الخامات أو كمياتها غير صالحة' }, 400);
        const materialId = Number(b.Material_ID) || materials[0]?.Material_ID || null;
        if (materialId && !(await env.DB.prepare('SELECT Material_ID FROM Inventory WHERE Material_ID=?').bind(materialId).first())) return json({ error: 'الخامة المختارة غير موجودة' }, 400);
        for (const row of materials) if (!(await env.DB.prepare('SELECT Material_ID FROM Inventory WHERE Material_ID=?').bind(row.Material_ID).first())) return json({ error: 'خامة الطلب غير موجودة' }, 400);
        let agentPrice = Number(b.Agent_Price ?? 0), commission = Number(b.Agent_Commission ?? 0), finalPrice = Number(b.Final_Price ?? b.Price ?? 0);
        if (pending) {
          const product = await env.DB.prepare('SELECT * FROM Product_Pricing WHERE Pricing_ID=? AND Is_Active=1').bind(Number(b.Pricing_ID)).first();
          if (!product || !materialId) return json({ error: 'اختر المنتج والخامة قبل إرسال الطلب' }, 400);
          if (product.Unit !== unit) return json({ error: 'وحدة الطلب لا تطابق وحدة سعر المنتج' }, 400);
          const configured = (await env.DB.prepare('SELECT Material_ID, Price FROM Product_Material_Pricing WHERE Pricing_ID=? AND Is_Active=1').bind(product.Pricing_ID).all()).results;
          const selected = configured.find(row => Number(row.Material_ID) === materialId);
          if (configured.length && !selected) return json({ error: 'هذه الخامة غير مسموحة للمنتج المختار' }, 400);
          for (const imageId of imageIds) {
            const image = await env.DB.prepare('SELECT Image_ID FROM Agent_Images WHERE Image_ID=?').bind(imageId).first();
            if (!image) return json({ error: 'صورة الطلب غير موجودة' }, 400);
            const allowed = (await env.DB.prepare('SELECT Material_ID FROM Agent_Image_Materials WHERE Image_ID=?').bind(imageId).all()).results;
            if (allowed.length && !allowed.some(row => Number(row.Material_ID) === materialId)) return json({ error: 'الخامة المختارة لا تناسب إحدى الصور' }, 400);
          }
          if (!Number.isFinite(commission) || commission < 0) return json({ error: 'عمولة الوكيل غير صالحة' }, 400);
          agentPrice = Number(selected?.Price ?? product.Base_Price);
          finalPrice = agentPrice + commission;
        }
        if (!Number.isFinite(requestedQty) || requestedQty < 0 || !Number.isFinite(finalPrice) || finalPrice < 0) return json({ error: 'كمية الطلب أو سعره غير صالح' }, 400);
        const stockQty = requestedQty || materials.reduce((sum, row) => sum + row.Quantity, 0);
        const designerId = a.user.Role === 'Designer' ? a.user.User_ID : (a.user.Role === 'Admin' && Number.isInteger(Number(b.Designer_ID)) && Number(b.Designer_ID) > 0 ? Number(b.Designer_ID) : null);
        const result = await env.DB.prepare("INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Material_ID, Material_Qty, Quantity_Unit, Price, Agent_Price, Agent_Commission, Final_Price, Notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(clientId, designerId, a.user.User_ID, b.Machine_Type, pending ? 'بانتظار الموافقة' : 'قيد التصميم', pending ? 'pending' : 'approved', materialId, stockQty, unit, finalPrice, agentPrice, commission, finalPrice, String(b.Notes || '')).run();
        const taskId = result.meta.last_row_id;
        for (const material of materials) await env.DB.prepare('INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)').bind(taskId, material.Material_ID, material.Quantity).run();
        for (const imageId of imageIds) {
          const image = await env.DB.prepare('SELECT * FROM Agent_Images WHERE Image_ID=?').bind(imageId).first();
          if (image) {
            const imageLabel = pending ? `الكمية: ${quantities[imageId]} ${unit}` : '';
            await env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, 'image', 1, ?)")
              .bind(taskId, image.Original_Name, image.Stored_Name, image.File_Path, image.File_Size, imageLabel, a.user.User_ID).run();
            const latest = await env.DB.prepare(`SELECT f.* FROM Order_Files f JOIN Orders o ON o.Task_ID=f.Task_ID
              WHERE o.Client_ID=? AND o.Task_ID<>? AND f.File_Type='design' AND COALESCE(f.Is_Current,1)=1
              AND EXISTS(SELECT 1 FROM Order_Files i WHERE i.Task_ID=o.Task_ID AND i.File_Type='image' AND i.File_Path=?)
              ORDER BY o.Created_At DESC, f.Created_At DESC, f.File_ID DESC LIMIT 1`).bind(clientId, taskId, image.File_Path).first();
            const design = latest || (image.Design_ID ? await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(image.Design_ID).first() : null);
            const designPath = latest?.File_Path || design?.FilePath;
            if (designPath) await env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, 'design', 1, ?)")
              .bind(taskId, latest?.Original_Name || design.Original_Name, latest?.Stored_Name || cleanName(design.Original_Name), designPath, latest?.File_Size || 0, latest ? 'أحدث نسخة محفوظة لهذا العميل' : `التصميم المرتبط: ${design.Name}`, a.user.User_ID).run();
          }
        }
        const order = await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(taskId).first();
        await logAction(env, 'order_created', a.user.User_ID, { taskId, clientId, machine: b.Machine_Type, requestedQty, unit });
        return json({ Task_ID: taskId, order }, 201);
      }
    }

    if (path === '/api/orders/agent/images' && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const category = String(url.searchParams.get('category') || '').trim();
      const limit = Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '200', 10) || 200));
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset') || String((page - 1) * limit), 10) || 0);
      const images = (await env.DB.prepare(`SELECT ai.*, d.Name AS Design_Name FROM Agent_Images ai LEFT JOIN Designs d ON d.Design_ID=ai.Design_ID ${category ? 'WHERE ai.Category=?' : ''} ORDER BY ai.Created_At DESC LIMIT ? OFFSET ?`).bind(...(category ? [category, limit, offset] : [limit, offset])).all()).results;
      for (const image of images) image.Materials = (await env.DB.prepare('SELECT i.* FROM Inventory i JOIN Agent_Image_Materials m ON m.Material_ID=i.Material_ID WHERE m.Image_ID=?').bind(image.Image_ID).all()).results;
      return json({ images });
    }
    if (path === '/api/orders/agent/images' && request.method === 'POST') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'رفع صور المكتبة للمدير فقط' }, 403);
      const form = await request.formData(), images = form.getAll('images').filter(file => file instanceof File);
      if (!images.length) return json({ error: 'لم يتم اختيار أي صورة' }, 400);
      if (images.length > 50 || images.some(file => file.size > 10 * 1024 * 1024)) return json({ error: 'الحد الأقصى 50 صورة و10 ميغابايت للصورة' }, 400);
      if (images.some(file => !file.type.startsWith('image/'))) return json({ error: 'يُسمح برفع الصور فقط في المكتبة' }, 400);
      const category = String(form.get('category') || 'عام').slice(0, 100), saved = [];
      const optimizedFlags = form.getAll('imageOptimized');
      await concurrently(images, 3, async (file, index) => {
        const key = `library-images/${crypto.randomUUID()}-${cleanName(file.name)}`;
        await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type }, ...(optimizedFlags[index] === '1' ? { customMetadata: { optimization: 'v1' } } : {}) });
        const created = await env.DB.prepare('INSERT INTO Agent_Images (Category, Original_Name, Stored_Name, File_Path, File_Size, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?)')
          .bind(category, file.name, key.split('/').at(-1), `r2://${key}`, file.size, a.user.User_ID).run();
        saved.push({ Image_ID: created.meta.last_row_id, Original_Name: file.name });
      });
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
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `inline; filename="${cleanName(image.Original_Name)}"`, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', ...(object.customMetadata?.optimization === 'v1' ? { 'x-image-optimization': 'v1' } : {}) } });
    }
    const agentImageOptimize = path.match(/^\/api\/orders\/agent\/images\/(\d+)\/optimize$/);
    if (agentImageOptimize && request.method === 'POST') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'تحسين صور المكتبة للمدير فقط' }, 403);
      const image = await env.DB.prepare('SELECT * FROM Agent_Images WHERE Image_ID=?').bind(Number(agentImageOptimize[1])).first();
      if (!image?.File_Path?.startsWith('r2://')) return json({ error: 'الصورة غير متاحة' }, 404);
      const key = image.File_Path.slice(5), current = await env.FILES.get(key);
      if (!current) return json({ error: 'الصورة غير موجودة في التخزين' }, 404);
      if (current.customMetadata?.optimization === 'v1') return json({ success: true, skipped: true });
      const form = await request.formData(), file = form.get('image');
      if (!(file instanceof File) || file.type !== 'image/webp' || !file.size || file.size > 10 * 1024 * 1024) return json({ error: 'ملف WebP المحسن غير صالح أو يتجاوز 10 ميغابايت' }, 400);
      if (file.size >= current.size) return json({ success: true, skipped: true });
      const storedName = cleanName(file.name);
      await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: 'image/webp' }, customMetadata: { optimization: 'v1' } });
      await env.DB.batch([
        env.DB.prepare('UPDATE Agent_Images SET Original_Name=?, Stored_Name=?, File_Size=? WHERE Image_ID=?').bind(file.name, storedName, file.size, image.Image_ID),
        env.DB.prepare("UPDATE Order_Files SET Stored_Name=?, File_Size=? WHERE File_Path=? AND File_Type='image'").bind(storedName, file.size, image.File_Path)
      ]);
      return json({ success: true, oldSize: current.size, newSize: file.size, savedBytes: current.size - file.size });
    }
    const agentImageDelete = path.match(/^\/api\/orders\/agent\/images\/(\d+)$/);
    if (agentImageDelete && request.method === 'DELETE') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'حذف صور المكتبة للمدير فقط' }, 403);
      const image = await env.DB.prepare('SELECT * FROM Agent_Images WHERE Image_ID=?').bind(Number(agentImageDelete[1])).first();
      if (!image) return json({ error: 'الصورة غير موجودة' }, 404);
      await env.DB.prepare('DELETE FROM Agent_Images WHERE Image_ID=?').bind(image.Image_ID).run();
      await removeUnreferencedR2Files(env, [image.File_Path]);
      return json({ success: true });
    }

    if (path === '/api/designs' && request.method === 'POST') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (!['Admin', 'Designer'].includes(a.user.Role)) return json({ error: 'رفع التصاميم للمدير أو المصمم فقط' }, 403);
      const form = await request.formData(), file = form.get('file'), thumbnail = form.get('thumbnail');
      const name = String(form.get('Name') || '').trim();
      if (!name || !(file instanceof File)) return json({ error: 'اسم التصميم وملفه مطلوبان' }, 400);
      if (!file.size || file.size > 25 * 1024 * 1024) return json({ error: 'ملف التصميم فارغ أو يتجاوز 25 ميغابايت' }, 400);
      if (thumbnail instanceof File && thumbnail.size && (!thumbnail.type.startsWith('image/') || thumbnail.size > 10 * 1024 * 1024)) return json({ error: 'الصورة المصغرة يجب أن تكون صورة أصغر من 10 ميغابايت' }, 400);
      const fileKey = `designs/${crypto.randomUUID()}-${cleanName(file.name)}`;
      const uploaded = [];
      try {
        await env.FILES.put(fileKey, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
        uploaded.push(fileKey);
        let thumbnailPath = null;
        if (thumbnail instanceof File && thumbnail.size) {
          const thumbKey = `design-thumbnails/${crypto.randomUUID()}-${cleanName(thumbnail.name)}`;
          await env.FILES.put(thumbKey, thumbnail.stream(), { httpMetadata: { contentType: thumbnail.type } });
          uploaded.push(thumbKey);
          thumbnailPath = `r2://${thumbKey}`;
        }
        const rawPassword = String(form.get('Password') || '');
        const result = await env.DB.prepare('INSERT INTO Designs (Name, Category, Material, Thickness, Width, Height, Unit, Notes, FilePath, Original_Name, ThumbnailPath, Password, CreatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
          .bind(name, String(form.get('Category') || ''), String(form.get('Material') || ''), String(form.get('Thickness') || ''), Number(form.get('Width') || 0), Number(form.get('Height') || 0), String(form.get('Unit') || 'مم'), String(form.get('Notes') || ''), `r2://${fileKey}`, file.name, thumbnailPath, rawPassword ? await bcrypt.hash(rawPassword, 12) : null, a.user.User_ID).run();
        return json({ success: true, Design_ID: result.meta.last_row_id }, 201);
      } catch (error) {
        await Promise.allSettled(uploaded.map(key => env.FILES.delete(key)));
        return json({ error: 'تعذر تخزين التصميم. حاول مجددًا' }, 500);
      }
    }

    if (path === '/api/agents/admin/designs' && request.method === 'GET') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'هذه القائمة للمدير فقط' }, 403);
      const search = `%${String(url.searchParams.get('search') || '').trim()}%`;
      const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '10', 10) || 10));
      const total = Number((await env.DB.prepare('SELECT COUNT(*) AS count FROM Designs d WHERE d.Name LIKE ? OR d.Category LIKE ?').bind(search, search).first())?.count || 0);
      const pages = Math.max(1, Math.ceil(total / limit));
      const currentPage = Math.min(page, pages);
      const designs = (await env.DB.prepare(`SELECT d.*, COUNT(ai.Image_ID) AS Image_Count, 1 AS Is_Active FROM Designs d LEFT JOIN Agent_Images ai ON ai.Design_ID=d.Design_ID WHERE d.Name LIKE ? OR d.Category LIKE ? GROUP BY d.Design_ID ORDER BY d.CreatedAt DESC, d.Design_ID DESC LIMIT ? OFFSET ?`).bind(search, search, limit, (currentPage - 1) * limit).all()).results;
      return json({ designs, page: currentPage, pages, total });
    }
    const designDelete = path.match(/^\/api\/agents\/admin\/designs\/(\d+)$/);
    if (designDelete && request.method === 'DELETE') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'حذف التصاميم للمدير فقط' }, 403);
      const design = await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(Number(designDelete[1])).first();
      if (!design) return json({ error: 'التصميم غير موجود' }, 404);
      const linked = await env.DB.prepare('SELECT Image_ID FROM Agent_Images WHERE Design_ID=? LIMIT 1').bind(design.Design_ID).first();
      if (linked) return json({ error: 'فك ارتباط صور المكتبة بهذا التصميم قبل حذفه' }, 409);
      await env.DB.prepare('DELETE FROM Designs WHERE Design_ID=?').bind(design.Design_ID).run();
      await removeUnreferencedR2Files(env, [design.FilePath, design.ThumbnailPath]);
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
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename="${cleanName(design.Original_Name)}"`, 'x-robots-tag': 'noindex, nofollow' } });
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
        await logAction(env, 'order_rejected', a.user.User_ID, { taskId: order.Task_ID });
        return json({ success: true });
      }
      if (body.action !== 'approve' || !Number.isInteger(Number(body.designer_id))) return json({ error: 'اختر مصممًا صالحًا قبل الموافقة' }, 400);
      const designer = await env.DB.prepare("SELECT User_ID FROM Users WHERE User_ID=? AND Role='Designer'").bind(Number(body.designer_id)).first();
      if (!designer) return json({ error: 'المصمم المختار غير موجود' }, 400);
      const approvalStatements = [env.DB.prepare("UPDATE Orders SET Approval_Status='approved', Status='قيد التصميم', Designer_ID=?, Agent_Approved_At=CURRENT_TIMESTAMP, Agent_Approved_By=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=? AND Approval_Status='pending'")
        .bind(designer.User_ID, a.user.User_ID, order.Task_ID)];
      if (Number(order.Agent_Commission) > 0) approvalStatements.push(env.DB.prepare(`INSERT INTO Agent_Commissions
        (Agent_ID, Order_ID, Client_ID, Commission_Amount, Commission_Type, Status)
        SELECT ?, ?, ?, ?, 'order_total', 'pending'
        WHERE NOT EXISTS(SELECT 1 FROM Agent_Commissions WHERE Order_ID=?)`)
        .bind(order.Created_By, order.Task_ID, order.Client_ID, Number(order.Agent_Commission), order.Task_ID));
      const approved = await env.DB.batch(approvalStatements);
      if (!approved[0].meta.changes) return json({ error: 'تمت معالجة الطلب مسبقًا' }, 409);
      await logAction(env, 'order_approved', a.user.User_ID, { taskId: order.Task_ID, designerId: designer.User_ID });
      return json({ success: true, order: await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(order.Task_ID).first() });
    }

    const orderDelete = path.match(/^\/api\/orders\/(\d+)$/);
    if (orderDelete && request.method === 'DELETE') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (a.user.Role !== 'Admin') return json({ error: 'حذف الطلبات للمدير فقط' }, 403);
      const taskId = Number(orderDelete[1]);
      const financial = await env.DB.prepare('SELECT (SELECT COUNT(*) FROM Invoices WHERE Order_Task_ID=?) + (SELECT COUNT(*) FROM Receipts WHERE Order_Task_ID=?) AS total').bind(taskId, taskId).first();
      if (Number(financial?.total) > 0) return json({ error: 'لا يمكن حذف طلب لديه فاتورة أو إيصال محفوظ' }, 409);
      const settledCommission = await env.DB.prepare("SELECT Commission_ID FROM Agent_Commissions WHERE Order_ID=? AND Status IN ('approved','paid') LIMIT 1").bind(taskId).first();
      if (settledCommission) return json({ error: 'لا يمكن حذف طلب لديه عمولة معتمدة أو مدفوعة' }, 409);
      const files = (await env.DB.prepare('SELECT File_Path FROM Order_Files WHERE Task_ID=?').bind(taskId).all()).results;
      await env.DB.batch([
        env.DB.prepare('UPDATE Agent_Custom_Designs SET Order_ID=NULL WHERE Order_ID=?').bind(taskId),
        env.DB.prepare('DELETE FROM Agent_Commissions WHERE Order_ID=?').bind(taskId),
        env.DB.prepare('DELETE FROM Notifications WHERE Task_ID=?').bind(taskId),
        env.DB.prepare('DELETE FROM Order_Materials WHERE Task_ID=?').bind(taskId),
        env.DB.prepare('DELETE FROM Order_Files WHERE Task_ID=?').bind(taskId),
        env.DB.prepare('DELETE FROM Orders WHERE Task_ID=?').bind(taskId)
      ]);
      await removeUnreferencedR2Files(env, files.map(file => file.File_Path));
      return json({ success: true });
    }

    const status = path.match(/^\/api\/orders\/(\d+)\/status$/);
    if (status && request.method === 'PUT') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const order = await accessibleOrder(env, a.user, Number(status[1])); if (!order) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      const next = (await request.json().catch(() => ({}))).Status;
      const valid = ['قيد التصميم', 'جاهز للقص', 'قيد التنفيذ', 'تم الانتهاء من القص', 'تم التغليف', 'تم التسليم'];
      if (!valid.includes(next)) return json({ error: 'حالة غير صالحة' }, 400);
      if (next === order.Status) return json({ order });
      const role = a.user.Role;
      if (role === 'Agent') return json({ error: 'تغيير حالة الطلب ليس من صلاحية الوكيل' }, 403);
      if (role === 'Laser_Op' && order.Machine_Type !== 'Laser' || role === 'Router_Op' && order.Machine_Type !== 'Router') return json({ error: 'هذا الطلب لا يتبع ماكينتك' }, 403);
      const machineRole = ['Laser_Op', 'Router_Op'].includes(role);
      if (machineRole && !['قيد التنفيذ', 'تم الانتهاء من القص', 'تم التسليم'].includes(next)) return json({ error: 'هذه الحالة ليست من صلاحية عامل القص' }, 403);
      if (role === 'Designer' && !['قيد التصميم', 'جاهز للقص'].includes(next)) return json({ error: 'إتمام القص والتسليم من صلاحية عامل الماكينة أو المدير' }, 403);
      if (order.Approval_Status === 'pending' || order.Approval_Status === 'rejected') return json({ error: 'الطلب لم يُعتمد بعد' }, 409);
      if (order.Status === 'تم التسليم' || order.Inventory_Deducted_At && ['قيد التصميم', 'جاهز للقص', 'قيد التنفيذ'].includes(next)) return json({ error: 'لا يمكن إرجاع طلب بعد قصه أو تسليمه' }, 409);

      if (next === 'تم الانتهاء من القص') {
        if (!['Admin', 'Laser_Op', 'Router_Op'].includes(role)) return json({ error: 'لا تملك صلاحية إتمام القص' }, 403);
        if (!['جاهز للقص', 'قيد التنفيذ'].includes(order.Status)) return json({ error: 'يجب أن يكون الطلب جاهزًا للقص قبل إتمامه' }, 409);
        const materials = (await env.DB.prepare('SELECT Material_ID, SUM(Quantity) AS Quantity FROM Order_Materials WHERE Task_ID=? GROUP BY Material_ID').bind(order.Task_ID).all()).results;
        const demand = materials.length ? materials : order.Material_ID && Number(order.Material_Qty) > 0 && order.Quantity_Unit === 'لوح'
          ? [{ Material_ID: order.Material_ID, Quantity: Number(order.Material_Qty) }] : [];
        if (!demand.length && order.Material_ID && order.Quantity_Unit === 'قطعة') return json({ error: 'حدد ألواح القص المستهلكة من المصمم قبل إتمام طلب القطع' }, 409);
        let cost = 0;
        for (const row of demand) {
          const stock = await env.DB.prepare('SELECT Quantity, Cost_Per_Unit FROM Inventory WHERE Material_ID=?').bind(row.Material_ID).first();
          if (!stock || Number(stock.Quantity) < Number(row.Quantity)) return json({ error: `المخزون غير كافٍ للخامة رقم ${row.Material_ID}` }, 409);
          cost += Number(row.Quantity) * Number(stock.Cost_Per_Unit || 0);
        }
        const claim = `cut:${crypto.randomUUID()}`;
        const checks = demand.map(() => 'AND EXISTS(SELECT 1 FROM Inventory WHERE Material_ID=? AND Quantity>=?)').join(' ');
        const checkValues = demand.flatMap(row => [row.Material_ID, Number(row.Quantity)]);
        const statements = [env.DB.prepare(`UPDATE Orders SET Inventory_Deducted_At=? WHERE Task_ID=? AND Inventory_Deducted_At IS NULL AND Status IN ('جاهز للقص','قيد التنفيذ') ${checks}`).bind(claim, order.Task_ID, ...checkValues)];
        for (const row of demand) statements.push(env.DB.prepare('UPDATE Inventory SET Quantity=Quantity-? WHERE Material_ID=? AND EXISTS(SELECT 1 FROM Orders WHERE Task_ID=? AND Inventory_Deducted_At=?)').bind(Number(row.Quantity), row.Material_ID, order.Task_ID, claim));
        statements.push(env.DB.prepare("UPDATE Orders SET Status='تم الانتهاء من القص', Cost=?, Profit=COALESCE(Price,0)-?, Inventory_Deducted_At=CURRENT_TIMESTAMP, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=? AND Inventory_Deducted_At=?").bind(cost, cost, order.Task_ID, claim));
        const changes = await env.DB.batch(statements);
        if (!changes[0].meta.changes) return json({ error: 'تعذر إتمام القص؛ تحقق من حالة الطلب والمخزون' }, 409);
        await logAction(env, 'cut_completed', a.user.User_ID, { taskId: order.Task_ID, materials: demand });
      } else if (next === 'تم التسليم') {
        if (!['Admin', 'Laser_Op', 'Router_Op'].includes(role)) return json({ error: 'لا تملك صلاحية تسليم الطلب' }, 403);
        if (!['تم الانتهاء من القص', 'تم التغليف'].includes(order.Status) || !order.Inventory_Deducted_At) return json({ error: 'أكمل القص وخصم المواد قبل تسليم الطلب' }, 409);
        const claim = `delivery:${crypto.randomUUID()}`, price = Number(order.Price || order.Final_Price || 0);
        const statements = [
          env.DB.prepare("UPDATE Orders SET Updated_At=? WHERE Task_ID=? AND Status IN ('تم الانتهاء من القص','تم التغليف') AND Inventory_Deducted_At IS NOT NULL").bind(claim, order.Task_ID),
          env.DB.prepare('UPDATE Clients SET Total_Spent=COALESCE(Total_Spent,0)+? WHERE Client_ID=? AND EXISTS(SELECT 1 FROM Orders WHERE Task_ID=? AND Updated_At=?)').bind(price, order.Client_ID, order.Task_ID, claim),
          env.DB.prepare("UPDATE Orders SET Status='تم التسليم', Profit=?-COALESCE(Cost,0), Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=? AND Updated_At=?").bind(price, order.Task_ID, claim)
        ];
        const changes = await env.DB.batch(statements);
        if (!changes[0].meta.changes) return json({ error: 'الطلب سُلّم مسبقًا أو تغيرت حالته' }, 409);
        await logAction(env, 'order_delivered', a.user.User_ID, { taskId: order.Task_ID });
      } else {
        const allowed = {
          'قيد التصميم': ['جاهز للقص'],
          'جاهز للقص': ['قيد التصميم'],
          'قيد التنفيذ': ['جاهز للقص'],
          'تم التغليف': ['تم الانتهاء من القص']
        };
        if (!allowed[next]?.includes(order.Status)) return json({ error: 'انتقال حالة الطلب غير مسموح' }, 409);
        if (next === 'جاهز للقص' && !(await env.DB.prepare("SELECT File_ID FROM Order_Files WHERE Task_ID=? AND File_Type='design' AND COALESCE(Is_Current,1)=1 LIMIT 1").bind(order.Task_ID).first())) return json({ error: 'ارفع ملف التصميم قبل تحويل الطلب إلى القص' }, 409);
        await env.DB.prepare('UPDATE Orders SET Status=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=? AND Status=?').bind(next, order.Task_ID, order.Status).run();
      }
      return json({ order: await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(order.Task_ID).first() });
    }

    const duplicateOrder = path.match(/^\/api\/orders\/(\d+)\/duplicate$/);
    if (duplicateOrder && request.method === 'POST') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      const source = await accessibleOrder(env, a.user, Number(duplicateOrder[1]));
      if (!source) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      const pending = a.user.Role === 'Agent';
      const created = await env.DB.prepare("INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Material_ID, Material_Qty, Quantity_Unit, Price, Agent_Price, Agent_Commission, Final_Price, Notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(source.Client_ID, pending ? null : (source.Designer_ID || a.user.User_ID), a.user.User_ID, source.Machine_Type, pending ? 'بانتظار الموافقة' : 'قيد التصميم', pending ? 'pending' : 'approved', source.Material_ID, source.Material_Qty, source.Quantity_Unit, source.Price, source.Agent_Price, source.Agent_Commission, source.Final_Price, `مكرر من طلب #${source.Task_ID} — ${source.Notes || ''}`).run();
      const taskId = created.meta.last_row_id;
      const materials = (await env.DB.prepare('SELECT Material_ID, Quantity FROM Order_Materials WHERE Task_ID=?').bind(source.Task_ID).all()).results;
      for (const material of materials) await env.DB.prepare('INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)').bind(taskId, material.Material_ID, material.Quantity).run();
      const files = (await env.DB.prepare("SELECT * FROM Order_Files WHERE Task_ID=? AND (File_Type='image' OR COALESCE(Is_Current,1)=1)").bind(source.Task_ID).all()).results;
      for (const file of files) await env.DB.prepare('INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Upload_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        .bind(taskId, file.Original_Name, file.Stored_Name, file.File_Path, file.File_Size, file.Label || '', file.File_Type, file.Upload_Type || 'design', a.user.User_ID).run();
      return json({ Task_ID: taskId, order: await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(taskId).first() }, 201);
    }

    const copyFiles = path.match(/^\/api\/files\/copy\/(\d+)$/);
    if (copyFiles && request.method === 'POST') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (!['Admin', 'Designer'].includes(a.user.Role)) return json({ error: 'استرجاع الملفات للمصمم أو المدير فقط' }, 403);
      const taskId = Number(copyFiles[1]), target = await accessibleOrder(env, a.user, taskId);
      if (!target) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      if (target.Inventory_Deducted_At || target.Status === 'تم التسليم') return json({ error: 'لا يمكن تعديل طلب منتهٍ' }, 409);
      const body = await request.json().catch(() => ({}));
      const ids = [...new Set(Array.isArray(body.fileIds) ? body.fileIds.map(Number) : [])].filter(Number.isInteger).slice(0, 50);
      if (!ids.length) return json({ error: 'لم يتم اختيار ملفات' }, 400);
      const selected = [];
      for (const id of ids) {
        const file = await env.DB.prepare('SELECT * FROM Order_Files WHERE File_ID=?').bind(id).first();
        if (!file || !await accessibleOrder(env, a.user, file.Task_ID)) return json({ error: 'أحد الملفات غير موجود أو غير مصرح' }, 403);
        selected.push(file);
      }
      if (selected.some(file => file.File_Type !== 'image')) await env.DB.prepare("UPDATE Order_Files SET Is_Current=0 WHERE Task_ID=? AND File_Type='design'").bind(taskId).run();
      for (const file of selected) await env.DB.prepare('INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Upload_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)')
        .bind(taskId, file.Original_Name, file.Stored_Name, file.File_Path, file.File_Size, file.Label || '', file.File_Type, file.Upload_Type || 'design', a.user.User_ID).run();
      const design = selected.findLast(file => file.File_Type !== 'image');
      if (design) await env.DB.prepare('UPDATE Orders SET File_Path=?, File_Name=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?').bind(design.File_Path, design.Original_Name, taskId).run();
      return json({ success: true, count: selected.length });
    }

    const deleteOrderFile = path.match(/^\/api\/files\/file\/(\d+)$/);
    if (deleteOrderFile && request.method === 'DELETE') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (!['Admin', 'Designer'].includes(a.user.Role)) return json({ error: 'حذف ملفات الطلب للمصمم أو المدير فقط' }, 403);
      const file = await env.DB.prepare('SELECT * FROM Order_Files WHERE File_ID=?').bind(Number(deleteOrderFile[1])).first();
      if (!file || !await accessibleOrder(env, a.user, file.Task_ID)) return json({ error: 'الملف غير موجود أو غير مصرح' }, 404);
      const order = await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(file.Task_ID).first();
      if (order.Inventory_Deducted_At) return json({ error: 'لا يمكن حذف ملف بعد إتمام القص' }, 409);
      await env.DB.prepare('DELETE FROM Order_Files WHERE File_ID=?').bind(file.File_ID).run();
      await removeUnreferencedR2Files(env, [file.File_Path]);
      if (file.File_Type !== 'image') {
        const remaining = await env.DB.prepare("SELECT * FROM Order_Files WHERE Task_ID=? AND File_Type='design' AND COALESCE(Is_Current,1)=1 ORDER BY File_ID DESC LIMIT 1").bind(file.Task_ID).first();
        if (!remaining) await env.DB.prepare("UPDATE Orders SET File_Path=NULL, File_Name=NULL, Status=CASE WHEN Status='جاهز للقص' THEN 'قيد التصميم' ELSE Status END, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?").bind(file.Task_ID).run();
        else if (order.File_Path === file.File_Path) await env.DB.prepare('UPDATE Orders SET File_Path=?, File_Name=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?').bind(remaining.File_Path, remaining.Original_Name, file.Task_ID).run();
      }
      return json({ success: true });
    }

    const deleteOrderDesignFiles = path.match(/^\/api\/files\/(\d+)$/);
    if (deleteOrderDesignFiles && request.method === 'DELETE') {
      const a = await auth(request, env, 'orders'); if (a.response) return a.response;
      if (!['Admin', 'Designer'].includes(a.user.Role)) return json({ error: 'حذف ملفات الطلب للمصمم أو المدير فقط' }, 403);
      const taskId = Number(deleteOrderDesignFiles[1]), order = await accessibleOrder(env, a.user, taskId);
      if (!order) return json({ error: 'الطلب غير موجود أو غير مصرح' }, 404);
      if (order.Inventory_Deducted_At) return json({ error: 'لا يمكن حذف ملفات طلب بعد إتمام القص' }, 409);
      const files = (await env.DB.prepare("SELECT File_Path FROM Order_Files WHERE Task_ID=? AND File_Type='design'").bind(taskId).all()).results;
      await env.DB.batch([
        env.DB.prepare("DELETE FROM Order_Files WHERE Task_ID=? AND File_Type='design'").bind(taskId),
        env.DB.prepare("UPDATE Orders SET File_Path=NULL, File_Name=NULL, Status=CASE WHEN Status='جاهز للقص' THEN 'قيد التصميم' ELSE Status END, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?").bind(taskId)
      ]);
      await removeUnreferencedR2Files(env, files.map(file => file.File_Path));
      return json({ success: true });
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
        if (!['Admin', 'Designer'].includes(a.user.Role)) return json({ error: 'رفع ملفات التصميم للمدير أو المصمم فقط' }, 403);
        if (order.Status === 'تم التسليم' || order.Status === 'تم الانتهاء من القص') return json({ error: 'لا يمكن تعديل ملفات طلب منتهٍ' }, 409);
        const form = await request.formData(), files = form.getAll('files').filter(x => x instanceof File);
        if (!files.length || files.length > 20 || files.some(file => !file.size || file.size > 25 * 1024 * 1024)) return json({ error: 'اختر حتى 20 ملفًا، بحد أقصى 25 ميغابايت لكل ملف' }, 400);
        let labels = []; try { labels = JSON.parse(String(form.get('labels') || '[]')); } catch { labels = []; }
        let materials = []; try { materials = JSON.parse(String(form.get('materials') || '[]')); } catch { materials = []; }
        if (!Array.isArray(materials) || materials.length > 20) return json({ error: 'قائمة الخامات غير صالحة' }, 400);
        materials = materials.map(row => ({ Material_ID: Number(row.Material_ID), Quantity: Number(row.Quantity) }));
        if (materials.some(row => !Number.isInteger(row.Material_ID) || row.Material_ID <= 0 || !Number.isFinite(row.Quantity) || row.Quantity <= 0)) return json({ error: 'حدد خامة وكمية صحيحة لكل مادة' }, 400);
        for (const row of materials) if (!(await env.DB.prepare('SELECT Material_ID FROM Inventory WHERE Material_ID=?').bind(row.Material_ID).first())) return json({ error: 'إحدى الخامات المحددة غير موجودة' }, 400);
        if (order.Quantity_Unit === 'قطعة' && !materials.length && !(await env.DB.prepare('SELECT ID FROM Order_Materials WHERE Task_ID=? LIMIT 1').bind(taskId).first())) return json({ error: 'حدد عدد الألواح المستهلكة للطلب بالقطع قبل إرساله إلى الليزر' }, 400);
        if (!materials.length && Number(order.Material_Qty) <= 0 && !(await env.DB.prepare('SELECT ID FROM Order_Materials WHERE Task_ID=? LIMIT 1').bind(taskId).first())) return json({ error: 'حدد كمية القص قبل رفع التصميم' }, 400);
        const staged = [];
        try {
          for (const [index, file] of files.entries()) {
            const key = `orders/task-${taskId}/${crypto.randomUUID()}-${cleanName(file.name)}`;
            await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type || 'application/octet-stream' } });
            staged.push({ key, file, label: String(labels[index] || '').slice(0, 200) });
          }
        } catch (error) {
          await Promise.allSettled(staged.map(item => env.FILES.delete(item.key)));
          return json({ error: 'تعذر تخزين الملفات. حاول مجددًا' }, 502);
        }
        const statements = [env.DB.prepare("UPDATE Order_Files SET Is_Current=0 WHERE Task_ID=? AND File_Type='design'").bind(taskId)];
        if (materials.length) {
          statements.push(env.DB.prepare('DELETE FROM Order_Materials WHERE Task_ID=?').bind(taskId));
          for (const material of materials) statements.push(env.DB.prepare('INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)').bind(taskId, material.Material_ID, material.Quantity));
        }
        for (const item of staged) statements.push(env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, 'design', 1, ?)").bind(taskId, item.file.name, item.key.split('/').at(-1), `r2://${item.key}`, item.file.size, item.label, a.user.User_ID));
        const last = staged.at(-1), note = String(form.get('notes') || '').trim().slice(0, 2000);
        statements.push(env.DB.prepare("UPDATE Orders SET File_Path=?, File_Name=?, Material_ID=COALESCE(?,Material_ID), Material_Qty=CASE WHEN Material_Qty<=0 THEN ? ELSE Material_Qty END, Notes=CASE WHEN ?='' THEN Notes ELSE COALESCE(Notes,'') || '\n' || ? END, Status='جاهز للقص', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?")
          .bind(`r2://${last.key}`, last.file.name, materials[0]?.Material_ID || null, materials.reduce((sum, row) => sum + row.Quantity, 0), note, note, taskId));
        let results;
        try { results = await env.DB.batch(statements); }
        catch (error) {
          await Promise.allSettled(staged.map(item => env.FILES.delete(item.key)));
          return json({ error: 'تعذر حفظ بيانات الملفات؛ لم يتغير الطلب' }, 500);
        }
        const insertOffset = materials.length ? 2 + materials.length : 1;
        const saved = staged.map((item, index) => ({ File_ID: results[insertOffset + index].meta.last_row_id, Original_Name: item.file.name, File_Path: `r2://${item.key}` }));
        await logAction(env, 'design_uploaded', a.user.User_ID, { taskId, fileCount: saved.length, materials });
        return json({ files: saved, count: saved.length });
      }
      if (action === 'download' && request.method === 'GET') {
        const file = await env.DB.prepare("SELECT * FROM Order_Files WHERE Task_ID=? AND File_Type!='image' AND COALESCE(Is_Current,1)=1 ORDER BY Created_At DESC LIMIT 1").bind(taskId).first(); if (!file?.File_Path?.startsWith('r2://')) return json({ error: 'لا يوجد ملف تصميم مخزن في R2 لهذا الطلب' }, 404);
        const object = await env.FILES.get(file.File_Path.slice(5)); if (!object) return json({ error: 'الملف غير موجود' }, 404);
        return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `attachment; filename="${cleanName(file.Original_Name)}"`, 'x-robots-tag': 'noindex, nofollow' } });
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
      return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType || 'application/octet-stream', 'content-disposition': `${inline ? 'inline' : 'attachment'}; filename="${cleanName(file.Original_Name)}"`, 'x-robots-tag': 'noindex, nofollow' } });
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
