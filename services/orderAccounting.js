const db = require('../database/connection');

// Delivery is the single accounting transition for an order. Calling it more
// than once is intentionally idempotent so retries cannot deduct stock twice.
function validateDelivery(order) {
  if (order.Status === 'تم التسليم') return null;
  const materials = db.all('SELECT * FROM Order_Materials WHERE Task_ID=?', [order.Task_ID]);
  for (const material of materials) {
    const inventory = db.get('SELECT * FROM Inventory WHERE Material_ID=?', [material.Material_ID]);
    if (!inventory || inventory.Quantity < material.Quantity) return `المخزون غير كافٍ للمادة رقم ${material.Material_ID}`;
  }
  if (!materials.length && order.Material_ID && Number(order.Material_Qty) > 0) {
    const inventory = db.get('SELECT * FROM Inventory WHERE Material_ID=?', [order.Material_ID]);
    if (!inventory || inventory.Quantity < order.Material_Qty) return 'المخزون غير كافٍ للمادة المختارة';
  }
  return null;
}

function deliverOrder(taskId, price) {
  const order = db.get('SELECT * FROM Orders WHERE Task_ID=?', [taskId]);
  if (!order) return { error: 'الطلب غير موجود' };

  if (order.Status === 'تم التسليم') {
    if (price !== undefined) {
      db.run('UPDATE Orders SET Price=?, Profit=?-COALESCE(Cost,0), Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?', [price, price, taskId]);
    }
    return { order: db.get('SELECT * FROM Orders WHERE Task_ID=?', [taskId]), alreadyDelivered: true };
  }

  const validationError = validateDelivery(order);
  if (validationError) return { error: validationError };
  let totalCost = 0;
  const materials = db.all('SELECT * FROM Order_Materials WHERE Task_ID=?', [taskId]);
  for (const material of materials) {
    const inventory = db.get('SELECT * FROM Inventory WHERE Material_ID=?', [material.Material_ID]);
    db.run('UPDATE Inventory SET Quantity = Quantity - ? WHERE Material_ID=?', [material.Quantity, material.Material_ID]);
    totalCost += Number(material.Quantity) * Number(inventory.Cost_Per_Unit);
  }
  if (!materials.length && order.Material_ID && Number(order.Material_Qty) > 0) {
    const inventory = db.get('SELECT * FROM Inventory WHERE Material_ID=?', [order.Material_ID]);
    db.run('UPDATE Inventory SET Quantity = Quantity - ? WHERE Material_ID=?', [order.Material_Qty, order.Material_ID]);
    totalCost = Number(order.Material_Qty) * Number(inventory.Cost_Per_Unit);
  }

  const finalPrice = price === undefined ? Number(order.Price || 0) : Number(price);
  // Total_Spent is what the client paid (the price), not what the workshop
  // spent on materials (the cost — already stored in Orders.Cost).
  db.run('UPDATE Clients SET Total_Spent = Total_Spent + ? WHERE Client_ID=?', [finalPrice, order.Client_ID]);
  db.run("UPDATE Orders SET Status='تم التسليم', Price=?, Cost=?, Profit=?, Updated_At=CURRENT_TIMESTAMP WHERE Task_ID=?", [finalPrice, totalCost, finalPrice - totalCost, taskId]);
  return { order: db.get('SELECT * FROM Orders WHERE Task_ID=?', [taskId]), alreadyDelivered: false };
}

module.exports = { deliverOrder, validateDelivery };
