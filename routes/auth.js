const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/connection');

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  res.render('login', { error: null });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.get("SELECT * FROM Users WHERE Username = ?", [username]);
  if (!user || !bcrypt.compareSync(password, user.Password)) {
    return res.render('login', { error: 'اسم المستخدم أو كلمة المرور غير صحيحة' });
  }
  req.session.userId = user.User_ID;
  req.session.username = user.Username;
  req.session.role = user.Role;
  req.session.name = user.Name;
  res.redirect('/');
});

router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  res.json({
    user: {
      id: req.session.userId,
      name: req.session.name,
      username: req.session.username,
      role: req.session.role
    }
  });
});

module.exports = router;
