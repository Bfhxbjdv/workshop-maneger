const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { requireAuth, requirePermission, canAccessOrder } = require('../middleware/auth');

const STORAGE = path.join(__dirname, '..', 'Designs_Storage');
if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE, { recursive: true });
// Design files are kept outside the public directory and are only read through
// authenticated routes below.  Therefore a workshop can store any design
// format (including formats the browser cannot render), without exposing the
// server as a public file host.
function makeUpload(maxFiles) {
  return multer({
    dest: path.join(__dirname, '..', 'uploads'),
    limits: { fileSize: 25 * 1024 * 1024, files: maxFiles }
  });
}

function uploadFields(fields, maxFiles) {
  const middleware = makeUpload(maxFiles).fields(fields);
  return (req, res, next) => middleware(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'حجم كل ملف يجب ألا يتجاوز 25 ميغابايت' });
    }
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'عدد الملفات المحدد أكبر من المسموح' });
    }
    console.error('Design upload error:', error);
    return res.status(400).json({ error: 'تعذر قراءة الملف المرفوع: ' + (error.message || 'خطأ غير معروف') });
  });
}

const singleDesignUpload = uploadFields([{ name: 'file', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }], 2);
const batchDesignUpload = uploadFields([{ name: 'files', maxCount: 50 }, { name: 'thumbs', maxCount: 50 }], 100);
const thumbnailUpload = uploadFields([{ name: 'thumbnail', maxCount: 1 }], 1);

const MIME_MAP = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.txt': 'text/plain', '.dxf': 'application/dxf',
  '.plt': 'application/octet-stream', '.eps': 'application/postscript',
  '.cdr': 'application/octet-stream', '.ai': 'application/postscript'
};
function mimeFor(origName) { return MIME_MAP[(path.extname(origName || '')).toLowerCase()] || 'application/octet-stream'; }

// Never let the browser cache design JSON/streams, otherwise freshly-uploaded
// designs stay invisible until a hard refresh.
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  next();
});

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); return d; }

function normalizeRelativeDesignPath(p) {
  if (!p) return '';
  return String(p).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function resolveDesignPath(filePath) {
  if (!filePath) return null;
  const raw = String(filePath).trim();
  if (!raw) return null;
  if (path.isAbsolute(raw)) {
    const safe = path.normalize(raw);
    return safe.startsWith(path.resolve(STORAGE)) ? safe : null;
  }
  const candidate = path.join(STORAGE, normalizeRelativeDesignPath(raw));
  const safe = path.resolve(candidate);
  const root = path.resolve(STORAGE);
  return safe.startsWith(root) ? safe : null;
}

function findDesignFileByName(design) {
  if (!design) return null;
  const target = (design.Original_Name || '').toLowerCase();
  if (!target) return null;
  let found = null;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); }
      else if ((entry.name || '').toLowerCase() === target || path.basename(full).toLowerCase() === target) {
        found = full; break;
      }
    }
  }
  walk(STORAGE);
  return found;
}

function getDesignFilePath(design) {
  if (!design) return null;
  return resolveDesignPath(design.FilePath) || findDesignFileByName(design);
}

function getThumbFilePath(design) {
  if (!design || !design.ThumbnailPath) return null;
  return resolveDesignPath(design.ThumbnailPath) || findDesignFileByName({ Original_Name: path.basename(design.ThumbnailPath) });
}

function canAccessDesign(req, designId) {
  if (req.session.role === 'Admin') return true;
  const permissionCount = db.get('SELECT COUNT(*) as count FROM Design_Permissions WHERE Design_ID=?', [designId]);
  if (!permissionCount?.count) return true;
  return !!db.get('SELECT 1 FROM Design_Permissions WHERE Design_ID=? AND User_ID=?', [designId, req.session.userId]);
}

