import bcrypt from 'bcryptjs';

const PROFILE_STATUSES = new Set(['active', 'inactive', 'suspended']);
const COMMISSION_STATUSES = new Set(['pending', 'approved', 'paid', 'cancelled']);
const PAYOUT_STATUSES = new Set(['pending', 'processing', 'completed', 'failed', 'cancelled']);

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
  });
}

function pageOptions(url, defaultLimit = 20) {
  const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(defaultLimit), 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

function idOf(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function commissionRate(value, fallback = 0.1) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) return null;
  return parsed / 100;
}

async function agentExists(env, agentId) {
  return env.DB.prepare("SELECT User_ID FROM Users WHERE User_ID=? AND Role='Agent'").bind(agentId).first();
}

async function logActivity(env, agentId, action, entityType, entityId, details) {
  await env.DB.prepare('INSERT INTO Agent_Activity_Log (Agent_ID, Action, Entity_Type, Entity_ID, Details) VALUES (?, ?, ?, ?, ?)')
    .bind(agentId, action, entityType, entityId, JSON.stringify(details || {})).run();
}

async function listAgents(env, url) {
  const { page, limit, offset } = pageOptions(url);
  const search = String(url.searchParams.get('search') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim();
  if (status && !PROFILE_STATUSES.has(status)) return json({ error: 'حالة الوكيل غير صالحة' }, 400);
  const conditions = ["u.Role='Agent'"];
  const values = [];
  if (search) {
    conditions.push('(u.Name LIKE ? OR u.Username LIKE ?)');
    values.push(`%${search}%`, `%${search}%`);
  }
  if (status) { conditions.push("COALESCE(ap.Status,'active')=?"); values.push(status); }
  const where = `WHERE ${conditions.join(' AND ')}`;
  const sort = { oldest: 'u.Created_At ASC, u.User_ID ASC', revenue: 'Total_Revenue DESC, u.User_ID DESC', clients: 'Client_Count DESC, u.User_ID DESC' }[url.searchParams.get('sort')] || 'u.Created_At DESC, u.User_ID DESC';
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total FROM Users u LEFT JOIN Agent_Profiles ap ON ap.User_ID=u.User_ID ${where}`).bind(...values).first();
  const agents = (await env.DB.prepare(`SELECT u.User_ID, u.Name, u.Username, u.Created_At,
      ap.Phone, ap.Email, ap.Territory, COALESCE(ap.Commission_Rate,0.1) AS Commission_Rate, COALESCE(ap.Status,'active') AS Status, ap.Hired_Date,
      (SELECT COUNT(*) FROM Clients c WHERE c.Agent_ID=u.User_ID OR c.Created_By=u.User_ID) AS Client_Count,
      (SELECT COUNT(*) FROM Orders o WHERE o.Created_By=u.User_ID) AS Order_Count,
      (SELECT COALESCE(SUM(o.Final_Price),0) FROM Orders o WHERE o.Created_By=u.User_ID AND o.Approval_Status!='rejected') AS Total_Revenue,
      (SELECT COALESCE(SUM(o.Agent_Commission),0) FROM Orders o WHERE o.Created_By=u.User_ID AND o.Approval_Status!='rejected') AS Total_Commission,
      (SELECT COUNT(*) FROM Orders o WHERE o.Created_By=u.User_ID AND o.Approval_Status='pending') AS Pending_Orders
    FROM Users u LEFT JOIN Agent_Profiles ap ON ap.User_ID=u.User_ID ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`)
    .bind(...values, limit, offset).all()).results;
  const summary = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM Users WHERE Role='Agent') AS totalAgents,
      (SELECT COUNT(*) FROM Orders WHERE Created_By IN (SELECT User_ID FROM Users WHERE Role='Agent') AND strftime('%Y-%m',Created_At)=strftime('%Y-%m','now')) AS totalOrders,
      (SELECT COALESCE(SUM(Final_Price),0) FROM Orders WHERE Created_By IN (SELECT User_ID FROM Users WHERE Role='Agent') AND Approval_Status!='rejected' AND strftime('%Y-%m',Created_At)=strftime('%Y-%m','now')) AS totalRevenue,
      MAX(0,
        (SELECT COALESCE(SUM(Commission_Amount),0) FROM Agent_Commissions WHERE Status='approved') -
        (SELECT COALESCE(SUM(Amount),0) FROM Agent_Payouts WHERE Status='completed')
      ) AS totalCommission`).first();
  const total = Number(count?.total || 0);
  return json({ agents, total, page, pages: Math.ceil(total / limit), summary });
}

