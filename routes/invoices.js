const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../database/connection');
const { requireAuth, requirePermission, canAccessOrder, orderScope } = require('../middleware/auth');
const { deliverOrder, validateDelivery } = require('../services/orderAccounting');
const PDFDocument = require('pdfkit');
const gdrive = require('../services/googleDrive');

const INVOICES_DIR = path.join(__dirname, '..', 'Server_Storage', 'Invoices');
if (!fs.existsSync(INVOICES_DIR)) fs.mkdirSync(INVOICES_DIR, { recursive: true });

function generateInvoiceNumber() {
  const last = db.get("SELECT Invoice_Number FROM Invoices ORDER BY Invoice_ID DESC LIMIT 1");
  const num = last ? parseInt(last.Invoice_Number.replace('INV-', '')) + 1 : 1;
  return `INV-${String(num).padStart(5, '0')}`;
}

async function generatePdf(invoice, order, client, materials) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  const fileName = `${invoice.Invoice_Number}.pdf`;
  const filePath = path.join(INVOICES_DIR, fileName);
  const stream = fs.createWriteStream(filePath);
  doc.pipe(stream);

  const rightMargin = doc.page.width - 50;
  const topY = 50;

  doc.fontSize(22).font('Helvetica-Bold').text('Kazanji Group', 50, topY, { align: 'right' });
  doc.fontSize(10).font('Helvetica').text('Company for Design & Cutting Services', 50, topY + 22, { align: 'right' });
  doc.moveDown(0.5);
  doc.fontSize(8).fillColor('#666').text('Tel: +963 933 123 456 | Email: info@kazanji-group.com', { align: 'right' });
  doc.fillColor('#000');

  doc.moveTo(50, topY + 55).lineTo(rightMargin, topY + 55).stroke('#ccc');

  doc.fontSize(18).font('Helvetica-Bold').text('INVOICE', 50, topY + 65, { align: 'center' });
  doc.moveDown(0.3);

  doc.fontSize(10).font('Helvetica');
  doc.text(`Invoice #: ${invoice.Invoice_Number}`, 50, topY + 90, { align: 'left' });
  const dateStr = new Date(invoice.Created_At).toLocaleDateString('en-GB');
  doc.text(`Date: ${dateStr}`, rightMargin - 150, topY + 90, { width: 150, align: 'right' });
  doc.text(`Status: ${invoice.Status}`, rightMargin - 150, topY + 105, { width: 150, align: 'right' });

  doc.moveDown(2);
  doc.fontSize(12).font('Helvetica-Bold').text('Bill To:', 50, doc.y);
  doc.fontSize(10).font('Helvetica');
  doc.text(`Client: ${client.Full_Name}`, 50, doc.y + 5);
  doc.text(`Phone: ${client.Phone_Number || 'N/A'}`, 50, doc.y + 5);

  if (order) {
    doc.text(`Order #: ${order.Task_ID}`, 50, doc.y + 5);
    doc.text(`Machine: ${order.Machine_Type}`, 50, doc.y + 5);
  }

  doc.moveDown(2);
  const tableTop = doc.y + 10;
  const col1 = 50, col2 = 250, col3 = 350, col4 = 450;
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Description', col1, tableTop);
  doc.text('Qty', col2, tableTop);
  doc.text('Unit Price', col3, tableTop);
  doc.text('Total', col4, tableTop);
  doc.moveTo(col1, tableTop + 18).lineTo(rightMargin, tableTop + 18).stroke('#999');

  let y = tableTop + 25;
  doc.fontSize(10).font('Helvetica');

  if (materials && materials.length > 0) {
    materials.forEach(m => {
      const desc = `${m.Material_Name || 'Material'} ${m.Thickness ? '(' + m.Thickness + ')' : ''}`;
      const qty = m.Quantity || 0;
      const price = m.Cost_Per_Unit || 0;
      const total = qty * price;
      doc.text(desc, col1, y, { width: 190 });
      doc.text(String(qty), col2, y);
      doc.text(`${price.toFixed(2)} SYP`, col3, y);
      doc.text(`${total.toFixed(2)} SYP`, col4, y);
      y += 20;
    });
  } else {
    doc.text('Design & Cutting Services', col1, y, { width: 190 });
    doc.text('1', col2, y);
    doc.text(`${invoice.Amount.toFixed(2)} SYP`, col3, y);
    doc.text(`${invoice.Amount.toFixed(2)} SYP`, col4, y);
    y += 20;
  }

  doc.moveTo(col1, y + 5).lineTo(rightMargin, y + 5).stroke('#999');

  y += 15;
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Total Amount:', col1, y);
  doc.text(`${invoice.Amount.toFixed(2)} SYP`, col4, y);
  y += 20;
  doc.text('Amount Paid:', col1, y);
  doc.text(`${(invoice.Amount_Paid || invoice.Amount).toFixed(2)} SYP`, col4, y);
  y += 20;
  const remaining = invoice.Amount - (invoice.Amount_Paid || invoice.Amount);
  if (remaining > 0) {
    doc.text('Remaining:', col1, y);
    doc.text(`${remaining.toFixed(2)} SYP`, col4, y);
  }

  doc.moveDown(3);
  doc.moveTo(50, doc.y + 5).lineTo(rightMargin, doc.y + 5).stroke('#ccc');
  doc.moveDown(0.5);
  doc.fontSize(8).fillColor('#666');
  doc.text('Thank you for your business!', { align: 'center' });
  doc.text('Kazanji Group - This is a computer-generated invoice', { align: 'center' });

  doc.end();
  return new Promise((resolve) => {
    stream.on('finish', () => resolve({ filePath, fileName }));
  });
}

