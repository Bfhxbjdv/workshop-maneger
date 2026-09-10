const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ZipArchive } = require('archiver');
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

function ensureTaskDir(dateDir, taskId) {
  const taskDir = path.join(dateDir, `Task_${taskId}`);
  if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });
  return taskDir;
}

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

router.post('/upload/:taskId', requirePermission('orders'), upload.array('files', 50), async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [taskId]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'لم يتم اختيار ملفات' });

    let materials = [];
    try { materials = JSON.parse(req.body.materials || '[]'); } catch(e) {}
    db.run("DELETE FROM Order_Materials WHERE Task_ID=?", [taskId]);
    materials.forEach(m => {
      if (m.Material_ID && m.Quantity) {
        db.run("INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)", [taskId, m.Material_ID, parseFloat(m.Quantity) || 0]);
      }
    });

    const clientDir = ensureClientDir(order.Client_Name || `client_${order.Client_ID}`);
    const dateDir = ensureDateDir(clientDir);
    const taskDir = ensureTaskDir(dateDir, taskId);

    const isOnline = await checkConnectivity();
    const results = [];
    let firstFilePath = null;
    let firstFileName = null;

    for (const file of req.files) {
      const ext = path.extname(file.originalname);
      const baseName = path.basename(file.originalname, ext);
      const storedName = `TaskID_${taskId}_${file.originalname}`;
      const localPath = path.join(taskDir, storedName);
      fs.renameSync(file.path, localPath);

      let filePath = path.relative(STORAGE, localPath);
      let gdriveFileId = null;

      if (isOnline && gdrive.isConfigured()) {
        try {
          const buffer = fs.readFileSync(localPath);
          const result = await gdrive.uploadFile(taskId, order.Client_Name, storedName, buffer);
          if (result && result.fileId) {
            gdriveFileId = result.fileId;
            filePath = `gdrive://${result.fileId}`;
          } else {
            db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)",
              [taskId, order.Client_Name, storedName, localPath]);
          }
        } catch (e) {
          db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)",
            [taskId, order.Client_Name, storedName, localPath]);
        }
      } else {
        db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)",
          [taskId, order.Client_Name, storedName, localPath]);
      }

      db.run("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, GDrive_File_ID, File_Size, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [taskId, file.originalname, storedName, filePath, gdriveFileId, file.size, req.session.userId]);

      if (!firstFilePath) {
        firstFilePath = filePath;
        firstFileName = file.originalname;
      }

      results.push({ originalName: file.originalname, storedName, size: file.size });
    }

    db.run("UPDATE Orders SET File_Path=?, File_Name=?, Status='جاهز للقص', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [firstFilePath, firstFileName, taskId]);

    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [taskId, `تم رفع ${results.length} ملف(ات) للطلب #${taskId}`, 'info']);

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
      global.io.emit('notification', { message: `تم رفع ${results.length} ملف(ات) للطلب #${taskId}`, type: 'info' });
    }

    res.json({ order: updated, files: results, count: results.length });
  } catch (e) { console.error('Upload error:', e); res.status(500).json({ error: e.message || 'فشل رفع الملفات' }); }
});

router.get('/list/:taskId', requireAuth(), (req, res) => {
  const files = db.all("SELECT * FROM Order_Files WHERE Task_ID=? ORDER BY Created_At", [req.params.taskId]);
  res.json(files || []);
});

