const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/connection');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth(['Admin']), (req, res) => {
  const users = db.all("SELECT User_ID, Name, Role, Username, Permissions, Created_At FROM Users");
  res.json(users);
});

const VALID_ROLES = ['Admin', 'Designer', 'Laser_Op', 'Router_Op', 'Custom', 'Agent'];

router.post('/', requireAuth(['Admin']), (req, res) => {
  const { Name, Role, Username, Password, Permissions } = req.body;
  if (!Name || !Role || !Username || !Password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  if (!VALID_ROLES.includes(Role)) return res.status(400).json({ error: 'الدور غير صالح' });
  const hash = bcrypt.hashSync(Password, 10);
  const perms = JSON.stringify(Permissions || {});
  try {
    db.run("INSERT INTO Users (Name, Role, Username, Password, Permissions) VALUES (?, ?, ?, ?, ?)", [Name, Role, Username, hash, perms]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
  }
});

// Self-service: change own username/password
router.put('/me', requireAuth([]), (req, res) => {
  const { currentPassword, newUsername, newPassword } = req.body;
  const current = db.get("SELECT * FROM Users WHERE User_ID=?", [req.session.userId]);
  if (!current) return res.status(404).json({ error: 'المستخدم غير موجود' });

  if (!bcrypt.compareSync(currentPassword || '', current.Password)) {
    return res.status(400).json({ error: 'كلمة المرور الحالية غير صحيحة' });
  }

  let finalUsername = current.Username;
  if (newUsername && newUsername !== current.Username) {
    const exists = db.get("SELECT User_ID FROM Users WHERE Username=? AND User_ID != ?", [newUsername, current.User_ID]);
    if (exists) return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
    finalUsername = newUsername;
  }

  if (newPassword) {
    const hash = bcrypt.hashSync(newPassword, 10);
    db.run("UPDATE Users SET Username=?, Password=? WHERE User_ID=?", [finalUsername, hash, current.User_ID]);
  } else {
    db.run("UPDATE Users SET Username=? WHERE User_ID=?", [finalUsername, current.User_ID]);
  }
  req.session.username = finalUsername;
  if (newPassword) req.session.passwordChanged = true;
  res.json({ success: true });
});

router.put('/:id', requireAuth(['Admin']), (req, res) => {
  const { Name, Role, Username, Password, Permissions } = req.body;
  const current = db.get("SELECT * FROM Users WHERE User_ID=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const perms = Permissions !== undefined ? JSON.stringify(Permissions) : current.Permissions;
  const finalName = Name || current.Name;
  const finalRole = Role || current.Role;
  if (!VALID_ROLES.includes(finalRole)) return res.status(400).json({ error: 'الدور غير صالح' });
  let finalUsername = current.Username;
  if (Username && Username !== current.Username) {
    const exists = db.get("SELECT User_ID FROM Users WHERE Username=? AND User_ID != ?", [Username, req.params.id]);
    if (exists) return res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
    finalUsername = Username;
  }
  if (Password) {
    const hash = bcrypt.hashSync(Password, 10);
    db.run("UPDATE Users SET Name=?, Role=?, Username=?, Password=?, Permissions=? WHERE User_ID=?", [finalName, finalRole, finalUsername, hash, perms, req.params.id]);
  } else {
    db.run("UPDATE Users SET Name=?, Role=?, Username=?, Permissions=? WHERE User_ID=?", [finalName, finalRole, finalUsername, perms, req.params.id]);
  }
  res.json({ success: true });
});

router.delete('/:id', requireAuth(['Admin']), (req, res) => {
  const target = db.get("SELECT * FROM Users WHERE User_ID=?", [req.params.id]);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (target.Role === 'Admin') return res.status(400).json({ error: 'لا يمكن حذف حساب مدير' });
  if (Number(req.params.id) === Number(req.session.userId)) return res.status(400).json({ error: 'لا يمكنك حذف حسابك الحالي' });
  const depOrder = db.get("SELECT Task_ID FROM Orders WHERE Designer_ID=? OR Created_By=? LIMIT 1", [req.params.id, req.params.id]);
  if (depOrder) return res.status(400).json({ error: `لا يمكن حذف المستخدم لوجود طلبات مرتبطة به (مثال: طلب #${depOrder.Task_ID}) — عطّل حسابه بدلاً من ذلك` });
  const depClient = db.get("SELECT Client_ID FROM Clients WHERE Created_By=? OR Agent_ID=? LIMIT 1", [req.params.id, req.params.id]);
  if (depClient) return res.status(400).json({ error: 'لا يمكن حذف المستخدم لوجود عملاء مرتبطين به' });
  const depDesign = db.get("SELECT Design_ID FROM Designs WHERE CreatedBy=? LIMIT 1", [req.params.id]);
  if (depDesign) return res.status(400).json({ error: 'لا يمكن حذف المستخدم لوجود تصاميم مرتبطة به' });
  db.run("DELETE FROM Users WHERE User_ID=? AND Role != 'Admin'", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
