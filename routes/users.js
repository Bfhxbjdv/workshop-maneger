const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/connection');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth(['Admin']), (req, res) => {
  const users = db.all("SELECT User_ID, Name, Role, Username, Permissions, Created_At FROM Users");
  res.json(users);
});

router.post('/', requireAuth(['Admin']), (req, res) => {
  const { Name, Role, Username, Password, Permissions } = req.body;
  if (!Name || !Role || !Username || !Password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const hash = bcrypt.hashSync(Password, 10);
  const perms = JSON.stringify(Permissions || {});
  try {
    db.run("INSERT INTO Users (Name, Role, Username, Password, Permissions) VALUES (?, ?, ?, ?, ?)", [Name, Role, Username, hash, perms]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
  }
});

router.put('/:id', requireAuth(['Admin']), (req, res) => {
  const { Name, Role, Password, Permissions } = req.body;
  const current = db.get("SELECT * FROM Users WHERE User_ID=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const perms = Permissions !== undefined ? JSON.stringify(Permissions) : current.Permissions;
  const finalName = Name || current.Name;
  const finalRole = Role || current.Role;
  if (Password) {
    const hash = bcrypt.hashSync(Password, 10);
    db.run("UPDATE Users SET Name=?, Role=?, Password=?, Permissions=? WHERE User_ID=?", [finalName, finalRole, hash, perms, req.params.id]);
  } else {
    db.run("UPDATE Users SET Name=?, Role=?, Permissions=? WHERE User_ID=?", [finalName, finalRole, perms, req.params.id]);
  }
  res.json({ success: true });
});

router.delete('/:id', requireAuth(['Admin']), (req, res) => {
  db.run("DELETE FROM Users WHERE User_ID=? AND Role != 'Admin'", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