router.get('/download/:taskId', requireAuth(), async (req, res) => {
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.taskId]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

  const files = db.all("SELECT * FROM Order_Files WHERE Task_ID=?", [req.params.taskId]);

  if (files && files.length > 1) {
    const zipName = `Task_${order.Task_ID}_${order.Client_Name || 'files'}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.pipe(res);

    for (const file of files) {
      if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
        try {
          const fileId = file.File_Path.replace('gdrive://', '');
          const stream = await gdrive.downloadFile(fileId);
          if (stream) archive.append(stream, { name: file.Original_Name });
        } catch (e) { console.error('ZIP append gdrive error:', e); }
      } else if (file.File_Path) {
        const fullPath = path.join(STORAGE, file.File_Path);
        if (fs.existsSync(fullPath)) archive.file(fullPath, { name: file.Original_Name });
      }
    }

    archive.finalize();
    return;
  }

  if (files && files.length === 1) {
    const file = files[0];
    if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
      try {
        const fileId = file.File_Path.replace('gdrive://', '');
        const fileStream = await gdrive.downloadFile(fileId);
        if (fileStream) {
          res.setHeader('Content-Disposition', `attachment; filename="${file.Original_Name}"`);
          fileStream.pipe(res);
          return;
        }
      } catch (e) { /* fallback */ }
    }
    if (file.File_Path) {
      const fullPath = path.join(STORAGE, file.File_Path);
      if (fs.existsSync(fullPath)) return res.download(fullPath, file.Original_Name);
    }
  }

  if (order.File_Path) {
    if (order.File_Path.startsWith('gdrive://')) {
      try {
        const fileId = order.File_Path.replace('gdrive://', '');
        const fileStream = await gdrive.downloadFile(fileId);
        if (fileStream) {
          res.setHeader('Content-Disposition', `attachment; filename="${order.File_Name || `task_${order.Task_ID}.dxf`}"`);
          fileStream.pipe(res);
          return;
        }
      } catch (e) {
        const localPath = path.join(STORAGE, order.File_Path);
        if (fs.existsSync(localPath)) return res.download(localPath, order.File_Name);
        res.status(500).json({ error: 'خطأ في تحميل الملف من Google Drive' });
      }
      return;
    }
    const filePath = path.join(STORAGE, order.File_Path);
    if (fs.existsSync(filePath)) return res.download(filePath, order.File_Name || `task_${order.Task_ID}.dxf`);
  }

  res.status(404).json({ error: 'لا توجد ملفات لهذا الطلب' });
});

router.get('/download-file/:fileId', requireAuth(), async (req, res) => {
  const file = db.get("SELECT * FROM Order_Files WHERE File_ID=?", [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });

  if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
    try {
      const fileId = file.File_Path.replace('gdrive://', '');
      const fileStream = await gdrive.downloadFile(fileId);
      if (fileStream) {
        res.setHeader('Content-Disposition', `attachment; filename="${file.Original_Name}"`);
        fileStream.pipe(res);
        return;
      }
    } catch (e) { /* fallback */ }
  }

  if (file.File_Path) {
    const fullPath = path.join(STORAGE, file.File_Path);
    if (fs.existsSync(fullPath)) return res.download(fullPath, file.Original_Name);
  }

  res.status(404).json({ error: 'الملف غير موجود على القرص' });
});

router.delete('/file/:fileId', requirePermission('orders'), async (req, res) => {
  const file = db.get("SELECT * FROM Order_Files WHERE File_ID=?", [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });

  if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
    await gdrive.deleteFile(file.File_Path.replace('gdrive://', ''));
  } else if (file.File_Path) {
    const fullPath = path.join(STORAGE, file.File_Path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  db.run("DELETE FROM Order_Files WHERE File_ID=?", [file.File_ID]);

  const remaining = db.get("SELECT COUNT(*) as cnt FROM Order_Files WHERE Task_ID=?", [file.Task_ID]);
  if (remaining && remaining.cnt === 0) {
    db.run("UPDATE Orders SET File_Path=NULL, File_Name=NULL, Status='قيد التصميم', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [file.Task_ID]);
  }

  const updated = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [file.Task_ID]);
  if (global.io) global.io.emit('order-update', updated);
  res.json({ order: updated });
});

router.delete('/:taskId', requirePermission('orders'), async (req, res) => {
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.taskId]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });

  const files = db.all("SELECT * FROM Order_Files WHERE Task_ID=?", [req.params.taskId]);
  if (files) {
    for (const file of files) {
      if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
        await gdrive.deleteFile(file.File_Path.replace('gdrive://', ''));
      } else if (file.File_Path) {
        const filePath = path.join(STORAGE, file.File_Path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    db.run("DELETE FROM Order_Files WHERE Task_ID=?", [req.params.taskId]);
  }

  if (order.File_Path) {
    if (order.File_Path.startsWith('gdrive://')) {
      await gdrive.deleteFile(order.File_Path.replace('gdrive://', ''));
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
