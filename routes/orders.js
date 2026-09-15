const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../database/connection');
const { requireAuth, requirePermission } = require('../middleware/auth');

const STORAGE = path.join(__dirname, '..', 'Server_Storage', 'Clients_Archive');

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

  const whereClause = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';
  const countRow = db.get(`SELECT COUNT(*) as total FROM Orders o LEFT JOIN Clients c ON o.Client_ID = c.Client_ID ${whereClause}`, params);

  let roleFilter = '';
  let roleParams = [];
  if (req.session.role === 'Designer') {
    roleFilter = 'AND o.Designer_ID = ?';
    roleParams = [req.session.userId];
  } else if (req.session.role === 'Laser_Op') {
    roleFilter = "AND o.Machine_Type = 'Laser'";
  } else if (req.session.role === 'Router_Op') {
    roleFilter = "AND o.Machine_Type = 'Router'";
  }

  let orderBy = 'o.Created_At DESC';
  if (sort === 'oldest') orderBy = 'o.Created_At ASC';
  else if (sort === 'status') orderBy = "CASE o.Status WHEN 'قيد التصميم' THEN 1 WHEN 'جاهز للقص' THEN 2 WHEN 'قيد التنفيذ' THEN 3 WHEN 'تم الانتهاء من القص' THEN 4 WHEN 'تم التغليف' THEN 5 WHEN 'تم التسليم' THEN 6 END";
  else if (sort === 'price_desc') orderBy = 'o.Price DESC';
  else if (sort === 'price_asc') orderBy = 'o.Price ASC';

  const orders = db.all(`
    SELECT o.*, c.Full_Name as Client_Name, c.Phone_Number,
           i.Material_Name, i.Thickness,
      (SELECT COUNT(*) FROM Order_Files f WHERE f.Task_ID=o.Task_ID) as File_Count,
      (SELECT GROUP_CONCAT(om.Material_ID || ':' || om.Quantity, '|') FROM Order_Materials om WHERE om.Task_ID=o.Task_ID) as Materials_Data
    FROM Orders o
    LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
    LEFT JOIN Inventory i ON o.Material_ID = i.Material_ID
    ${whereClause} ${roleFilter}
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `, [...params, ...roleParams, limit, offset]);

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
  const { Client_ID, Machine_Type, Materials, Notes } = req.body;
  if (!Client_ID || !Machine_Type) return res.status(400).json({ error: 'العميل ونوع الماكينة مطلوبان' });

  const result = db.run(
    `INSERT INTO Orders (Client_ID, Designer_ID, Machine_Type, Status, Notes)
     VALUES (?, ?, ?, 'قيد التصميم', ?)`,
    [Client_ID, req.session.userId, Machine_Type, Notes || '']
  );

  if (!result.lastId) return res.status(500).json({ error: 'فشل إنشاء الطلب' });

  if (Materials && Array.isArray(Materials) && Materials.length > 0) {
    Materials.forEach(m => {
      if (m.Material_ID && m.Quantity > 0) {
        db.run("INSERT INTO Order_Materials (Task_ID, Material_ID, Quantity) VALUES (?, ?, ?)", [result.lastId, m.Material_ID, m.Quantity]);
      }
    });
  }

  const order = db.get(`
    SELECT o.*, c.Full_Name as Client_Name
    FROM Orders o
    LEFT JOIN Clients c ON o.Client_ID = c.Client_ID
    WHERE o.Task_ID = ?
  `, [result.lastId]);

  res.json(order);
});

