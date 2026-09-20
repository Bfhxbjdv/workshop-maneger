const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const bcrypt = require('bcryptjs');
const { requireAuth, requirePermission, hasPermission } = require('../middleware/auth');

// ==================== Helper Functions ====================

function logActivity(agentId, action, entityType, entityId, details, req) {
  try {
    db.run(
      `INSERT INTO Agent_Activity_Log (Agent_ID, Action, Entity_Type, Entity_ID, Details, IP_Address, User_Agent)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [agentId, action, entityType, entityId, JSON.stringify(details), 
       req.ip, req.headers['user-agent'] || '']
    );
  } catch (e) { console.error('Log activity error:', e); }
}

function calculateAgentCommission(order, clientPricing) {
  if (!clientPricing) return 0;
  return (clientPricing.Final_Price - clientPricing.Agent_Price) * (order.Material_Qty || 1);
}

// ==================== Admin: Agent Management ====================

// List all agents with summary stats
router.get('/', requireAuth(['Admin']), (req, res) => {
  try {
    const agents = db.all(`
      SELECT u.User_ID, u.Name, u.Username, u.Role, u.Created_At,
             ap.Phone, ap.Email, ap.Territory, ap.Commission_Rate, ap.Status, ap.Hired_Date,
             (SELECT COUNT(*) FROM Clients WHERE Agent_ID = u.User_ID) as Client_Count,
             (SELECT COUNT(*) FROM Orders WHERE Created_By = u.User_ID) as Order_Count,
             (SELECT COALESCE(SUM(Final_Price * Material_Qty), 0) FROM Orders WHERE Created_By = u.User_ID) as Total_Revenue,
             (SELECT COALESCE(SUM(Agent_Commission * Material_Qty), 0) FROM Orders WHERE Created_By = u.User_ID) as Total_Commission,
             (SELECT COUNT(*) FROM Orders WHERE Created_By = u.User_ID AND Status = 'بانتظار الموافقة') as Pending_Orders
      FROM Users u
      LEFT JOIN Agent_Profiles ap ON u.User_ID = ap.User_ID
      WHERE u.Role = 'Agent'
      ORDER BY u.Created_At DESC
    `);
    res.json({ agents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Agent Self-Service APIs ====================
// These MUST come before /:id routes to avoid route conflicts

// Agent: My Stats
router.get('/my/stats', requireAuth(['Agent']), (req, res) => {
  try {
    const agentId = req.session.userId;
    const days = parseInt(req.query.days) || 30;
    
    const summary = db.get(`
      SELECT 
        (SELECT COUNT(*) FROM Clients WHERE Agent_ID = ?) as Client_Count,
        (SELECT COUNT(*) FROM Orders WHERE Created_By = ?) as Order_Count,
        (SELECT COALESCE(SUM(Final_Price * Material_Qty), 0) FROM Orders WHERE Created_By = ?) as Total_Revenue,
        (SELECT COALESCE(SUM(Agent_Commission * Material_Qty), 0) FROM Orders WHERE Created_By = ?) as Total_Commission,
        (SELECT COUNT(*) FROM Orders WHERE Created_By = ? AND Status = 'بانتظار الموافقة') as Pending_Orders,
        (SELECT COUNT(*) FROM Orders WHERE Created_By = ? AND Approval_Status = 'approved') as Approved_Orders,
        (SELECT COALESCE(SUM(Commission_Amount), 0) FROM Agent_Commissions WHERE Agent_ID = ? AND Status = 'approved') as Total_Approved_Commission,
        (SELECT COALESCE(SUM(Commission_Amount), 0) FROM Agent_Commissions WHERE Agent_ID = ? AND Status = 'paid') as Total_Paid_Commission,
        (SELECT COALESCE(SUM(Commission_Amount), 0) FROM Agent_Commissions WHERE Agent_ID = ? AND Status = 'pending') as Pending_Commission
    `, [req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId]);
    
    // Daily chart data
    const dailyStats = db.all(`
      SELECT 
        date(Created_At) as date,
        COUNT(*) as orders_count,
        COALESCE(SUM(Material_Qty), 0) as total_sheets,
        COALESCE(SUM(Final_Price * Material_Qty), 0) as revenue,
        COALESCE(SUM(Agent_Commission * Material_Qty), 0) as commission
      FROM Orders
      WHERE Created_By = ? AND Created_At >= date('now', '-30 days')
      GROUP BY date(Created_At)
      ORDER BY date
    `, [req.session.userId]);
    
    // Status breakdown
    const statusBreakdown = db.all(`
      SELECT Status, COUNT(*) as count
      FROM Orders
      WHERE Created_By = ?
      GROUP BY Status
    `, [req.session.userId]);
    
    res.json({ summary, dailyStats, statusBreakdown });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: My Clients
router.get('/my/clients', requireAuth(['Agent']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    
    let where = 'WHERE c.Agent_ID = ?';
    let params = [req.session.userId];
    
    if (search) {
      where += ' AND (c.Full_Name LIKE ? OR c.Phone_Number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Clients c ${where}`, params);
    const clients = db.all(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM Orders WHERE Client_ID = c.Client_ID) as order_count,
             (SELECT COALESCE(SUM(Final_Price * Material_Qty), 0) FROM Orders WHERE Client_ID = c.Client_ID) as total_spent
      FROM Clients c
      ${where}
      ORDER BY c.Created_At DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ clients, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: Add Client (creates client assigned to this agent)
router.post('/my/clients', requireAuth(['Agent']), (req, res) => {
  try {
    const { Full_Name, Phone_Number, Notes } = req.body;
    if (!Full_Name) return res.status(400).json({ error: 'اسم العميل مطلوب' });
    
    const result = db.run(
      "INSERT INTO Clients (Full_Name, Phone_Number, Notes, Agent_ID, Source) VALUES (?, ?, ?, ?, 'agent')",
      [Full_Name, Phone_Number || '', Notes || '', req.session.userId]
    );
    
    const client = db.get("SELECT * FROM Clients WHERE Client_ID = ?", [result.lastId]);
    logActivity(req.session.userId, 'client_added', 'client', result.lastId, { Full_Name }, req);
    res.json({ success: true, client });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: My Orders
router.get('/my/orders', requireAuth(['Agent']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    
    let where = 'WHERE o.Created_By = ?';
    let params = [req.session.userId];
    
    if (status) {
      where += ' AND o.Status = ?';
      params.push(status);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Orders o ${where}`, params);
    const orders = db.all(`
      SELECT o.*, c.Full_Name as Client_Name
      FROM Orders o
      LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
      ${where}
      ORDER BY o.Created_At DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ orders, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: My Commissions
router.get('/my/commissions', requireAuth(['Agent']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    
    let where = 'WHERE c.Agent_ID = ?';
    let params = [req.session.userId];
    
    if (status) {
      where += ' AND c.Status = ?';
      params.push(status);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Agent_Commissions c ${where}`, params);
    const commissions = db.all(`
      SELECT c.*, o.Task_ID as Order_ID, cl.Full_Name as Client_Name
      FROM Agent_Commissions c
      LEFT JOIN Orders o ON c.Order_ID = o.Task_ID
      LEFT JOIN Clients cl ON c.Client_ID = cl.Client_ID
      ${where}
      ORDER BY c.Calculated_At DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ commissions, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: Request Payout
router.post('/my/request-payout', requireAuth(['Agent']), (req, res) => {
  try {
    const { period_start, period_end, notes } = req.body;
    if (!period_start || !period_end) {
      return res.status(400).json({ error: 'تاريخ البداية والنهاية مطلوبان' });
    }
    
    // Calculate total approved unpaid commission
    const total = db.get(`
      SELECT COALESCE(SUM(Commission_Amount), 0) as total
      FROM Agent_Commissions
      WHERE Agent_ID = ? AND Status = 'approved'
    `, [req.session.userId]);
    
    if (total.total <= 0) {
      return res.status(400).json({ error: 'لا توجد عمولات مستحقة للصرف' });
    }
    
    const result = db.run(
      `INSERT INTO Agent_Payouts (Agent_ID, Amount, Period_Start, Period_End, Notes, Status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [req.session.userId, total.total, period_start, period_end, notes || '']
    );
    
    logActivity(req.session.userId, 'payout_requested', 'payout', result.lastId, { amount: total.total }, req);
    res.json({ success: true, payout_id: result.lastId, amount: total.total });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: My Payouts
router.get('/my/payouts', requireAuth(['Agent']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    
    let where = 'WHERE p.Agent_ID = ?';
    let params = [req.session.userId];
    
    if (status) {
      where += ' AND p.Status = ?';
      params.push(status);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Agent_Payouts p ${where}`, params);
    const payouts = db.all(
      `SELECT * FROM Agent_Payouts p ${where} ORDER BY p.Requested_At DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    
    res.json({ payouts, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: My Activity
router.get('/my/activity', requireAuth(['Agent']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const countRow = db.get("SELECT COUNT(*) as total FROM Agent_Activity_Log WHERE Agent_ID = ?", [req.session.userId]);
    const activities = db.all(
      "SELECT * FROM Agent_Activity_Log WHERE Agent_ID = ? ORDER BY Created_At DESC LIMIT ? OFFSET ?",
      [req.session.userId, limit, offset]
    );
    
    res.json({ activities, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: My Profile
router.get('/my/profile', requireAuth(['Agent']), (req, res) => {
  try {
    const agent = db.get(`
      SELECT u.*, ap.*
      FROM Users u
      LEFT JOIN Agent_Profiles ap ON u.User_ID = ap.User_ID
      WHERE u.User_ID = ?
    `, [req.session.userId]);
    
    if (!agent) return res.status(404).json({ error: 'الملف الشخصي غير موجود' });
    res.json({ agent });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/my/profile', requireAuth(['Agent']), (req, res) => {
  try {
    const { Name, Phone, Email, Territory, Bank_Account, IBAN, Tax_Number } = req.body;
    
    if (Name) db.run("UPDATE Users SET Name = ? WHERE User_ID = ?", [Name, req.session.userId]);
    
    db.run(
      `UPDATE Agent_Profiles SET 
        Phone = COALESCE(?, Phone),
        Email = COALESCE(?, Email),
        Territory = COALESCE(?, Territory),
        Bank_Account = COALESCE(?, Bank_Account),
        IBAN = COALESCE(?, IBAN),
        Tax_Number = COALESCE(?, Tax_Number)
       WHERE User_ID = ?`,
      [Phone || null, Email || null, Territory || null, Bank_Account || null, IBAN || null, Tax_Number || null, req.session.userId]
    );
    
    logActivity(req.session.userId, 'profile_updated', 'agent', req.session.userId, req.body, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: Get available pricing for orders
router.get('/my/pricing', requireAuth(['Agent']), (req, res) => {
  try {
    const clientIds = db.all("SELECT Client_ID FROM Clients WHERE Agent_ID = ?", [req.session.userId]).map(c => c.Client_ID);
    if (!clientIds.length) {
      return res.json({ pricing: [] });
    }
    const placeholders = clientIds.map(() => '?').join(',');
    const pricing = db.all(`
      SELECT DISTINCT pp.*, cp.Agent_Price, cp.Agent_Commission, cp.Final_Price, c.Full_Name as Client_Name
      FROM Product_Pricing pp
      JOIN Client_Pricing cp ON pp.Pricing_ID = cp.Pricing_ID
      JOIN Clients c ON cp.Client_ID = c.Client_ID
      WHERE pp.Is_Active = 1 AND cp.Client_ID IN (${placeholders})
      ORDER BY pp.Category, pp.Product_Name
    `, clientIds);
    res.json({ pricing });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Admin: Agent Management ====================

// List all agents with summary stats
router.get('/', requireAuth(['Admin']), (req, res) => {
  try {
    const agents = db.all(`
      SELECT u.User_ID, u.Name, u.Username, u.Role, u.Created_At,
             ap.Phone, ap.Email, ap.Territory, ap.Commission_Rate, ap.Status, ap.Hired_Date,
             (SELECT COUNT(*) FROM Clients WHERE Agent_ID = u.User_ID) as Client_Count,
             (SELECT COUNT(*) FROM Orders WHERE Created_By = u.User_ID) as Order_Count,
             (SELECT COALESCE(SUM(Final_Price * Material_Qty), 0) FROM Orders WHERE Created_By = u.User_ID) as Total_Revenue,
             (SELECT COALESCE(SUM(Agent_Commission * Material_Qty), 0) FROM Orders WHERE Created_By = u.User_ID) as Total_Commission,
             (SELECT COUNT(*) FROM Orders WHERE Created_By = u.User_ID AND Status = 'بانتظار الموافقة') as Pending_Orders
      FROM Users u
      LEFT JOIN Agent_Profiles ap ON u.User_ID = ap.User_ID
      WHERE u.Role = 'Agent'
      ORDER BY u.Created_At DESC
    `);
    res.json({ agents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent detail with full stats
router.get('/:id', requireAuth(['Admin']), (req, res) => {
  try {
    const agent = db.get(`
      SELECT u.*, ap.*
      FROM Users u
      LEFT JOIN Agent_Profiles ap ON u.User_ID = ap.User_ID
      WHERE u.User_ID = ? AND u.Role = 'Agent'
    `, [req.params.id]);
    
    if (!agent) return res.status(404).json({ error: 'الوكيل غير موجود' });
    
    // Get stats
    const stats = db.get(`
      SELECT 
        (SELECT COUNT(*) FROM Clients WHERE Agent_ID = ?) as Client_Count,
        (SELECT COUNT(*) FROM Orders WHERE Created_By = ?) as Order_Count,
        (SELECT COALESCE(SUM(Final_Price * Material_Qty), 0) FROM Orders WHERE Created_By = ?) as Total_Revenue,
        (SELECT COALESCE(SUM(Agent_Commission * Material_Qty), 0) FROM Orders WHERE Created_By = ?) as Total_Commission,
        (SELECT COUNT(*) FROM Orders WHERE Created_By = ? AND Status = 'بانتظار الموافقة') as Pending_Orders,
        (SELECT COUNT(*) FROM Orders WHERE Created_By = ? AND Approval_Status = 'approved') as Approved_Orders,
        (SELECT COUNT(*) FROM Orders WHERE Created_By = ? AND Approval_Status = 'rejected') as Rejected_Orders
    `, [req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id]);
    
    // Recent orders
    const recentOrders = db.all(`
      SELECT o.*, c.Full_Name as Client_Name
      FROM Orders o
      LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
      WHERE o.Created_By = ?
      ORDER BY o.Created_At DESC
      LIMIT 10
    `, [req.params.id]);
    
    // Recent clients
    const recentClients = db.all(`
      SELECT * FROM Clients WHERE Agent_ID = ? ORDER BY Created_At DESC LIMIT 10
    `, [req.params.id]);
    
    res.json({ agent, stats, recentOrders, recentClients });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent stats for charts
router.get('/:id/stats', requireAuth(['Admin']), (req, res) => {
  try {
    const { period = 'monthly', days = 30 } = req.query;
    const agentId = req.params.id;
    
    // Get daily stats for chart
    const dailyStats = db.all(`
      SELECT 
        date(Created_At) as date,
        COUNT(*) as orders_count,
        COALESCE(SUM(Material_Qty), 0) as total_sheets,
        COALESCE(SUM(Final_Price * Material_Qty), 0) as revenue,
        COALESCE(SUM(Agent_Commission * Material_Qty), 0) as commission
      FROM Orders
      WHERE Created_By = ? AND Created_At >= date('now', ? || ' days')
      GROUP BY date(Created_At)
      ORDER BY date
    `, [req.params.id, -days]);
    
    // Status breakdown
    const statusBreakdown = db.all(`
      SELECT Status, COUNT(*) as count
      FROM Orders
      WHERE Created_By = ?
      GROUP BY Status
    `, [req.params.id]);
    
    // Monthly comparison
    const monthlyComparison = db.all(`
      SELECT 
        strftime('%Y-%m', Created_At) as month,
        COUNT(*) as orders,
        COALESCE(SUM(Final_Price * Material_Qty), 0) as revenue,
        COALESCE(SUM(Agent_Commission * Material_Qty), 0) as commission
      FROM Orders
      WHERE Created_By = ?
      GROUP BY strftime('%Y-%m', Created_At)
      ORDER BY month DESC
      LIMIT 12
    `, [req.params.id]);
    
    // Top clients
    const topClients = db.all(`
      SELECT c.Client_ID, c.Full_Name, c.Phone_Number,
             COUNT(o.Task_ID) as order_count,
             COALESCE(SUM(o.Final_Price * o.Material_Qty), 0) as total_spent
      FROM Clients c
      LEFT JOIN Orders o ON c.Client_ID = o.Client_ID
      WHERE c.Agent_ID = ?
      GROUP BY c.Client_ID
      ORDER BY total_spent DESC
      LIMIT 10
    `, [req.params.id]);
    
    res.json({ dailyStats, statusBreakdown, monthlyComparison, topClients });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent's clients
router.get('/:id/clients', requireAuth(['Admin']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const agentId = req.params.id;
    
    let where = 'WHERE c.Agent_ID = ?';
    let params = [req.params.id];
    
    if (search) {
      where += ' AND (c.Full_Name LIKE ? OR c.Phone_Number LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Clients c ${where}`, params);
    const clients = db.all(`
      SELECT c.*, 
             (SELECT COUNT(*) FROM Orders WHERE Client_ID = c.Client_ID) as order_count,
             (SELECT COALESCE(SUM(Final_Price * Material_Qty), 0) FROM Orders WHERE Client_ID = c.Client_ID) as total_spent
      FROM Clients c
      ${where}
      ORDER BY c.Created_At DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ clients, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent's orders
router.get('/:id/orders', requireAuth(['Admin']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    const agentId = req.params.id;
    
    let where = 'WHERE o.Created_By = ?';
    let params = [agentId];
    
    if (status) {
      where += ' AND o.Status = ?';
      params.push(status);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Orders o ${where}`, params);
    const orders = db.all(`
      SELECT o.*, c.Full_Name as Client_Name
      FROM Orders o
      LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
      ${where}
      ORDER BY o.Created_At DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ orders, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent's commissions
router.get('/:id/commissions', requireAuth(['Admin']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    
    let where = 'WHERE c.Agent_ID = ?';
    let params = [req.params.id];
    
    if (status) {
      where += ' AND c.Status = ?';
      params.push(status);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Agent_Commissions c ${where}`, params);
    const commissions = db.all(`
      SELECT c.*, o.Task_ID as Order_ID, cl.Full_Name as Client_Name
      FROM Agent_Commissions c
      LEFT JOIN Orders o ON c.Order_ID = o.Task_ID
      LEFT JOIN Clients cl ON c.Client_ID = cl.Client_ID
      ${where}
      ORDER BY c.Calculated_At DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ commissions, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Approve/Reject commission
router.put('/:id/commissions/:commissionId', requireAuth(['Admin']), (req, res) => {
  try {
    const { action, notes } = req.body; // 'approve' or 'reject'
    const commission = db.get("SELECT * FROM Agent_Commissions WHERE Commission_ID = ?", [req.params.commissionId]);
    
    if (!commission) return res.status(404).json({ error: 'العمولة غير موجودة' });
    
    if (action === 'approve') {
      db.run("UPDATE Agent_Commissions SET Status = 'approved', Approved_At = CURRENT_TIMESTAMP, Approved_By = ?, Notes = COALESCE(?, Notes) WHERE Commission_ID = ?",
        [req.session.userId, notes || null, req.params.commissionId]);
    } else if (action === 'reject') {
      db.run("UPDATE Agent_Commissions SET Status = 'cancelled', Notes = COALESCE(?, Notes) WHERE Commission_ID = ?",
        [notes || null, req.params.commissionId]);
    } else {
      return res.status(400).json({ error: 'إجراء غير صالح' });
    }
    
    logActivity(req.params.id, `commission_${action}`, 'commission', req.params.commissionId, { notes }, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent's payouts
router.get('/:id/payouts', requireAuth(['Admin']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    
    let where = 'WHERE p.Agent_ID = ?';
    let params = [req.params.id];
    
    if (status) {
      where += ' AND p.Status = ?';
      params.push(status);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Agent_Payouts p ${where}`, params);
    const payouts = db.all(`
      SELECT * FROM Agent_Payouts p ${where} ORDER BY p.Requested_At DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ payouts, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create payout request (admin records payout)
router.post('/:id/payouts', requireAuth(['Admin']), (req, res) => {
  try {
    const { amount, period_start, period_end, payment_method, transaction_ref, notes } = req.body;
    if (!amount || !period_start || !period_end) {
      return res.status(400).json({ error: 'المبلغ والفترة مطلوبان' });
    }
    
    const result = db.run(
      `INSERT INTO Agent_Payouts (Agent_ID, Amount, Period_Start, Period_End, Payment_Method, Transaction_Ref, Notes, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
      [req.params.id, amount, period_start, period_end, payment_method || null, transaction_ref || null, notes || null]
    );
    
    // Mark related commissions as paid
    db.run(
      `UPDATE Agent_Commissions SET Status = 'paid', Paid_At = CURRENT_TIMESTAMP 
       WHERE Agent_ID = ? AND Status = 'approved'`,
      [req.params.id]
    );
    
    logActivity(req.params.id, 'payout_recorded', 'payout', result.lastId, { amount }, req);
    res.json({ success: true, payout_id: result.lastId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Get agent activity log
router.get('/:id/activity', requireAuth(['Admin']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const countRow = db.get("SELECT COUNT(*) as total FROM Agent_Activity_Log WHERE Agent_ID = ?", [req.params.id]);
    const activities = db.all(
      "SELECT * FROM Agent_Activity_Log WHERE Agent_ID = ? ORDER BY Created_At DESC LIMIT ? OFFSET ?",
      [req.params.id, limit, offset]
    );
    
    res.json({ activities, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create new agent (Admin)
router.post('/', requireAuth(['Admin']), (req, res) => {
  try {
    const { Name, Username, Password, Phone, Email, Territory, Commission_Rate, Bank_Account, IBAN, Tax_Number, Status } = req.body;
    
    if (!Name || !Username || !Password) {
      return res.status(400).json({ error: 'الاسم واسم المستخدم وكلمة المرور مطلوبة' });
    }
    
    const hash = bcrypt.hashSync(Password, 10);
    const result = db.run(
      `INSERT INTO Users (Name, Role, Username, Password) VALUES (?, 'Agent', ?, ?)`,
      [Name, Username, hash]
    );
    
    const agentId = result.lastId;
    
    db.run(
      `INSERT INTO Agent_Profiles (User_ID, Phone, Email, Territory, Commission_Rate, Bank_Account, IBAN, Tax_Number, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [agentId, Phone || null, Email || null, Territory || null, Commission_Rate || 0.10, 
       Bank_Account || null, IBAN || null, Tax_Number || null, Status || 'active']
    );
    
    logActivity(agentId, 'agent_created', 'agent', agentId, { Name, Username }, req);
    res.json({ success: true, agent_id: agentId });
  } catch (e) {
    if (e.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
    }
    res.status(500).json({ error: e.message });
  }
});

// Update agent profile
router.put('/:id', requireAuth(['Admin']), (req, res) => {
  try {
    const { Name, Phone, Email, Territory, Commission_Rate, Bank_Account, IBAN, Tax_Number, Status } = req.body;
    
    db.run("UPDATE Users SET Name = ? WHERE User_ID = ?", [Name || null, req.params.id]);
    db.run(
      `UPDATE Agent_Profiles SET 
        Phone = COALESCE(?, Phone),
        Email = COALESCE(?, Email),
        Territory = COALESCE(?, Territory),
        Commission_Rate = COALESCE(?, Commission_Rate),
        Bank_Account = COALESCE(?, Bank_Account),
        IBAN = COALESCE(?, IBAN),
        Tax_Number = COALESCE(?, Tax_Number),
        Status = COALESCE(?, Status)
       WHERE User_ID = ?`,
      [Phone || null, Email || null, Territory || null, Commission_Rate || null, 
       Bank_Account || null, IBAN || null, Tax_Number || null, Status || null, req.params.id]
    );
    
    logActivity(req.params.id, 'profile_updated', 'agent', req.params.id, req.body, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete/Deactivate agent
router.delete('/:id', requireAuth(['Admin']), (req, res) => {
  try {
    // Check if agent has orders
    const orderCount = db.get("SELECT COUNT(*) as cnt FROM Orders WHERE Created_By = ?", [req.params.id]);
    if (orderCount.cnt > 0) {
      // Just deactivate instead of delete
      db.run("UPDATE Agent_Profiles SET Status = 'inactive' WHERE User_ID = ?", [req.params.id]);
      db.run("UPDATE Users SET Role = 'Agent' WHERE User_ID = ?", [req.params.id]); // Keep role but profile inactive
      logActivity(req.params.id, 'agent_deactivated', 'agent', req.params.id, {}, req);
      return res.json({ success: true, message: 'تم تعطيل الوكيل (له طلبات سابقة)' });
    }
    
    // Safe to delete
    db.run("DELETE FROM Agent_Profiles WHERE User_ID = ?", [req.params.id]);
    db.run("DELETE FROM Users WHERE User_ID = ? AND Role = 'Agent'", [req.params.id]);
    res.json({ success: true, message: 'تم حذف الوكيل' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;