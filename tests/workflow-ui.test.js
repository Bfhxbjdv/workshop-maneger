const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'main.js'), 'utf8');
const context = vm.createContext({
  document: { addEventListener() {}, getElementById() { return null; } },
  setTimeout() {},
  clearTimeout() {}
});
vm.runInContext(source, context);

test('machine view shows requested pieces and the actual boards entered by the designer', () => {
  const details = vm.runInContext(`machineOrderDetails({
    Material_Qty: 20, Quantity_Unit: 'قطعة',
    Materials: [{ Material_Name: 'MDF', Thickness: '18 مم', Quantity: 7 }]
  })`, context);
  assert.match(details.quantity, /المطلوب: <strong>20<\/strong> قطعة/);
  assert.match(details.quantity, /للقص: <strong>7<\/strong> لوح MDF/);
  assert.match(details.materialNames, /MDF/);
  assert.match(details.thicknesses, /18 مم/);
});

test('machine view still shows the requested quantity for older orders without material rows', () => {
  const details = vm.runInContext(`machineOrderDetails({
    Material_Name: 'خشب', Thickness: '3 مم', Material_Qty: 4, Quantity_Unit: 'لوح'
  })`, context);
  assert.match(details.quantity, /المطلوب: <strong>4<\/strong> لوح/);
  assert.match(details.materialNames, /خشب/);
});

test('machine view escapes customer supplied material names', () => {
  const details = vm.runInContext(`machineOrderDetails({
    Materials: [{ Material_Name: '<script>', Quantity: 2 }]
  })`, context);
  assert.doesNotMatch(details.materialNames, /<script>/);
  assert.match(details.materialNames, /&lt;script&gt;/);
});

test('machine file preview keeps current designs and order images, excluding old revisions', async () => {
  const modal = {};
  const content = { textContent: '', innerHTML: '' };
  context.document.getElementById = id => id === 'machineFilesModal' ? modal : id === 'machineFilesContent' ? content : null;
  context.bootstrap = { Modal: { getOrCreateInstance: () => ({ show() {} }) } };
  context.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify([
      { File_ID: 1, File_Type: 'design', Is_Current: 0, Original_Name: 'old.dxf' },
      { File_ID: 2, File_Type: 'design', Is_Current: 1, Original_Name: 'new.dxf' },
      { File_ID: 3, File_Type: 'image', Is_Current: 1, Original_Name: 'photo.png' }
    ])
  });
  await vm.runInContext('openMachineFiles(42)', context);
  assert.match(content.innerHTML, /new\.dxf/);
  assert.match(content.innerHTML, /photo\.png/);
  assert.doesNotMatch(content.innerHTML, /old\.dxf/);
});
