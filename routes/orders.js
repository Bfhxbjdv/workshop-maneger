const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../database/connection');
const { requireAuth, requirePermission, canAccessOrder, orderScope } = require('../middleware/auth');
const { deliverOrder } = require('../services/orderAccounting');

const STORAGE = path.join(__dirname, '..', 'Server_Storage', 'Clients_Archive');
const AGENT_UPLOAD_DIR = path.join(__dirname, '..', 'Server_Storage', 'Agent_Images');
if (!fs.existsSync(AGENT_UPLOAD_DIR)) fs.mkdirSync(AGENT_UPLOAD_DIR, { recursive: true });

const agentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AGENT_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const agentUpload = multer({ storage: agentStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Helper: filter clients by agent
function getClientsForUser(req) {
  if (req.session.role === 'Admin' || (req.session.role === 'Custom' && hasPermission(req, 'clients'))) {
    return { sql: '1=1', params: [] };
  }
  if (req.session.role === 'Agent') {
    return { sql: 'Created_By = ?', params: [req.session.userId] };
  }
  return { sql: '1=0', params: [] };
}

router.get('/', requireAuth(), (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 50;
  const offset = (page - 1) * limit;
  const status = req.query.status || '';
  const machine = req.query.machine || '';
  const search = req.query.search || '';
  const sort = req.query.sort || 'newest';
  const clientOnly = req.query.clientId || '';
  const excludeTask = parseInt(req.query.excludeTask) || 0;

  let where = [];
  let params = [];
  if (status) {
    if (status === 'تم التسليم') { where.push("o.Status = 'تم التسليم'"); }
    else if (status === 'تم الانتهاء من القص') { where.push("o.Status = 'تم الانتهاء من القص'"); }
    else { where.push("o.Status = ?"); params.push(status); }
  }
  if (machine) { where.push("o.Machine_Type = ?"); params.push(machine); }
  if (search) { where.push("c.Full_Name LIKE ?"); params.push(`%${search}%`); }
  if (clientOnly) { where.push("o.Client_ID = ?"); params.push(parseInt(clientOnly)); }
  if (excludeTask) { where.push("o.Task_ID != ?"); params.push(excludeTask); }

  const scope = orderScope(req);
  where.push(scope.sql);
  params.push(...scope.params);
  const whereClause = 'WHERE ' + where.join(' AND ');
  const countRow = db.get(`SELECT COUNT(*) as total FROM Orders o LEFT JOIN Clients c ON o.Client_ID = c.Client_ID ${whereClause}`, params);

  let orderBy = 'o.Created_At DESC';
  if (sort === 'oldest') orderBy = 'o.Created_At ASC';
  else if (sort === 'status') orderBy = "CASE o.Status WHEN 'قيد التصميم' THEN 1 WHEN 'جاهز للقص' THEN 2 WHEN 'قيد التنفيذ' THEN 3 WHEN 'تم الانتهاء من القص' THEN 4 WHEN 'تم التغليف' THEN 5 WHEN 'تم التسليم' THEN 6 END";
  else if (sort === 'price_desc') orderBy = 'o.Price DESC';
  else if (sort === 'price_asc') orderBy = 'o.Price ASC';

const orders = db.all(`
    SELECT o.*, c.Full_Name as Client_Name, c.Phone_Number,
           i.Material_Name, i.Thickness,
           u.Name as Agent_Name,
           (SELECT COUNT(*) FROM Order_Files f WHERE f.Task_ID=o.Task_ID) as File_Count,
           (SELECT GROUP_CONCAT(om.Material_ID || ':' || om.Quantity, '|') FROM Order_Materials om WHERE om.Task_ID=o.Task_ID) as Materials_Data
    FROM Orders o
    LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
    LEFT JOIN Inventory i ON o.Material_ID = i.Material_ID
    LEFT JOIN Users u ON o.Created_By = u.User_ID
    ${whereClause}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const enriched = orders.map(o => {
    if (o.Materials_Data) {
      o.Materials = o.Materials_Data.split('|').map(m => {
        const [mid, qty] = m.split(':');
        const mat = db.get("SELECT Material_ID, Material_Name, Thickness FROM Inventory WHERE Material_ID=?", [parseInt(mid)]);
        return mat ? { ...mat, Quantity: parseFloat(qty) } : null;
      }).filter(Boolean);
    } else {
      o.Materials = [];
    }
    delete o.Materials_Data;
    return o;
  });

  res.json({ orders: enriched, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
});

router.post('/', requirePermission('orders'), (req, res) => {
  const isAgent = req.session.role === 'Agent';
  if (!['Admin', 'Designer', 'Custom', 'Agent'].includes(req.session.role)) {
    return res.status(403).json({ error: 'إنشاء الطلبات غير متاح لهذا الدور' });
  }
  const { Client_ID, Machine_Type, Materials, Notes, Sheets, Shapes, Image_IDs, Quantities, Agent_Price, Agent_Commission, Final_Price } = req.body;
  if (!Client_ID || !Machine_Type) return res.status(400).json({ error: 'العميل ونوع الماكينة مطلوبان' });
  const machineType = (Machine_Type || '').toString().toLowerCase() === 'router' ? 'Router' : 'Laser';

  const initialStatus = isAgent ? 'بانتظار الموافقة' : 'قيد التصميم';
  const approvalStatus = isAgent ? 'pending' : 'approved';

  const agentPrice = isAgent ? (parseFloat(Agent_Price) || 0) : 0;
  const agentCommission = isAgent ? (parseFloat(Agent_Commission) || 0) : 0;
  const finalPrice = isAgent ? (parseFloat(Final_Price) || agentPrice + agentCommission) : 0;

  const result = db.run(
    `INSERT INTO Orders (Client_ID, Designer_ID, Created_By, Machine_Type, Status, Approval_Status, Notes, Agent_Price, Agent_Commission, Final_Price)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [Client_ID, isAgent ? null : req.session.userId, req.session.userId, machineType, initialStatus, approvalStatus, Notes || '', agentPrice, agentCommission, finalPrice]
  );

  if (!result.lastId) return res.status(500).json({ error: 'فشل إنشاء الطلب' });

  if (isAgent && Sheets) {
    db.run("UPDATE Orders SET Material_Qty = ? WHERE Task_ID = ?", [parseFloat(Sheets) || 0, result.lastId]);
  }

  if (isAgent && Image_IDs && Array.isArray(Image_IDs) && Image_IDs.length > 0) {
    let totalSheets = 0;
    Image_IDs.forEach(imgId => {
      const qty = Quantities && Quantities[imgId] ? parseFloat(Quantities[imgId]) : 0;
      if (qty > 0) totalSheets += qty;
      db.run("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Type, Uploaded_By) VALUES (?, 'agent_image', 'agent_image', ?, 'agent_image', ?)",
        [result.lastId, imgId, req.session.userId]);
    });
    if (totalSheets > 0) {
      db.run("UPDATE Orders SET Material_Qty = ? WHERE Task_ID = ?", [totalSheets, result.lastId]);
    }
  }

  if (Materials && Array.isArray(Materials) && Materials.length > 0) {
    Materials.forEach(m => {
      if (m.Material_ID && m.Quantity > 0) {
        db.run("INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)", [result.lastId, m.Material_ID, m.Quantity]);
      }
    });
  }

  if (isAgent && Shapes && Array.isArray(Shapes) && Shapes.length > 0) {
    Shapes.forEach(shapeId => {
      db.run("INSERT INTO Order_Files (Task_ID, Original_Name, Stored_Name, File_Path, File_Type, Uploaded_By) VALUES (?, 'agent_shape', 'agent_shape', ?, 'agent_shape', ?)",
        [result.lastId, shapeId, req.session.userId]);
    });
  }

  const order = db.get(`
    SELECT o.*, c.Full_Name as Client_Name
    FROM Orders o
    LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
    WHERE o.Task_ID = ?
  `, [result.lastId]);

  if (isAgent) {
    const admins = db.all("SELECT User_ID FROM Users WHERE Role IN ('Admin', 'Custom')");
    const designers = db.all("SELECT User_ID FROM Users WHERE Role = 'Designer'");
    [...admins, ...designers].forEach(u => {
      db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)",
        [result.lastId, `طلب جديد من الوكيل يحتاج موافقة: #${result.lastId}`, 'warning']);
    });
  }

  res.json(order);
});

