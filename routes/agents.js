const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth, requirePermission, hasPermission } = require('../middleware/auth');

// Multer config for custom design uploads
const CUSTOM_DESIGN_DIR = path.join(__dirname, '..', 'Server_Storage', 'Custom_Designs');
if (!fs.existsSync(CUSTOM_DESIGN_DIR)) fs.mkdirSync(CUSTOM_DESIGN_DIR, { recursive: true });

const customDesignStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CUSTOM_DESIGN_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const customDesignUpload = multer({ storage: customDesignStorage, limits: { fileSize: 10 * 1024 * 1024 } });

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

// ==================== Admin: Image Library Management ====================

// List all agent images (library)
router.get('/admin/images', requireAuth(['Admin']), (req, res) => {
  try {
    const category = req.query.category || '';
    let where = 'WHERE 1=1';
    let params = [];
    
    if (category) {
      where += ' AND ai.Category = ?';
      params.push(category);
    }
    
    const images = db.all(`
      SELECT ai.*, d.Name as Design_Name, u.Name as Uploader_Name
      FROM Agent_Images ai
      LEFT JOIN Designs d ON ai.Design_ID = d.Design_ID
      LEFT JOIN Users u ON ai.Uploaded_By = u.User_ID
      ${where}
      ORDER BY ai.Created_At DESC
    `, params);
    
    res.json({ images });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Upload image to library
router.post('/admin/images', requireAuth(['Admin']), (req, res) => {
  // This will be handled by multer middleware in the actual route
  // The actual upload is handled in orders.js with agentUpload middleware
  res.json({ success: true, message: 'Use /api/orders/agent/images for upload' });
});

// Delete image from library
router.delete('/admin/images/:id', requireAuth(['Admin']), (req, res) => {
  try {
    const image = db.get("SELECT * FROM Agent_Images WHERE Image_ID = ?", [req.params.id]);
    if (!image) return res.status(404).json({ error: 'الصورة غير موجودة' });
    
    // Delete physical file
    const fs = require('fs');
    if (fs.existsSync(image.File_Path)) {
      fs.unlinkSync(image.File_Path);
    }
    
    db.run("DELETE FROM Agent_Images WHERE Image_ID = ?", [req.params.id]);
    logActivity(0, 'image_deleted', 'image', req.params.id, { image: image.Original_Name }, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Link/Unlink image to design
router.put('/admin/images/:id/link-design', requireAuth(['Admin']), (req, res) => {
  try {
    const { design_id } = req.body;
    const image = db.get("SELECT * FROM Agent_Images WHERE Image_ID = ?", [req.params.id]);
    if (!image) return res.status(404).json({ error: 'الصورة غير موجودة' });
    
    if (design_id) {
      const design = db.get("SELECT * FROM Designs WHERE Design_ID = ?", [design_id]);
      if (!design) return res.status(404).json({ error: 'التصميم غير موجود' });
      db.run("UPDATE Agent_Images SET Design_ID = ? WHERE Image_ID = ?", [design_id, req.params.id]);
      logActivity(0, 'image_linked_design', 'image', req.params.id, { design_id }, req);
    } else {
      db.run("UPDATE Agent_Images SET Design_ID = NULL WHERE Image_ID = ?", [req.params.id]);
      logActivity(0, 'image_unlinked_design', 'image', req.params.id, {}, req);
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Admin: Designs Management ====================

// List all designs with stats
router.get('/admin/designs', requireAuth(['Admin']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const status = req.query.status || '';
    
    let where = 'WHERE 1=1';
    let params = [];
    
    if (search) {
      where += ' AND (d.Name LIKE ? OR d.Category LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      where += ' AND d.Status = ?';
      params.push(status);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Designs d ${where}`, params);
    const designs = db.all(`
      SELECT d.*, u.Name as Creator_Name,
             (SELECT COUNT(*) FROM Agent_Images WHERE Design_ID = d.Design_ID) as Image_Count
      FROM Designs d
      LEFT JOIN Users u ON d.CreatedBy = u.User_ID
      ${where}
      ORDER BY d.CreatedAt DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ designs, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Create design
router.post('/admin/designs', requireAuth(['Admin']), (req, res) => {
  try {
    const { Name, Category, Material, Thickness, Width, Height, Unit, Notes, FilePath, Original_Name, ThumbnailPath, Password } = req.body;
    if (!Name || !FilePath) return res.status(400).json({ error: 'اسم التصميم وملف التصميم مطلوبان' });
    
    const result = db.run(
      `INSERT INTO Designs (Name, Category, Material, Thickness, Width, Height, Unit, Notes, FilePath, Original_Name, ThumbnailPath, Password, CreatedBy)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [Name, Category || '', Material || '', Thickness || '', parseFloat(Width) || 0, parseFloat(Height) || 0, Unit || 'سم', Notes || '', FilePath, Original_Name || '', ThumbnailPath || null, Password || null, req.session.userId]
    );
    
    const design = db.get("SELECT * FROM Designs WHERE Design_ID = ?", [result.lastId]);
    res.json({ success: true, design });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update design
router.put('/admin/designs/:id', requireAuth(['Admin']), (req, res) => {
  try {
    const { Name, Category, Material, Thickness, Width, Height, Unit, Notes, FilePath, Original_Name, ThumbnailPath, Password, Status } = req.body;
    
    db.run(
      `UPDATE Designs SET 
        Name = COALESCE(?, Name),
        Category = COALESCE(?, Category),
        Material = COALESCE(?, Material),
        Thickness = COALESCE(?, Thickness),
        Width = COALESCE(?, Width),
        Height = COALESCE(?, Height),
        Unit = COALESCE(?, Unit),
        Notes = COALESCE(?, Notes),
        FilePath = COALESCE(?, FilePath),
        Original_Name = COALESCE(?, Original_Name),
        ThumbnailPath = COALESCE(?, ThumbnailPath),
        Password = COALESCE(?, Password)
       WHERE Design_ID = ?`,
      [Name || null, Category || null, Material || null, Thickness || null, 
       Width || null, Height || null, Unit || null, Notes || null, 
       FilePath || null, Original_Name || null, ThumbnailPath || null, Password || null, req.params.id]
    );
    
    const design = db.get("SELECT * FROM Designs WHERE Design_ID = ?", [req.params.id]);
    res.json({ success: true, design });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete design
router.delete('/admin/designs/:id', requireAuth(['Admin']), (req, res) => {
  try {
    const design = db.get("SELECT * FROM Designs WHERE Design_ID = ?", [req.params.id]);
    if (!design) return res.status(404).json({ error: 'التصميم غير موجود' });
    
    // Unlink images first
    db.run("UPDATE Agent_Images SET Design_ID = NULL WHERE Design_ID = ?", [req.params.id]);
    
    // Delete design
    db.run("DELETE FROM Designs WHERE Design_ID = ?", [req.params.id]);
    
    logActivity(0, 'design_deleted', 'design', req.params.id, { name: design.Name }, req);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Admin: Custom Design Requests ====================

// List custom design requests
router.get('/admin/custom-requests', requireAuth(['Admin']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    const search = req.query.search || '';
    
    let where = 'WHERE 1=1';
    let params = [];
    
    if (status) {
      where += ' AND c.Status = ?';
      params.push(status);
    }
    if (search) {
      where += ' AND (c.Name LIKE ? OR u.Name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Agent_Custom_Designs c JOIN Users u ON c.Agent_ID = u.User_ID ${where}`, params);
    const requests = db.all(`
      SELECT c.*, u.Name as Agent_Name, u.Username as Agent_Username,
             o.Task_ID as Order_ID, c2.Full_Name as Client_Name
      FROM Agent_Custom_Designs c
      JOIN Users u ON c.Agent_ID = u.User_ID
      LEFT JOIN Orders o ON c.Order_ID = o.Task_ID
      LEFT JOIN Clients c2 ON o.Client_ID = c2.Client_ID
      ${where}
      ORDER BY c.Created_At DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ requests, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update custom design request status.
// Approving (in_progress) turns the custom request into a REAL order so it
// appears immediately for the designer like any other order.
router.put('/admin/custom-requests/:id/status', requireAuth(['Admin']), (req, res) => {
  try {
    const { status, designer_id, notes, client_id, machine_type } = req.body;
    const validStatuses = ['pending', 'in_progress', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'حالة غير صالحة' });
    }

    const request = db.get("SELECT * FROM Agent_Custom_Designs WHERE Custom_Design_ID = ?", [req.params.id]);
    if (!request) return res.status(404).json({ error: 'الطلب غير موجود' });

    let orderId = request.Order_ID || null;

    if (status === 'in_progress') {
      const designerId = designer_id ? parseInt(designer_id, 10) : null;
      if (!designerId) {
        return res.status(400).json({ error: 'اختر المصمم الذي سيستلم الطلب' });
      }
      const designer = db.get("SELECT User_ID FROM Users WHERE User_ID = ? AND Role = 'Designer'", [designerId]);
      if (!designer) return res.status(400).json({ error: 'المصمم المختار غير موجود' });

      if (orderId) {
        const linked = db.get("SELECT * FROM Orders WHERE Task_ID = ?", [orderId]);
        if (!linked) return res.status(400).json({ error: 'الطلب المرتبط غير موجود' });
        // Only reset to design phase if it never started; never move a started order backwards.
        if (linked.Status === 'بانتظار الموافقة') {
          db.run("UPDATE Orders SET Status = 'قيد التصميم', Updated_At = CURRENT_TIMESTAMP WHERE Task_ID = ?", [orderId]);
        }
        db.run("UPDATE Orders SET Approval_Status = 'approved', Designer_ID = ?, Updated_At = CURRENT_TIMESTAMP WHERE Task_ID = ?",
          [designerId, orderId]);
      } else {
        // No linked order: create a real one so the designer sees it at once.
        const clientId = client_id ? parseInt(client_id, 10) : null;
        if (!clientId) {
          return res.status(400).json({ error: 'اختر العميل لإنشاء طلب التصميم' });
        }
        const client = db.get("SELECT Client_ID FROM Clients WHERE Client_ID = ?", [clientId]);
        if (!client) return res.status(400).json({ error: 'العميل المختار غير موجود' });
        const machineType = String(machine_type || '').toLowerCase() === 'router' ? 'Router' : 'Laser';
        const created = db.run(
          `INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Notes)
           VALUES (?, ?, ?, ?, 'قيد التصميم', 'approved', ?)`,
          [clientId, designerId, request.Agent_ID, machineType,
           `[تصميم مخصص] ${request.Name}${request.Description ? ' — ' + request.Description : ''}`]
        );
        if (!created.lastId) return res.status(500).json({ error: 'فشل إنشاء الطلب' });
        orderId = created.lastId;
        db.run("UPDATE Agent_Custom_Designs SET Order_ID = ? WHERE Custom_Design_ID = ?", [orderId, req.params.id]);
      }

      // Copy the custom request attachments into Order_Files so the order
      // actually carries its files (this is what the "agent custom orders"
      // list displays). Image_Path holds one path or a JSON array of paths.
      try {
        let storedPaths = [];
        const rawPath = request.Image_Path;
        if (rawPath) {
          try {
            const parsed = JSON.parse(rawPath);
            storedPaths = Array.isArray(parsed) ? parsed : [rawPath];
          } catch {
            storedPaths = [rawPath];
          }
        }
        storedPaths.forEach((fp) => {
          if (!fp || typeof fp !== 'string') return;
          let size = 0;
          try { if (fs.existsSync(fp)) size = fs.statSync(fp).size; } catch {}
          const base = path.basename(fp);
          db.run(
            `INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Size, File_Type, Upload_Type, Uploaded_By)
             VALUES (?, ?, ?, ?, ?, 'image', 'agent_custom', ?)`,
            [orderId, `${request.Name} — ${base}`, base, fp, size, request.Agent_ID]
          );
        });
      } catch (e) { console.error('Copy custom files to order failed:', e.message); }

      db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)",
        [orderId, `طلب تصميم مخصص جديد بانتظارك (#${orderId})`, 'info']);
      const orderRow = db.get("SELECT * FROM Orders WHERE Task_ID = ?", [orderId]);
      if (global.io && orderRow) global.io.emit('order-update', orderRow);
    }

    db.run(
      `UPDATE Agent_Custom_Designs SET Status = ?, Designer_ID = ?, Notes = COALESCE(?, Notes), Updated_At = CURRENT_TIMESTAMP WHERE Custom_Design_ID = ?`,
      [status, designer_id ? parseInt(designer_id, 10) : null, notes || null, req.params.id]
    );

    logActivity(request.Agent_ID, `custom_design_${status}`, 'custom_design', req.params.id, { status, designer_id, orderId }, req);

    // Notify agent (Task_ID must be NULL when unlinked to satisfy FK)
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)",
      [orderId, `تم تحديث طلب التصميم المخصص: ${status}`, 'info']);

    res.json({ success: true, order_id: orderId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Admin: Agent Custom Orders ====================

// List orders with agent custom uploads
router.get('/admin/agent-custom-orders', requireAuth(['Admin']), (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    
    const countRow = db.get("SELECT COUNT(*) as total FROM Order_Files WHERE Upload_Type = 'agent_custom'");
    const files = db.all(`
      SELECT of.*, o.Task_ID, o.Status as Order_Status, o.Agent_Price, o.Agent_Commission, o.Final_Price,
             c.Full_Name as Client_Name, u.Name as Agent_Name
      FROM Order_Files of
      JOIN Orders o ON of.Task_ID = o.Task_ID
      LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
      LEFT JOIN Users u ON o.Created_By = u.User_ID
      WHERE of.Upload_Type = 'agent_custom'
      ORDER BY of.Created_At DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    res.json({ files, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== Agent: Custom Design Request ====================

// Agent: Submit custom design request
// Multer errors must return JSON (not the default HTML error page)
function customDesignUploadMw(req, res, next) {
  customDesignUpload.array('customDesignFiles', 10)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? 'حجم الملف يتجاوز الحد المسموح (10MB)'
        : err.code === 'LIMIT_FILE_COUNT'
          ? 'عدد الملفات يتجاوز الحد المسموح (10)'
          : 'فشل رفع الملفات: ' + (err.message || 'خطأ غير معروف');
      return res.status(400).json({ error: msg });
    }
    next();
  });
}
router.post('/my/custom-design', requireAuth(['Agent']), customDesignUploadMw, (req, res) => {
  try {
    const name = String(req.body?.name || '').trim();
    const description = String(req.body?.description || '').trim();
    let orderIdRaw = req.body?.order_id;
    if (orderIdRaw === undefined || orderIdRaw === null) orderIdRaw = '';
    orderIdRaw = String(orderIdRaw).trim();
    const orderId = (orderIdRaw === '' || orderIdRaw.toLowerCase() === 'null' || orderIdRaw.toLowerCase() === 'undefined')
      ? null
      : parseInt(orderIdRaw, 10);
    if (!name) return res.status(400).json({ error: 'اسم التصميم مطلوب' });
    if (orderId !== null && (!Number.isInteger(orderId) || orderId <= 0)) {
      return res.status(400).json({ error: 'رقم الطلب المرتبط غير صالح' });
    }
    if (orderId !== null) {
      const ownOrder = db.get(
        "SELECT Task_ID FROM Orders WHERE Task_ID = ? AND Created_By = ?",
        [orderId, req.session.userId]
      );
      if (!ownOrder) return res.status(403).json({ error: 'لا تملك الصلاحية لربط هذا الطلب' });
    }

    // Save every uploaded file; keep all paths as JSON so no attachment is lost
    const filePaths = Array.isArray(req.files) ? req.files.map(f => f.path) : [];
    const imagePath = filePaths.length > 1 ? JSON.stringify(filePaths) : (filePaths[0] || null);
    const thumbnailPath = filePaths[0] || null;

    const result = db.run(
      `INSERT INTO Agent_Custom_Designs (Agent_ID, Order_ID, Name, Description, Image_Path, Thumbnail_Path)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [req.session.userId, orderId, name, description, imagePath, thumbnailPath]
    );

    // Notify admins and designers (Task_ID must be NULL when unlinked to satisfy FK)
    const admins = db.all("SELECT User_ID FROM Users WHERE Role IN ('Admin', 'Designer', 'Custom')");
    admins.forEach(u => {
      db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)",
        [orderId, `طلب تصميم مخصص جديد من الوكيل: ${req.session.name}`, 'info']);
    });

    logActivity(req.session.userId, 'custom_design_requested', 'custom_design', result.lastId, { name, files: filePaths.length }, req);
    res.json({ success: true, custom_design_id: result.lastId, files: filePaths.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Agent: Get my custom design requests
router.get('/my/custom-designs', requireAuth(['Agent']), (req, res) => {
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
    
    const countRow = db.get(`SELECT COUNT(*) as total FROM Agent_Custom_Designs c ${where}`, params);
    const requests = db.all(`
      SELECT c.*, o.Task_ID as Order_ID
      FROM Agent_Custom_Designs c
      LEFT JOIN Orders o ON c.Order_ID = o.Task_ID
      ${where}
      ORDER BY c.Created_At DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    
    res.json({ requests, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;