// ---------- helper: design with permission visibility ----------
function visibleDesignSql(user) {
  if (user.role === 'Admin') {
    return `SELECT d.*, u.Name as Created_By_Name FROM Designs d LEFT JOIN Users u ON d.CreatedBy=u.User_ID`;
  }
  return `SELECT d.*, u.Name as Created_By_Name
    FROM Designs d
    LEFT JOIN Users u ON d.CreatedBy=u.User_ID
    WHERE d.Design_ID IN (
      SELECT Design_ID FROM Design_Permissions WHERE User_ID=${user.userId}
      UNION SELECT Design_ID FROM Designs d2
        WHERE NOT EXISTS (SELECT 1 FROM Design_Permissions dp WHERE dp.Design_ID=d2.Design_ID)
    )`;
}

// ---------- LIST ----------
router.get('/', requireAuth(), (req, res) => {
  const designs = db.all(visibleDesignSql(req.session) + ` ORDER BY d.CreatedAt DESC`);
  const perms = db.all(`
    SELECT dp.Design_ID, u.User_ID, u.Name, u.Username FROM Design_Permissions dp
    JOIN Users u ON u.User_ID=dp.User_ID ORDER BY dp.Design_ID, u.Name`);
  const permsMap = {};
  perms.forEach(p => { (permsMap[p.Design_ID] = permsMap[p.Design_ID] || []).push({ User_ID: p.User_ID, Name: p.Name, Username: p.Username }); });
  res.json(designs.map(d => {
    d.PasswordProtected = !!d.Password;
    delete d.Password;
    d.PermittedUsers = permsMap[d.Design_ID] || [];
    return d;
  }));
});

// ---------- GET ONE ----------
router.get('/:id', requireAuth(), (req, res) => {
  const d = db.get(`SELECT v.* FROM (${visibleDesignSql(req.session)}) v WHERE v.Design_ID=?`, [req.params.id]);
  if (!d) return res.status(404).json({ error: 'التصميم غير موجود أو لا تملك الصلاحية' });
  d.PasswordProtected = !!d.Password;
  const unlocked = !!req.session.unlockedDesigns?.[d.Design_ID];
  if (d.Password && !unlocked) { d.NeedsPassword = true; }
  delete d.Password;
  const perms = db.all("SELECT u.User_ID, u.Name, u.Username FROM Design_Permissions dp JOIN Users u ON u.User_ID=dp.User_ID WHERE dp.Design_ID=?", [req.params.id]);
  d.PermittedUsers = perms;
  res.json(d);
});

