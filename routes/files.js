const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ZipArchive } = require('archiver');
const db = require('../database/connection');
const { requireAuth, requirePermission, canAccessOrder } = require('../middleware/auth');
const gdrive = require('../services/googleDrive');
const { resolveLocalFile, imageHeaders } = require('../services/localFiles');
const r2 = require('../services/cloudflareR2');

const STORAGE = path.join(__dirname, '..', 'Server_Storage', 'Clients_Archive');
if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE, { recursive: true });

// Design attachments can be produced by several CAD/CAM applications, so do
// not reject a valid workshop file merely because its extension is unfamiliar.
// They remain behind authenticated download routes.
const designUpload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 25 * 1024 * 1024, files: 50, fields: 20 }
});
const imageUpload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: { fileSize: 25 * 1024 * 1024, files: 10, fields: 20 },
  fileFilter: (req, file, cb) => {
    const allowed = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
    cb(null, allowed.has(path.extname(file.originalname || '').toLowerCase()));
  }
});

function safeFileName(name) {
  return path.basename(String(name || 'file')).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').replace(/^\.+/, '') || 'file';
}

async function storeInR2(taskId, storedName, localPath, mime, type) {
  if (!r2.configured) return null;
  return r2.uploadLocalFile(r2.keyFor(taskId, storedName, type), localPath, mime);
}

// Uploading a replacement/new production file means the approved order is
// ready for the machine again. Pending agent requests must still be approved
// first, and completed/delivered orders must never be moved backwards.
function shouldSendToMachine(order) {
  if (!order || ['pending', 'rejected'].includes(order.Approval_Status)) return false;
  return !['تم الانتهاء من القص', 'تم التغليف', 'تم التسليم', 'ملغي'].includes(order.Status);
}

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

