const MAX_FILES = 10;
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const STATUSES = new Set(['pending', 'in_progress', 'completed', 'cancelled']);
const TERMINAL_ORDER_STATUSES = new Set(['تم الانتهاء من القص', 'تم التغليف', 'تم التسليم', 'مرفوض', 'ملغي', 'ملغى', 'completed', 'cancelled', 'rejected']);

function closedOrder(order) {
  return order.Approval_Status === 'rejected' || Boolean(order.Inventory_Deducted_At) || TERMINAL_ORDER_STATUSES.has(order.Status);
}

function agentOrderQuery() {
  return `SELECT o.* FROM Orders o JOIN Clients c ON c.Client_ID=o.Client_ID
    WHERE o.Task_ID=? AND o.Created_By=?
      AND (c.Agent_ID=? OR (c.Agent_ID IS NULL AND c.Created_By=?))`;
}

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', ...headers }
  });
}

function methodNotAllowed(allowed) {
  return json({ error: 'طريقة الطلب غير مسموحة' }, 405, { allow: allowed });
}

function pageOptions(url, defaultLimit = 20) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function positiveId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function safeName(value) {
  return String(value || 'file').replace(/[\r\n\\/"<>:|?*\u0000-\u001f]/g, '_').slice(0, 200) || 'file';
}

function storageName(value) {
  return safeName(value).replace(/[^\w.()-]/g, '_').slice(0, 140) || 'file';
}

function fileNameFromPath(path) {
  const basename = String(path || '').split('/').at(-1) || 'file';
  return basename.replace(/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}-/i, '') || basename;
}

function parseAttachments(row) {
  if (!row?.Image_Path) return [];
  let items;
  try { items = JSON.parse(row.Image_Path); }
  catch { items = row.Image_Path; }
  if (!Array.isArray(items)) items = [items];
  return items.map(item => {
    if (typeof item === 'string') return { path: item, name: fileNameFromPath(item), size: 0, type: '' };
    if (!item || typeof item !== 'object') return null;
    const path = String(item.path || item.File_Path || '');
    return { path, name: safeName(item.name || item.Original_Name || fileNameFromPath(path)), size: Number(item.size || 0), type: String(item.type || '') };
  }).filter(item => item?.path?.startsWith('r2://'));
}

function attachmentDisposition(name, download) {
  const filename = safeName(name);
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function myOrders(env, user, url) {
  const { page, limit, offset } = pageOptions(url, 50);
  const status = String(url.searchParams.get('status') || '').trim();
  const condition = status ? ' AND o.Status=?' : '';
  const values = status ? [user.User_ID, status] : [user.User_ID];
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM Orders o WHERE o.Created_By=?${condition}`).bind(...values).first();
  const orders = (await env.DB.prepare(`SELECT o.*, c.Full_Name AS Client_Name FROM Orders o LEFT JOIN Clients c ON c.Client_ID=o.Client_ID WHERE o.Created_By=?${condition} ORDER BY o.Created_At DESC, o.Task_ID DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all()).results;
  const total = Number(count?.total || 0);
  return json({ orders, total, page, pages: Math.ceil(total / limit) });
}

async function createCustomRequest(request, env, user) {
  const form = await request.formData();
  const name = String(form.get('name') || '').trim().slice(0, 200);
  const description = String(form.get('description') || '').trim().slice(0, 5000);
  if (!name) return json({ error: 'اسم التصميم مطلوب' }, 400);

  const orderValue = String(form.get('order_id') || '').trim();
  const orderId = orderValue ? positiveId(orderValue) : null;
  if (orderValue && !orderId) return json({ error: 'رقم الطلب المرتبط غير صالح' }, 400);
  if (orderId) {
    const ownOrder = await env.DB.prepare(agentOrderQuery()).bind(orderId, user.User_ID, user.User_ID, user.User_ID).first();
    if (!ownOrder) return json({ error: 'لا تملك الصلاحية لربط هذا الطلب' }, 403);
    if (closedOrder(ownOrder)) return json({ error: 'لا يمكن ربط تصميم مخصص بطلب منتهٍ أو مرفوض' }, 409);
  }

  const supplied = form.getAll('customDesignFiles');
  const files = supplied.filter(file => file instanceof File && file.name);
  if (supplied.length > MAX_FILES || files.length > MAX_FILES) return json({ error: 'الحد الأقصى 10 ملفات' }, 400);
  if (files.some(file => file.size === 0)) return json({ error: 'لا يمكن رفع ملف فارغ' }, 400);
  if (files.some(file => file.size > MAX_FILE_SIZE)) return json({ error: 'حجم الملف يتجاوز الحد المسموح (10MB)' }, 400);

  const attachments = [];
  try {
    for (const file of files) {
      const key = `custom-designs/${crypto.randomUUID()}-${storageName(file.name)}`;
      await env.FILES.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || 'application/octet-stream' },
        customMetadata: { originalName: safeName(file.name) }
      });
      attachments.push({ path: `r2://${key}`, name: safeName(file.name), size: file.size, type: file.type || 'application/octet-stream' });
    }
    const imagePath = attachments.length ? JSON.stringify(attachments) : null;
    const created = await env.DB.prepare('INSERT INTO Agent_Custom_Designs (Agent_ID, Order_ID, Name, Description, Image_Path, Thumbnail_Path) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(user.User_ID, orderId, name, description, imagePath, attachments[0]?.path || null).run();
    return json({ success: true, custom_design_id: created.meta.last_row_id, files: attachments.length }, 201);
  } catch (error) {
    await Promise.allSettled(attachments.map(file => env.FILES.delete(file.path.slice(5))));
    throw error;
  }
}