router.get('/', requirePermission('invoices'), (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';
  let params = [];
  const scope = orderScope(req, 'o');
  const conditions = [scope.sql];
  if (search) { conditions.push('c.Full_Name LIKE ?'); params.push(`%${search}%`); }
  const where = 'WHERE ' + conditions.join(' AND ');
  const countRow = db.get(`SELECT COUNT(*) as total FROM Invoices i LEFT JOIN Clients c ON i.Client_ID=c.Client_ID LEFT JOIN Orders o ON i.Order_Task_ID=o.Task_ID ${where}`, [...scope.params, ...params]);
  const invoices = db.all(`
    SELECT i.*, c.Full_Name as Client_Name, o.Machine_Type
    FROM Invoices i
    LEFT JOIN Clients c ON i.Client_ID = c.Client_ID
    LEFT JOIN Orders o ON i.Order_Task_ID = o.Task_ID
    ${where}
    ORDER BY i.Created_At DESC
    LIMIT ? OFFSET ?
  `, [...scope.params, ...params, limit, offset]);
  res.json({ invoices, total: countRow.total, page, pages: Math.ceil(countRow.total / limit) });
});

router.post('/', requirePermission('invoices'), async (req, res) => {
  const { Order_Task_ID, Amount, Amount_Paid, Payment_Method, Status, Notes } = req.body;
  if (!Order_Task_ID || !Amount) return res.status(400).json({ error: 'رقم الطلب والمبلغ مطلوبان' });

  const existing = db.get("SELECT * FROM Invoices WHERE Order_Task_ID=?", [Order_Task_ID]);
  if (existing) return res.status(400).json({ error: 'هذا الطلب لديه فاتورة مسبقاً', invoice: existing });

  const order = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [Order_Task_ID]);
  if (!order) return res.status(404).json({ error: 'الطلب غير موجود' });
  if (!canAccessOrder(req, order)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذا الطلب' });
  const stockError = validateDelivery(order);
  if (stockError) return res.status(400).json({ error: stockError });

  const client = db.get("SELECT * FROM Clients WHERE Client_ID=?", [order.Client_ID]);
  if (!client) return res.status(404).json({ error: 'العميل غير موجود' });

  const invNumber = generateInvoiceNumber();
  const result = db.run(
    `INSERT INTO Invoices (Order_Task_ID, Client_ID, Invoice_Number, Amount, Amount_Paid, Payment_Method, Status, Notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [Order_Task_ID, order.Client_ID, invNumber, Amount, Amount_Paid || Amount, Payment_Method || 'نقداً', Status || 'مدفوعة', Notes || '']
  );

  if (!result.lastId) return res.status(500).json({ error: 'فشل إنشاء الفاتورة' });

  const invoice = db.get("SELECT * FROM Invoices WHERE Invoice_ID=?", [result.lastId]);

  const materials = db.all(`
    SELECT i.Material_Name, i.Thickness, i.Cost_Per_Unit, om.Quantity
    FROM Order_Materials om
    LEFT JOIN Inventory i ON om.Material_ID = i.Material_ID
    WHERE om.Task_ID = ?
  `, [Order_Task_ID]);

  const pdf = await generatePdf(invoice, order, client, materials);
  db.run("UPDATE Invoices SET File_Path=? WHERE Invoice_ID=?", [pdf.fileName, result.lastId]);

  const useGdrive = gdrive.isConfigured();
  if (useGdrive) {
    const fileBuffer = fs.readFileSync(pdf.filePath);
    const driveResult = await gdrive.uploadFile(`INV-${invoice.Invoice_ID}`, 'Invoices', pdf.fileName, fileBuffer);
    if (!driveResult.error) {
      db.run("UPDATE Invoices SET File_Path=? WHERE Invoice_ID=?", [`gdrive://${driveResult.fileId}`, result.lastId]);
    }
  }

  const delivery = deliverOrder(Order_Task_ID, Amount);
  if (delivery.error) return res.status(400).json({ error: delivery.error });
  if (global.io) {
    const updated = db.get("SELECT o.*, c.Full_Name as Client_Name FROM Orders o LEFT JOIN Clients c ON o.Client_ID=c.Client_ID WHERE o.Task_ID=?", [Order_Task_ID]);
    global.io.emit('order-update', updated);
    global.io.emit('notification', { message: `تم إنشاء فاتورة #${invNumber} للطلب #${Order_Task_ID}`, type: 'success' });
  }

  const created = db.get(`SELECT i.*, c.Full_Name as Client_Name FROM Invoices i LEFT JOIN Clients c ON i.Client_ID=c.Client_ID WHERE i.Invoice_ID=?`, [result.lastId]);
  res.json(created);
});

