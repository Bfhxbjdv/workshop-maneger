const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { requireAuth, requirePermission } = require('../middleware/auth');

const STORAGE = path.join(__dirname, '..', 'Designs_Storage');
if (!fs.existsSync(STORAGE)) fs.mkdirSync(STORAGE, { recursive: true });
const upload = multer({ dest: path.join(__dirname, '..', 'uploads') });

function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); return d; }

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
router.post('/', requirePermission('admin'), upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumbnail', maxCount: 1 }]), (req, res) => {
  try {
    const { Name, Category, Material, Thickness, Width, Height, Unit, Notes, Password } = req.body;
    if (!Name || !req.files?.file?.[0]) return res.status(400).json({ error: 'الاسم والملف مطلوبان' });

    const designDir = ensureDir(path.join(STORAGE, `design_${Date.now()}`));
    const uploaded = req.files.file[0];
    const origName = uploaded.originalname;
    const filePath = path.join(designDir, origName);
    fs.renameSync(uploaded.path, filePath);

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
      [Name, Category || '', Material || '', Thickness || '', parseFloat(Width) || 0, parseFloat(Height) || 0, Unit || 'سم', Notes || '', path.relative(STORAGE, filePath), origName, thumbRel, hashPass, req.session.userId]);

    res.json({ success: true, Design_ID: result.lastId });
  } catch (e) { console.error('Design create error:', e); res.status(500).json({ error: e.message }); }
});

// ---------- UPDATE (admin) ----------
router.put('/:id', requirePermission('admin'), upload.fields([{ name: 'thumbnail', maxCount: 1 }]), (req, res) => {
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
  try { fs.rmSync(path.join(STORAGE, path.dirname(d.FilePath)), { recursive: true, force: true }); } catch {}
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
  const fp = path.join(STORAGE, d.ThumbnailPath);
  if (!fs.existsSync(fp)) return res.status(404).send('no thumb');
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
  const fp = path.join(STORAGE, d.FilePath);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'الملف غير موجود' });
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${d.Original_Name}"`);
  fs.createReadStream(fp).pipe(res);
});

module.exports = router;