async function myCustomRequests(env, user, url) {
  const { page, limit, offset } = pageOptions(url, 50);
  const status = String(url.searchParams.get('status') || '').trim();
  if (status && !STATUSES.has(status)) return json({ error: 'حالة غير صالحة' }, 400);
  const clause = status ? ' AND c.Status=?' : '';
  const values = status ? [user.User_ID, status] : [user.User_ID];
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM Agent_Custom_Designs c WHERE c.Agent_ID=?${clause}`).bind(...values).first();
  const requests = (await env.DB.prepare(`SELECT c.* FROM Agent_Custom_Designs c WHERE c.Agent_ID=?${clause} ORDER BY c.Created_At DESC, c.Custom_Design_ID DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all()).results;
  const total = Number(count?.total || 0);
  return json({ requests, total, page, pages: Math.ceil(total / limit) });
}

async function adminCustomRequests(env, url) {
  const { page, limit, offset } = pageOptions(url);
  const status = String(url.searchParams.get('status') || '').trim();
  if (status && !STATUSES.has(status)) return json({ error: 'حالة غير صالحة' }, 400);
  const search = String(url.searchParams.get('search') || '').trim();
  const conditions = [];
  const values = [];
  if (status) { conditions.push('c.Status=?'); values.push(status); }
  if (search) { conditions.push('(c.Name LIKE ? OR u.Name LIKE ?)'); values.push(`%${search}%`, `%${search}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const from = `FROM Agent_Custom_Designs c JOIN Users u ON u.User_ID=c.Agent_ID LEFT JOIN Orders o ON o.Task_ID=c.Order_ID LEFT JOIN Clients cl ON cl.Client_ID=o.Client_ID ${where}`;
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...values).first();
  const requests = (await env.DB.prepare(`SELECT c.*, u.Name AS Agent_Name, u.Username AS Agent_Username, cl.Full_Name AS Client_Name ${from} ORDER BY c.Created_At DESC, c.Custom_Design_ID DESC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all()).results;
  const total = Number(count?.total || 0);
  return json({ requests, total, page, pages: Math.ceil(total / limit) });
}

async function listCustomFiles(env, requestId) {
  const item = await env.DB.prepare('SELECT Image_Path FROM Agent_Custom_Designs WHERE Custom_Design_ID=?').bind(requestId).first();
  if (!item) return json({ error: 'الطلب غير موجود' }, 404);
  const files = parseAttachments(item).map((file, index) => ({
    index,
    Original_Name: file.name,
    preview_url: `/api/agents/admin/custom-requests/${requestId}/files/${index}`,
    download_url: `/api/agents/admin/custom-requests/${requestId}/files/${index}?download=1`
  }));
  return json({ files });
}

async function readCustomFile(env, requestId, fileIndex, url) {
  const item = await env.DB.prepare('SELECT Image_Path FROM Agent_Custom_Designs WHERE Custom_Design_ID=?').bind(requestId).first();
  if (!item) return json({ error: 'الطلب غير موجود' }, 404);
  const file = parseAttachments(item)[fileIndex];
  if (!file) return json({ error: 'الملف غير موجود' }, 404);
  const object = await env.FILES.get(file.path.slice(5));
  if (!object) return json({ error: 'الملف غير موجود في التخزين' }, 404);
  const type = object.httpMetadata?.contentType || file.type || 'application/octet-stream';
  const safeInline = /^image\/(png|jpeg|gif|webp|avif|bmp)$/i.test(type);
  const download = url.searchParams.get('download') === '1' || !safeInline;
  return new Response(object.body, {
    headers: {
      'content-type': type,
      'content-disposition': attachmentDisposition(file.name, download),
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff'
    }
  });
}

async function attachCustomFiles(env, item, orderId) {
  for (const file of parseAttachments(item)) {
    const existing = await env.DB.prepare("SELECT File_ID FROM Order_Files WHERE Task_ID=? AND File_Path=? AND Upload_Type='agent_custom' LIMIT 1").bind(orderId, file.path).first();
    if (existing) continue;
    await env.DB.prepare("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, Label, File_Type, Upload_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, 'image', 'agent_custom', 1, ?)")
      .bind(orderId, `${item.Name} — ${file.name}`, fileNameFromPath(file.path), file.path, file.size, 'مرفق الطلب المخصص', item.Agent_ID).run();
  }
}

async function updateCustomStatus(request, env, requestId) {
  const body = await request.json().catch(() => ({}));
  const status = String(body.status || '');
  if (!STATUSES.has(status)) return json({ error: 'حالة غير صالحة' }, 400);
  const item = await env.DB.prepare('SELECT * FROM Agent_Custom_Designs WHERE Custom_Design_ID=?').bind(requestId).first();
  if (!item) return json({ error: 'الطلب غير موجود' }, 404);
  if (item.Status === status) return json({ success: true, order_id: item.Order_ID || null });

  if (status === 'in_progress') {
    if (item.Status !== 'pending') return json({ error: 'يمكن بدء تنفيذ طلب قيد الانتظار فقط' }, 409);
    const designerId = positiveId(body.designer_id);
    if (!designerId) return json({ error: 'اختر المصمم الذي سيستلم الطلب' }, 400);
    const designer = await env.DB.prepare("SELECT User_ID FROM Users WHERE User_ID=? AND Role='Designer'").bind(designerId).first();
    if (!designer) return json({ error: 'المصمم المختار غير موجود' }, 400);

    let orderId = positiveId(item.Order_ID);
    if (orderId) {
      const linked = await env.DB.prepare(agentOrderQuery()).bind(orderId, item.Agent_ID, item.Agent_ID, item.Agent_ID).first();
      if (!linked) return json({ error: 'الطلب المرتبط غير موجود أو لا يخص الوكيل' }, 400);
      if (closedOrder(linked)) return json({ error: 'لا يمكن بدء تنفيذ تصميم لطلب منتهٍ أو مرفوض' }, 409);
      await env.DB.prepare("UPDATE Orders SET Approval_Status='approved', Designer_ID=?, Status=CASE WHEN Status='بانتظار الموافقة' THEN 'قيد التصميم' ELSE Status END, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?").bind(designerId, orderId).run();
    } else {
      const clientId = positiveId(body.client_id);
      if (!clientId) return json({ error: 'اختر العميل لإنشاء طلب التصميم' }, 400);
      const client = await env.DB.prepare('SELECT Client_ID FROM Clients WHERE Client_ID=? AND (Agent_ID=? OR (Agent_ID IS NULL AND Created_By=?))').bind(clientId, item.Agent_ID, item.Agent_ID).first();
      if (!client) return json({ error: 'العميل المختار غير موجود أو لا يخص هذا الوكيل' }, 403);
      const machine = body.machine_type === 'Router' ? 'Router' : body.machine_type === 'Laser' ? 'Laser' : null;
      if (!machine) return json({ error: 'نوع الماكينة غير صالح' }, 400);
      const notes = `[تصميم مخصص] ${item.Name}${item.Description ? ` — ${item.Description}` : ''}`;
      const created = await env.DB.prepare("INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Notes) VALUES (?, ?, ?, ?, 'قيد التصميم', 'approved', ?)")
        .bind(clientId, designerId, item.Agent_ID, machine, notes).run();
      orderId = created.meta.last_row_id;
      await env.DB.prepare('UPDATE Agent_Custom_Designs SET Order_ID=? WHERE Custom_Design_ID=?').bind(orderId, requestId).run();
    }

    await attachCustomFiles(env, item, orderId);
    await env.DB.prepare("UPDATE Agent_Custom_Designs SET Status='in_progress', Designer_ID=?, Updated_At=CURRENT_TIMESTAMP WHERE Custom_Design_ID=?").bind(designerId, requestId).run();
    await env.DB.prepare("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, 'info')").bind(orderId, `طلب تصميم مخصص جديد بانتظارك (#${orderId})`).run();
    return json({ success: true, order_id: orderId });
  }

  if (status === 'completed' && item.Status !== 'in_progress') return json({ error: 'لا يمكن إتمام طلب لم يبدأ تنفيذه' }, 409);
  if (status === 'cancelled' && !['pending', 'in_progress'].includes(item.Status)) return json({ error: 'لا يمكن إلغاء هذا الطلب' }, 409);
  if (status === 'pending') return json({ error: 'لا يمكن إعادة الطلب إلى الانتظار' }, 409);
  const notes = body.notes == null ? item.Notes : String(body.notes).slice(0, 1000);
  await env.DB.prepare('UPDATE Agent_Custom_Designs SET Status=?, Notes=?, Updated_At=CURRENT_TIMESTAMP WHERE Custom_Design_ID=?').bind(status, notes, requestId).run();
  await env.DB.prepare("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, 'info')").bind(item.Order_ID || null, `تم تحديث طلب التصميم المخصص: ${status}`).run();
  return json({ success: true, order_id: item.Order_ID || null });
}

async function agentCustomOrders(env, url) {
  const { page, limit, offset } = pageOptions(url);
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM Order_Files WHERE Upload_Type='agent_custom'").first();
  const files = (await env.DB.prepare(`SELECT f.*, o.Status AS Order_Status, o.Agent_Price, o.Agent_Commission, o.Final_Price, c.Full_Name AS Client_Name, u.Name AS Agent_Name
    FROM Order_Files f JOIN Orders o ON o.Task_ID=f.Task_ID LEFT JOIN Clients c ON c.Client_ID=o.Client_ID LEFT JOIN Users u ON u.User_ID=o.Created_By
    WHERE f.Upload_Type='agent_custom' ORDER BY f.Created_At DESC, f.File_ID DESC LIMIT ? OFFSET ?`).bind(limit, offset).all()).results;
  const total = Number(count?.total || 0);
  return json({ files, total, page, pages: Math.ceil(total / limit) });
}

export async function handleCustomOrders(request, env, user, path, url) {
  const agentRoutes = new Set(['/api/agents/my/orders', '/api/agents/my/custom-design', '/api/agents/my/custom-designs']);
  const adminRoutes = new Set(['/api/agents/admin/custom-requests', '/api/agents/admin/agent-custom-orders']);
  const filesRoute = path.match(/^\/api\/agents\/admin\/custom-requests\/(\d+)\/files(?:\/(\d+))?$/);
  const statusRoute = path.match(/^\/api\/agents\/admin\/custom-requests\/(\d+)\/status$/);
  if (!agentRoutes.has(path) && !adminRoutes.has(path) && !filesRoute && !statusRoute) return null;
  if (!user) return json({ error: 'غير مصرح', login: true }, 401);
  if (agentRoutes.has(path) && user.Role !== 'Agent') return json({ error: 'هذا المسار للوكيل فقط' }, 403);
  if (!agentRoutes.has(path) && user.Role !== 'Admin') return json({ error: 'هذا المسار للمدير فقط' }, 403);

  try {
    if (path === '/api/agents/my/orders') return request.method === 'GET' ? await myOrders(env, user, url) : methodNotAllowed('GET');
    if (path === '/api/agents/my/custom-design') return request.method === 'POST' ? await createCustomRequest(request, env, user) : methodNotAllowed('POST');
    if (path === '/api/agents/my/custom-designs') return request.method === 'GET' ? await myCustomRequests(env, user, url) : methodNotAllowed('GET');
    if (path === '/api/agents/admin/custom-requests') return request.method === 'GET' ? await adminCustomRequests(env, url) : methodNotAllowed('GET');
    if (path === '/api/agents/admin/agent-custom-orders') return request.method === 'GET' ? await agentCustomOrders(env, url) : methodNotAllowed('GET');
    if (filesRoute) {
      if (request.method !== 'GET') return methodNotAllowed('GET');
      const id = Number(filesRoute[1]);
      return filesRoute[2] === undefined ? await listCustomFiles(env, id) : await readCustomFile(env, id, Number(filesRoute[2]), url);
    }
    if (statusRoute) return request.method === 'PUT' ? await updateCustomStatus(request, env, Number(statusRoute[1])) : methodNotAllowed('PUT');
    return null;
  } catch (error) {
    console.error('Custom orders request failed:', error);
    return json({ error: 'تعذر إكمال العملية. حاول مجددًا.' }, 500);
  }
}