router.get('/:id', requireAuth(), (req, res) => {
  const invoice = db.get(`
    SELECT i.*, c.Full_Name as Client_Name, c.Phone_Number, o.Machine_Type, o.Notes as Order_Notes
    FROM Invoices i
    LEFT JOIN Clients c ON i.Client_ID = c.Client_ID
    LEFT JOIN Orders o ON i.Order_Task_ID = o.Task_ID
    WHERE i.Invoice_ID = ?
  `, [req.params.id]);
  if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  const invoiceOrder = db.get('SELECT * FROM Orders WHERE Task_ID=?', [invoice.Order_Task_ID]);
  if (!canAccessOrder(req, invoiceOrder)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذه الفاتورة' });
  const materials = db.all(`
    SELECT i.Material_Name, i.Thickness, i.Cost_Per_Unit, om.Quantity
    FROM Order_Materials om
    LEFT JOIN Inventory i ON om.Material_ID = i.Material_ID
    WHERE om.Task_ID = ?
  `, [invoice.Order_Task_ID]);
  invoice.Items = materials;
  res.json(invoice);
});

router.get('/:id/pdf', requireAuth(), async (req, res) => {
  const invoice = db.get(`
    SELECT i.*, c.Full_Name as Client_Name, c.Phone_Number, o.Machine_Type
    FROM Invoices i
    LEFT JOIN Clients c ON i.Client_ID = c.Client_ID
    LEFT JOIN Orders o ON i.Order_Task_ID = o.Task_ID
    WHERE i.Invoice_ID = ?
  `, [req.params.id]);
  if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  const invoiceOrder = db.get('SELECT * FROM Orders WHERE Task_ID=?', [invoice.Order_Task_ID]);
  if (!canAccessOrder(req, invoiceOrder)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذه الفاتورة' });

  if (invoice.File_Path && !invoice.File_Path.startsWith('gdrive://')) {
    const filePath = path.join(INVOICES_DIR, invoice.File_Path);
    if (fs.existsSync(filePath)) return res.download(filePath);
  }

  const client = db.get("SELECT * FROM Clients WHERE Client_ID=?", [invoice.Client_ID]);
  const order = db.get("SELECT * FROM Orders WHERE Task_ID=?", [invoice.Order_Task_ID]);
  const materials = db.all(`
    SELECT i.Material_Name, i.Thickness, i.Cost_Per_Unit, om.Quantity
    FROM Order_Materials om
    LEFT JOIN Inventory i ON om.Material_ID = i.Material_ID
    WHERE om.Task_ID = ?
  `, [invoice.Order_Task_ID]);

  const pdf = await generatePdf(invoice, order, client, materials);
  res.download(pdf.filePath, pdf.fileName);
});

router.get('/:id/view', requireAuth(), (req, res) => {
  const invoice = db.get(`
    SELECT i.*, c.Full_Name as Client_Name, c.Phone_Number, o.Machine_Type, o.Notes as Order_Notes
    FROM Invoices i
    LEFT JOIN Clients c ON i.Client_ID = c.Client_ID
    LEFT JOIN Orders o ON i.Order_Task_ID = o.Task_ID
    WHERE i.Invoice_ID = ?
  `, [req.params.id]);
  if (!invoice) return res.status(404).send('الفاتورة غير موجودة');
  const invoiceOrder = db.get('SELECT * FROM Orders WHERE Task_ID=?', [invoice.Order_Task_ID]);
  if (!canAccessOrder(req, invoiceOrder)) return res.status(403).send('لا تملك الصلاحية لهذه الفاتورة');
  const materials = db.all(`
    SELECT i.Material_Name, i.Thickness, i.Cost_Per_Unit, om.Quantity
    FROM Order_Materials om
    LEFT JOIN Inventory i ON om.Material_ID = i.Material_ID
    WHERE om.Task_ID = ?
  `, [invoice.Order_Task_ID]);
  res.render('invoice', { user: res.locals.user, invoice, materials });
});

router.delete('/:id', requirePermission('invoices'), (req, res) => {
  const invoice = db.get("SELECT * FROM Invoices WHERE Invoice_ID=?", [req.params.id]);
  if (!invoice) return res.status(404).json({ error: 'الفاتورة غير موجودة' });
  const invoiceOrder = db.get('SELECT * FROM Orders WHERE Task_ID=?', [invoice.Order_Task_ID]);
  if (!canAccessOrder(req, invoiceOrder)) return res.status(403).json({ error: 'لا تملك الصلاحية لهذه الفاتورة' });
  if (invoice.File_Path && !invoice.File_Path.startsWith('gdrive://')) {
    const filePath = path.join(INVOICES_DIR, invoice.File_Path);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.run("DELETE FROM Invoices WHERE Invoice_ID=?", [req.params.id]);
  res.json({ success: true });
});

module.exports = router;