router.put('/:id', requirePermission('orders'), (req, res) => {
  const { Status, Material_ID, Material_Qty, Notes } = req.body;
  const oldOrder = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.id]);
  if (!oldOrder) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (!canAccessOrder(req, oldOrder)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });
  if (Status === 'تم التسليم') {
    if (req.session.role !== 'Admin' && req.session.role !== 'Custom') return res.status(403).json({ error: 'تسليم الطلبات متاح للمدير فقط' });
    const result = deliverOrder(req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [req.params.id, `تم تسليم الطلب #${req.params.id}`, 'success']);
    return res.json({ success: true, alreadyDelivered: result.alreadyDelivered });
  }
  if (Status && !['قيد التصميم', 'جاهز للقص', 'قيد التنفيذ', 'تم الانتهاء من القص', 'تم التغليف'].includes(Status)) {
    return res.status(400).json({ error: 'حالة الطلب غير صالحة' });
  }

  db.run(
    "UPDATE Orders SET Status=COALESCE(?,Status), Material_ID=COALESCE(?,Material_ID), Material_Qty=COALESCE(?,Material_Qty), Notes=COALESCE(?,Notes), Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?",
    [Status || null, Material_ID || null, Material_Qty || null, Notes || null, req.params.id]
  );

  if (Status === 'جاهز للقص') {
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [req.params.id, `طلب جديد جاهز للقص - #${req.params.id}`, 'info']);
  } else if (Status === 'تم الانتهاء من القص') {
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [req.params.id, `تم الانتهاء من قص الطلب #${req.params.id}`, 'success']);
  } else if (Status === 'تم التسليم') {
    const order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [req.params.id]);
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [req.params.id, `تم تسليم طلب ${order?.Client_Name || ''} (#${req.params.id})`, 'success']);
  }

  res.json({ success: true });
});

