const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'designs.js'), 'utf8');

function pageContext(elements = {}, selectors = {}) {
  const context = vm.createContext({
    document: {
      addEventListener() {},
      getElementById(id) { return elements[id] || null; },
      querySelector(selector) { return selectors[selector] || null; },
      querySelectorAll(selector) { return selectors[selector] || []; }
    },
    window: {},
    FormData,
    File,
    setTimeout() {},
    clearTimeout() {}
  });
  vm.runInContext(source, context);
  return context;
}

function stubUploadUi(context) {
  context.bootstrap = { Modal: { getInstance: () => ({ hide() {} }) } };
  vm.runInContext(`
    globalThis.toasts = [];
    showToast = (message, type) => toasts.push({ message, type });
    loadDesigns = async () => {};
    generateAutoThumbnail = async () => null;
  `, context);
}

test('clicking a protected design download prevents navigation and opens password prompt', async () => {
  const context = pageContext();
  const action = { dataset: { designAction: 'download', designId: '7' } };
  let prevented = false;
  context.event = {
    target: { closest(selector) { return selector === '[data-design-action]' ? action : null; } },
    preventDefault() { prevented = true; },
    stopPropagation() {}
  };
  context.fetch = async () => ({
    ok: false, status: 403, json: async () => ({ needsPassword: true })
  });
  vm.runInContext(`
    allDesigns = [{ Design_ID: 7, PasswordProtected: true, Original_Name: 'locked.dxf' }];
    openViewDesign = async id => { globalThis.openedId = id; };
  `, context);

  await vm.runInContext('handleDesignAction(event)', context);
  assert.equal(prevented, true);
  assert.equal(context.openedId, 7);
  assert.equal(vm.runInContext('pendingDesignDownloadId', context), 7);
});

test('successful password verification unlocks the current design and resumes its download', async () => {
  const elements = Object.fromEntries(['viewPassword', 'viewPasswordError', 'viewPasswordWrap', 'viewContent']
    .map(id => [id, { value: '', textContent: '', classList: { add() {}, remove() {} } }]));
  elements.viewPassword.value = 'secret';
  const context = pageContext(elements);
  context.fetch = async () => ({ ok: true, json: async () => ({ success: true }) });
  vm.runInContext(`
    currentViewDesign = { Design_ID: 7, PasswordProtected: true, NeedsPassword: true };
    pendingDesignDownloadId = 7;
    loadViewFile = design => { globalThis.previewedId = design.Design_ID; };
    downloadDesignFile = async (event, id) => { globalThis.downloadedId = id; };
  `, context);

  await vm.runInContext('verifyDesignPassword()', context);
  assert.equal(vm.runInContext('currentViewDesign.NeedsPassword', context), false);
  assert.equal(vm.runInContext('pendingDesignDownloadId', context), null);
  assert.equal(context.previewedId, 7);
  assert.equal(context.downloadedId, 7);
  assert.equal(elements.viewPasswordError.textContent, '');
});

test('permission endpoint must confirm success with JSON', async () => {
  const context = pageContext();
  context.fetch = async () => ({ ok: true, json: async () => { throw new SyntaxError('HTML response'); } });
  await assert.rejects(vm.runInContext('saveDesignPermissions(7, [3])', context), /لم يؤكد الخادم حفظ الصلاحيات/);
});

test('single upload reports partial failure when permission assignment fails', async () => {
  const fields = {
    dFile: { files: [new File(['DXF'], 'part.dxf')] },
    dThumb: { files: [] },
    dPermitted: { selectedOptions: [{ value: '3' }] },
    uploadDesignModal: {}
  };
  for (const id of ['dName', 'dCategory', 'dMaterial', 'dThickness', 'dUnit', 'dWidth', 'dHeight', 'dNotes', 'dPassword']) {
    fields[id] = { value: id === 'dName' ? 'Part' : '' };
  }
  const button = { disabled: false, innerHTML: '' };
  const context = pageContext(fields, { '#uploadDesignModal .modal-footer .btn-primary': button });
  stubUploadUi(context);
  context.fetch = async url => url === '/api/designs'
    ? { ok: true, json: async () => ({ success: true, Design_ID: 9 }) }
    : { ok: false, status: 500, json: async () => ({ error: 'خطأ قاعدة البيانات' }) };

  await vm.runInContext('uploadDesign()', context);
  assert.equal(context.toasts.length, 1);
  assert.equal(context.toasts[0].type, 'danger');
  assert.match(context.toasts[0].message, /تم رفع التصميم #9، لكن لم تُحفظ صلاحياته/);
  assert.equal(button.disabled, false);
});

test('edit reports saved specifications but failed permissions without claiming full success', async () => {
  const fields = {
    editDesignId: { value: '9' },
    eThumb: { files: [] },
    eClearPassword: { checked: false },
    ePermitted: { selectedOptions: [{ value: '3' }] },
    editDesignModal: {}
  };
  for (const id of ['eName', 'eCategory', 'eMaterial', 'eThickness', 'eUnit', 'eWidth', 'eHeight', 'eNotes', 'ePassword']) {
    fields[id] = { value: id === 'eName' ? 'Edited' : '' };
  }
  const button = { disabled: false };
  const context = pageContext(fields, { '#editDesignModal .modal-footer .btn-warning': button });
  stubUploadUi(context);
  context.fetch = async (url, options) => options.method === 'PUT'
    ? { ok: true, json: async () => ({ success: true }) }
    : { ok: false, status: 503, json: async () => ({ error: 'الخدمة غير متاحة' }) };

  await vm.runInContext('saveDesignEdit()', context);
  assert.equal(context.toasts.length, 1);
  assert.equal(context.toasts[0].type, 'danger');
  assert.match(context.toasts[0].message, /تم حفظ مواصفات التصميم #9، لكن لم تُحفظ صلاحياته/);
  assert.equal(button.disabled, false);
});

test('batch upload reports which designs have failed permission assignment', async () => {
  const fields = {
    bPermitted: { selectedOptions: [{ value: '3' }] },
    batchUploadModal: {}
  };
  for (const id of ['bCategory', 'bMaterial', 'bThickness', 'bPassword']) fields[id] = { value: '' };
  const button = { disabled: false, innerHTML: '' };
  const row = name => ({ querySelector(selector) { return { value: selector === '.batch-name' ? name : '' }; } });
  const context = pageContext(fields, {
    '#batchUploadModal .modal-footer .btn-success': button,
    '#batchPreview > div': [row('A'), row('B')]
  });
  stubUploadUi(context);
  vm.runInContext('batchFileList = [new File(["A"], "a.dxf"), new File(["B"], "b.dxf")]', context);
  context.fetch = async url => {
    if (url === '/api/designs/batch') return { ok: true, json: async () => ({ success: true, count: 2, created: [8, 9], errors: [] }) };
    return url.endsWith('/8/permissions')
      ? { ok: true, json: async () => ({ success: true }) }
      : { ok: false, json: async () => ({ error: 'خطأ في الصلاحيات' }) };
  };

  await vm.runInContext('uploadBatch()', context);
  assert.equal(context.toasts.length, 1);
  assert.equal(context.toasts[0].type, 'danger');
  assert.match(context.toasts[0].message, /لم تُحفظ صلاحيات 1 تصميم/);
  assert.match(context.toasts[0].message, /#9/);
  assert.equal(button.disabled, false);
});
