const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const path = require('path');
const fs = require('fs');
const { requireAuth, requirePermission } = require('../middleware/auth');

function requireAdmin(req, res, next) {
  if (req.session.role !== 'Admin') return res.status(403).json({ error: 'غير مصرح' });
  next();
}

// Admin page (Admin-only, matching the APIs below)
router.get('/', requireAdmin, (req, res) => {
  res.render('admin', { user: res.locals.user });
});

// ============== SYSTEM LOGS ==============
router.get('/api/logs', requireAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const total = db.get("SELECT COUNT(*) as cnt FROM System_Logs");
  const logs = db.query("SELECT l.*, u.Name as User_Name FROM System_Logs l LEFT JOIN Users u ON l.User_ID = u.User_ID ORDER BY l.Created_At DESC LIMIT ? OFFSET ?", [limit, offset]);
  res.json({ logs, page, pages: Math.ceil(total.cnt / limit) });
});

router.post('/api/logs', requireAdmin, (req, res) => {
  const { Action, Details } = req.body;
  if (!Action) return res.status(400).json({ error: 'Action مطلوب' });
  db.run("INSERT INTO System_Logs (Action, User_ID, Details) VALUES (?, ?, ?)", [Action, req.session.userId || null, Details || '']);
  res.json({ success: true });
});