router.put('/:id/status', requirePermission('orders'), (req, res) => {
  const { Status } = req.body;
  const oldOrder = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.id]);
  if (!oldOrder) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (!canAccessOrder(req, oldOrder)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });
  if (Status === 'تم التسليم') {
    if (req.session.role !== 'Admin' && req.session.role !== 'Custom') return res.status(403).json({ error: 'تسليم الطلبات متاح للمدير فقط' });
    const result = deliverOrder(req.params.id);
    if (result.error) return res.status(400).json({ error: result.error });
  } else {
    const allowed = ['قيد التصميم', 'جاهز للقص', 'قيد التنفيذ', 'تم الانتهاء من القص', 'تم التغليف'];
    if (!allowed.includes(Status)) return res.status(400).json({ error: 'حالة الطلب غير صالحة' });
    db.run("UPDATE Orders SET Status=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [Status, req.params.id]);
  }

  if (Status === 'جاهز للقص') {
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [req.params.id, `طلب جديد جاهز للقص - #${req.params.id}`, 'info']);
  } else if (Status === 'تم الانتهاء من القص') {
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [req.params.id, `تم الانتهاء من قص الطلب #${req.params.id}`, 'success']);
  } else if (Status === 'تم التسليم') {
    const order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [req.params.id]);
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)", [req.params.id, `تم تسليم طلب ${order?.Client_Name || ''} (#${req.params.id})`, 'success']);
  }

  const order = db.get(`
    SELECT o.*, c.Full_Name as Client_Name, c.Phone_Number,
           i.Material_Name, i.Thickness
    FROM Orders o
    LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
    LEFT JOIN Inventory i ON o.Material_ID = i.Material_ID
    WHERE o.Task_ID = ?
  `, [req.params.id]);

  if (global.io) {
    global.io.emit('order-update', order);
  }

  res.json(order);
});

router.post('/:id/duplicate', requirePermission('orders'), (req, res) => {
  const old = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.id]);
  if (!old) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (!canAccessOrder(req, old)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });

  const result = db.run(
    `INSERT INTO Orders (Client_ID, Designer_ID, Machine_Type, Status, Notes)
     VALUES (?, ?, ?, 'قيد التصميم', ?)`,
    [old.Client_ID, req.session.userId, old.Machine_Type, `مكرر من طلب #${old.Task_ID} - ${old.Notes || ''}`]
  );

  if (!result.lastId) return res.status(500).json({ error: 'فشل إنشاء الطلب' });

  const oldMats = db.all("SELECT * FROM Order_Materials WHERE Task_ID=?", [req.params.id]);
  oldMats.forEach(m => {
    db.run("INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)", [result.lastId, m.Material_ID, m.Quantity]);
  });

  const order = db.get(`
    SELECT o.*, c.Full_Name as Client_Name
    FROM Orders o LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
    WHERE o.Task_ID = ?
  `, [result.lastId]);

  if (global.io) global.io.emit('order-update', order);
  res.json(order);
});

