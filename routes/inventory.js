const express = require('express');
const router = express.Router();
const db = require('../database/connection');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth(), (req, res) => {
  const materials = db.all("SELECT * FROM Inventory ORDER BY Material_Name ASC");
  res.json(materials);
});

router.post('/', requireAuth(['Admin', 'Designer']), (req, res) => {
  const { Material_Name, Thickness, Quantity, Cost_Per_Unit } = req.body;
  if (!Material_Name) return res.status(400).json({ error: 'اسم المادة مطلوب' });
  db.run(
    "INSERT INTO Inventory (Material_Name, Thickness, Quantity, Cost_Per_Unit) VALUES (?, ?, ?, ?)",
    [Material_Name, Thickness || '', Quantity || 0, Cost_Per_Unit || 0]
  );
  res.json({ success: true });
});

router.put('/:id', requireAuth(['Admin', 'Designer']), (req, res) => {
  const { Material_Name, Thickness, Quantity, Cost_Per_Unit } = req.body;
  db.run(
    "UPDATE Inventory SET Material_Name=?, Thickness=?, Quantity=?, Cost_Per_Unit=? WHERE Material_ID=?",
    [Material_Name, Thickness, Quantity, Cost_Per_Unit, req.params.id]
  );
  res.json({ success: true });
});

router.put('/:id/deduct', requireAuth(), (req, res) => {
  const { qty } = req.body;
  const mat = db.get("SELECT * FROM Inventory WHERE Material_ID=?", [req.params.id]);
  if (!mat) return res.status(404).json({ error: 'المادة غير موجودة' });
  if (mat.Quantity < qty) return res.status(400).json({ error: 'الكمية غير كافية في المخزون' });
  db.run("UPDATE Inventory SET Quantity = Quantity - ? WHERE Material_ID=?", [qty, req.params.id]);
  res.json({ success: true });
});

module.exports = router;