router.post('/upload/:taskId', requirePermission('orders'), designUpload.array('files', 50), async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [taskId]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'لم يتم اختيار ملفات' });

    let materials = [];
    try { materials = JSON.parse(req.body.materials || '[]'); } catch(e) {}
    db.run("DELETE FROM Order_Materials WHERE Task_ID=?", [taskId]);
    materials.forEach(m => {
      if (m.Material_ID && m.Quantity) {
        db.run("INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)", [taskId, m.Material_ID, parseFloat(m.Quantity) || 0]);
      }
    });

    let labels = [];
    try { labels = JSON.parse(req.body.labels || '[]'); } catch(e) {}

    const clientDir = ensureClientDir(order.Client_Name || `client_${order.Client_ID}`);
    const dateDir = ensureDateDir(clientDir);
    const taskDir = ensureTaskDir(dateDir, taskId);

    const isOnline = await checkConnectivity();
    const results = [];
    let firstFilePath = null;
    let firstFileName = null;

    for (let i = 0; i < req.files.length; i++) {
      const file = req.files[i];
      const storedName = `TaskID_${taskId}_${Date.now()}_${safeFileName(file.originalname)}`;
      const localPath = path.join(taskDir, storedName);
      fs.renameSync(file.path, localPath);

      let filePath = path.relative(STORAGE, localPath);
      let gdriveFileId = null;

      const r2Path = await storeInR2(taskId, storedName, localPath, file.mimetype, 'designs');
      if (r2Path) {
        filePath = r2Path;
      } else if (isOnline && gdrive.isConfigured()) {
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

      const label = (labels[i] || file.originalname).toString().trim() || file.originalname;
      db.run("UPDATE Order_Files SET Is_Current=0 WHERE Task_ID=? AND File_Type='design'", [taskId]);
      db.run("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, GDrive_File_ID, File_Size, Label, File_Type, Is_Current, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, ?, 'design', 1, ?)",
        [taskId, file.originalname, storedName, filePath, gdriveFileId, file.size, label, req.session.userId]);

      if (!firstFilePath) {
        firstFilePath = filePath;
        firstFileName = file.originalname;
      }

      results.push({ originalName: file.originalname, label, storedName, size: file.size });
    }

    if (shouldSendToMachine(order)) {
      db.run("UPDATE Orders SET File_Path=?, File_Name=?, Status='جاهز للقص', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [firstFilePath, firstFileName, taskId]);
    } else {
      db.run("UPDATE Orders SET File_Path=?, File_Name=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [firstFilePath, firstFileName, taskId]);
    }

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

router.post('/upload-image/:taskId', requirePermission('orders'), imageUpload.array('image', 10), async (req, res) => {
  try {
    const taskId = req.params.taskId;
    const order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [taskId]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'لم يتم اختيار صورة' });

    const clientDir = ensureClientDir(order.Client_Name || `client_${order.Client_ID}`);
    const dateDir = ensureDateDir(clientDir);
    const taskDir = ensureTaskDir(dateDir, taskId);
    const isOnline = await checkConnectivity();
    const uploaded = [];

    for (const imgFile of req.files) {
      const storedName = `TaskID_${taskId}_IMG_${Date.now()}_${safeFileName(imgFile.originalname)}`;
      const localPath = path.join(taskDir, storedName);
      fs.renameSync(imgFile.path, localPath);

      let filePath = path.relative(STORAGE, localPath);
      let gdriveFileId = null;

      const r2Path = await storeInR2(taskId, storedName, localPath, imgFile.mimetype, 'images');
      if (r2Path) {
        filePath = r2Path;
      } else if (isOnline && gdrive.isConfigured()) {
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

      const ins = db.run("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, GDrive_File_ID, File_Size, Label, File_Type, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, '', 'image', ?)",
        [taskId, imgFile.originalname, storedName, filePath, gdriveFileId, imgFile.size, req.session.userId]);
      uploaded.push({ File_ID: ins.lastId, Original_Name: imgFile.originalname, Label: '', File_Type: 'image' });
    }

    res.json({ images: uploaded, count: uploaded.length });
  } catch (e) { console.error('Image upload error:', e); res.status(500).json({ error: e.message || 'فشل رفع الصور' }); }
});

router.post('/copy/:taskId', requirePermission('orders'), async (req, res) => {
  try {
    const taskId = parseInt(req.params.taskId, 10);
    const fileIds = (req.body.fileIds || []).map(Number);
    if (!fileIds.length) return res.status(400).json({ error: 'لم يتم اختيار ملفات' });

    const order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [taskId]);
    if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
    if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });

    const clientDir = ensureClientDir(order.Client_Name || `client_${order.Client_ID}`);
    const dateDir = ensureDateDir(clientDir);
    const taskDir = ensureTaskDir(dateDir, taskId);

    const copied = [];
    for (const fileId of fileIds) {
      const src = db.get("SELECT * FROM Order_Files WHERE File_ID=?", [fileId]);
      if (!src) continue;
      const sourceOrder = db.get('SELECT * FROM Orders WHERE Task_ID=?', [src.Task_ID]);
      if (!canAccessOrder(req, sourceOrder)) continue;

      const buffer = await getFileBuffer(src);
      if (!buffer) continue;

      const storedName = `TaskID_${taskId}_${Date.now()}_${safeFileName(src.Original_Name)}`;
      const localPath = path.join(taskDir, storedName);
      fs.writeFileSync(localPath, buffer);

      let filePath = path.relative(STORAGE, localPath);
      let gdriveFileId = null;
      const isOnline = await checkConnectivity();

      if (buffer && isOnline && gdrive.isConfigured()) {
        try {
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
      } else if (buffer) {
        db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)",
          [taskId, order.Client_Name, storedName, localPath]);
      }

      const ins = db.run("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, GDrive_File_ID, File_Size, Label, File_Type, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [taskId, src.Original_Name, storedName, filePath, gdriveFileId, src.File_Size, src.Label, src.File_Type, req.session.userId]);

      copied.push({ File_ID: ins.lastId, Original_Name: src.Original_Name, Label: src.Label, File_Type: src.File_Type });
    }

    if (copied.length) {
      const first = db.get("SELECT * FROM Order_Files WHERE Task_ID=? ORDER BY File_ID LIMIT 1", [taskId]);
      if (first) {
        if (shouldSendToMachine(order)) {
          db.run("UPDATE Orders SET File_Path=?, File_Name=?, Status='جاهز للقص', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [first.File_Path, first.Original_Name, taskId]);
        } else {
          db.run("UPDATE Orders SET File_Path=?, File_Name=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [first.File_Path, first.Original_Name, taskId]);
        }
      }
      db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [taskId, `تم استرجاع ${copied.length} ملف(ات) للطلب #${taskId}`, 'info']);
    }

    res.json({ copied, count: copied.length });
  } catch (e) { console.error('Copy error:', e); res.status(500).json({ error: e.message || 'فشل الاسترجاع' }); }
});

async function getFileBuffer(file) {
  try {
    if (r2.isR2Path(file.File_Path)) {
      const stream = await r2.getStream(file.File_Path);
      if (!stream) return null;
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    }
    if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
      const fileId = file.File_Path.replace('gdrive://', '');
      const stream = await gdrive.downloadFile(fileId);
      if (!stream) return null;
      return await new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (c) => chunks.push(c));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    } else {
      const fullPath = resolveLocalFile(file.File_Path);
      if (!fullPath) return null;
      return fs.readFileSync(fullPath);
    }
  } catch (e) {
    console.error('getFileBuffer error:', e);
    return null;
  }
}