router.get('/notifications', requirePermission('orders'), (req, res) => {
  const scope = orderScope(req);
  const notifs = db.all(`SELECT n.*, o.Client_ID FROM Notifications n LEFT JOIN Orders o ON n.Task_ID=o.Task_ID WHERE ${scope.sql} ORDER BY n.Created_At DESC LIMIT 20`, scope.params);
  res.json(notifs);
});

router.post('/notifications/read', requirePermission('orders'), (req, res) => {
  const scope = orderScope(req);
  db.run(`UPDATE Notifications SET Is_Read=1 WHERE Task_ID IN (SELECT Task_ID FROM Orders o WHERE ${scope.sql})`, scope.params);
  res.json({ success: true });
});

router.delete('/:id', requirePermission('orders'), (req, res) => {
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.id]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });
  if (!['Admin', 'Designer', 'Custom'].includes(req.session.role)) return res.status(403).json({ error: 'حذف الطلبات غير متاح لهذا الدور' });
  const archiveRoot = path.join(__dirname, '..', 'Server_Storage', 'Clients_Archive');
  const files = db.all("SELECT * FROM Order_Files WHERE Task_ID=?", [req.params.id]);
  if (files) {
    for (const file of files) {
      if (file.File_Path && file.File_Path.startsWith('gdrive://')) {
        try { require('../services/googleDrive').deleteFile(file.File_Path.replace('gdrive://', '')); } catch {}
      } else if (file.File_Path) {
        try { fs.unlinkSync(path.join(archiveRoot, file.File_Path)); } catch {}
      }
    }
    db.run("DELETE FROM Order_Files WHERE Task_ID=?", [req.params.id]);
  }
  if (order.File_Path) {
    if (order.File_Path.startsWith('gdrive://')) {
      try { require('../services/googleDrive').deleteFile(order.File_Path.replace('gdrive://', '')); } catch {}
    } else {
      const filePath = path.join(archiveRoot, order.File_Path);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  }
  // clean any leftover Task_<id> folders inside the client archive
  const safeClient = order.Client_Name ? String(order.Client_Name).replace(/[<>:"\/\\|?*]/g, '_').trim() : '';
  if (safeClient) {
    const clientDir = path.join(archiveRoot, safeClient);
    try {
      const years = fs.readdirSync(clientDir);
      for (const y of years) {
        const yearDir = path.join(clientDir, y);
        if (!fs.statSync(yearDir).isDirectory()) continue;
        const months = fs.readdirSync(yearDir);
        for (const m of months) {
          const monthDir = path.join(yearDir, m);
          if (!fs.statSync(monthDir).isDirectory()) continue;
          const taskDir = path.join(monthDir, `Task_${req.params.id}`);
          if (fs.existsSync(taskDir)) fs.rmSync(taskDir, { recursive: true, force: true });
        }
      }
    } catch {}
  }
  db.run("DELETE FROM Order_Materials WHERE Task_ID=?", [req.params.id]);
  db.run("DELETE FROM Notifications WHERE Task_ID=?", [req.params.id]);
  db.run("DELETE FROM Orders WHERE Task_ID=?", [req.params.id]);
  if (global.io) global.io.emit('order-update', { Task_ID: parseInt(req.params.id), _deleted: true });
  res.json({ success: true });
});

router.get('/stats', requirePermission('orders'), (req, res) => {
  const scope = orderScope(req);
  const totalOrders = db.get(`SELECT COUNT(*) as cnt FROM Orders o WHERE ${scope.sql}`, scope.params)?.cnt || 0;
  const activeOrders = db.get(`SELECT COUNT(*) as cnt FROM Orders o WHERE ${scope.sql} AND o.Status NOT IN ('تم التسليم')`, scope.params)?.cnt || 0;
  const totalClients = db.get(`SELECT COUNT(DISTINCT o.Client_ID) as cnt FROM Orders o WHERE ${scope.sql}`, scope.params)?.cnt || 0;
  const lowStock = (req.session.role === 'Admin' || req.session.role === 'Custom') ? db.all("SELECT * FROM Inventory WHERE Quantity < 5") : [];
  const recentOrders = db.all(`
    SELECT o.*, c.Full_Name as Client_Name
    FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE ${scope.sql}
    ORDER BY o.Created_At DESC LIMIT 5
  `, scope.params);
  const statusCounts = db.all(`SELECT Status, COUNT(*) as cnt FROM Orders o WHERE ${scope.sql} GROUP BY Status`, scope.params);

  res.json({ totalOrders, activeOrders, totalClients, lowStock, recentOrders, statusCounts });
});

router.get('/:id/receipt/pdf', requireAuth(), async (req, res) => {
  const PDFDocument = require('pdfkit');
  const order = db.get(`
    SELECT o.*, c.Full_Name as Client_Name, c.Phone_Number, i.Material_Name, i.Thickness
    FROM Orders o
    LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
    LEFT JOIN Inventory i ON o.Material_ID = i.Material_ID
    WHERE o.Task_ID = ?
  `, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });

  const receiptDir = path.join(__dirname, '..', 'Server_Storage', 'Receipts');
  if (!fs.existsSync(receiptDir)) fs.mkdirSync(receiptDir, { recursive: true });
  const fileName = `Receipt_${order.Task_ID}.pdf`;
  const filePath = path.join(receiptDir, fileName);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const rightMargin = doc.page.width - 50;
  const topY = 50;

  doc.fontSize(22).font('Helvetica-Bold').text('Kazanji Group', 50, topY, { align: 'right' });
  doc.fontSize(10).font('Helvetica').text('Company for Design & Cutting Services', 50, topY + 22, { align: 'right' });
  doc.fontSize(8).fillColor('#666').text('Tel: +963 933 123 456 | Email: info@kazanji-group.com', { align: 'right' });
  doc.fillColor('#000');
  doc.moveTo(50, topY + 55).lineTo(rightMargin, topY + 55).stroke('#ccc');

  doc.fontSize(18).font('Helvetica-Bold').text('DELIVERY RECEIPT', 50, topY + 65, { align: 'center' });
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#28a745').text('فاتورة استلام', 50, topY + 85, { align: 'center' });
  doc.fillColor('#000');
  doc.moveTo(50, topY + 110).lineTo(rightMargin, topY + 110).stroke('#ccc');

  let y = topY + 125;
  doc.fontSize(10).font('Helvetica');
  doc.text(`Receipt #: RCP-${order.Task_ID}`, 50, y, { align: 'left' });
  doc.text(`Date: ${new Date().toLocaleDateString('en-GB')}`, rightMargin - 150, y, { width: 150, align: 'right' });
  y += 25;

  doc.fontSize(12).font('Helvetica-Bold').text('Client:', 50, y);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Name: ${order.Client_Name || 'N/A'}`, 50, y + 5);
  doc.text(`Phone: ${order.Phone_Number || 'N/A'}`, 50, doc.y + 5);
  doc.text(`Order #: ${order.Task_ID}`, 50, doc.y + 5);
  doc.text(`Machine: ${order.Machine_Type === 'Laser' ? 'Laser' : 'Router'}`, 50, doc.y + 5);
  doc.text(`Material: ${order.Material_Name || 'N/A'} ${order.Thickness ? '(' + order.Thickness + ')' : ''}`, 50, doc.y + 5);
  doc.moveDown(2);

  doc.moveTo(50, doc.y + 5).lineTo(rightMargin, doc.y + 5).stroke('#999');
  y = doc.y + 15;
  doc.fontSize(11).font('Helvetica-Bold');
  doc.text('I confirm that I have received the ordered items in good condition.', 50, y, { align: 'center' });
  doc.moveDown(2);
  doc.text('أُقر أنا الموقع أدناه باستلام الطلب كاملاً بالحالة المطلوبة.', 50, doc.y + 5, { align: 'center' });
  doc.moveDown(3);

  doc.moveTo(50, doc.y + 5).lineTo(rightMargin, doc.y + 5).stroke('#ccc');
  doc.moveDown(1);
  doc.fontSize(10).font('Helvetica');
  doc.text('Client Signature: ______________________', 50, doc.y, { align: 'left' });
  doc.text('Company Signature: ______________________', rightMargin - 250, doc.y, { width: 250, align: 'right' });
  doc.moveDown(3);
  doc.fontSize(8).fillColor('#666');
  doc.text('Kazanji Group - This is a computer-generated receipt', { align: 'center' });

  doc.end();
  stream.on('finish', () => res.download(filePath, fileName));
});

