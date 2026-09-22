const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const { requireAuth, requirePermission, orderScope } = require('../middleware/auth');

// Helper: filter clients by agent
function getClientsScope(req) {
  if (req.session.role === 'Admin' || (req.session.role === 'Custom' && hasPermission(req, 'clients'))) {
    return { sql: '1=1', params: [] };
  }
  if (req.session.role === 'Agent') {
    return { sql: 'Created_By = ?', params: [req.session.userId] };
  }
  return { sql: '1=0', params: [] };
}

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

router.get('/', requirePermission('clients'), (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  const scope = getClientsScope(req);
  let where = scope.sql ? `WHERE ${scope.sql}` : '';
  let params = [...scope.params];
  if (search) {
    where += (where ? ' AND ' : 'WHERE ') + '(Full_Name LIKE ? OR Phone_Number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  const countRow = db.get(`SELECT COUNT(*) as total FROM Clients ${where}`, params);
  const clients = db.all(`SELECT * FROM Clients ${where} ORDER BY Created_At DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

  res.json({ clients, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
});

router.get('/all', requirePermission('clients'), (req, res) => {
  const search = req.query.search || '';
  const scope = getClientsScope(req);
  let where = scope.sql ? `WHERE ${scope.sql}` : '';
  let params = [...scope.params];
  if (search) {
    where += (where ? ' AND ' : 'WHERE ') + '(Full_Name LIKE ? OR Phone_Number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  const clients = db.all(`SELECT Client_ID, Full_Name, Phone_Number FROM Clients ${where} ORDER BY Full_Name ASC LIMIT 20`, params);
  res.json(clients);
});

router.get('/:id', requirePermission('clients'), (req, res) => {
  const scope = getClientsScope(req);
  const client = db.get(`SELECT * FROM Clients WHERE Client_ID=? AND ${scope.sql}`, [req.params.id, ...scope.params]);
  if (!client) return res.status(404).json({ error: 'العميل غير موجود' });
  res.json(client);
});

router.get('/:id/orders', requirePermission('clients'), (req, res) => {
  const scope = orderScope(req);
  const clientScope = getClientsScope(req);
  const orders = db.all(`
    SELECT o.*,
      CASE WHEN EXISTS(SELECT 1 FROM Order_Materials WHERE Task_ID=o.Task_ID)
        THEN (SELECT GROUP_CONCAT(i.Material_Name || ' (' || om.Quantity || ')', ', ')
              FROM Order_Materials om LEFT JOIN Inventory i ON om.Material_ID=i.Material_ID
              WHERE om.Task_ID=o.Task_ID)
        ELSE i.Material_Name || CASE WHEN o.Material_Qty>0 THEN ' (' || o.Material_Qty || ')' ELSE '' END
      END as Materials_List
    FROM Orders o
    LEFT JOIN Inventory i ON o.Material_ID = i.Material_ID
    WHERE o.Client_ID = ? AND ${scope.sql} AND ${clientScope.sql} ORDER BY o.Created_At DESC
  `, [req.params.id, ...scope.params, ...clientScope.params]);
  res.json(orders);
});

router.post('/', requirePermission('clients'), (req, res) => {
  const { Full_Name, Phone_Number, Notes } = req.body;
  if (!Full_Name) return res.status(400).json({ error: 'اسم العميل مطلوب' });
  const Created_By = (req.session.role === 'Agent') ? req.session.userId : null;
  const result = db.run(
    "INSERT INTO Clients (Full_Name, Phone_Number, Notes, Created_By) VALUES (?, ?, ?, ?)",
    [Full_Name, Phone_Number || '', Notes || '', Created_By]
  );
  if (!result.lastId) return res.status(500).json({ error: 'فشل إنشاء العميل' });
  const client = db.get("SELECT * FROM Clients WHERE Client_ID = ?", [result.lastId]);
  res.json(client);
});

router.put('/:id', requirePermission('clients'), (req, res) => {
  const { Full_Name, Phone_Number, Rating, Notes } = req.body;
  const scope = getClientsScope(req);
  const current = db.get(`SELECT * FROM Clients WHERE Client_ID=? AND ${scope.sql}`, [req.params.id, ...scope.params]);
  if (!current) return res.status(404).json({ error: 'العميل غير موجود' });
  if (Rating !== undefined && Rating !== null && Rating !== '' && (!Number.isInteger(Number(Rating)) || Number(Rating) < 1 || Number(Rating) > 5)) {
    return res.status(400).json({ error: 'التقييم يجب أن يكون رقماً من 1 إلى 5' });
  }

  db.run(
    "UPDATE Clients SET Full_Name=COALESCE(?,Full_Name), Phone_Number=COALESCE(?,Phone_Number), Rating=COALESCE(?,Rating), Notes=COALESCE(?,Notes) WHERE Client_ID=?",
    [Full_Name || null, Phone_Number || null, Rating || null, Notes || null, req.params.id]
  );
  res.json({ success: true });
});

router.delete('/:id', requirePermission('clients'), (req, res) => {
  const scope = getClientsScope(req);
  const current = db.get(`SELECT * FROM Clients WHERE Client_ID=? AND ${scope.sql}`, [req.params.id, ...scope.params]);
  if (!current) return res.status(404).json({ error: 'العميل غير موجود' });
  const orderCount = db.get("SELECT COUNT(*) as cnt FROM Orders WHERE Client_ID=?", [req.params.id]);
  if (orderCount && orderCount.cnt > 0) {
    return res.status(400).json({ error: `لا يمكن حذف العميل لوجود ${orderCount.cnt} طلب مرتبط به — احذف الطلبات أولاً` });
  }
  const invCount = db.get("SELECT COUNT(*) as cnt FROM Invoices WHERE Client_ID=?", [req.params.id]);
  if (invCount && invCount.cnt > 0) {
    return res.status(400).json({ error: 'لا يمكن حذف العميل لوجود فواتير مرتبطة به — احذف الفواتير أولاً' });
  }
  db.run(`DELETE FROM Clients WHERE Client_ID=? AND ${scope.sql}`, [req.params.id, ...scope.params]);
  res.json({ success: true });
});

module.exports = router;
