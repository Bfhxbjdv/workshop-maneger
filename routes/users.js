const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/connection');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth(['Admin']), (req, res) => {
  const users = db.all("SELECT User_ID, Name, Role, Username, Created_At FROM Users");
  res.json(users);
});

router.post('/', requireAuth(['Admin']), (req, res) => {
  const { Name, Role, Username, Password } = req.body;
  if (!Name || !Role || !Username || !Password) return res.status(400).json({ error: 'جميع الحقول مطلوبة' });
  const hash = bcrypt.hashSync(Password, 10);
  try {
    db.run("INSERT INTO Users (Name, Role, Username, Password) VALUES (?, ?, ?, ?)", [Name, Role, Username, hash]);
    res.json({ success: true });
  } catch (e) {
    res.status(400).json({ error: 'اسم المستخدم موجود مسبقاً' });
  }
});

router.put('/:id', requireAuth(['Admin']), (req, res) => {
  const { Name, Role, Password } = req.body;
  if (Password) {
    const hash = bcrypt.hashSync(Password, 10);
    db.run("UPDATE Users SET Name=?, Role=?, Password=? WHERE User_ID=?", [Name, Role, hash, req.params.id]);
  } else {
    db.run("UPDATE Users SET Name=?, Role=? WHERE User_ID=?", [Name, Role, req.params.id]);
  }
  res.json({ success: true });
});

router.delete('/:id', requireAuth(['Admin']), (req, res) => {
  db.run("DELETE FROM Users WHERE User_ID=? AND Role != 'Admin'", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