module.exports = router;

// Agent Image Management
router.post('/agent/images', requirePermission('orders'), agentUpload.array('images'), (req, res) => {
  if (req.session.role !== 'Agent' && req.session.role !== 'Admin' && !(req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'لم يتم رفع أي صور' });
  }
  const { category } = req.body;
  const results = req.files.map(f => {
    const result = db.run(
      `INSERT INTO Agent_Images (Category, Original_Name, Stored_Name, File_Path, File_Size, Uploaded_By)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [category || 'عام', f.originalname, f.filename, f.path, f.size, req.session.userId]
    );
    return { Image_ID: result.lastId, filename: f.filename, category: category || 'عام' };
  });
  res.json({ success: true, images: results });
});

router.get('/agent/images', requirePermission('orders'), (req, res) => {
  const { category } = req.query;
  let sql = 'SELECT * FROM Agent_Images';
  let params = [];
  if (category) {
    sql += ' WHERE Category = ?';
    params.push(category);
  }
  sql += ' ORDER BY Created_At DESC';
  const images = db.all(sql, params);
  res.json({ images });
});

router.delete('/agent/images/:id', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Agent' && req.session.role !== 'Admin') {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  const img = db.get("SELECT * FROM Agent_Images WHERE Image_ID = ?", [req.params.id]);
  if (!img) return res.status(404).json({ error: 'الصورة غير موجودة' });
  try { fs.unlinkSync(img.File_Path); } catch {}
  db.run("DELETE FROM Agent_Images WHERE Image_ID = ?", [req.params.id]);
  res.json({ success: true });
});

// Agent Shapes
router.post('/agent/shapes', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Agent' && req.session.role !== 'Admin') {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  const { name, description, image_id } = req.body;
  if (!name) return res.status(400).json({ error: 'اسم الشكل مطلوب' });
  const result = db.run(
    `INSERT INTO Agent_Shapes (Name, Description, Image_ID) VALUES (?, ?, ?)`,
    [name, description || '', image_id || null]
  );
  res.json({ success: true, Shape_ID: result.lastId });
});

router.get('/agent/shapes', requirePermission('orders'), (req, res) => {
  const shapes = db.all("SELECT s.*, i.File_Path as Image_Path FROM Agent_Shapes s LEFT JOIN Agent_Images i ON s.Image_ID = i.Image_ID ORDER BY s.Created_At DESC");
  res.json({ shapes });
});

router.delete('/agent/shapes/:id', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Agent' && req.session.role !== 'Admin') {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  db.run("DELETE FROM Agent_Shapes WHERE Shape_ID = ?", [req.params.id]);
  res.json({ success: true });
});

// Order Approval (Admin/Designer)
router.put('/:id/approve', requirePermission('orders'), (req, res) => {
  if (!['Admin', 'Designer', 'Custom'].includes(req.session.role)) {
    return res.status(403).json({ error: 'الموافقة متاحة للمدير والمصمم فقط' });
  }
  const { action, designer_id } = req.body; // action: 'approve' or 'reject'
  const order = db.get("SELECT * FROM Orders WHERE Task_ID = ?", [req.params.id]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (order.Approval_Status !== 'pending') {
    return res.status(400).json({ error: 'هذا الطلب ليس بانتظار الموافقة' });
  }

  if (action === 'approve') {
    const assignedDesigner = designer_id || (req.session.role === 'Designer' ? req.session.userId : null);
    db.run("UPDATE Orders SET Status = 'قيد التصميم', Approval_Status = 'approved', Designer_ID = COALESCE(?, Designer_ID) WHERE Task_ID = ?",
      [assignedDesigner, req.params.id]);
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)",
      [req.params.id, `تم الموافقة على طلب الوكيل #${req.params.id}`, 'success']);
  } else if (action === 'reject') {
    const { reason } = req.body;
    db.run("UPDATE Orders SET Status = 'ملغي', Approval_Status = 'rejected' WHERE Task_ID = ?", [req.params.id]);
    db.run("INSERT INTO Notifications (Task_ID, Message, Type) VALUES (?, ?, ?)",
      [req.params.id, `تم رفض طلب الوكيل #${req.params.id}${reason ? ': ' + reason : ''}`, 'danger']);
  } else {
    return res.status(400).json({ error: 'إجراء غير صالح' });
  }

  const updated = db.get("SELECT * FROM Orders WHERE Task_ID = ?", [req.params.id]);
  if (global.io) global.io.emit('order-update', updated);
  res.json({ success: true, order: updated });
});

// Get pending orders for Admin/Designer
router.get('/pending', requirePermission('orders'), (req, res) => {
  if (!['Admin', 'Designer', 'Custom'].includes(req.session.role)) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  const orders = db.all(`
    SELECT o.*, c.Full_Name as Client_Name, u.Name as Agent_Name
    FROM Orders o
    LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
    LEFT JOIN Users u ON o.Created_By = u.User_ID
    WHERE o.Approval_Status = 'pending'
    ORDER BY o.Created_At DESC
  `);
  res.json({ orders });
});

// ==================== Product Pricing APIs (Admin) ====================
// List all product pricing
router.get('/pricing', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Admin' && !(req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  const pricing = db.all("SELECT * FROM Product_Pricing ORDER BY Category, Product_Name");
  res.json({ pricing });
});

