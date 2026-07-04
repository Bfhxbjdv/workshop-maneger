const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const initDatabase = require('./database/init');
const db = require('./database/connection');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
global.io = io;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'workshop-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  res.locals.user = req.session.userId ? {
    name: req.session.name,
    role: req.session.role,
    username: req.session.username
  } : null;
  next();
});

app.use('/', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/users', require('./routes/users'));
app.use('/api/files', require('./routes/files'));

app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const role = req.session.role;
  if (role === 'Designer') return res.render('designer', { user: res.locals.user });
  if (role === 'Laser_Op') return res.render('laser', { user: res.locals.user });
  if (role === 'Router_Op') return res.render('router', { user: res.locals.user });
  res.render('dashboard', { user: res.locals.user });
});

app.get('/clients', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('clients', { user: res.locals.user });
});

app.get('/inventory', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('inventory', { user: res.locals.user });
});

app.get('/client/:id', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('client', { user: res.locals.user, clientId: req.params.id });
});

app.get('/users', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('users', { user: res.locals.user });
});

io.on('connection', (socket) => {
  socket.on('join', (data) => { socket.join(data.room || 'general'); });
});

const PORT = process.env.PORT || 3000;

initDatabase().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 النظام يعمل على: http://localhost:${PORT}`);
    console.log(`👤 حسابات مبدئية:`);
    console.log(`   مدير: admin / admin123`);
    console.log(`   مصمم: designer / designer123`);
    console.log(`   ليزر: laser / laser123`);
    console.log(`   راوتر: router / router123`);
  });
}).catch(err => {
  console.error('❌ فشل تهيئة قاعدة البيانات:', err);
  process.exit(1);
});