async function createAgent(request, env) {
  const body = await request.json().catch(() => ({}));
  const name = String(body.Name || '').trim().slice(0, 200);
  const username = String(body.Username || '').trim().slice(0, 100);
  const password = String(body.Password || '');
  const rate = commissionRate(body.Commission_Rate);
  const status = String(body.Status || 'active');
  if (!name || !username || password.length < 8) return json({ error: 'الاسم واسم المستخدم وكلمة مرور من 8 أحرف على الأقل مطلوبة' }, 400);
  if (rate === null || !PROFILE_STATUSES.has(status)) return json({ error: 'نسبة العمولة أو حالة الوكيل غير صالحة' }, 400);
  if (await env.DB.prepare('SELECT User_ID FROM Users WHERE Username=?').bind(username).first()) return json({ error: 'اسم المستخدم موجود مسبقًا' }, 409);
  const hash = await bcrypt.hash(password, 10);
  const created = await env.DB.prepare("INSERT INTO Users (Name, Role, Username, Password) VALUES (?, 'Agent', ?, ?)").bind(name, username, hash).run();
  const agentId = created.meta.last_row_id;
  try {
    await env.DB.prepare('INSERT INTO Agent_Profiles (User_ID, Phone, Email, Territory, Commission_Rate, Bank_Account, IBAN, Tax_Number, Status, Notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(agentId, String(body.Phone || ''), String(body.Email || ''), String(body.Territory || ''), rate,
        String(body.Bank_Account || ''), String(body.IBAN || ''), String(body.Tax_Number || ''), status, String(body.Notes || '')).run();
  } catch (error) {
    await env.DB.prepare("DELETE FROM Users WHERE User_ID=? AND Role='Agent'").bind(agentId).run();
    throw error;
  }
  await logActivity(env, agentId, 'agent_created', 'agent', agentId, { name, username });
  return json({ success: true, agent_id: agentId }, 201);
}