// Create product pricing (Admin only)
router.post('/pricing', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Admin' && !(req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return res.status(403).json({ error: 'إضافة الأسعار متاحة للأدمن فقط' });
  }
  const { Product_Name, Category, Base_Price, Unit, Description } = req.body;
  if (!Product_Name || Base_Price === undefined) {
    return res.status(400).json({ error: 'اسم المنتج والسعر الأساسي مطلوبان' });
  }
  const result = db.run(
    `INSERT INTO Product_Pricing (Product_Name, Category, Base_Price, Unit, Description) VALUES (?, ?, ?, ?, ?)`,
    [Product_Name, Category || 'عام', parseFloat(Base_Price) || 0, Unit || 'لوح', Description || '']
  );
  const pricing = db.get("SELECT * FROM Product_Pricing WHERE Pricing_ID = ?", [result.lastId]);
  res.json({ success: true, pricing });
});

// Update product pricing (Admin only)
router.put('/pricing/:id', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Admin' && !(req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return res.status(403).json({ error: 'تعديل الأسعار متاح للأدمن فقط' });
  }
  const { Product_Name, Category, Base_Price, Unit, Description, Is_Active } = req.body;
  db.run(
    `UPDATE Product_Pricing SET Product_Name=COALESCE(?,Product_Name), Category=COALESCE(?,Category), Base_Price=COALESCE(?,Base_Price), Unit=COALESCE(?,Unit), Description=COALESCE(?,Description), Is_Active=COALESCE(?,Is_Active), Updated_At=CURRENT_TIMESTAMP WHERE Pricing_ID=?`,
    [Product_Name || null, Category || null, Base_Price !== undefined ? parseFloat(Base_Price) : null, Unit || null, Description || null, Is_Active !== undefined ? (Is_Active ? 1 : 0) : null, req.params.id]
  );
  const pricing = db.get("SELECT * FROM Product_Pricing WHERE Pricing_ID = ?", [req.params.id]);
  res.json({ success: true, pricing });
});

