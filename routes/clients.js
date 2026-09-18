const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const { requireAuth, requirePermission, orderScope } = require('../middleware/auth');

router.get('/', requirePermission('clients'), (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  let where = '';
  let params = [];
  if (search) {
    where = 'WHERE Full_Name LIKE ? OR Phone_Number LIKE ?';
    params = [`%${search}%`, `%${search}%`];
  }
  const countRow = db.get(`SELECT COUNT(*) as total FROM Clients ${where}`, params);
  const clients = db.all(`SELECT * FROM Clients ${where} ORDER BY Created_At DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);

  res.json({ clients, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
});

router.get('/all', requirePermission('clients'), (req, res) => {
  const search = req.query.search || '';
  let where = '';
  let params = [];
  if (search) {
    where = 'WHERE Full_Name LIKE ? OR Phone_Number LIKE ?';
    params = [`%${search}%`, `%${search}%`];
  }
  const clients = db.all(`SELECT Client_ID, Full_Name, Phone_Number FROM Clients ${where} ORDER BY Full_Name ASC LIMIT 20`, params);
  res.json(clients);
});

router.get('/:id', requirePermission('clients'), (req, res) => {
  const client = db.get("SELECT * FROM Clients WHERE Client_ID=?", [req.params.id]);
  if (!client) return res.status(404).json({ error: 'العميل غير موجود' });
  res.json(client);
});

router.get('/:id/orders', requirePermission('clients'), (req, res) => {
  const scope = orderScope(req);
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
    WHERE o.Client_ID = ? AND ${scope.sql} ORDER BY o.Created_At DESC
  `, [req.params.id, ...scope.params]);
  res.json(orders);
});

router.post('/', requirePermission('clients'), (req, res) => {
  const { Full_Name, Phone_Number, Notes } = req.body;
  if (!Full_Name) return res.status(400).json({ error: 'اسم العميل مطلوب' });
  const result = db.run(
    "INSERT INTO Clients (Full_Name, Phone_Number, Notes) VALUES (?, ?, ?)",
    [Full_Name, Phone_Number || '', Notes || '']
  );
  if (!result.lastId) return res.status(500).json({ error: 'فشل إنشاء العميل' });
  const client = db.get("SELECT * FROM Clients WHERE Client_ID = ?", [result.lastId]);
  res.json(client);
});

router.put('/:id', requirePermission('clients'), (req, res) => {
  const { Full_Name, Phone_Number, Rating, Notes } = req.body;
  const current = db.get("SELECT * FROM Clients WHERE Client_ID=?", [req.params.id]);
  if (!current) return res.status(404).json({ error: 'العميل غير موجود' });

  db.run(
    "UPDATE Clients SET Full_Name=COALESCE(?,Full_Name), Phone_Number=COALESCE(?,Phone_Number), Rating=COALESCE(?,Rating), Notes=COALESCE(?,Notes) WHERE Client_ID=?",
    [Full_Name || null, Phone_Number || null, Rating || null, Notes || null, req.params.id]
  );
  res.json({ success: true });
});

router.delete('/:id', requirePermission('clients'), (req, res) => {
  db.run("DELETE FROM Clients WHERE Client_ID=?", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