async function agentDetail(env, agentId) {
  const agent = await env.DB.prepare(`SELECT u.User_ID, u.Name, u.Username, u.Role, u.Created_At, ap.Agent_ID, ap.Phone, ap.Email, ap.Territory,
      COALESCE(ap.Commission_Rate,0.1) AS Commission_Rate, COALESCE(ap.Status,'active') AS Status, ap.Hired_Date,
      ap.Bank_Account, ap.IBAN, ap.Tax_Number, ap.Notes
    FROM Users u LEFT JOIN Agent_Profiles ap ON ap.User_ID=u.User_ID WHERE u.User_ID=? AND u.Role='Agent'`).bind(agentId).first();
  if (!agent) return json({ error: 'الوكيل غير موجود' }, 404);
  const stats = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM Clients WHERE Agent_ID=? OR Created_By=?) AS Client_Count,
      (SELECT COUNT(*) FROM Orders WHERE Created_By=?) AS Order_Count,
      (SELECT COALESCE(SUM(Final_Price),0) FROM Orders WHERE Created_By=? AND Approval_Status!='rejected') AS Total_Revenue,
      (SELECT COALESCE(SUM(Agent_Commission),0) FROM Orders WHERE Created_By=? AND Approval_Status!='rejected') AS Total_Commission,
      (SELECT COUNT(*) FROM Orders WHERE Created_By=? AND Approval_Status='pending') AS Pending_Orders,
      (SELECT COUNT(*) FROM Orders WHERE Created_By=? AND Approval_Status='approved') AS Approved_Orders,
      (SELECT COUNT(*) FROM Orders WHERE Created_By=? AND Approval_Status='rejected') AS Rejected_Orders,
      (SELECT COUNT(*) FROM Clients WHERE (Agent_ID=? OR Created_By=?) AND Created_At>=datetime('now','-30 days')) AS New_Clients`)
    .bind(agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId).first();
  const recentOrders = (await env.DB.prepare('SELECT o.*, c.Full_Name AS Client_Name FROM Orders o LEFT JOIN Clients c ON c.Client_ID=o.Client_ID WHERE o.Created_By=? ORDER BY o.Created_At DESC LIMIT 10').bind(agentId).all()).results;
  const recentClients = (await env.DB.prepare('SELECT * FROM Clients WHERE Agent_ID=? OR Created_By=? ORDER BY Created_At DESC LIMIT 10').bind(agentId, agentId).all()).results;
  return json({ agent, stats, recentOrders, recentClients });
}

async function updateAgent(request, env, agentId) {
  if (!await agentExists(env, agentId)) return json({ error: 'الوكيل غير موجود' }, 404);
  const body = await request.json().catch(() => ({}));
  const name = String(body.Name || '').trim().slice(0, 200);
  const username = String(body.Username || '').trim().slice(0, 100);
  const rate = commissionRate(body.Commission_Rate);
  const status = String(body.Status || 'active');
  if (!name || !username || rate === null || !PROFILE_STATUSES.has(status)) return json({ error: 'بيانات الوكيل غير صالحة' }, 400);
  const conflict = await env.DB.prepare('SELECT User_ID FROM Users WHERE Username=? AND User_ID<>?').bind(username, agentId).first();
  if (conflict) return json({ error: 'اسم المستخدم موجود مسبقًا' }, 409);
  const password = String(body.Password || '');
  if (password && password.length < 8) return json({ error: 'كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل' }, 400);
  if (password) await env.DB.prepare('UPDATE Users SET Name=?, Username=?, Password=? WHERE User_ID=?').bind(name, username, await bcrypt.hash(password, 10), agentId).run();
  else await env.DB.prepare('UPDATE Users SET Name=?, Username=? WHERE User_ID=?').bind(name, username, agentId).run();
  await env.DB.prepare(`INSERT INTO Agent_Profiles (User_ID, Phone, Email, Territory, Commission_Rate, Bank_Account, IBAN, Tax_Number, Status, Notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(User_ID) DO UPDATE SET Phone=excluded.Phone, Email=excluded.Email, Territory=excluded.Territory,
    Commission_Rate=excluded.Commission_Rate, Bank_Account=excluded.Bank_Account, IBAN=excluded.IBAN,
    Tax_Number=excluded.Tax_Number, Status=excluded.Status, Notes=excluded.Notes`)
    .bind(agentId, String(body.Phone || ''), String(body.Email || ''), String(body.Territory || ''), rate,
      String(body.Bank_Account || ''), String(body.IBAN || ''), String(body.Tax_Number || ''), status, String(body.Notes || '')).run();
  await logActivity(env, agentId, 'profile_updated', 'agent', agentId, { status });
  return json({ success: true });
}

async function deleteAgent(env, agentId) {
  if (!await agentExists(env, agentId)) return json({ error: 'الوكيل غير موجود' }, 404);
  const dependencies = await env.DB.prepare(`SELECT
    (SELECT COUNT(*) FROM Orders WHERE Created_By=?) +
    (SELECT COUNT(*) FROM Clients WHERE Agent_ID=? OR Created_By=?) +
    (SELECT COUNT(*) FROM Agent_Custom_Designs WHERE Agent_ID=?) +
    (SELECT COUNT(*) FROM Agent_Commissions WHERE Agent_ID=?) +
    (SELECT COUNT(*) FROM Agent_Payouts WHERE Agent_ID=?) AS count`).bind(agentId, agentId, agentId, agentId, agentId, agentId).first();
  if (Number(dependencies?.count || 0) > 0) {
    await env.DB.prepare("INSERT INTO Agent_Profiles (User_ID, Status) VALUES (?, 'inactive') ON CONFLICT(User_ID) DO UPDATE SET Status='inactive'").bind(agentId).run();
    await logActivity(env, agentId, 'agent_deactivated', 'agent', agentId, {});
    return json({ success: true, deactivated: true, message: 'تم تعطيل الوكيل لأن له سجلات سابقة' });
  }
  await env.DB.prepare('DELETE FROM Agent_Activity_Log WHERE Agent_ID=?').bind(agentId).run();
  await env.DB.prepare('DELETE FROM Agent_Stats WHERE Agent_ID=?').bind(agentId).run();
  await env.DB.prepare('DELETE FROM Agent_Profiles WHERE User_ID=?').bind(agentId).run();
  await env.DB.prepare("DELETE FROM Users WHERE User_ID=? AND Role='Agent'").bind(agentId).run();
  return json({ success: true, message: 'تم حذف الوكيل' });
}

async function pagedRows(env, url, from, where, values, select, order, resultKey) {
  const { page, limit, offset } = pageOptions(url);
  const count = await env.DB.prepare(`SELECT COUNT(*) AS total ${from} ${where}`).bind(...values).first();
  const rows = (await env.DB.prepare(`SELECT ${select} ${from} ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...values, limit, offset).all()).results;
  const total = Number(count?.total || 0);
  return json({ [resultKey]: rows, total, page, pages: Math.ceil(total / limit) });
}

