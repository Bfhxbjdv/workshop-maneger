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

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 24 || sessionSecret === 'workshop-secret-key-2024') {
  throw new Error('SESSION_SECRET يجب أن يكون مضبوطاً وعشوائياً بطول 24 حرفاً على الأقل');
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.get('/favicon.ico', (req, res) => {
  res.type('image/svg+xml').send(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="12" fill="#0d6efd"/>
      <path d="M18 38h28M22 29h20M27 20h10" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
    </svg>
  `);
});
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    if (['.js', '.css', '.html', '.htm'].includes(ext)) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.COOKIE_SECURE === 'true',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Auto cache-buster: changes whenever any static asset changes, forcing
// browsers/CDNs to fetch fresh instead of a stale designs.js (which caused
// "file disappears on click" after uploads changed the file).
const assetVersion = (() => {
  try {
    const djs = fs.statSync(path.join(__dirname, 'public', 'js', 'designs.js')).mtimeMs;
    return String(djs).replace('.', '');
  } catch { return Date.now().toString(); }
})();

app.use((req, res, next) => {
  res.locals.assetVersion = assetVersion;
  if (req.session.userId) {
    const user = db.get("SELECT Permissions FROM Users WHERE User_ID=?", [req.session.userId]);
    let permissions = {};
    try {
      permissions = user ? JSON.parse(user.Permissions || '{}') : {};
    } catch {}
    res.locals.user = {
      id: req.session.userId,
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

// Never let browsers/CDNs cache rendered pages so the latest markup and
// versioned assets are always fetched. (Static .js/.css already get their
// own no-cache headers via express.static setHeaders and are skipped here.)
app.use((req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css')) { return next(); }
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
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
app.use('/api/agents', require('./routes/agents'));
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
  if (role === 'Agent') return res.redirect('/agent');
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

app.get('/agent', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  if (req.session.role !== 'Agent' && req.session.role !== 'Admin' && req.session.role !== 'Custom') {
    return res.status(403).send('غير مصرح');
  }
  res.render('agent', { user: res.locals.user });
});

app.get('/agents', requireAuth(['Admin']), (req, res) => {
  res.render('agents', { user: res.locals.user });
});

app.get('/agents/:id', requireAuth(['Admin']), (req, res) => {
  res.render('agent-detail', { user: res.locals.user, agentId: req.params.id });
});

app.get('/account', (req, res) => {
  if (!req.session.userId) return res.redirect('/login');
  res.render('account', { user: res.locals.user });
});

// JSON error responses for API routes (multer limits, FK violations, etc.)
// so the frontend always gets parseable JSON instead of an HTML error page.
app.use('/api', (err, req, res, next) => {
  console.error('API error:', err.message);
  if (res.headersSent) return next(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || 'خطأ في الخادم' });
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
  });
}).catch(err => {
  console.error('❌ فشل تهيئة قاعدة البيانات:', err);
  process.exit(1);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ المنفذ ${PORT} مستخدم بالفعل. أوقف النسخة الأخرى أو غيّر PORT.`);
  } else {
    console.error('❌ تعذر تشغيل الخادم:', err.message);
  }
  process.exit(1);
});