router.get('/list/:taskId', requireAuth(), (req, res) => {
  const order = db.get('SELECT * FROM Orders WHERE Task_ID=?', [req.params.taskId]);
  if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });
  const files = db.all("SELECT * FROM Order_Files WHERE Task_ID=? ORDER BY File_Type, Is_Current DESC, Created_At DESC", [req.params.taskId]);
  res.json(files || []);
});

router.put('/label/:fileId', requirePermission('orders'), (req, res) => {
  const file = db.get("SELECT * FROM Order_Files WHERE File_ID=?", [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });
  if (!canAccessOrder(req, db.get('SELECT * FROM Orders WHERE Task_ID=?', [file.Task_ID]))) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });
  const label = (req.body.label || '').toString().trim() || file.Original_Name;
  db.run("UPDATE Order_Files SET Label=? WHERE File_ID=?", [label, file.File_ID]);
  res.json({ ok: true, label });
});

router.get('/image/:fileId', requireAuth(), async (req, res) => {
  const file = db.get("SELECT * FROM Order_Files WHERE File_ID=?", [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });
  if (!canAccessOrder(req, db.get('SELECT * FROM Orders WHERE Task_ID=?', [file.Task_ID]))) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });

  if (r2.isR2Path(file.File_Path)) {
    try {
      const stream = await r2.getStream(file.File_Path);
      if (stream) { imageHeaders(res); res.type(path.extname(file.Original_Name)); return stream.pipe(res); }
    } catch (e) { console.error('R2 image read error:', e.message); }
  } else if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
    try {
      const fileId = file.File_Path.replace('gdrive://', '');
      const fileStream = await gdrive.downloadFile(fileId);
      if (fileStream) { res.setHeader('Content-Type', 'image/jpeg'); return fileStream.pipe(res); }
    } catch (e) { /* fallback */ }
  } else if (file.File_Path) {
    const fullPath = resolveLocalFile(file.File_Path);
    if (fullPath) { imageHeaders(res); return res.sendFile(fullPath); }
  }
  res.status(404).json({ error: 'الصورة غير موجودة' });
});