// Delete product pricing (Admin only)
router.delete('/pricing/:id', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Admin' && !(req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return res.status(403).json({ error: 'حذف الأسعار متاح للأدمن فقط' });
  }
  db.run("DELETE FROM Product_Pricing WHERE Pricing_ID = ?", [req.params.id]);
  res.json({ success: true });
});

// ==================== Client Pricing APIs (Admin sets per-client prices) ====================
// Get client pricing for a specific client
router.get('/client-pricing/:clientId', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Admin' && !(req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  const clientId = req.params.clientId;
  const pricing = db.all(`
    SELECT cp.*, pp.Product_Name, pp.Category, pp.Base_Price, pp.Unit, pp.Description
    FROM Client_Pricing cp
    JOIN Product_Pricing pp ON cp.Pricing_ID = pp.Pricing_ID
    WHERE cp.Client_ID = ? AND pp.Is_Active = 1
    ORDER BY pp.Category, pp.Product_Name
  `, [clientId]);
  res.json({ client_pricing: pricing });
});

// Set/Update client pricing (Admin only)
router.post('/client-pricing', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Admin' && !(req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return res.status(403).json({ error: 'تسعير العملاء متاح للأدمن فقط' });
  }
  const { Client_ID, Pricing_ID, Agent_Price, Agent_Commission, Final_Price } = req.body;
  if (!Client_ID || !Pricing_ID || Agent_Price === undefined) {
    return res.status(400).json({ error: 'العميل، المنتج، والسعر مطلوبان' });
  }
  const agentPrice = parseFloat(Agent_Price) || 0;
  const agentCommission = parseFloat(Agent_Commission) || 0;
  const finalPrice = parseFloat(Final_Price) || agentPrice + agentCommission;

  db.run(
    `INSERT INTO Client_Pricing (Client_ID, Pricing_ID, Agent_Price, Agent_Commission, Final_Price)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(Client_ID, Pricing_ID) DO UPDATE SET
       Agent_Price=excluded.Agent_Price,
       Agent_Commission=excluded.Agent_Commission,
       Final_Price=excluded.Final_Price`,
    [Client_ID, Pricing_ID, agentPrice, agentCommission, finalPrice]
  );
  res.json({ success: true });
});