// ---------- CREATE (admin) ----------
router.post('/', requirePermission('admin'), singleDesignUpload, (req, res) => {
  try {
    const { Name, Category, Material, Thickness, Width, Height, Unit, Notes, Password } = req.body;
    if (!Name || !req.files?.file?.[0]) return res.status(400).json({ error: 'الاسم والملف مطلوبان' });

    const designDir = ensureDir(path.join(STORAGE, `design_${Date.now()}`));
    const uploaded = req.files.file[0];
    const origName = path.basename(uploaded.originalname || 'design-file');
    const filePath = path.join(designDir, origName);
    fs.renameSync(uploaded.path, filePath);
    const relPath = normalizeRelativeDesignPath(path.relative(STORAGE, filePath));

    let thumbPath = null;
    if (req.files.thumbnail?.[0]) {
      thumbPath = path.join(designDir, 'thumbnail' + path.extname(req.files.thumbnail[0].originalname));
      fs.renameSync(req.files.thumbnail[0].path, thumbPath);
    }

    const hashPass = Password ? bcrypt.hashSync(Password, 10) : null;
    const thumbRel = thumbPath ? path.relative(STORAGE, thumbPath) : null;
    const result = db.run(`INSERT INTO Designs
      (Name, Category, Material, Thickness, Width, Height, Unit, Notes, FilePath, Original_Name, ThumbnailPath, Password, CreatedBy)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [Name, Category || '', Material || '', Thickness || '', parseFloat(Width) || 0, parseFloat(Height) || 0, Unit || 'سم', Notes || '', relPath, origName, thumbRel, hashPass, req.session.userId]);

    res.json({ success: true, Design_ID: result.lastId });
  } catch (e) { console.error('Design create error:', e); res.status(500).json({ error: e.message }); }
});

// ---------- BATCH CREATE (admin) ----------
router.post('/batch', requirePermission('admin'), batchDesignUpload, (req, res) => {
  try {
    let items = [];
    try { items = JSON.parse(req.body.items || '[]'); } catch (e) {}
    const fileArr = req.files?.files || [];
    const thumbArr = req.files?.thumbs || [];
    if (!fileArr.length) return res.status(400).json({ error: 'لم يتم اختيار ملفات' });

    const created = [];
    const errors = [];
    for (let i = 0; i < fileArr.length; i++) {
      try {
        const uploaded = fileArr[i];
        const item = items[i] || {};
        const name = (item.Name || '').trim();
        if (!name) { errors.push(`الملف ${i + 1}: الاسم مطلوب`); continue; }

        const designDir = ensureDir(path.join(STORAGE, `design_${Date.now()}_${i}`));
        const origName = path.basename(uploaded.originalname || `design-${i + 1}`);
        const filePath = path.join(designDir, origName);
        fs.renameSync(uploaded.path, filePath);

        let thumbPath = null;
        const thumbFile = thumbArr[i];
        if (thumbFile) {
          thumbPath = path.join(designDir, 'thumbnail' + (path.extname(thumbFile.originalname) || '.png'));
          fs.renameSync(thumbFile.path, thumbPath);
        }

        const hashPass = item.Password ? bcrypt.hashSync(item.Password, 10) : null;
        const result = db.run(`INSERT INTO Designs
          (Name, Category, Material, Thickness, Width, Height, Unit, Notes, FilePath, Original_Name, ThumbnailPath, Password, CreatedBy)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [name, item.Category || '', item.Material || '', item.Thickness || '',
            parseFloat(item.Width) || 0, parseFloat(item.Height) || 0, item.Unit || 'سم', item.Notes || '',
            path.relative(STORAGE, filePath), origName, thumbPath ? path.relative(STORAGE, thumbPath) : null, hashPass, req.session.userId]);
        created.push(result.lastId);
      } catch (e) {
        errors.push(`الملف ${i + 1}: ${e.message}`);
        try { fs.rmSync(path.join(STORAGE, `design_${Date.now()}_${i}`), { recursive: true, force: true }); } catch {}
      }
    }

    if (!created.length) return res.status(400).json({ error: errors.join(' | ') || 'فشل رفع أي ملف' });
    res.json({ success: true, created, count: created.length, errors: errors.slice(0, 5) });
  } catch (e) { console.error('Design batch error:', e); res.status(500).json({ error: e.message }); }
});

// ---------- UPDATE (admin) ----------
router.put('/:id', requirePermission('admin'), thumbnailUpload, (req, res) => {
  try {
    const d = db.get("SELECT * FROM Designs WHERE Design_ID=?", [req.params.id]);
    if (!d) return res.status(404).json({ error: 'التصميم غير موجود' });
    const { Name, Category, Material, Thickness, Width, Height, Unit, Notes, Password, ClearPassword } = req.body;

    let thumbPath = d.ThumbnailPath;
    if (req.files?.thumbnail?.[0]) {
      try { if (thumbPath) fs.unlinkSync(path.join(STORAGE, thumbPath)); } catch {}
      const designDir = path.dirname(d.FilePath);
      thumbPath = path.join(designDir, 'thumbnail' + path.extname(req.files.thumbnail[0].originalname));
      ensureDir(path.dirname(path.join(STORAGE, thumbPath)));
      fs.renameSync(req.files.thumbnail[0].path, path.join(STORAGE, thumbPath));
    }

    let passHash = d.Password;
    if (ClearPassword === '1') {
      passHash = null;
    } else if (Password && Password !== '') {
      passHash = bcrypt.hashSync(Password, 10);
    }

    db.run(`UPDATE Designs SET Name=?, Category=?, Material=?, Thickness=?, Width=?, Height=?, Unit=?, Notes=?, ThumbnailPath=?, Password=? WHERE Design_ID=?`,
      [Name || d.Name, Category ?? d.Category, Material ?? d.Material, Thickness ?? d.Thickness,
        Width !== undefined ? (parseFloat(Width) || 0) : d.Width,
        Height !== undefined ? (parseFloat(Height) || 0) : d.Height,
        Unit || d.Unit, Notes ?? d.Notes, thumbPath, passHash, req.params.id]);

    res.json({ success: true });
  } catch (e) { console.error('Design update error:', e); res.status(500).json({ error: e.message }); }
});