router.get('/download/:taskId', requireAuth(), async (req, res) => {
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.taskId]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });

  const files = db.all("SELECT * FROM Order_Files WHERE Task_ID=? AND (File_Type='image' OR COALESCE(Is_Current, 1)=1)", [req.params.taskId]);

  if (files && files.length > 1) {
    const zipName = `Task_${order.Task_ID}_${order.Client_Name || 'files'}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);

    const archive = new ZipArchive({ zlib: { level: 1 } });
    archive.pipe(res);

    for (const file of files) {
      if (r2.isR2Path(file.File_Path)) {
        try {
          const stream = await r2.getStream(file.File_Path);
          if (stream) archive.append(stream, { name: file.Original_Name });
        } catch (e) { console.error('ZIP append R2 error:', e.message); }
      } else if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
        try {
          const fileId = file.File_Path.replace('gdrive://', '');
          const stream = await gdrive.downloadFile(fileId);
          if (stream) archive.append(stream, { name: file.Original_Name });
        } catch (e) { console.error('ZIP append gdrive error:', e); }
      } else if (file.File_Path) {
        const fullPath = resolveLocalFile(file.File_Path);
        if (fullPath) archive.file(fullPath, { name: file.Original_Name });
      }
    }

    archive.finalize();
    return;
  }

  if (files && files.length === 1) {
    const file = files[0];
    if (r2.isR2Path(file.File_Path)) {
      try {
        const stream = await r2.getStream(file.File_Path);
        if (stream) {
          res.setHeader('Content-Disposition', `attachment; filename="${file.Original_Name}"`);
          return stream.pipe(res);
        }
      } catch (e) { console.error('R2 download error:', e.message); }
    } else if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
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
      const fullPath = resolveLocalFile(file.File_Path);
      if (fullPath) return res.download(fullPath, file.Original_Name);
    }
  }

  if (order.File_Path) {
    if (r2.isR2Path(order.File_Path)) {
      try {
        const stream = await r2.getStream(order.File_Path);
        if (stream) {
          res.setHeader('Content-Disposition', `attachment; filename="${order.File_Name || `task_${order.Task_ID}.dxf`}"`);
          return stream.pipe(res);
        }
      } catch (e) { console.error('R2 order download error:', e.message); }
    } else if (order.File_Path.startsWith('gdrive://')) {
      try {
        const fileId = order.File_Path.replace('gdrive://', '');
        const fileStream = await gdrive.downloadFile(fileId);
        if (fileStream) {
          res.setHeader('Content-Disposition', `attachment; filename="${order.File_Name || `task_${order.Task_ID}.dxf`}"`);
          fileStream.pipe(res);
          return;
        }
      } catch (e) {
        const localPath = resolveLocalFile(order.File_Path);
        if (localPath) return res.download(localPath, order.File_Name);
        res.status(500).json({ error: 'خطأ في تحميل الملف من Google Drive' });
      }
      return;
    }
    const filePath = resolveLocalFile(order.File_Path);
    if (filePath) return res.download(filePath, order.File_Name || `task_${order.Task_ID}.dxf`);
  }

  res.status(404).json({ error: 'لا توجد ملفات لهذا الطلب' });
});

router.get('/download-file/:fileId', requireAuth(), async (req, res) => {
  const file = db.get("SELECT * FROM Order_Files WHERE File_ID=?", [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });
  if (!canAccessOrder(req, db.get('SELECT * FROM Orders WHERE Task_ID=?', [file.Task_ID]))) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });

  if (r2.isR2Path(file.File_Path)) {
    try {
      const stream = await r2.getStream(file.File_Path);
      if (stream) {
        res.setHeader('Content-Disposition', `attachment; filename="${file.Original_Name}"`);
        return stream.pipe(res);
      }
    } catch (e) { console.error('R2 file download error:', e.message); }
  } else if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
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
    const fullPath = resolveLocalFile(file.File_Path);
    if (fullPath) return res.download(fullPath, file.Original_Name);
  }

  res.status(404).json({ error: 'الملف غير موجود على القرص' });
});

router.delete('/file/:fileId', requirePermission('orders'), async (req, res) => {
  const file = db.get("SELECT * FROM Order_Files WHERE File_ID=?", [req.params.fileId]);
  if (!file) return res.status(404).json({ error: 'الملف غير موجود' });
  if (!canAccessOrder(req, db.get('SELECT * FROM Orders WHERE Task_ID=?', [file.Task_ID]))) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });

  if (r2.isR2Path(file.File_Path)) {
    await r2.remove(file.File_Path);
  } else if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
    await gdrive.deleteFile(file.File_Path.replace('gdrive://', ''));
  } else if (file.File_Path) {
    const fullPath = path.join(STORAGE, file.File_Path);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  }

  db.run("DELETE FROM Order_Files WHERE File_ID=?", [file.File_ID]);

  const remaining = db.get("SELECT COUNT(*) as cnt FROM Order_Files WHERE Task_ID=?", [file.Task_ID]);
  if (remaining && remaining.cnt === 0) {
    const cur = db.get("SELECT Status FROM Orders WHERE Task_ID=?", [file.Task_ID]);
    // Only send back to design phase from ready-to-cut; never touch
    // delivered or pending-approval orders.
    if (cur && cur.Status === 'جاهز للقص') {
      db.run("UPDATE Orders SET File_Path=NULL, File_Name=NULL, Status='قيد التصميم', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [file.Task_ID]);
    } else {
      db.run("UPDATE Orders SET File_Path=NULL, File_Name=NULL, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [file.Task_ID]);
    }
  }

  const updated = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [file.Task_ID]);
  if (global.io) global.io.emit('order-update', updated);
  res.json({ order: updated });
});

router.delete('/:taskId', requirePermission('orders'), async (req, res) => {
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.taskId]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });

  const files = db.all("SELECT * FROM Order_Files WHERE Task_ID=?", [req.params.taskId]);
  if (files) {
    for (const file of files) {
      if (r2.isR2Path(file.File_Path)) {
        await r2.remove(file.File_Path);
      } else if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
        await gdrive.deleteFile(file.File_Path.replace('gdrive://', ''));
      } else if (file.File_Path) {
        const filePath = path.join(STORAGE, file.File_Path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }
    db.run("DELETE FROM Order_Files WHERE Task_ID=?", [req.params.taskId]);
  }

  if (order.File_Path) {
    if (r2.isR2Path(order.File_Path)) {
      await r2.remove(order.File_Path);
    } else if (order.File_Path.startsWith('gdrive://')) {
      await gdrive.deleteFile(order.File_Path.replace('gdrive://', ''));
    } else {
      const filePath = path.join(STORAGE, order.File_Path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }

  const curSt = db.get("SELECT Status FROM Orders WHERE Task_ID=?", [req.params.taskId]);
  if (curSt && curSt.Status === 'جاهز للقص') {
    db.run("UPDATE Orders SET File_Path=NULL, File_Name=NULL, Status='قيد التصميم', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [req.params.taskId]);
  } else {
    db.run("UPDATE Orders SET File_Path=NULL, File_Name=NULL, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [req.params.taskId]);
  }
  const updated = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [req.params.taskId]);
  if (global.io) global.io.emit('order-update', updated);
  res.json({ order: updated });
});

module.exports = router;
