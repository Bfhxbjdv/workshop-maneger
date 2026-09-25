import bcrypt from 'bcryptjs';

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_THUMB_SIZE = 10 * 1024 * 1024;
const MAX_BATCH_FILES = 20;
const MAX_BATCH_BYTES = 80 * 1024 * 1024;
const UNLOCK_SECONDS = 60 * 60;

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

function idOf(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function safeName(value) {
  return String(value || 'design').replace(/[\r\n\\/"<>:|?*\u0000-\u001f]/g, '_').slice(0, 200) || 'design';
}

function storageName(value) {
  return safeName(value).replace(/[^\w.()-]/g, '_').slice(0, 140) || 'design';
}

function disposition(name, download) {
  const filename = safeName(name);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function mimeFor(name) {
  const ext = String(name || '').split('.').at(-1)?.toLowerCase();
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml',
    pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
    dxf: 'text/plain; charset=utf-8', plt: 'text/plain; charset=utf-8',
    cdr: 'application/octet-stream', ai: 'application/postscript', eps: 'application/postscript'
  })[ext] || 'application/octet-stream';
}

function customPermissions(user) {
  try { return JSON.parse(user?.Permissions || '{}'); }
  catch { return {}; }
}

function canManage(user) {
  return user?.Role === 'Admin' || (user?.Role === 'Custom' && customPermissions(user).admin === true);
}

function canUseOrders(user) {
  return canManage(user) || ['Designer', 'Agent'].includes(user?.Role) ||
    (user?.Role === 'Custom' && customPermissions(user).orders === true);
}

function canSeeUnrestrictedDesign(user) {
  return canManage(user) || user?.Role === 'Designer';
}

async function visibleDesign(env, user, id) {
  const design = await env.DB.prepare('SELECT d.*, u.Name AS Created_By_Name FROM Designs d LEFT JOIN Users u ON u.User_ID=d.CreatedBy WHERE d.Design_ID=?').bind(id).first();
  if (!design) return null;
  if (canManage(user)) return design;
  const permissions = await env.DB.prepare('SELECT COUNT(*) AS total FROM Design_Permissions WHERE Design_ID=?').bind(id).first();
  if (!Number(permissions?.total) && canSeeUnrestrictedDesign(user)) return design;
  const allowed = await env.DB.prepare('SELECT 1 AS allowed FROM Design_Permissions WHERE Design_ID=? AND User_ID=?').bind(id, user.User_ID).first();
  return allowed ? design : null;
}

function cookieValue(request, name) {
  const cookie = (request.headers.get('cookie') || '').split(';').map(part => part.trim()).find(part => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : '';
}

function base64Url(bytes) {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function unlockSignature(secret, userId, designId, expires) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${userId}:${designId}:${expires}`))));
}

async function unlocked(request, env, user, design) {
  if (!design.Password) return true;
  if (!env.SESSION_SECRET) return false;
  const value = cookieValue(request, `design_unlock_${design.Design_ID}`);
  const [expiresText, signature] = value.split('.');
  const expires = Number(expiresText);
  if (!Number.isSafeInteger(expires) || expires <= Math.floor(Date.now() / 1000) || !signature) return false;
  const expected = await unlockSignature(env.SESSION_SECRET, user.User_ID, design.Design_ID, expires);
  return signature === expected;
}

async function permittedUsers(env, ids) {
  const map = new Map(ids.map(id => [Number(id), []]));
  if (!ids.length) return map;
  for (let start = 0; start < ids.length; start += 100) {
    const chunk = ids.slice(start, start + 100);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = (await env.DB.prepare(`SELECT dp.Design_ID, u.User_ID, u.Name, u.Username FROM Design_Permissions dp JOIN Users u ON u.User_ID=dp.User_ID WHERE dp.Design_ID IN (${placeholders}) ORDER BY u.Name`).bind(...chunk).all()).results;
    for (const row of rows) map.get(Number(row.Design_ID))?.push({ User_ID: row.User_ID, Name: row.Name, Username: row.Username });
  }
  return map;
}

function publicDesign(design, users, needsPassword = false) {
  const { Password, ...safe } = design;
  return { ...safe, PasswordProtected: Boolean(Password), NeedsPassword: needsPassword, PermittedUsers: users || [] };
}

function visiblePermissions(user, users) {
  return canManage(user) ? users : users.filter(member => Number(member.User_ID) === Number(user.User_ID));
}

async function listDesigns(env, user) {
  const where = canManage(user) ? '' : canSeeUnrestrictedDesign(user)
    ? `WHERE NOT EXISTS(SELECT 1 FROM Design_Permissions dp WHERE dp.Design_ID=d.Design_ID)
      OR EXISTS(SELECT 1 FROM Design_Permissions dp WHERE dp.Design_ID=d.Design_ID AND dp.User_ID=?)`
    : 'WHERE EXISTS(SELECT 1 FROM Design_Permissions dp WHERE dp.Design_ID=d.Design_ID AND dp.User_ID=?)';
  const statement = env.DB.prepare(`SELECT d.*, u.Name AS Created_By_Name FROM Designs d LEFT JOIN Users u ON u.User_ID=d.CreatedBy ${where} ORDER BY d.CreatedAt DESC, d.Design_ID DESC LIMIT 5000`);
  const designs = (await (where ? statement.bind(user.User_ID) : statement).all()).results;
  const permissions = await permittedUsers(env, designs.map(design => Number(design.Design_ID)));
  return json(designs.map(design => publicDesign(design, visiblePermissions(user, permissions.get(Number(design.Design_ID)) || []))));
}

async function oneDesign(request, env, user, id) {
  const design = await visibleDesign(env, user, id);
  if (!design) return json({ error: 'التصميم غير موجود أو لا تملك الصلاحية' }, 404);
  const permissions = await permittedUsers(env, [id]);
  return json(publicDesign(design, visiblePermissions(user, permissions.get(id) || []), !await unlocked(request, env, user, design)));
}

async function streamDesign(request, env, user, id, action) {
  const design = await visibleDesign(env, user, id);
  if (!design) return json({ error: 'التصميم غير موجود أو لا تملك الصلاحية' }, 404);
  if (action !== 'thumbnail' && !await unlocked(request, env, user, design)) return json({ error: 'هذا الملف محمي بكلمة مرور', needsPassword: true }, 403);
  const path = action === 'thumbnail' ? design.ThumbnailPath : design.FilePath;
  if (!path?.startsWith('r2://')) return json({ error: 'الملف غير متاح في التخزين' }, 404);
  const object = await env.FILES.get(path.slice(5));
  if (!object) return json({ error: 'الملف غير موجود في التخزين' }, 404);
  const name = action === 'thumbnail' ? path.split('/').at(-1) : design.Original_Name;
  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType || mimeFor(name),
      'content-disposition': disposition(name, action === 'download'),
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      ...(String(name).toLowerCase().endsWith('.svg') ? { 'content-security-policy': 'sandbox' } : {})
    }
  });
}

async function verifyPassword(request, env, user, id) {
  const design = await visibleDesign(env, user, id);
  if (!design) return json({ error: 'التصميم غير موجود أو لا تملك الصلاحية' }, 404);
  if (!design.Password) return json({ success: true });
  const body = await request.json().catch(() => ({}));
  if (!await bcrypt.compare(String(body.Password || ''), design.Password)) return json({ error: 'كلمة المرور غير صحيحة' }, 403);
  if (!env.SESSION_SECRET) return json({ error: 'تعذر فتح التصميم حاليًا' }, 503);
  const expires = Math.floor(Date.now() / 1000) + UNLOCK_SECONDS;
  const signature = await unlockSignature(env.SESSION_SECRET, user.User_ID, id, expires);
  return json({ success: true }, 200, {
    'set-cookie': `design_unlock_${id}=${expires}.${signature}; Path=/api/designs; Max-Age=${UNLOCK_SECONDS}; HttpOnly; Secure; SameSite=Lax`
  });
}

async function removeUnreferencedObject(env, path) {
  if (!path?.startsWith('r2://')) return;
  const used = await env.DB.prepare(`SELECT
    EXISTS(SELECT 1 FROM Designs WHERE FilePath=? OR ThumbnailPath=?) OR
    EXISTS(SELECT 1 FROM Agent_Images WHERE File_Path=?) OR
    EXISTS(SELECT 1 FROM Order_Files WHERE File_Path=?) AS in_use`)
    .bind(path, path, path, path).first();
  if (!used?.in_use) await env.FILES.delete(path.slice(5));
}

async function updateDesign(request, env, user, id) {
  if (!canManage(user)) return json({ error: 'تعديل التصاميم للمدير فقط' }, 403);
  const design = await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(id).first();
  if (!design) return json({ error: 'التصميم غير موجود' }, 404);
  const form = await request.formData();
  const name = String(form.get('Name') || design.Name).trim().slice(0, 200);
  if (!name) return json({ error: 'اسم التصميم مطلوب' }, 400);
  const width = form.has('Width') ? Number(form.get('Width') || 0) : Number(design.Width || 0);
  const height = form.has('Height') ? Number(form.get('Height') || 0) : Number(design.Height || 0);
  if (![width, height].every(value => Number.isFinite(value) && value >= 0)) return json({ error: 'الأبعاد غير صالحة' }, 400);
  const thumbnail = form.get('thumbnail');
  if (thumbnail instanceof File && thumbnail.size && (!thumbnail.type.startsWith('image/') || thumbnail.size > MAX_THUMB_SIZE)) return json({ error: 'الصورة المصغرة يجب أن تكون صورة أصغر من 10 ميغابايت' }, 400);
  let thumbnailPath = design.ThumbnailPath;
  let newThumbnailPath = null;
  if (thumbnail instanceof File && thumbnail.size) {
    const key = `design-thumbnails/${crypto.randomUUID()}-${storageName(thumbnail.name)}`;
    await env.FILES.put(key, thumbnail.stream(), { httpMetadata: { contentType: thumbnail.type } });
    newThumbnailPath = thumbnailPath = `r2://${key}`;
  }
  let password = design.Password;
  if (String(form.get('ClearPassword') || '') === '1') password = null;
  else if (String(form.get('Password') || '')) password = await bcrypt.hash(String(form.get('Password')), 12);
  try {
    await env.DB.prepare(`UPDATE Designs SET Name=?, Category=?, Material=?, Thickness=?, Width=?, Height=?, Unit=?, Notes=?, ThumbnailPath=?, Password=? WHERE Design_ID=?`)
      .bind(name, String(form.get('Category') ?? design.Category ?? '').slice(0, 200), String(form.get('Material') ?? design.Material ?? '').slice(0, 200),
        String(form.get('Thickness') ?? design.Thickness ?? '').slice(0, 100), width, height,
        String(form.get('Unit') || design.Unit || 'سم').slice(0, 30), String(form.get('Notes') ?? design.Notes ?? '').slice(0, 5000),
        thumbnailPath, password, id).run();
  } catch (error) {
    if (newThumbnailPath) await env.FILES.delete(newThumbnailPath.slice(5));
    throw error;
  }
  if (newThumbnailPath && design.ThumbnailPath) {
    try { await removeUnreferencedObject(env, design.ThumbnailPath); } catch {}
  }
  return json({ success: true });
}

async function deleteDesign(env, user, id) {
  if (!canManage(user)) return json({ error: 'حذف التصاميم للمدير فقط' }, 403);
  const design = await env.DB.prepare('SELECT * FROM Designs WHERE Design_ID=?').bind(id).first();
  if (!design) return json({ error: 'التصميم غير موجود' }, 404);
  const linked = await env.DB.prepare('SELECT Image_ID FROM Agent_Images WHERE Design_ID=? LIMIT 1').bind(id).first();
  if (linked) return json({ error: 'فك ارتباط صور المكتبة بهذا التصميم قبل حذفه' }, 409);
  await env.DB.prepare('DELETE FROM Designs WHERE Design_ID=?').bind(id).run();
  try { await removeUnreferencedObject(env, design.FilePath); } catch {}
  try { await removeUnreferencedObject(env, design.ThumbnailPath); } catch {}
  return json({ success: true });
}

async function setPermissions(request, env, user, id) {
  if (!canManage(user)) return json({ error: 'إدارة صلاحيات التصاميم للمدير فقط' }, 403);
  const design = await env.DB.prepare('SELECT Design_ID FROM Designs WHERE Design_ID=?').bind(id).first();
  if (!design) return json({ error: 'التصميم غير موجود' }, 404);
  const body = await request.json().catch(() => ({}));
  if (!Array.isArray(body.userIds) || body.userIds.length > 200) return json({ error: 'قائمة المستخدمين غير صالحة' }, 400);
  const ids = [...new Set(body.userIds.map(idOf))];
  if (ids.includes(null)) return json({ error: 'أحد المستخدمين غير صالح' }, 400);
  for (const userId of ids) {
    if (!await env.DB.prepare('SELECT User_ID FROM Users WHERE User_ID=?').bind(userId).first()) return json({ error: 'أحد المستخدمين غير موجود' }, 400);
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM Design_Permissions WHERE Design_ID=?').bind(id),
    ...ids.map(userId => env.DB.prepare('INSERT INTO Design_Permissions (Design_ID, User_ID) VALUES (?, ?)').bind(id, userId))
  ]);
  return json({ success: true });
}

async function createBatch(request, env, user) {
  if (!canManage(user)) return json({ error: 'الرفع الجماعي للمدير فقط' }, 403);
  const form = await request.formData();
  const supplied = form.getAll('files');
  const files = supplied.filter(file => file instanceof File);
  if (!files.length || files.length !== supplied.length || files.length > MAX_BATCH_FILES) return json({ error: 'اختر من 1 إلى 20 ملفًا' }, 400);
  if (files.some(file => !file.size || file.size > MAX_FILE_SIZE)) return json({ error: 'حجم أحد الملفات يتجاوز 25 ميغابايت أو الملف فارغ' }, 400);
  if (files.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) return json({ error: 'قسّم الملفات إلى دفعات أصغر من 80 ميغابايت' }, 413);
  let items, thumbIndexes;
  try {
    items = JSON.parse(String(form.get('items') || '[]'));
    thumbIndexes = JSON.parse(String(form.get('thumbIndexes') || '[]'));
  } catch { return json({ error: 'بيانات الملفات غير صالحة' }, 400); }
  if (!Array.isArray(items) || items.length !== files.length || !Array.isArray(thumbIndexes)) return json({ error: 'بيانات الملفات غير مكتملة' }, 400);
  const thumbs = form.getAll('thumbs').filter(file => file instanceof File);
  if (thumbs.length !== thumbIndexes.length || thumbs.some(file => !file.type.startsWith('image/') || file.size > MAX_THUMB_SIZE)) return json({ error: 'الصور المصغرة غير صالحة' }, 400);
  if (thumbIndexes.some(index => !Number.isInteger(index) || index < 0 || index >= files.length) || new Set(thumbIndexes).size !== thumbIndexes.length) return json({ error: 'ترتيب الصور المصغرة غير صالح' }, 400);
  const thumbByIndex = new Map(thumbIndexes.map((index, position) => [index, thumbs[position]]));
  const created = [], errors = [];
  for (const [index, file] of files.entries()) {
    const item = items[index] || {};
    const name = String(item.Name || '').trim().slice(0, 200);
    if (!name) { errors.push(`الملف ${index + 1}: الاسم مطلوب`); continue; }
    const paths = [];
    try {
      const fileKey = `designs/${crypto.randomUUID()}-${storageName(file.name)}`;
      await env.FILES.put(fileKey, file.stream(), { httpMetadata: { contentType: file.type || mimeFor(file.name) } });
      paths.push(`r2://${fileKey}`);
      const thumb = thumbByIndex.get(index);
      if (thumb) {
        const thumbKey = `design-thumbnails/${crypto.randomUUID()}-${storageName(thumb.name)}`;
        await env.FILES.put(thumbKey, thumb.stream(), { httpMetadata: { contentType: thumb.type } });
        paths.push(`r2://${thumbKey}`);
      }
      const password = String(item.Password || '');
      const result = await env.DB.prepare('INSERT INTO Designs (Name, Category, Material, Thickness, Width, Height, Unit, Notes, FilePath, Original_Name, ThumbnailPath, Password, CreatedBy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(name, String(item.Category || '').slice(0, 200), String(item.Material || '').slice(0, 200), String(item.Thickness || '').slice(0, 100),
          0, 0, 'سم', String(item.Notes || '').slice(0, 5000), paths[0], file.name, paths[1] || null,
          password ? await bcrypt.hash(password, 12) : null, user.User_ID).run();
      created.push(result.meta.last_row_id);
    } catch (error) {
      errors.push(`الملف ${index + 1}: تعذر التخزين أو الحفظ`);
      await Promise.allSettled(paths.map(path => env.FILES.delete(path.slice(5))));
    }
  }
  if (!created.length) return json({ error: errors.join(' | ') || 'فشل رفع أي ملف' }, 400);
  return json({ success: true, created, count: created.length, errors: errors.slice(0, 5) }, 201);
}

function mayModifyOrder(user, order) {
  if (canManage(user)) return true;
  if (user.Role === 'Designer') return Number(order.Designer_ID) === Number(user.User_ID);
  if (user.Role === 'Agent') return Number(order.Created_By) === Number(user.User_ID);
  return false;
}

async function addToOrder(request, env, user, id) {
  if (!canUseOrders(user)) return json({ error: 'لا تملك صلاحية الطلبات' }, 403);
  const design = await visibleDesign(env, user, id);
  if (!design) return json({ error: 'التصميم غير موجود أو لا تملك الصلاحية' }, 404);
  if (!await unlocked(request, env, user, design)) return json({ error: 'هذا الملف محمي بكلمة مرور', needsPassword: true }, 403);
  if (!design.FilePath?.startsWith('r2://')) return json({ error: 'ملف التصميم غير متاح' }, 404);
  const object = await env.FILES.head(design.FilePath.slice(5));
  if (!object) return json({ error: 'ملف التصميم غير موجود في التخزين' }, 404);
  const body = await request.json().catch(() => ({}));
  const clientId = idOf(body.Client_ID), taskId = body.Task_ID ? idOf(body.Task_ID) : null;
  if (!clientId || body.Task_ID && !taskId) return json({ error: 'حدد العميل والطلب بصورة صحيحة' }, 400);
  const client = await env.DB.prepare('SELECT Client_ID, Full_Name, Created_By FROM Clients WHERE Client_ID=?').bind(clientId).first();
  if (!client) return json({ error: 'العميل غير موجود' }, 404);
  if (user.Role === 'Agent' && Number(client.Created_By) !== Number(user.User_ID)) return json({ error: 'لا تملك صلاحية هذا العميل' }, 403);

  let order = taskId ? await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(taskId).first() : null;
  if (taskId && (!order || !mayModifyOrder(user, order) || Number(order.Client_ID) !== clientId)) return json({ error: 'الطلب غير موجود أو لا تملك صلاحيته' }, 404);
  if (order && (order.Inventory_Deducted_At || !['قيد التصميم', 'جاهز للقص', 'بانتظار الموافقة'].includes(order.Status))) return json({ error: 'لا يمكن إضافة تصميم إلى طلب بدأ قصه أو انتهى' }, 409);
  let createdTaskId = null;
  if (!order) {
    if (!['Laser', 'Router'].includes(body.Machine_Type)) return json({ error: 'اختر نوع الماكينة' }, 400);
    let designerId = user.Role === 'Designer' ? user.User_ID : null;
    if (canManage(user) && body.Designer_ID) {
      const requestedDesigner = await env.DB.prepare("SELECT User_ID FROM Users WHERE User_ID=? AND Role IN ('Designer','Admin')").bind(idOf(body.Designer_ID)).first();
      if (!requestedDesigner) return json({ error: 'المصمم المختار غير صالح' }, 400);
      designerId = requestedDesigner.User_ID;
    }
    const pending = user.Role === 'Agent';
    const result = await env.DB.prepare('INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Material_Qty, Quantity_Unit, Notes) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(clientId, designerId, user.User_ID, body.Machine_Type, pending ? 'بانتظار الموافقة' : 'قيد التصميم', pending ? 'pending' : 'approved', 'لوح', `إضافة تصميم: ${design.Name}`).run();
    createdTaskId = result.meta.last_row_id;
    order = await env.DB.prepare('SELECT * FROM Orders WHERE Task_ID=?').bind(createdTaskId).first();
  }

  const existing = await env.DB.prepare("SELECT File_ID FROM Order_Files WHERE Task_ID=? AND File_Type='design' AND File_Path=? AND COALESCE(Is_Current,1)=1 LIMIT 1")
    .bind(order.Task_ID, design.FilePath).first();
  if (existing) return json({ success: true, File_ID: existing.File_ID, Task_ID: order.Task_ID, Client_Name: client.Full_Name });

  const materialCount = await env.DB.prepare('SELECT COUNT(*) AS total FROM Order_Materials WHERE Task_ID=? AND Quantity>0').bind(order.Task_ID).first();
  const hasCutQuantity = Number(materialCount?.total) > 0 || order.Quantity_Unit === 'لوح' && Number(order.Material_Qty) > 0 && !!order.Material_ID;
  const nextStatus = order.Approval_Status === 'approved' && hasCutQuantity ? 'جاهز للقص' : order.Status;
  const fileName = safeName(design.Original_Name);
  try {
    const result = await env.DB.batch([
      env.DB.prepare("UPDATE Order_Files SET Is_Current=0 WHERE Task_ID=? AND File_Type='design'").bind(order.Task_ID),
      env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, 'design', 1, ?)")
        .bind(order.Task_ID, fileName, storageName(fileName), design.FilePath, Number(object.size || 0), `تصميم جاهز: ${design.Name}`, user.User_ID),
      env.DB.prepare('UPDATE Orders SET File_Path=?, File_Name=?, Status=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?')
        .bind(design.FilePath, fileName, nextStatus, order.Task_ID)
    ]);
    return json({ success: true, File_ID: result[1].meta.last_row_id, Task_ID: order.Task_ID, Client_Name: client.Full_Name });
  } catch (error) {
    if (createdTaskId) await env.DB.prepare('DELETE FROM Orders WHERE Task_ID=?').bind(createdTaskId).run();
    throw error;
  }
}

/** Return null for paths owned by worker.mjs, especially POST /api/designs. */
export async function handleDesignsApi(request, env, user) {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/designs')) return null;
  const method = request.method;
  const handled = pathname === '/api/designs' && method === 'GET' ||
    pathname === '/api/designs/batch' && method === 'POST' ||
    /^\/api\/designs\/\d+(?:\/(?:file|thumbnail|download|permissions|verify-password|add-to-order))?$/.test(pathname);
  if (!handled || pathname === '/api/designs' && method === 'POST') return null;
  if (!user) return json({ error: 'غير مصرح', login: true }, 401);

  if (pathname === '/api/designs') return method === 'GET' ? listDesigns(env, user) : null;
  if (pathname === '/api/designs/batch') return method === 'POST' ? createBatch(request, env, user) : json({ error: 'طريقة الطلب غير مسموحة' }, 405);
  const match = pathname.match(/^\/api\/designs\/(\d+)(?:\/(file|thumbnail|download|permissions|verify-password|add-to-order))?$/);
  if (!match) return null;
  const id = idOf(match[1]), action = match[2] || '';
  if (!id) return json({ error: 'رقم التصميم غير صالح' }, 400);
  if (!action) {
    if (method === 'GET') return oneDesign(request, env, user, id);
    if (method === 'PUT') return updateDesign(request, env, user, id);
    if (method === 'DELETE') return deleteDesign(env, user, id);
  }
  if (['file', 'thumbnail', 'download'].includes(action) && method === 'GET') return streamDesign(request, env, user, id, action);
  if (action === 'permissions' && method === 'POST') return setPermissions(request, env, user, id);
  if (action === 'verify-password' && method === 'POST') return verifyPassword(request, env, user, id);
  if (action === 'add-to-order' && method === 'POST') return addToOrder(request, env, user, id);
  return json({ error: 'طريقة الطلب غير مسموحة' }, 405);
}