// ---------- DELETE (admin) ----------
router.delete('/:id', requirePermission('admin'), (req, res) => {
  const d = db.get("SELECT * FROM Designs WHERE Design_ID=?", [req.params.id]);
  if (!d) return res.status(404).json({ error: 'التصميم غير موجود' });
  if (!canAccessDesign(req, d.Design_ID)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا التصميم' });
  try { fs.rmSync(path.join(STORAGE, path.dirname(d.FilePath)), { recursive: true, force: true }); } catch {}
  db.run("UPDATE Agent_Images SET Design_ID=NULL WHERE Design_ID=?", [req.params.id]);
  db.run("DELETE FROM Designs WHERE Design_ID=?", [req.params.id]);
  res.json({ success: true });
});

// ---------- PERMISSIONS (admin) ----------
router.post('/:id/permissions', requirePermission('admin'), (req, res) => {
  const { userIds } = req.body;
  const d = db.get("SELECT * FROM Designs WHERE Design_ID=?", [req.params.id]);
  if (!d) return res.status(404).json({ error: 'التصميم غير موجود' });
  db.run("DELETE FROM Design_Permissions WHERE Design_ID=?", [req.params.id]);
  (userIds || []).forEach(uid => {
    db.run("INSERT OR IGNORE INTO Design_Permissions (Design_ID, User_ID) VALUES (?, ?)", [req.params.id, uid]);
  });
  res.json({ success: true });
});

// ---------- VERIFY PASSWORD ----------
router.post('/:id/verify-password', requireAuth(), (req, res) => {
  const d = db.get("SELECT * FROM Designs WHERE Design_ID=?", [req.params.id]);
  if (!d) return res.status(404).json({ error: 'التصميم غير موجود' });
  if (!canAccessDesign(req, d.Design_ID)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا التصميم' });
  if (!d.Password) return res.json({ success: true });
  const ok = bcrypt.compareSync(req.body.Password || '', d.Password);
  if (!ok) return res.status(403).json({ error: 'كلمة المرور غير صحيحة' });
  if (!req.session.unlockedDesigns) req.session.unlockedDesigns = {};
  req.session.unlockedDesigns[d.Design_ID] = true;
  res.json({ success: true });
});

// ---------- THUMBNAIL ----------
router.get('/:id/thumbnail', requireAuth(), (req, res) => {
  const d = db.get("SELECT * FROM Designs WHERE Design_ID=?", [req.params.id]);
  if (!d || !d.ThumbnailPath) return res.status(404).send('no thumb');
  if (!canAccessDesign(req, d.Design_ID)) return res.status(403).send('لا تملك الصلاحية لهذا التصميم');
  const fp = getThumbFilePath(d);
  if (!fp || !fs.existsSync(fp)) return res.status(404).send('no thumb');
  res.sendFile(fp);
});

// ---------- FILE STREAM (view/download inside site) ----------
router.get('/:id/file', requireAuth(), (req, res) => {
  const d = db.get("SELECT * FROM Designs WHERE Design_ID=?", [req.params.id]);
  if (!d) return res.status(404).json({ error: 'التصميم غير موجود' });
  // permission check
  if (req.session.role !== 'Admin') {
    const allowed = db.get("SELECT 1 FROM Design_Permissions WHERE Design_ID=? AND User_ID=?", [req.params.id, req.session.userId]);
    const any = db.get("SELECT COUNT(*) as c FROM Design_Permissions WHERE Design_ID=?", [req.params.id]);
    if (!allowed && any.c > 0) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الملف' });
  }
  // password check
  if (d.Password && !req.session.unlockedDesigns?.[d.Design_ID]) {
    return res.status(403).json({ error: 'هذا الملف محمي بكلمة مرور', needsPassword: true });
  }
  const fp = getDesignFilePath(d);
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'الملف غير موجود' });
  const ext = path.extname(d.Original_Name || '').toLowerCase();
  const inline = ['.png','.jpg','.jpeg','.gif','.webp','.bmp','.svg','.pdf','.txt','.dxf','.plt'].includes(ext);
  res.setHeader('Content-Type', mimeFor(d.Original_Name));
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${d.Original_Name}"`);
  if (inline) res.setHeader('Access-Control-Allow-Origin', '*');
  fs.createReadStream(fp).pipe(res);
});