router.put('/:id', requireAuth(), (req, res) => {
  const { Status, Material_ID, Material_Qty, Notes } = req.body;
  const oldOrder = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.id]);

  db.run(
    "UPDATE Orders SET Status=COALESCE(?,Status), Material_ID=COALESCE(?,Material_ID), Material_Qty=COALESCE(?,Material_Qty), Notes=COALESCE(?,Notes), Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?",
    [Status || null, Material_ID || null, Material_Qty || null, Notes || null, req.params.id]
  );

  let totalCost = 0;
  if (Status === 'تم التسليم') {
    const orderMats = db.all("SELECT * FROM Order_Materials WHERE Task_ID=?", [req.params.id]);
    if (orderMats.length > 0) {
      orderMats.forEach(om => {
        const mat = db.get("SELECT * FROM Inventory WHERE Material_ID=?", [om.Material_ID]);
        if (mat && mat.Quantity >= om.Quantity) {
          db.run("UPDATE Inventory SET Quantity = Quantity - ? WHERE Material_ID=?", [om.Quantity, om.Material_ID]);
          totalCost += om.Quantity * mat.Cost_Per_Unit;
        }
      });
    } else if (oldOrder && oldOrder.Material_ID && oldOrder.Material_Qty > 0) {
      const mat = db.get("SELECT * FROM Inventory WHERE Material_ID=?", [oldOrder.Material_ID]);
      if (mat && mat.Quantity >= oldOrder.Material_Qty) {
        db.run("UPDATE Inventory SET Quantity = Quantity - ? WHERE Material_ID=?", [oldOrder.Material_Qty, oldOrder.Material_ID]);
        totalCost = oldOrder.Material_Qty * mat.Cost_Per_Unit;
      }
    }
    if (totalCost > 0) {
      db.run("UPDATE Clients SET Total_Spent = Total_Spent + ? WHERE Client_ID=?", [totalCost, oldOrder.Client_ID]);
    }
    db.run("UPDATE Orders SET Cost=?, Profit=COALESCE(Price,0)-? WHERE Task_ID=?", [totalCost, totalCost, req.params.id]);
  }

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

router.put('/:id/status', requireAuth(), (req, res) => {
  const { Status } = req.body;
  const oldOrder = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.id]);

  db.run("UPDATE Orders SET Status=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [Status, req.params.id]);

  let totalCost = 0;
  if (Status === 'تم التسليم') {
    const orderMats = db.all("SELECT * FROM Order_Materials WHERE Task_ID=?", [req.params.id]);
    if (orderMats.length > 0) {
      orderMats.forEach(om => {
        const mat = db.get("SELECT * FROM Inventory WHERE Material_ID=?", [om.Material_ID]);
        if (mat && mat.Quantity >= om.Quantity) {
          db.run("UPDATE Inventory SET Quantity = Quantity - ? WHERE Material_ID=?", [om.Quantity, om.Material_ID]);
          totalCost += om.Quantity * mat.Cost_Per_Unit;
        }
      });
    } else if (oldOrder && oldOrder.Material_ID && oldOrder.Material_Qty > 0) {
      const mat = db.get("SELECT * FROM Inventory WHERE Material_ID=?", [oldOrder.Material_ID]);
      if (mat && mat.Quantity >= oldOrder.Material_Qty) {
        db.run("UPDATE Inventory SET Quantity = Quantity - ? WHERE Material_ID=?", [oldOrder.Material_Qty, oldOrder.Material_ID]);
        totalCost = oldOrder.Material_Qty * mat.Cost_Per_Unit;
      }
    }
    if (totalCost > 0) {
      db.run("UPDATE Clients SET Total_Spent = Total_Spent + ? WHERE Client_ID=?", [totalCost, oldOrder.Client_ID]);
    }
    db.run("UPDATE Orders SET Cost=?, Profit=COALESCE(Price,0)-? WHERE Task_ID=?", [totalCost, totalCost, req.params.id]);
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

router.get('/notifications', requireAuth(), (req, res) => {
  const notifs = db.all("SELECT n.*, o.Client_ID FROM Notifications n LEFT JOIN Orders o ON n.Task_ID=o.Task_ID ORDER BY n.Created_At DESC LIMIT 20");
  res.json(notifs);
});

router.post('/notifications/read', requireAuth(), (req, res) => {
  db.run("UPDATE Notifications SET Is_Read=1");
  res.json({ success: true });
});

router.delete('/:id', requirePermission('orders'), (req, res) => {
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [req.params.id]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
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

router.get('/stats', requireAuth(), (req, res) => {
  const totalOrders = db.get("SELECT COUNT(*) as cnt FROM Orders")?.cnt || 0;
  const activeOrders = db.get("SELECT COUNT(*) as cnt FROM Orders WHERE Status NOT IN ('تم التسليم')")?.cnt || 0;
  const totalClients = db.get("SELECT COUNT(*) as cnt FROM Clients")?.cnt || 0;
  const lowStock = db.all("SELECT * FROM Inventory WHERE Quantity < 5");
  const recentOrders = db.all(`
    SELECT o.*, c.Full_Name as Client_Name
    FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID
    ORDER BY o.Created_At DESC LIMIT 5
  `);
  const statusCounts = db.all("SELECT Status, COUNT(*) as cnt FROM Orders GROUP BY Status");

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
