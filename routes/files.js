const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database/connection');
const { requireAuth, requirePermission } = require('../middleware/auth');
const gdrive = require('../services/googleDrive');

const STORAGE = path.join(__dirname, '..', 'Server_Storage', 'Clients_Archive');
if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE, { recursive: true });

const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => { cb(null, true); }
});

function ensureClientDir(clientName) {
  const safe = clientName.replace(/[<>:"\/\\|?*]/g, '_').trim();
  const clientDir = path.join(STORAGE, safe);
  if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });
  return clientDir;
}

function ensureDateDir(clientDir) {
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = now.toLocaleString('en', { month: 'long' });
  const yearDir = path.join(clientDir, year);
  if (!fs.existsSync(yearDir)) fs.mkdirSync(yearDir);
  const monthDir = path.join(yearDir, month);
  if (!fs.existsSync(monthDir)) fs.mkdirSync(monthDir);
  return monthDir;
}

// Check internet connectivity
function checkConnectivity() {
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.get('http://clients3.google.com/generate_204', { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 204);
      req.destroy();
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

router.post('/upload/:taskId', requirePermission('orders'), (req, res) => {
  upload.single('file')(req, res, async (err) => {
    try {
    if (err) return res.status(400).json({ error: err.message });

    const taskId = req.params.taskId;
    const order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [taskId]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

    // Always save locally first
    const clientDir = ensureClientDir(order.Client_Name || `client_${order.Client_ID}`);
    const dateDir = ensureDateDir(clientDir);
    const ext = path.extname(req.file.originalname);
    const newName = `TaskID_${taskId}_${path.basename(req.file.originalname, ext)}${ext}`;
    const localPath = path.join(dateDir, newName);
    fs.renameSync(req.file.path, localPath);

    let filePath = path.relative(STORAGE, localPath);
    let fileName = newName;

    // Try Drive upload (online) or queue (offline)
    const isOnline = await checkConnectivity();
    if (isOnline && gdrive.isConfigured()) {
      try {
        const buffer = fs.readFileSync(localPath);
        const result = await gdrive.uploadFile(taskId, order.Client_Name, fileName, buffer);
        if (result && result.fileId) {
          filePath = `gdrive://${result.fileId}`;
          fileName = result.fileName;
        } else {
          // API returned an error, queue for later sync
          db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)",
            [taskId, order.Client_Name, fileName, localPath]);
        }
      } catch (e) {
        // Network error, queue for later sync
        db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)",
          [taskId, order.Client_Name, fileName, localPath]);
      }
    } else {
      // Offline: save locally and queue for Drive
      db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)",
        [taskId, order.Client_Name, fileName, localPath]);
    }

    db.run("UPDATE Orders SET File_Path=?, File_Name=?, Status='جاهز للقص', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [filePath, fileName, taskId]);

    let materials = [];
    try { materials = JSON.parse(req.body.materials || '[]'); } catch(e) {}
    db.run("DELETE FROM Order_Materials WHERE Task_ID=?", [taskId]);
    materials.forEach(m => {
      if (m.Material_ID && m.Quantity) {
        db.run("INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)", [taskId, m.Material_ID, parseFloat(m.Quantity) || 0]);
      }
    });

    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [taskId, `تم رفع ملف التصميم للطلب #${taskId}`, 'info']);

    const updated = db.get(`
      SELECT o.*, c.Full_Name as Client_Name, c.Phone_Number,
             i.Material_Name, i.Thickness
      FROM Orders o
      LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
      LEFT JOIN Inventory i ON o.Material_ID = i.Material_ID
      WHERE o.Task_ID = ?
    `, [taskId]);

    if (global.io) {
      global.io.emit('order-update', updated);
      global.io.emit('notification', { message: `تم رفع ملف جديد للطلب #${taskId}`, type: 'info' });
    }

    res.json({ order: updated, filePath, storage: filePath.startsWith('gdrive://') ? 'gdrive' : 'local' });
    } catch (e) { console.error('Upload error:', e); res.status(500).json({ error: e.message || 'فشل رفع الملف' }); }
  });
});

router.get('/download/:taskId', requireAuth(), async (req, res) => {
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.taskId]);
  if (!order || !order.File_Path) return res.status(404).json({ error: 'الملف غير موجود' });

  if (order.File_Path.startsWith('gdrive://')) {
    const fileId = order.File_Path.replace('gdrive://', '');
    try {
      const fileStream = await gdrive.downloadFile(fileId);
      if (!fileStream) return res.status(500).json({ error: 'فشل تحميل الملف من Google Drive' });
      res.setHeader('Content-Disposition', `attachment; filename="${order.File_Name || `task_${order.Task_ID}.dxf`}"`);
      fileStream.pipe(res);
    } catch (e) {
      // Fallback to local if Drive fails
      const localPath = path.join(STORAGE, order.File_Path);
      if (fs.existsSync(localPath)) return res.download(localPath, order.File_Name);
      res.status(500).json({ error: 'خطأ في تحميل الملف من Google Drive' });
    }
    return;
  }

  const filePath = path.join(STORAGE, order.File_Path);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'الملف غير موجود على القرص' });
  res.download(filePath, order.File_Name || `task_${order.Task_ID}.dxf`);
});

router.delete('/:taskId', requirePermission('orders'), async (req, res) => {
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.taskId]);
  if (order && order.File_Path) {
    if (order.File_Path.startsWith('gdrive://')) {
      const fileId = order.File_Path.replace('gdrive://', '');
      await gdrive.deleteFile(fileId);
    } else {
      const filePath = path.join(STORAGE, order.File_Path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
  db.run("UPDATE Orders SET File_Path=NULL, File_Name=NULL, Status='قيد التصميم', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [req.params.taskId]);
  const updated = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [req.params.taskId]);
  if (global.io) global.io.emit('order-update', updated);
  res.json({ order: updated });
});

module.exports = router;