// ============== EXPENSES ==============
router.get('/api/expenses', requireAdmin, (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  let where = '';
  let params = [];
  if (search) { where = 'WHERE Description LIKE ? OR Category LIKE ?'; params = [`%${search}%`, `%${search}%`]; }
  const total = db.get(`SELECT COUNT(*) as cnt FROM Expenses ${where}`, params);
  const expenses = db.query(`SELECT * FROM Expenses ${where} ORDER BY Expense_Date DESC, Created_At DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
  res.json({ expenses, page, pages: Math.ceil(total.cnt / limit) });
});

router.post('/api/expenses', requireAdmin, (req, res) => {
  const { Description, Category, Amount, Expense_Date, Notes } = req.body;
  if (!Description || !Amount) return res.status(400).json({ error: 'الوصف والمبلغ مطلوبان' });
  db.run("INSERT INTO Expenses (Description, Category, Amount, Expense_Date, Notes) VALUES (?, ?, ?, ?, ?)",
    [Description, Category || 'أخرى', parseFloat(Amount), Expense_Date || new Date().toISOString().split('T')[0], Notes || '']);
  db.run("INSERT INTO System_Logs (Action, User_ID, Details) VALUES (?, ?, ?)", ['إضافة مصروف', req.session.userId, `${Description} - ${Amount}`]);
  res.json({ success: true });
});

router.put('/api/expenses/:id', requireAdmin, (req, res) => {
  const { Description, Category, Amount, Expense_Date, Notes } = req.body;
  if (!Description || !Amount) return res.status(400).json({ error: 'الوصف والمبلغ مطلوبان' });
  db.run("UPDATE Expenses SET Description=?, Category=?, Amount=?, Expense_Date=?, Notes=? WHERE Expense_ID=?",
    [Description, Category, parseFloat(Amount), Expense_Date, Notes || '', req.params.id]);
  res.json({ success: true });
});

router.delete('/api/expenses/:id', requireAdmin, (req, res) => {
  db.run("DELETE FROM Expenses WHERE Expense_ID=?", [req.params.id]);
  res.json({ success: true });
});

// ============== DASHBOARD STATS ==============
router.get('/api/admin-stats', requireAdmin, (req, res) => {
  const totalUsers = db.get("SELECT COUNT(*) as cnt FROM Users").cnt;
  const totalClients = db.get("SELECT COUNT(*) as cnt FROM Clients").cnt;
  const totalOrders = db.get("SELECT COUNT(*) as cnt FROM Orders").cnt;
  const totalInvoices = db.get("SELECT COUNT(*) as cnt FROM Invoices").cnt;
  const totalExpenses = db.get("SELECT SUM(Amount) as total FROM Expenses").total || 0;
  const totalRevenue = db.get("SELECT SUM(Amount) as total FROM Invoices WHERE Status='مدفوعة'").total || 0;
  const pendingUploads = db.get("SELECT COUNT(*) as cnt FROM Upload_Queue WHERE Status='pending'").cnt;
  const recentLogs = db.query("SELECT l.*, u.Name as User_Name FROM System_Logs l LEFT JOIN Users u ON l.User_ID = u.User_ID ORDER BY l.Created_At DESC LIMIT 10");
  res.json({ totalUsers, totalClients, totalOrders, totalInvoices, totalExpenses, totalRevenue, pendingUploads, recentLogs });
});

// ============== DATABASE BACKUP ==============
router.post('/api/backup', requireAdmin, (req, res) => {
  try {
    const backupDir = path.join(__dirname, '..', 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const src = path.join(__dirname, '..', 'data', 'workshop.db');
    const dest = path.join(backupDir, `workshop-backup-${timestamp}.db`);
    try { db.saveDb(); } catch {}
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      db.run("INSERT INTO System_Logs (Action, User_ID, Details) VALUES (?, ?, ?)", ['نسخ احتياطي', req.session.userId, dest]);
      res.json({ success: true, path: dest });
    } else {
      res.status(404).json({ error: 'قاعدة البيانات غير موجودة' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/api/backups', requireAdmin, (req, res) => {
  const backupDir = path.join(__dirname, '..', 'backups');
  if (!fs.existsSync(backupDir)) return res.json([]);
  const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.db')).map(f => {
    const stat = fs.statSync(path.join(backupDir, f));
    return { name: f, size: stat.size, date: stat.mtime };
  }).sort((a, b) => b.date - a.date);
  res.json(files);
});

// ============== UPLOAD QUEUE ==============
router.get('/api/upload-queue', requireAdmin, (req, res) => {
  const items = db.query("SELECT * FROM Upload_Queue ORDER BY Created_At DESC LIMIT 100");
  res.json(items);
});

router.post('/api/upload-queue/retry/:id', requireAdmin, (req, res) => {
  db.run("UPDATE Upload_Queue SET Status='pending', Error=NULL WHERE Queue_ID=?", [req.params.id]);
  res.json({ success: true });
});

router.post('/api/upload-queue/retry-all', requireAdmin, (req, res) => {
  db.run("UPDATE Upload_Queue SET Status='pending', Error=NULL WHERE Status='failed'");
  res.json({ success: true });
});

// ============== SYSTEM INFO ==============
router.get('/api/system-info', requireAdmin, (req, res) => {
  const dbSize = fs.existsSync(path.join(__dirname, '..', 'data', 'workshop.db'))
    ? fs.statSync(path.join(__dirname, '..', 'data', 'workshop.db')).size : 0;
  const storageSize = fs.existsSync(path.join(__dirname, '..', 'Server_Storage'))
    ? getDirSize(path.join(__dirname, '..', 'Server_Storage')) : 0;
  res.json({
    nodeVersion: process.version,
    platform: process.platform,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    dbSize,
    storageSize,
    driveConfigured: require('../services/googleDrive').isConfigured()
  });
});

function getDirSize(dir) {
  let size = 0;
  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isFile()) size += fs.statSync(fullPath).size;
      else if (item.isDirectory()) size += getDirSize(fullPath);
    }
  } catch {}
  return size;
}

// ============== SYNC SERVICE ==============
router.post('/api/sync-now', requireAdmin, async (req, res) => {
  const gdrive = require('../services/googleDrive');
  if (!gdrive.isConfigured()) return res.json({ error: 'Google Drive غير مهيأ' });

  const pending = db.query("SELECT * FROM Upload_Queue WHERE Status='pending' ORDER BY Queue_ID ASC");
  let synced = 0, failed = 0;

  for (const item of pending) {
    try {
      db.run("UPDATE Upload_Queue SET Status='uploading' WHERE Queue_ID=?", [item.Queue_ID]);
      const filePath = item.File_Path;
      if (fs.existsSync(filePath)) {
        const buffer = fs.readFileSync(filePath);
        const result = await gdrive.uploadFile(item.Task_ID, item.Client_Name || 'Unknown', item.Original_Name, buffer);
        if (result && result.fileId) {
          db.run("UPDATE Upload_Queue SET Status='done' WHERE Queue_ID=?", [item.Queue_ID]);
          db.run("UPDATE Orders SET File_Path=? WHERE Task_ID=?", [`gdrive://${result.fileId}`, item.Task_ID]);
          synced++;
        } else {
          db.run("UPDATE Upload_Queue SET Status='failed', Error=? WHERE Queue_ID=?", [result?.error || 'فشل الرفع', item.Queue_ID]);
          failed++;
        }
      } else {
        db.run("UPDATE Upload_Queue SET Status='failed', Error='الملف غير موجود' WHERE Queue_ID=?", [item.Queue_ID]);
        failed++;
      }
    } catch (e) {
      db.run("UPDATE Upload_Queue SET Status='failed', Error=? WHERE Queue_ID=?", [e.message, item.Queue_ID]);
      failed++;
    }
  }

  db.run("INSERT INTO System_Logs (Action, User_ID, Details) VALUES (?, ?, ?)", ['مزامنة Drive', req.session.userId, `تم: ${synced}, فشل: ${failed}`]);
  res.json({ synced, failed });
});

module.exports = router;