// ---------- DOWNLOAD (always attachment) ----------
router.get('/:id/download', requireAuth(), (req, res) => {
  const d = db.get("SELECT * FROM Designs WHERE Design_ID=?", [req.params.id]);
  if (!d) return res.status(404).json({ error: 'التصميم غير موجود' });
  if (req.session.role !== 'Admin') {
    const allowed = db.get("SELECT 1 FROM Design_Permissions WHERE Design_ID=? AND User_ID=?", [req.params.id, req.session.userId]);
    const any = db.get("SELECT COUNT(*) as c FROM Design_Permissions WHERE Design_ID=?", [req.params.id]);
    if (!allowed && any.c > 0) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الملف' });
  }
  if (d.Password && !req.session.unlockedDesigns?.[d.Design_ID]) {
    return res.status(403).json({ error: 'هذا الملف محمي بكلمة مرور', needsPassword: true });
  }
  const fp = getDesignFilePath(d);
  if (!fp || !fs.existsSync(fp)) return res.status(404).json({ error: 'الملف غير موجود' });
  res.download(fp, d.Original_Name || `design_${d.Design_ID}`);
});

// ---------- ADD DESIGN TO CLIENT ORDER ----------
const CLIENT_ARCHIVE = path.join(__dirname, '..', 'Server_Storage', 'Clients_Archive');
if (!fs.existsSync(CLIENT_ARCHIVE)) fs.mkdirSync(CLIENT_ARCHIVE, { recursive: true });

