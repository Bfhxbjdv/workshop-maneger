process.on('uncaughtException', err => {
  console.error('❌ خطأ غير متوقع:', err.message);
  try { db?.run?.("INSERT INTO System_Logs (Action, User_ID, Details) VALUES (?, ?, ?)", ['خطأ عام', null, err.message + '\n' + (err.stack || '')]); } catch {}
});
process.on('unhandledRejection', (reason) => {
  console.error('❌ وعد غير معالج:', reason?.message || reason);
});

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const session = require('express-session');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const initDatabase = require('./database/init');
const db = require('./database/connection');
const gdrive = require('./services/googleDrive');
const fs = require('fs');
const { requireAuth, requirePermission } = require('./middleware/auth');

const dirs = ['data', 'uploads', 'Server_Storage', 'Server_Storage/Clients_Archive', 'Server_Storage/Invoices', 'backups', 'logs'];
dirs.forEach(d => { const p = require('path').join(__dirname, d); if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true }); });

const app = express();
const server = http.createServer(app);
const io = new Server(server);
global.io = io;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'workshop-secret-key-2024',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.COOKIE_SECURE === 'true',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use((req, res, next) => {
  if (req.session.userId) {
    const user = db.get("SELECT Permissions FROM Users WHERE User_ID=?", [req.session.userId]);
    let permissions = {};
    try {
      permissions = user ? JSON.parse(user.Permissions || '{}') : {};
    } catch {}
    res.locals.user = {
      name: req.session.name,
      role: req.session.role,
      username: req.session.username,
      permissions: permissions
    };
  } else {
    res.locals.user = null;
  }
  next();
});

app.use('/', require('./routes/auth'));
app.use('/api/clients', require('./routes/clients'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/files', require('./routes/files'));
app.use('/api/inventory', require('./routes/inventory'));
app.use('/api/users', require('./routes/users'));
app.use('/api/invoices', require('./routes/invoices'));
app.use('/api/designs', require('./routes/designs'));
app.use('/admin', require('./routes/admin'));

// Page routes
app.get('/invoices', requirePermission('invoices'), (req, res) => {
  res.render('invoices', { user: res.locals.user });
});

app.get('/', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  const role = req.session.role;
  if (role === 'Designer') return res.render('designer', { user: res.locals.user });
  if (role === 'Laser_Op') return res.render('laser', { user: res.locals.user });
  if (role === 'Router_Op') return res.render('router', { user: res.locals.user });
  res.render('dashboard', { user: res.locals.user });
});

app.get('/clients', requirePermission('clients'), (req, res) => {
  res.render('clients', { user: res.locals.user });
});

app.get('/inventory', requirePermission('inventory'), (req, res) => {
  res.render('inventory', { user: res.locals.user });
});

app.get('/client/:id', requirePermission('clients'), (req, res) => {
  res.render('client', { user: res.locals.user, clientId: req.params.id });
});

app.get('/users', requirePermission('users'), (req, res) => {
  res.render('users', { user: res.locals.user });
});

app.get('/expenses', requirePermission('expenses'), (req, res) => {
  res.render('expenses', { user: res.locals.user });
});

app.get('/designs', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('designs', { user: res.locals.user });
});

app.get('/account', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('account', { user: res.locals.user });
});

io.on('connection', (socket) => {
  socket.on('join', (data) => { socket.join(data.room || 'general'); });
});

// Background sync: process upload queue every 60 seconds if Drive is configured
setInterval(async () => {
  try {
    if (!gdrive.isConfigured()) return;
    const pending = db.query("SELECT * FROM Upload_Queue WHERE Status='pending' ORDER BY Queue_ID ASC LIMIT 5");
    for (const item of pending) {
      try {
        db.run("UPDATE Upload_Queue SET Status='uploading' WHERE Queue_ID=?", [item.Queue_ID]);
        if (fs.existsSync(item.File_Path)) {
          const buffer = fs.readFileSync(item.File_Path);
          const result = await gdrive.uploadFile(item.Task_ID, item.Client_Name || 'Unknown', item.Original_Name, buffer);
          if (result && result.fileId) {
            db.run("UPDATE Upload_Queue SET Status='done' WHERE Queue_ID=?", [item.Queue_ID]);
            db.run("UPDATE Orders SET File_Path=? WHERE Task_ID=?", [`gdrive://${result.fileId}`, item.Task_ID]);
          } else {
            db.run("UPDATE Upload_Queue SET Status='failed', Error=? WHERE Queue_ID=?", [result?.error || 'فشل الرفع', item.Queue_ID]);
          }
        } else {
          db.run("UPDATE Upload_Queue SET Status='failed', Error='الملف غير موجود' WHERE Queue_ID=?", [item.Queue_ID]);
        }
      } catch (e) {
        db.run("UPDATE Upload_Queue SET Status='failed', Error=? WHERE Queue_ID=?", [e.message, item.Queue_ID]);
      }
    }
  } catch {}
}, 60000);

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
function gracefulShutdown() {
  console.log('🛑 إيقاف السيرفر...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}

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