async function agentStats(env, agentId, url) {
  const days = Math.min(365, Math.max(1, Number.parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const dailyStats = (await env.DB.prepare(`SELECT date(Created_At) AS date, COUNT(*) AS orders_count,
    COALESCE(SUM(Material_Qty),0) AS total_sheets, COALESCE(SUM(Final_Price),0) AS revenue,
    COALESCE(SUM(Agent_Commission),0) AS commission FROM Orders
    WHERE Created_By=? AND Created_At>=datetime('now',?) GROUP BY date(Created_At) ORDER BY date`)
    .bind(agentId, `-${days} days`).all()).results;
  const statusBreakdown = (await env.DB.prepare('SELECT Status, COUNT(*) AS count FROM Orders WHERE Created_By=? GROUP BY Status').bind(agentId).all()).results;
  const monthlyComparison = (await env.DB.prepare(`SELECT strftime('%Y-%m',Created_At) AS month, COUNT(*) AS orders,
    COALESCE(SUM(Final_Price),0) AS revenue, COALESCE(SUM(Agent_Commission),0) AS commission
    FROM Orders WHERE Created_By=? GROUP BY strftime('%Y-%m',Created_At) ORDER BY month DESC LIMIT 12`).bind(agentId).all()).results;
  const topClients = (await env.DB.prepare(`SELECT c.Client_ID, c.Full_Name, c.Phone_Number, COUNT(o.Task_ID) AS order_count,
    COALESCE(SUM(o.Final_Price),0) AS total_spent FROM Clients c LEFT JOIN Orders o ON o.Client_ID=c.Client_ID
    WHERE c.Agent_ID=? OR c.Created_By=? GROUP BY c.Client_ID ORDER BY total_spent DESC LIMIT 10`).bind(agentId, agentId).all()).results;
  return json({ dailyStats, statusBreakdown, monthlyComparison, topClients });
}

async function agentSubresource(request, env, user, agentId, action, url) {
  if (!await agentExists(env, agentId)) return json({ error: 'الوكيل غير موجود' }, 404);
  const search = String(url.searchParams.get('search') || '').trim();
  const status = String(url.searchParams.get('status') || '').trim();
  if (action === 'stats' && request.method === 'GET') return agentStats(env, agentId, url);
  if (action === 'clients' && request.method === 'GET') {
    const values = [agentId, agentId];
    const filter = search ? ' AND (c.Full_Name LIKE ? OR c.Phone_Number LIKE ?)' : '';
    if (search) values.push(`%${search}%`, `%${search}%`);
    return pagedRows(env, url, 'FROM Clients c', `WHERE (c.Agent_ID=? OR c.Created_By=?)${filter}`, values,
      'c.*, (SELECT COUNT(*) FROM Orders WHERE Client_ID=c.Client_ID) AS order_count, (SELECT COALESCE(SUM(Final_Price),0) FROM Orders WHERE Client_ID=c.Client_ID) AS total_spent',
      'c.Created_At DESC, c.Client_ID DESC', 'clients');
  }
  if (action === 'orders' && request.method === 'GET') {
    const values = [agentId];
    if (status) values.push(status);
    return pagedRows(env, url, 'FROM Orders o LEFT JOIN Clients c ON c.Client_ID=o.Client_ID', `WHERE o.Created_By=?${status ? ' AND o.Status=?' : ''}`, values,
      'o.*, c.Full_Name AS Client_Name', 'o.Created_At DESC, o.Task_ID DESC', 'orders');
  }
  if (action === 'commissions' && request.method === 'GET') {
    if (status && !COMMISSION_STATUSES.has(status)) return json({ error: 'حالة العمولة غير صالحة' }, 400);
    const values = [agentId];
    if (status) values.push(status);
    return pagedRows(env, url, 'FROM Agent_Commissions ac LEFT JOIN Orders o ON o.Task_ID=ac.Order_ID LEFT JOIN Clients c ON c.Client_ID=ac.Client_ID',
      `WHERE ac.Agent_ID=?${status ? ' AND ac.Status=?' : ''}`, values,
      'ac.*, o.Task_ID AS Linked_Order_ID, c.Full_Name AS Client_Name', 'ac.Calculated_At DESC, ac.Commission_ID DESC', 'commissions');
  }
  if (action === 'payouts' && request.method === 'GET') {
    if (status && !PAYOUT_STATUSES.has(status)) return json({ error: 'حالة الصرف غير صالحة' }, 400);
    const values = [agentId];
    if (status) values.push(status);
    const response = await pagedRows(env, url, 'FROM Agent_Payouts p', `WHERE p.Agent_ID=?${status ? ' AND p.Status=?' : ''}`, values,
      'p.*', 'p.Requested_At DESC, p.Payout_ID DESC', 'payouts');
    const data = await response.json();
    const summary = await env.DB.prepare("SELECT COALESCE(SUM(Amount),0) AS total FROM Agent_Payouts WHERE Agent_ID=? AND Status='completed'").bind(agentId).first();
    return json({ ...data, totalAmount: Number(summary?.total || 0) });
  }
  if (action === 'payouts' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const amount = Number(body.amount), start = String(body.period_start || ''), end = String(body.period_end || '');
    if (!Number.isFinite(amount) || amount <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end)
      return json({ error: 'المبلغ والفترة الزمنية الصحيحة مطلوبة' }, 400);
    const balance = await env.DB.prepare(`SELECT
      (SELECT COALESCE(SUM(Commission_Amount),0) FROM Agent_Commissions WHERE Agent_ID=? AND Status='approved') -
      (SELECT COALESCE(SUM(Amount),0) FROM Agent_Payouts WHERE Agent_ID=? AND Status='completed') AS due`)
      .bind(agentId, agentId).first();
    if (amount > Number(balance?.due || 0) + 0.000001) return json({ error: 'المبلغ أكبر من العمولات المستحقة المتبقية' }, 409);
    const result = await env.DB.prepare("INSERT INTO Agent_Payouts (Agent_ID, Amount, Period_Start, Period_End, Status, Payment_Method, Transaction_Ref, Processed_At, Processed_By, Notes) VALUES (?, ?, ?, ?, 'completed', ?, ?, CURRENT_TIMESTAMP, ?, ?)")
      .bind(agentId, amount, start, end, String(body.payment_method || ''), String(body.transaction_ref || ''), user.User_ID, String(body.notes || '')).run();
    await logActivity(env, agentId, 'payout_recorded', 'payout', result.meta.last_row_id, { amount });
    return json({ success: true, payout_id: result.meta.last_row_id }, 201);
  }
  if (action === 'activity' && request.method === 'GET') return pagedRows(env, url, 'FROM Agent_Activity_Log a', 'WHERE a.Agent_ID=?', [agentId], 'a.*', 'a.Created_At DESC, a.Log_ID DESC', 'activities');
  return json({ error: 'طريقة الطلب غير مسموحة' }, 405);
}

async function updateCommission(request, env, user, agentId, commissionId) {
  if (!await agentExists(env, agentId)) return json({ error: 'الوكيل غير موجود' }, 404);
  const commission = await env.DB.prepare('SELECT * FROM Agent_Commissions WHERE Commission_ID=? AND Agent_ID=?').bind(commissionId, agentId).first();
  if (!commission) return json({ error: 'العمولة غير موجودة لهذا الوكيل' }, 404);
  if (commission.Status !== 'pending') return json({ error: 'تمت معالجة هذه العمولة سابقًا' }, 409);
  const body = await request.json().catch(() => ({}));
  if (!['approve', 'reject'].includes(body.action)) return json({ error: 'إجراء غير صالح' }, 400);
  const notes = body.notes == null ? commission.Notes : String(body.notes).slice(0, 1000);
  if (body.action === 'approve') await env.DB.prepare("UPDATE Agent_Commissions SET Status='approved', Approved_At=CURRENT_TIMESTAMP, Approved_By=?, Notes=? WHERE Commission_ID=?").bind(user.User_ID, notes, commissionId).run();
  else await env.DB.prepare("UPDATE Agent_Commissions SET Status='cancelled', Notes=? WHERE Commission_ID=?").bind(notes, commissionId).run();
  await logActivity(env, agentId, `commission_${body.action}`, 'commission', commissionId, { notes });
  return json({ success: true });
}

export async function handleAgentsApi(request, env, user, path, url) {
  const collection = path === '/api/agents';
  const member = path.match(/^\/api\/agents\/(\d+)$/);
  const subresource = path.match(/^\/api\/agents\/(\d+)\/(stats|clients|orders|commissions|payouts|activity)$/);
  const commission = path.match(/^\/api\/agents\/(\d+)\/commissions\/(\d+)$/);
  if (!collection && !member && !subresource && !commission) return null;
  if (!user) return json({ error: 'غير مصرح', login: true }, 401);
  if (user.Role !== 'Admin') return json({ error: 'إدارة الوكلاء للمدير فقط' }, 403);
  try {
    if (collection) {
      if (request.method === 'GET') return await listAgents(env, url);
      if (request.method === 'POST') return await createAgent(request, env);
      return json({ error: 'طريقة الطلب غير مسموحة' }, 405, { allow: 'GET, POST' });
    }
    if (member) {
      const agentId = Number(member[1]);
      if (request.method === 'GET') return await agentDetail(env, agentId);
      if (request.method === 'PUT') return await updateAgent(request, env, agentId);
      if (request.method === 'DELETE') return await deleteAgent(env, agentId);
      return json({ error: 'طريقة الطلب غير مسموحة' }, 405, { allow: 'GET, PUT, DELETE' });
    }
    if (subresource) return await agentSubresource(request, env, user, Number(subresource[1]), subresource[2], url);
    if (commission) return request.method === 'PUT'
      ? await updateCommission(request, env, user, Number(commission[1]), Number(commission[2]))
      : json({ error: 'طريقة الطلب غير مسموحة' }, 405, { allow: 'PUT' });
    return null;
  } catch (error) {
    console.error('Agent management request failed:', error);
    return json({ error: 'تعذر إكمال عملية إدارة الوكلاء' }, 500);
  }
}