// Delete client pricing
router.delete('/client-pricing/:clientId/:pricingId', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Admin' && !(req.session.role === 'Custom' && hasPermission(req, 'orders'))) {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  db.run("DELETE FROM Client_Pricing WHERE Client_ID = ? AND Pricing_ID = ?", [req.params.clientId, req.params.pricingId]);
  res.json({ success: true });
});

// ==================== Agent: Get Available Pricing for Order ====================
router.get('/agent/pricing', requirePermission('orders'), (req, res) => {
  if (req.session.role !== 'Agent') {
    return res.status(403).json({ error: 'غير مصرح' });
  }
  // Get active product pricing that has client pricing for this agent's clients
  const clientIds = db.all("SELECT Client_ID FROM Clients WHERE Created_By = ?", [req.session.userId]).map(c => c.Client_ID);
  if (!clientIds.length) {
    return res.json({ pricing: [] });
  }
  const placeholders = clientIds.map(() => '?').join(',');
  const pricing = db.all(`
    SELECT DISTINCT pp.*, cp.Agent_Price, cp.Agent_Commission, cp.Final_Price, c.Full_Name as Client_Name
    FROM Product_Pricing pp
    JOIN Client_Pricing cp ON pp.Pricing_ID = cp.Pricing_ID
    JOIN Clients c ON cp.Client_ID = c.Client_ID
    WHERE pp.Is_Active = 1 AND cp.Client_ID IN (${placeholders})
    ORDER BY pp.Category, pp.Product_Name
  `, clientIds);
  res.json({ pricing });
});

// Debug: Check Orders table schema
router.get('/debug/schema', requireAuth(), (req, res) => {
  if (req.session.role !== 'Admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const cols = db.all("PRAGMA table_info(Orders)");
    res.json({ columns: cols.map(c => c.name) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Debug: Run migration manually
router.post('/debug/migrate', requireAuth(), (req, res) => {
  if (req.session.role !== 'Admin') return res.status(403).json({ error: 'Admin only' });
  try {
    const results = [];
    try { db.exec("ALTER TABLE Orders ADD COLUMN Created_By INTEGER"); results.push('Created_By'); } catch {}
    try { db.exec("ALTER TABLE Orders ADD COLUMN Approval_Status TEXT DEFAULT 'approved' CHECK(Approval_Status IN ('pending','approved','rejected'))"); results.push('Approval_Status'); } catch {}
    try { db.exec("ALTER TABLE Orders ADD COLUMN Agent_Price REAL DEFAULT 0"); results.push('Agent_Price'); } catch {}
    try { db.exec("ALTER TABLE Orders ADD COLUMN Agent_Commission REAL DEFAULT 0"); results.push('Agent_Commission'); } catch {}
    try { db.exec("ALTER TABLE Orders ADD COLUMN Final_Price REAL DEFAULT 0"); results.push('Final_Price'); } catch {}
    res.json({ success: true, added: results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// Helper function for hasPermission
function hasPermission(req, permission) {
  if (!req.session?.userId) return false;
  if (req.session.role === 'Admin') return true;
  if (req.session.role === 'Custom') {
    const user = db.get("SELECT Permissions FROM Users WHERE User_ID=?", [req.session.userId]);
    try { return !!JSON.parse(user?.Permissions || '{}')[permission]; } catch { return false; }
  }
  const standardRoles = {
    Designer: ['orders', 'clients', 'inventory', 'invoices'],
    Laser_Op: ['orders'],
    Router_Op: ['orders'],
    Agent: ['orders', 'clients']
  };
  return (standardRoles[req.session.role] || []).includes(permission);
}