function clientDirFor(clientName) {
  const safe = (clientName || `client`).replace(/[<>:"\/\\|?*]/g, '_').trim() || 'client';
  const d = path.join(CLIENT_ARCHIVE, safe);
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  return d;
}

router.post('/:id/add-to-order', requirePermission('orders'), async (req, res) => {
  try {
    const design = db.get("SELECT * FROM Designs WHERE Design_ID=?", [req.params.id]);
    if (!design) return res.status(404).json({ error: 'التصميم غير موجود' });

    if (req.session.role !== 'Admin') {
      const allowed = db.get("SELECT 1 FROM Design_Permissions WHERE Design_ID=? AND User_ID=?", [req.params.id, req.session.userId]);
      const any = db.get("SELECT COUNT(*) as c FROM Design_Permissions WHERE Design_ID=?", [req.params.id]);
      if (!allowed && any.c > 0) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الملف' });
    }
    if (design.Password && !req.session.unlockedDesigns?.[design.Design_ID]) {
      return res.status(403).json({ error: 'هذا الملف محمي بكلمة مرور', needsPassword: true });
    }

    let order = null;
    let client = null;

    if (req.body.Task_ID) {
      const orderRow = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [req.body.Task_ID]);
      if (orderRow && canAccessOrder(req, orderRow)) { order = orderRow; order.Task_ID = parseInt(req.body.Task_ID, 10); }
    }
    if (!order && req.body.Client_ID) {
      const c = db.get("SELECT * FROM Clients WHERE Client_ID=?", [req.body.Client_ID]);
      if (c) {
        client = c;
        let designerId = req.session.userId;
        if (req.body.Designer_ID && ['Admin', 'Custom'].includes(req.session.role)) {
          const des = db.get("SELECT User_ID FROM Users WHERE User_ID=? AND (Role='Designer' OR Role='Admin')", [req.body.Designer_ID]);
          if (!des) designerId = req.session.userId;
        }
        const machineType = (req.body.Machine_Type || '').toString().toLowerCase() === 'router' ? 'Router' : 'Laser';
        // Agents must go through approval like any other agent order —
        // never create a directly-approved order from here.
        const isAgentOrder = req.session.role === 'Agent';
        const res2 = db.run("INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Notes) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [c.Client_ID, isAgentOrder ? null : designerId, req.session.userId, machineType,
           isAgentOrder ? 'بانتظار الموافقة' : 'قيد التصميم',
           isAgentOrder ? 'pending' : 'approved',
           `إضافة تصميم: ${design.Name}`]);
        order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [res2.lastId]);
        if (order) order.Task_ID = res2.lastId;
      }
    }

    if (!order) return res.status(404).json({ error: 'الطلب أو العميل غير موجود' });

    const clientDir = clientDirFor(order.Client_Name || `client_${order.Client_ID}`);
    const now = new Date();
    const monthDir = path.join(clientDir, now.getFullYear().toString(), now.toLocaleString('en', { month: 'long' }));
    if (!fs.existsSync(monthDir)) fs.mkdirSync(monthDir, { recursive: true });
    const taskDir = path.join(monthDir, `Task_${order.Task_ID}`);
    if (!fs.existsSync(taskDir)) fs.mkdirSync(taskDir, { recursive: true });

    const srcPath = getDesignFilePath(design);
    if (!srcPath || !fs.existsSync(srcPath)) return res.status(404).json({ error: 'ملف التصميم غير موجود على القرص' });
    const buffer = fs.readFileSync(srcPath);

    const storedName = `TaskID_${order.Task_ID}_${design.Original_Name}`;
    const localPath = path.join(taskDir, storedName);
    fs.writeFileSync(localPath, buffer);

    let filePath = path.relative(CLIENT_ARCHIVE, localPath);
    let gdriveFileId = null;
    const gdrive = require('../services/googleDrive');
    try {
      const http = require('http');
      const online = await new Promise(resolve => {
        const r = http.get('http://clients3.google.com/generate_204', { timeout: 3000 }, (res3) => { resolve(res3.statusCode === 204); r.destroy(); });
        r.on('error', () => resolve(false)); r.on('timeout', () => { r.destroy(); resolve(false); });
      });
      if (online && gdrive.isConfigured()) {
        const up = await gdrive.uploadFile(order.Task_ID, order.Client_Name, storedName, buffer);
        if (up && up.fileId) { gdriveFileId = up.fileId; filePath = `gdrive://${up.fileId}`; }
        else db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)", [order.Task_ID, order.Client_Name, storedName, localPath]);
      } else {
        db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)", [order.Task_ID, order.Client_Name, storedName, localPath]);
      }
    } catch (e) {
      db.run("INSERT INTO Upload_Queue (Task_ID, Client_Name, Original_Name, File_Path) VALUES (?, ?, ?, ?)", [order.Task_ID, order.Client_Name, storedName, localPath]);
    }

    const ins = db.run("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, GDrive_File_ID, File_Size, Label, File_Type, Uploaded_By) VALUES (?, ?, ?, ?, ?, ?, ?, 'design', ?)",
      [order.Task_ID, design.Original_Name, storedName, filePath, gdriveFileId, buffer.length, `${design.Name}${design.Notes ? ' - ' + design.Notes : ''}`, req.session.userId]);

    if (order.Status === 'قيد التصميم') {
      db.run("UPDATE Orders SET File_Path=?, File_Name=?, Status='جاهز للقص', Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [filePath, design.Original_Name, order.Task_ID]);
    } else {
      db.run("UPDATE Orders SET File_Path=?, File_Name=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [filePath, design.Original_Name, order.Task_ID]);
    }
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [order.Task_ID, `أُضيف التصميم «${design.Name}» إلى الطلب #${order.Task_ID}`, 'info']);

    const updated = db.get(`SELECT o.*, c.Full_Name as Client_Name, c.Phone_Number, i.Material_Name, i.Thickness
      FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID LEFT JOIN Inventory i ON o.Material_ID=i.Material_ID WHERE o.Task_ID=?`, [order.Task_ID]);
    if (global.io) { global.io.emit('order-update', updated); global.io.emit('notification', { message: `أُضيف التصميم «${design.Name}» إلى الطلب #${order.Task_ID}`, type: 'info' }); }

    res.json({ success: true, File_ID: ins.lastId, Task_ID: order.Task_ID, Client_Name: order.Client_Name });
  } catch (e) { console.error('Add design to order error:', e); res.status(500).json({ error: e.message || 'فشل إضافة التصميم إلى الطلب' }); }
});

module.exports = router;
