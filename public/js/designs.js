const socket = (typeof io !== 'undefined') ? io() : null;
let allDesigns = [];
let allUsers = [];
let currentViewDesign = null;
let previewMode = 'auto';
const isAdmin = () => (document.body.dataset.role === 'Admin') || (document.body.dataset.permAdmin === '1');
let aotDesignId = null;
let aotSelectedClient = null;
let batchFileList = [];
let aotSearchTimer = null;
let designsLoadRequest = 0;
let viewerRequestId = 0;
let viewerObjectUrl = null;
let pendingDesignDownloadId = null;

document.addEventListener('DOMContentLoaded', () => {
  loadDesigns();
  loadUsersForPerms();
  document.addEventListener('click', handleDesignAction);
  document.getElementById('batchFiles')?.addEventListener('change', onBatchFilesChanged);
  document.getElementById('aotOrderSelect')?.addEventListener('change', () => {
    const wrap = document.getElementById('aotNewOrderWrap');
    if (wrap) wrap.classList.toggle('d-none', !!document.getElementById('aotOrderSelect').value);
    document.getElementById('aotSubmit').disabled = false;
  });
  document.getElementById('aotSearch')?.addEventListener('input', debounceAotSearch);
});

function handleDesignAction(event) {
  const action = event.target.closest('[data-design-action]');
  if (action) {
    event.stopPropagation();
    const id = Number(action.dataset.designId);
    if (action.dataset.designAction === 'download' || action.dataset.designAction === 'view-download') {
      return downloadDesignFile(event, id);
    }
    if (action.dataset.designAction === 'open') return openViewDesign(id);
  }
  const card = event.target.closest('[data-design-card]');
  if (card && !event.target.closest('[data-design-action]')) openViewDesign(Number(card.dataset.designId));
}

function openUploadModal() {
  document.getElementById('uploadDesignForm').reset();
  fillUserMultiSelect('dPermitted');
  new bootstrap.Modal(document.getElementById('uploadDesignModal')).show();
}

function fillUserMultiSelect(selId, selectedIds = []) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  sel.innerHTML = `<option value="__all__">جميع المستخدمين</option>` +
    allUsers.map(u => `<option value="${u.User_ID}" ${selectedIds.includes(u.User_ID) ? 'selected' : ''}>${u.Name} (${u.Role})</option>`).join('');
}

async function loadUsersForPerms() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) return;
    allUsers = await res.json();
    fillUserMultiSelect('ePermitted');
    fillUserMultiSelect('bPermitted');
  } catch {}
}

async function loadDesigns({ preserveGrid = false } = {}) {
  const grid = document.getElementById('designsGrid');
  const requestId = ++designsLoadRequest;
  if (!preserveGrid || !allDesigns.length) {
    grid.innerHTML = `<div class="col-12 text-center text-muted py-5"><div class="spinner-border"></div></div>`;
  }
  try {
    const res = await fetch('/api/designs', { cache: 'no-store' });
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (!res.ok) throw new Error((await res.json()).error);
    const designs = await res.json();
    if (requestId !== designsLoadRequest) return;
    allDesigns = designs;
    buildCategoryList();
    renderDesigns();
  } catch (e) {
    if (requestId !== designsLoadRequest) return;
    grid.innerHTML = `<div class="col-12 text-center text-danger py-4">خطأ في تحميل التصاميم: ${e.message}</div>`;
  }
}

function buildCategoryList() {
  const cats = new Set(allDesigns.map(d => d.Category).filter(Boolean));
  const sel = document.getElementById('designCategory');
  if (sel) sel.innerHTML = `<option value="">كل التصنيفات</option>` + [...cats].map(c => `<option value="${c}">${c}</option>`).join('');
}

function renderDesigns() {
  const grid = document.getElementById('designsGrid');
  const empty = document.getElementById('designsEmpty');
  if (!grid) return;
  const q = (document.getElementById('designSearch')?.value || '').trim().toLowerCase();
  const cat = document.getElementById('designCategory')?.value || '';
  const filter = document.getElementById('designFilter')?.value || 'all';
  let list = allDesigns;
  if (q) list = list.filter(d => [d.Name, d.Category, d.Material, d.Thickness, d.Notes].join(' ').toLowerCase().includes(q));
  if (cat) list = list.filter(d => d.Category === cat);
  if (filter === 'protected') list = list.filter(d => d.PasswordProtected);
  if (filter === 'mine') list = list.filter(d => d.PasswordProtected ? true : (d.PermittedUsers?.length === 0 || d.PermittedUsers.some(p => p.Username === (document.body.dataset.username)) || document.body.dataset.role === 'Admin'));

  empty.classList.toggle('d-none', list.length > 0);
  grid.innerHTML = list.map(d => designCard(d)).join('');
  renderMissingCardPreviews(list);
  if (list.length === 0) grid.innerHTML = '';
}

function designCard(d) {
  const ext = (d.Original_Name || '').split('.').pop().toUpperCase();
  const hasThumb = !!d.ThumbnailPath;
  const needsAdmin = document.body.dataset.role === 'Admin' || document.body.dataset.permAdmin === '1';
  const permCount = d.PermittedUsers?.length || 0;
  return `<div class="col-6 col-md-4 col-lg-3">
    <div class="card design-card h-100" data-design-card data-design-id="${d.Design_ID}">
      <div class="position-relative">
        <span class="badge bg-dark badge-ext">${ext}</span>
        <div class="design-thumb" data-design-preview="${d.Design_ID}">
          ${hasThumb ? `<img src="/api/designs/${d.Design_ID}/thumbnail" alt="${d.Name}">` : `<span class="placeholder-preview"><i class="bi bi-file-earmark-${ext === 'CDR' ? 'richtext' : 'image'} placeholder"></i><small class="d-block text-muted">${ext}</small></span>`}
        </div>
        <div class="lock-badge d-flex gap-1">
          ${d.PasswordProtected ? `<span class="badge bg-warning"><i class="bi bi-lock-fill"></i></span>` : ''}
          <a class="badge bg-primary text-decoration-none" data-design-action="download" data-design-id="${d.Design_ID}" href="/api/designs/${d.Design_ID}/download" title="تحميل"><i class="bi bi-download"></i></a>
        </div>
        ${(needsAdmin && permCount > 0) ? `<span class="badge bg-info thumb-badge"><i class="bi bi-people"></i> ${permCount}</span>` : ''}
      </div>
      <div class="card-body p-2">
        <h6 class="card-title"><i class="bi bi-file-earmark"></i> ${d.Name}</h6>
        <div class="small text-muted">
          ${[d.Material, d.Thickness].filter(Boolean).join(' • ')}
          ${d.Width || d.Height ? `<div><i class="bi bi-rulers"></i> ${d.Width || 0} × ${d.Height || 0} ${d.Unit || 'سم'}</div>` : ''}
        </div>
      </div>
    </div>
  </div>`;
}

// Older records may have been saved before automatic thumbnails existed.
// Render DXF/PLT directly in their card; for CDR, use its embedded bitmap
// preview when CorelDRAW includes one. This keeps the file content visible
// before downloading whenever a browser-readable preview is available.
async function renderMissingCardPreviews(designs) {
  for (const d of designs) {
    if (d.ThumbnailPath) continue;
    const ext = extOf(d);
    if (!['dxf', 'plt', 'cdr'].includes(ext)) continue;
    const host = document.querySelector(`[data-design-preview="${d.Design_ID}"]`);
    if (!host) continue;
    try {
      const res = await fetch(`/api/designs/${d.Design_ID}/file`, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) continue;
      if (ext === 'dxf' || ext === 'plt') {
        const canvas = document.createElement('canvas');
        canvas.width = 360; canvas.height = 180;
        canvas.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#fff';
        host.replaceChildren(canvas);
        const source = await res.text();
        if (ext === 'dxf') drawDxf(canvas, source); else drawPlt(canvas, source);
      } else {
        const preview = extractEmbeddedCdrPreview(await res.arrayBuffer());
        if (!preview) continue;
        const image = document.createElement('img');
        const url = URL.createObjectURL(preview);
        image.src = url; image.alt = d.Name;
        image.onload = () => URL.revokeObjectURL(url);
        host.replaceChildren(image);
      }
    } catch {}
  }
}

// ===================== UPLOAD (single) =====================
async function saveDesignPermissions(designId, userIds) {
  if (!Number.isSafeInteger(Number(designId)) || Number(designId) < 1) {
    throw new Error('رقم التصميم غير صالح');
  }
  const res = await fetch(`/api/designs/${designId}/permissions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userIds })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success !== true) {
    throw new Error(data.error || 'لم يؤكد الخادم حفظ الصلاحيات');
  }
}

async function uploadDesign() {
  const file = document.getElementById('dFile').files[0];
  const name = document.getElementById('dName').value.trim();
  if (!file || !name) { showToast('اسم التصميم والملف مطلوبان', 'warning'); return; }
  const fd = new FormData();
  fd.append('file', file);
  const thumb = document.getElementById('dThumb').files[0];
  if (thumb) fd.append('thumbnail', thumb);
  else {
    try {
      const autoThumb = await generateAutoThumbnail(file);
      if (autoThumb) fd.append('thumbnail', autoThumb);
    } catch {}
  }
  fd.append('Name', name);
  fd.append('Category', document.getElementById('dCategory').value.trim());
  fd.append('Material', document.getElementById('dMaterial').value.trim());
  fd.append('Thickness', document.getElementById('dThickness').value.trim());
  fd.append('Unit', document.getElementById('dUnit').value);
  fd.append('Width', document.getElementById('dWidth').value);
  fd.append('Height', document.getElementById('dHeight').value);
  fd.append('Notes', document.getElementById('dNotes').value.trim());
  const pass = document.getElementById('dPassword').value;
  if (pass) fd.append('Password', pass);

  const btn = document.querySelector('#uploadDesignModal .modal-footer .btn-primary');
  btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جارٍ الرفع...';
  let uploaded = false;
  try {
    const res = await fetch('/api/designs', { method: 'POST', body: fd });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || data.success !== true || !Number.isSafeInteger(Number(data.Design_ID)) || Number(data.Design_ID) < 1) {
      throw new Error(data.error || 'لم يؤكد الخادم رفع التصميم');
    }
    uploaded = true;
    const sel = document.getElementById('dPermitted');
    let permissionError = null;
    if (sel && sel.selectedOptions.length > 0 && ![...sel.selectedOptions].some(o => o.value === '__all__')) {
      try {
        await saveDesignPermissions(data.Design_ID, [...sel.selectedOptions].map(o => parseInt(o.value)));
      } catch (error) { permissionError = error; }
    }
    try { bootstrap.Modal.getInstance(document.getElementById('uploadDesignModal'))?.hide(); } catch {}
    if (permissionError) {
      showToast(`تم رفع التصميم #${data.Design_ID}، لكن لم تُحفظ صلاحياته: ${permissionError.message}. راجع صلاحياته قبل استخدامه.`, 'danger');
    } else {
      showToast('تم رفع التصميم بنجاح', 'success');
    }
  } catch (e) { showToast(e.message, 'danger'); }
  finally {
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-cloud-upload"></i> رفع';
    if (uploaded) await loadDesigns({ preserveGrid: true });
  }
}

// ===================== AUTO-THUMBNAIL GENERATION =====================
function generateAutoThumbnail(file) {
  return new Promise(resolve => {
    const ext = (file.name || '').split('.').pop().toLowerCase();
    const IMAGE_EXTS = ['png','jpg','jpeg','gif','webp','bmp'];
    if (IMAGE_EXTS.includes(ext)) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const MAX = 360;
        let w = img.width, h = img.height;
        const s = Math.min(1, MAX / Math.max(w, h));
        c.width = Math.round(w * s); c.height = Math.round(h * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => resolve(b ? new File([b], 'auto_thumb.png', { type: 'image/png' }) : null), 'image/png');
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
      return;
    }
    if (ext === 'svg' || ext === 'dxf' || ext === 'plt') {
      const fr = new FileReader();
      fr.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 360; c.height = 280;
          if (ext === 'dxf') drawDxf(c, fr.result);
          else if (ext === 'plt') drawPlt(c, fr.result);
          else if (ext === 'svg') { drawSvg(c, fr.result); }
          c.toBlob(b => resolve(b ? new File([b], 'auto_thumb.png', { type: 'image/png' }) : null), 'image/png');
        } catch { resolve(null); }
      };
      fr.onerror = () => resolve(null);
      fr.readAsText(file);
      return;
    }
    if (ext === 'cdr') {
      const fr = new FileReader();
      fr.onload = () => {
        const preview = extractEmbeddedCdrPreview(fr.result);
        const extension = preview?.type === 'image/jpeg' ? 'jpg' : 'png';
        resolve(preview ? new File([preview], `auto_thumb.${extension}`, { type: preview.type || 'image/png' }) : null);
      };
      fr.onerror = () => resolve(null);
      fr.readAsArrayBuffer(file);
      return;
    }
    resolve(null);
  });
}

function extractEmbeddedCdrPreview(buffer) {
  const bytes = new Uint8Array(buffer);
  // CDR files frequently keep a PNG or JPEG display preview in a RIFF chunk.
  // Extract only a complete raster image; never execute or interpret CDR data.
  for (let start = 0; start + 8 < bytes.length; start++) {
    const isPng = bytes[start] === 0x89 && bytes[start + 1] === 0x50 && bytes[start + 2] === 0x4e && bytes[start + 3] === 0x47;
    if (isPng) {
      for (let end = start + 8; end + 8 < bytes.length; end++) {
        if (bytes[end] === 0x49 && bytes[end + 1] === 0x45 && bytes[end + 2] === 0x4e && bytes[end + 3] === 0x44 && bytes[end + 4] === 0xae && bytes[end + 5] === 0x42 && bytes[end + 6] === 0x60 && bytes[end + 7] === 0x82) {
          return new Blob([bytes.slice(start, end + 8)], { type: 'image/png' });
        }
      }
    }
    const isJpeg = bytes[start] === 0xff && bytes[start + 1] === 0xd8 && bytes[start + 2] === 0xff;
    if (isJpeg) {
      for (let end = start + 3; end + 1 < bytes.length; end++) {
        if (bytes[end] === 0xff && bytes[end + 1] === 0xd9) return new Blob([bytes.slice(start, end + 2)], { type: 'image/jpeg' });
      }
    }
  }
  return null;
}

// ===================== BATCH UPLOAD =====================
function openBatchModal() {
  document.getElementById('batchFiles').value = '';
  document.getElementById('batchPreview').innerHTML = '';
  document.getElementById('bCategory').value = '';
  document.getElementById('bMaterial').value = '';
  document.getElementById('bThickness').value = '';
  document.getElementById('bPassword').value = '';
  fillUserMultiSelect('bPermitted');
  batchFileList = [];
  new bootstrap.Modal(document.getElementById('batchUploadModal')).show();
}

async function onBatchFilesChanged() {
  const input = document.getElementById('batchFiles');
  const preview = document.getElementById('batchPreview');
  preview.innerHTML = '';
  batchFileList = Array.from(input.files || []);
  if (!batchFileList.length) return;
  const nameCounts = new Map();

  for (let i = 0; i < batchFileList.length; i++) {
    const file = batchFileList[i];
    const ext = (file.name || '').split('.').pop().toUpperCase();
    const baseName = (file.name || '').replace(/\.[^.]+$/, '');
    const occurrence = (nameCounts.get(baseName.toLowerCase()) || 0) + 1;
    nameCounts.set(baseName.toLowerCase(), occurrence);
    const displayName = occurrence === 1 ? baseName : `${baseName} (${occurrence})`;
    const IMAGE_EXTS = ['PNG','JPG','JPEG','GIF','WEBP','BMP'];
    let thumbSrc = '';
    if (IMAGE_EXTS.includes(ext)) {
      thumbSrc = URL.createObjectURL(file);
    } else if (['DXF','PLT','SVG'].includes(ext)) {
      try {
        const auto = await generateAutoThumbnail(file);
        if (auto) thumbSrc = URL.createObjectURL(auto);
      } catch {}
    }

    preview.innerHTML += `
      <div class="col-12 col-sm-6 col-lg-4" data-idx="${i}">
        <div class="card border h-100">
          <div class="card-body p-2">
            <div class="d-flex gap-2 mb-2">
              <div style="width:60px;height:60px;min-width:60px;border-radius:4px;overflow:hidden;background:#f8f9fa;display:flex;align-items:center;justify-content:center">
                ${thumbSrc ? `<img src="${thumbSrc}" style="width:100%;height:100%;object-fit:cover" alt="">` : `<span class="text-muted small">${ext}</span>`}
              </div>
              <div class="flex-grow-1">
                <input type="text" class="form-control form-control-sm mb-1 batch-name" value="${displayName.replace(/"/g, '&quot;')}" placeholder="اسم التصميم">
                <textarea class="form-control form-control-sm batch-notes" rows="2" placeholder="ملاحظات..."></textarea>
              </div>
            </div>
            <div class="text-muted" style="font-size:.7rem">${file.name} • ${(file.size / 1024).toFixed(1)} KB</div>
          </div>
        </div>
      </div>`;
  }
}

async function uploadBatch() {
  if (!batchFileList.length) { showToast('اختر ملفات أولاً', 'warning'); return; }
  const btn = document.querySelector('#batchUploadModal .modal-footer .btn-success');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جارٍ الرفع...';

  const fd = new FormData();
  const items = [];
  const thumbIndexes = [];
  const rows = document.querySelectorAll('#batchPreview > div');

  for (let i = 0; i < batchFileList.length; i++) {
    const row = rows[i];
    const nameInput = row?.querySelector('.batch-name');
    const notesInput = row?.querySelector('.batch-notes');
    const name = (nameInput?.value || batchFileList[i].name).trim() || `تصميم ${i + 1}`;
    items.push({
      Name: name,
      Notes: notesInput?.value?.trim() || '',
      Category: document.getElementById('bCategory').value.trim(),
      Material: document.getElementById('bMaterial').value.trim(),
      Thickness: document.getElementById('bThickness').value.trim(),
      Password: document.getElementById('bPassword').value || ''
    });
    fd.append('files', batchFileList[i]);
    try {
      const autoThumb = await generateAutoThumbnail(batchFileList[i]);
      if (autoThumb) {
        fd.append('thumbs', autoThumb);
        thumbIndexes.push(i);
      }
    } catch {}
  }

  if (!items.length) { showToast('لا توجد ملفات صالحة', 'warning'); btn.disabled = false; btn.innerHTML = '<i class="bi bi-cloud-upload"></i> رفع الكل'; return; }
  fd.append('items', JSON.stringify(items));
  fd.append('thumbIndexes', JSON.stringify(thumbIndexes));

  try {
    const res = await fetch('/api/designs/batch', { method: 'POST', body: fd });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || data.success !== true || !Array.isArray(data.created) || !data.created.length) {
      throw new Error(data.error || 'لم يؤكد الخادم رفع التصاميم');
    }

    const permSel = document.getElementById('bPermitted');
    const permissionFailures = [];
    if (permSel && permSel.selectedOptions.length > 0 && ![...permSel.selectedOptions].some(o => o.value === '__all__')) {
      const permIds = [...permSel.selectedOptions].map(o => parseInt(o.value));
      for (const did of data.created) {
        try {
          await saveDesignPermissions(did, permIds);
        } catch (error) { permissionFailures.push(`#${did}: ${error.message}`); }
      }
    }

    try { bootstrap.Modal.getInstance(document.getElementById('batchUploadModal'))?.hide(); } catch {}
    const uploadErrors = Array.isArray(data.errors) ? data.errors : [];
    if (permissionFailures.length || uploadErrors.length) {
      const details = [
        uploadErrors.length ? `تعذر رفع بعض الملفات: ${uploadErrors.join('؛ ')}` : '',
        permissionFailures.length ? `لم تُحفظ صلاحيات ${permissionFailures.length} تصميم(ات): ${permissionFailures.join('؛ ')}` : ''
      ].filter(Boolean).join(' | ');
      showToast(`تم رفع ${data.created.length} تصميم(ات)، لكن العملية لم تكتمل: ${details}. راجع النتائج قبل الاستخدام.`, 'danger');
    } else {
      showToast(`تم رفع ${data.created.length} تصميم(ات) بنجاح`, 'success');
    }
  } catch (e) { showToast(e.message, 'danger'); }
  finally {
    btn.disabled = false; btn.innerHTML = '<i class="bi bi-cloud-upload"></i> رفع الكل';
    await loadDesigns({ preserveGrid: true });
  }
}

// ===================== EDIT / DELETE =====================
async function openEditDesign(id, ev) {
  if (ev) ev.stopPropagation();
  const d = allDesigns.find(x => x.Design_ID === id);
  if (!d) return;
  document.getElementById('editDesignId').value = d.Design_ID;
  document.getElementById('eName').value = d.Name;
  document.getElementById('eCategory').value = d.Category || '';
  document.getElementById('eMaterial').value = d.Material || '';
  document.getElementById('eThickness').value = d.Thickness || '';
  document.getElementById('eUnit').value = d.Unit || 'سم';
  document.getElementById('eWidth').value = d.Width || '';
  document.getElementById('eHeight').value = d.Height || '';
  document.getElementById('eNotes').value = d.Notes || '';
  document.getElementById('ePassword').value = '';
  document.getElementById('eClearPassword').checked = false;
  fillUserMultiSelect('ePermitted', (d.PermittedUsers || []).map(p => p.User_ID));
  new bootstrap.Modal(document.getElementById('editDesignModal')).show();
}

function openEditDesignFromView() {
  if (!currentViewDesign) return;
  bootstrap.Modal.getInstance(document.getElementById('viewDesignModal')).hide();
  setTimeout(() => openEditDesign(currentViewDesign.Design_ID), 300);
}

async function saveDesignEdit() {
  const id = document.getElementById('editDesignId').value;
  const fd = new FormData();
  fd.append('Name', document.getElementById('eName').value.trim());
  fd.append('Category', document.getElementById('eCategory').value.trim());
  fd.append('Material', document.getElementById('eMaterial').value.trim());
  fd.append('Thickness', document.getElementById('eThickness').value.trim());
  fd.append('Unit', document.getElementById('eUnit').value);
  fd.append('Width', document.getElementById('eWidth').value);
  fd.append('Height', document.getElementById('eHeight').value);
  fd.append('Notes', document.getElementById('eNotes').value.trim());
  const thumbFile = document.getElementById('eThumb').files[0];
  if (thumbFile) fd.append('thumbnail', thumbFile);
  const pass = document.getElementById('ePassword').value;
  if (pass) fd.append('Password', pass);
  if (document.getElementById('eClearPassword').checked) fd.append('ClearPassword', '1');
  const btn = document.querySelector('#editDesignModal .modal-footer .btn-warning');
  btn.disabled = true;
  let saved = false;
  try {
    let res = await fetch('/api/designs/' + id, { method: 'PUT', body: fd });
    let data = await res.json().catch(() => ({}));
    if (!res.ok || data.success !== true) throw new Error(data.error || 'لم يؤكد الخادم حفظ التصميم');
    saved = true;
    const sel = document.getElementById('ePermitted');
    const chosen = [...sel.selectedOptions].map(o => o.value);
    const selAll = chosen.includes('__all__') || chosen.length === 0;
    let permissionError = null;
    try {
      await saveDesignPermissions(id, selAll ? [] : chosen.map(v => parseInt(v)));
    } catch (error) { permissionError = error; }
    bootstrap.Modal.getInstance(document.getElementById('editDesignModal')).hide();
    if (permissionError) {
      showToast(`تم حفظ مواصفات التصميم #${id}، لكن لم تُحفظ صلاحياته: ${permissionError.message}. أعد فتحه لتصحيح الصلاحيات.`, 'danger');
    } else {
      showToast('تم الحفظ', 'success');
    }
  } catch (e) { showToast(e.message, 'danger'); }
  finally { btn.disabled = false; if (saved) loadDesigns(); }
}

async function deleteDesign() {
  if (!confirm('هل أنت متأكد من حذف هذا التصميم والملف وكلمة المرور؟')) return;
  const id = document.getElementById('editDesignId').value;
  const res = await fetch('/api/designs/' + id, { method: 'DELETE' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return showToast(data.error || 'فشل الحذف', 'danger');
  bootstrap.Modal.getInstance(document.getElementById('editDesignModal')).hide();
  showToast('تم الحذف', 'success');
  loadDesigns();
}

// ===================== VIEW =====================
async function openViewDesign(id) {
  const res = await fetch('/api/designs/' + id, { cache: 'no-store', credentials: 'same-origin' });
  if (res.status === 401) { window.location.href = '/login'; return; }
  if (!res.ok) return showToast((await res.json()).error || 'لا يمكن فتح التصميم', 'danger');
  currentViewDesign = await res.json();
  document.getElementById('viewDesignName').textContent = currentViewDesign.Name;
  const viewDownloadButton = document.getElementById('viewDownloadButton');
  if (viewDownloadButton) {
    viewDownloadButton.dataset.designId = currentViewDesign.Design_ID;
    viewDownloadButton.href = `/api/designs/${currentViewDesign.Design_ID}/download`;
  }
  buildSpecs(currentViewDesign);

  const pwWrap = document.getElementById('viewPasswordWrap');
  const content = document.getElementById('viewContent');
  if (currentViewDesign.NeedsPassword) {
    content.classList.add('d-none');
    pwWrap.classList.remove('d-none');
    document.getElementById('viewPasswordError').textContent = '';
    document.getElementById('viewPassword').value = '';
  } else {
    pwWrap.classList.add('d-none');
    content.classList.remove('d-none');
  }
  const modalEl = document.getElementById('viewDesignModal');
  modalEl.addEventListener('shown.bs.modal', () => {
    if (!currentViewDesign.NeedsPassword) loadViewFile(currentViewDesign);
  }, { once: true });
  bootstrap.Modal.getOrCreateInstance(modalEl).show();
}

function buildSpecs(d) {
  const specs = [];
  if (d.Category) specs.push(['التصنيف', d.Category]);
  if (d.Material) specs.push(['الخامة', d.Material]);
  if (d.Thickness) specs.push(['السمك', d.Thickness]);
  if (d.Width || d.Height) specs.push(['الأبعاد', `${d.Width || 0} × ${d.Height || 0} ${d.Unit || 'سم'}`]);
  if (d.Notes) specs.push(['المواصفات', d.Notes]);
  if (d.Created_By_Name) specs.push(['أضيف بواسطة', d.Created_By_Name]);
  document.getElementById('viewSpecs').innerHTML = specs.map(([k, v]) => `
    <div class="col-md-6"><div class="border rounded p-2 bg-light h-100"><small class="text-muted">${k}</small><div>${v}</div></div></div>`).join('');
}

function extOf(d) { return (d.Original_Name || '').split('.').pop().toLowerCase(); }

function startBrowserDownload(id) {
  const link = document.createElement('a');
  link.href = `/api/designs/${id}/download`;
  link.download = '';
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function downloadDesignFile(event, id) {
  if (typeof event === 'number' || typeof event === 'string') {
    id = event;
    event = null;
  }
  event?.preventDefault();
  event?.stopPropagation();
  try {
    id = Number(id);
    if (!Number.isSafeInteger(id) || id < 1) return;
    const design = (currentViewDesign?.Design_ID === id ? currentViewDesign : null) ||
      allDesigns.find(item => item.Design_ID === id);
    if (!design?.PasswordProtected) {
      startBrowserDownload(id);
      return;
    }
    const name = design?.Original_Name || `design_${id}`;
    const res = await fetch(`/api/designs/${id}/download`, {
      cache: 'no-store',
      credentials: 'same-origin'
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      if (res.status === 403 && j.needsPassword) {
        pendingDesignDownloadId = id;
        await openViewDesign(id);
        return;
      }
      showToast(j.error || 'لا يمكن تحميل هذا الملف', 'danger');
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || `design_${id}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) {
    showToast('فشل التحميل: ' + e.message, 'danger');
  }
}

async function loadViewFile(d) {
  const requestId = ++viewerRequestId;
  previewMode = 'auto';
  const canvas = document.getElementById('viewerCanvas');
  const placeholder = document.getElementById('viewerPlaceholder');
  const modeBtn = document.getElementById('viewModeBtn');
  const pdfFrame = document.getElementById('viewerPdf');
  const textPre = document.getElementById('viewerText');
  const IMG_EXTS = ['png','jpg','jpeg','gif','webp','bmp'];
  const ext = extOf(d);

  if (viewerObjectUrl) {
    URL.revokeObjectURL(viewerObjectUrl);
    viewerObjectUrl = null;
  }

  const hideAll = () => {
    canvas.classList.add('d-none');
    placeholder.classList.add('d-none');
    if (pdfFrame) { pdfFrame.classList.add('d-none'); pdfFrame.src = ''; }
    if (textPre) { textPre.classList.add('d-none'); textPre.textContent = ''; }
    modeBtn.classList.add('d-none');
  };
  hideAll();

  const showThumb = (msg) => {
    placeholder.classList.remove('d-none');
    const img = document.getElementById('viewThumbImg');
    if (d.ThumbnailPath) {
      img.onerror = () => { img.style.display = 'none'; };
      img.onload = () => { img.style.display = ''; };
      img.src = `/api/designs/${d.Design_ID}/thumbnail`;
    } else {
      img.style.display = 'none';
    }
    const note = document.querySelector('#viewerPlaceholder .text-muted');
    if (note && msg) note.innerHTML = `<i class="bi bi-info-circle"></i> ${msg}`;
  };

  try {
    if (['dxf', 'plt', 'svg'].includes(ext)) {
      const res = await fetch(`/api/designs/${d.Design_ID}/file`, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('لا يمكن فتح الملف' + (res.status === 403 ? ' - لا تملك الصلاحية' : ''));
      const text = await res.text();
      if (requestId !== viewerRequestId) return;
      canvas.classList.remove('d-none');
      modeBtn.classList.remove('d-none');
      if (ext === 'dxf') drawDxf(canvas, text);
      else if (ext === 'plt') drawPlt(canvas, text);
      else if (ext === 'svg') drawSvg(canvas, text);
    } else if (ext === 'pdf' && pdfFrame) {
      const res = await fetch(`/api/designs/${d.Design_ID}/file`, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('لا يمكن فتح الملف');
      const blob = await res.blob();
      if (requestId !== viewerRequestId) return;
      viewerObjectUrl = URL.createObjectURL(blob);
      pdfFrame.classList.remove('d-none');
      pdfFrame.src = viewerObjectUrl;
    } else if (IMG_EXTS.includes(ext)) {
      const res = await fetch(`/api/designs/${d.Design_ID}/file`, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('لا يمكن فتح الملف');
      const blob = await res.blob();
      if (requestId !== viewerRequestId) return;
      viewerObjectUrl = URL.createObjectURL(blob);
      placeholder.classList.remove('d-none');
      const img = document.getElementById('viewThumbImg');
      img.onerror = () => { img.style.display = 'none'; };
      img.onload = () => { img.style.display = ''; };
      img.src = viewerObjectUrl;
    } else if (ext === 'txt' && textPre) {
      const res = await fetch(`/api/designs/${d.Design_ID}/file`, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('لا يمكن فتح الملف');
      textPre.textContent = await res.text();
      textPre.classList.remove('d-none');
    } else if (['ai', 'eps', 'cdr'].includes(ext)) {
      const res = await fetch(`/api/designs/${d.Design_ID}/file`, { cache: 'no-store', credentials: 'same-origin' });
      if (!res.ok) throw new Error('لا يمكن فتح الملف');
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder('utf-8', { fatal: false }).decode(buf.subarray(0, Math.min(4096, buf.length)));
      const headTrim = head.replace(/^\uFEFF/, '').trimStart();
      const lower = headTrim.toLowerCase();

      if (ext === 'cdr') {
        const cdrPreview = extractEmbeddedCdrPreview(buf);
        if (cdrPreview) {
          viewerObjectUrl = URL.createObjectURL(cdrPreview);
          placeholder.classList.remove('d-none');
          const img = document.getElementById('viewThumbImg');
          img.onload = () => { img.style.display = ''; };
          img.onerror = () => { img.style.display = 'none'; };
          img.src = viewerObjectUrl;
          return;
        }
      }
      if (lower.startsWith('%pdf') || headTrim.startsWith('%PDF-')) {
        // AI often saved as PDF-compatible
        const blob = new Blob([buf], { type: 'application/pdf' });
        pdfFrame.src = URL.createObjectURL(blob);
        pdfFrame.classList.remove('d-none');
      } else if (lower.includes('<svg') || lower.startsWith('<?xml') || lower.includes('<svg ')) {
        canvas.classList.remove('d-none');
        drawSvg(canvas, new TextDecoder().decode(buf));
      } else if (headTrim.startsWith('%!ps') || headTrim.startsWith('%!PS')) {
        // EPS / PostScript - try parsing basic vector commands on canvas
        canvas.classList.remove('d-none');
        drawPlt(canvas, new TextDecoder().decode(buf));
      } else {
        throw new Error('هذا النوع لا يُعرض هنا تلقائياً');
      }
    } else {
      throw new Error('هذا النوع لا يُعرض هنا تلقائياً');
    }
  } catch (e) {
    showThumb(e.message === 'هذا النوع لا يُعرض هنا تلقائياً'
      ? 'هذا النوع من الملفات يُعرض هنا كصورة مميزة. لاستعراض النسخة الأصلية استخدم زر التحميل.'
      : e.message + '. يمكنك تحميل الملف وعرضه في برنامج التصميم.');
  }
}

function togglePreviewMode() {
  if (!currentViewDesign) return;
  if (previewMode === 'auto' || previewMode === 'canvas') {
    previewMode = 'thumb';
    document.getElementById('viewerCanvas').classList.add('d-none');
    document.getElementById('viewerPlaceholder').classList.remove('d-none');
    document.getElementById('viewModeBtn').innerHTML = '<i class="bi bi-bounding-box"></i> عرض الرسم';
    document.getElementById('viewThumbImg').src = currentViewDesign.ThumbnailPath ? `/api/designs/${currentViewDesign.Design_ID}/thumbnail` : '';
  } else {
    previewMode = 'canvas';
    document.getElementById('viewerCanvas').classList.remove('d-none');
    document.getElementById('viewerPlaceholder').classList.add('d-none');
    document.getElementById('viewModeBtn').innerHTML = '<i class="bi bi-card-image"></i> عرض الصورة';
    loadViewFile(currentViewDesign);
  }
}

async function verifyDesignPassword() {
  if (!currentViewDesign) return;
  const pass = document.getElementById('viewPassword').value;
  document.getElementById('viewPasswordError').textContent = '';
  try {
    const res = await fetch(`/api/designs/${currentViewDesign.Design_ID}/verify-password`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Password: pass })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { document.getElementById('viewPasswordError').textContent = data.error || 'كلمة المرور غير صحيحة'; return; }
    document.getElementById('viewPasswordWrap').classList.add('d-none');
    document.getElementById('viewContent').classList.remove('d-none');
    currentViewDesign.NeedsPassword = false;
    loadViewFile(currentViewDesign);
    if (pendingDesignDownloadId === currentViewDesign.Design_ID) {
      const id = pendingDesignDownloadId;
      pendingDesignDownloadId = null;
      await downloadDesignFile(null, id);
    }
  } catch (error) {
    document.getElementById('viewPasswordError').textContent = 'تعذر الاتصال. حاول مجددًا.';
  }
}

// ===================== ADD TO ORDER =====================
async function openAddToOrderModal() {
  if (!currentViewDesign) return;
  aotDesignId = currentViewDesign.Design_ID;
  aotSelectedClient = null;
  document.getElementById('aotDesignInfo').innerHTML = `<i class="bi bi-file-earmark"></i> <strong>${currentViewDesign.Name}</strong> <span class="text-muted">(${currentViewDesign.Original_Name || ''})</span>`;
  document.getElementById('aotSearch').value = '';
  document.getElementById('aotClientsList').classList.add('d-none');
  document.getElementById('aotClientsList').innerHTML = '';
  document.getElementById('aotOrdersSection').classList.add('d-none');
  document.getElementById('aotOrderSelect').innerHTML = '<option value="">- إنشاء طلب جديد -</option>';
  document.getElementById('aotNewOrderWrap').classList.add('d-none');
  document.getElementById('aotSubmit').disabled = true;
  const ds = document.getElementById('aotDesigner');
  if (ds) {
    const designers = (allUsers || []).filter(u => u.Role === 'Designer' || u.Role === 'Admin');
    ds.innerHTML = '<option value="">- المصمم الحالي -</option>' + designers.map(u => `<option value="${u.User_ID}">${u.Name}${u.Role === 'Admin' ? ' (مدير)' : ''}</option>`).join('');
  }
  new bootstrap.Modal(document.getElementById('addToOrderModal')).show();
}

function debounceAotSearch() {
  clearTimeout(aotSearchTimer);
  aotSearchTimer = setTimeout(searchAotClients, 300);
}

async function searchAotClients() {
  const q = (document.getElementById('aotSearch').value || '').trim();
  const list = document.getElementById('aotClientsList');
  if (!q) { list.classList.add('d-none'); return; }
  try {
    const res = await fetch('/api/clients/all?search=' + encodeURIComponent(q));
    if (!res.ok) return;
    const clients = await res.json();
    list.classList.remove('d-none');
    list.innerHTML = clients.map(c => `
      <button type="button" class="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
        onclick="selectAotClient(${c.Client_ID}, '${(c.Full_Name || '').replace(/'/g, "\\'")}')">
        <span>${c.Full_Name}</span>
        <small class="text-muted">${c.Phone_Number || ''}</small>
      </button>`).join('') || '<div class="list-group-item text-muted small">لا يوجد زبائن مطابقين</div>';
  } catch {}
}

async function selectAotClient(clientId, name) {
  aotSelectedClient = clientId;
  document.getElementById('aotClientsList').innerHTML = `<div class="list-group-item list-group-item-active bg-info text-white"><i class="bi bi-person-check"></i> ${name}</div>`;
  const section = document.getElementById('aotOrdersSection');
  section.classList.remove('d-none');
  const sel = document.getElementById('aotOrderSelect');
  sel.innerHTML = '<option value="">- إنشاء طلب جديد -</option>';
  try {
    const res = await fetch(`/api/clients/${clientId}/orders`);
    if (!res.ok) return;
    const orders = await res.json();
    orders.forEach(o => {
      const opt = document.createElement('option');
      opt.value = o.Task_ID;
      opt.textContent = `#${o.Task_ID} - ${o.Status} - ${o.Materials_List || 'بدون خامة'}`;
      sel.appendChild(opt);
    });
    document.getElementById('aotNewOrderWrap').classList.toggle('d-none', orders.length > 0);
  } catch {}
  document.getElementById('aotSubmit').disabled = false;
}

async function submitAddToOrder() {
  if (!aotDesignId || !aotSelectedClient) return;
  const btn = document.getElementById('aotSubmit');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
  const body = { Client_ID: aotSelectedClient };
  const taskId = document.getElementById('aotOrderSelect').value;
  if (taskId) body.Task_ID = parseInt(taskId, 10);
  else {
    body.Machine_Type = document.getElementById('aotMachine').value;
    const des = document.getElementById('aotDesigner')?.value;
    if (des) body.Designer_ID = parseInt(des, 10);
  }

  try {
    const res = await fetch(`/api/designs/${aotDesignId}/add-to-order`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل الإضافة');
    bootstrap.Modal.getInstance(document.getElementById('addToOrderModal')).hide();
    showToast(`تم إضافة التصميم إلى الطلب #${data.Task_ID} - ${data.Client_Name}`, 'success');
  } catch (e) { showToast(e.message, 'danger'); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check-lg"></i> إضافة'; }
}

// ===================== TOAST =====================
function showToast(msg, type = 'info') {
  let c = document.getElementById('toastContainer');
  if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.style.cssText = 'position:fixed;top:20px;left:20px;z-index:9999'; document.body.appendChild(c); }
  const colors = { info: 'primary', success: 'success', warning: 'warning', danger: 'danger' };
  const t = document.createElement('div');
  t.className = `alert alert-${colors[type] || 'info'} alert-dismissible fade show`;
  t.textContent = String(msg);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-close';
  close.dataset.bsDismiss = 'alert';
  t.appendChild(close);
  c.appendChild(t);
  setTimeout(() => t.remove(), 5000);
}

// ===================== DXF RENDERER =====================
function parseDxfEntities(text) {
  const struct = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i += 2) {
    struct.push({ code: parseInt(lines[i].trim(), 10), value: lines[i + 1].trim() });
  }
  const out = [];
  let i = 0;
  while (i < struct.length) {
    if (struct[i].code === 0 && ['LINE', 'CIRCLE', 'ARC', 'LWPOLYLINE', 'TEXT', 'MTEXT'].includes(struct[i].value)) {
      const type = struct[i].value;
      i++;
      const verts = [];
      const props = {};
      while (i < struct.length && struct[i].code !== 0) {
        const c = struct[i].code;
        const v = struct[i].value;
        // Keep the first point both as a vertex (for polylines) and as DXF
        // properties (for ordinary LINE entities). Previously LINE's start
        // point was discarded, producing an empty DXF thumbnail.
        if (c === 10) { props[10] = parseFloat(v); verts.push([parseFloat(v), null]); }
        else if (c === 20 && verts.length) { props[20] = parseFloat(v); verts[verts.length - 1][1] = parseFloat(v); }
        else if (c === 11 || c === 21 || c === 40 || c === 50 || c === 51 || c === 30) props[c] = parseFloat(v);
        else if (c === 70) props[c] = parseInt(v, 10);
        else if (c === 1) props[c] = v;
        i++;
      }
      if (type === 'LWPOLYLINE') {
        const closed = ((props[70] || 0) & 1) === 1;
        for (let k = 0; k + 1 < verts.length; k++) {
          if (verts[k] && verts[k + 1] && isFinite(verts[k][0]) && isFinite(verts[k][1]) && isFinite(verts[k + 1][0]) && isFinite(verts[k + 1][1])) {
            out.push({ type: 'LINE', pts: [verts[k], verts[k + 1]] });
          }
        }
        if (closed && verts.length > 2) {
          const last = verts[verts.length - 1], first = verts[0];
          if (isFinite(last[0]) && isFinite(last[1]) && isFinite(first[0]) && isFinite(first[1])) {
            out.push({ type: 'LINE', pts: [last, first] });
          }
        }
      } else if (type === 'LINE') {
        out.push({ type, vals: props, extraVals: { 11: props[11], 21: props[21] }, verts });
      } else {
        out.push({ type, vals: props, verts });
      }
    } else { i++; }
  }
  return out;
}

function drawDxf(canvas, text) {
  const shapes = [];
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.width;
  const H = 400;
  canvas.width = W; canvas.height = H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bounding = (x, y) => {
    if (!isFinite(x) || !isFinite(y)) return;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };

  parseDxfEntities(text).forEach(e => {
    if (e.type === 'LINE') {
      let x1, y1, x2, y2;
      if (e.verts && e.verts.length >= 2) {
        x1 = e.verts[0][0]; y1 = e.verts[0][1];
        x2 = e.verts[1] ? e.verts[1][0] : e.extraVals[11];
        y2 = e.verts[1] ? e.verts[1][1] : e.extraVals[21];
      } else {
        x1 = e.vals[10]; y1 = e.vals[20]; x2 = e.extraVals[11]; y2 = e.extraVals[21];
      }
      if (isFinite(x1) && isFinite(y1) && isFinite(x2) && isFinite(y2)) {
        shapes.push({ kind: 'line', pts: [[x1, y1], [x2, y2]] });
        bounding(x1, y1); bounding(x2, y2);
      }
    } else if (e.type === 'CIRCLE') {
      const cx = e.vals[10], cy = e.vals[20], r = e.vals[40];
      if (isFinite(cx) && isFinite(cy) && isFinite(r)) {
        shapes.push({ kind: 'circle', cx, cy, r });
        bounding(cx - r, cy - r); bounding(cx + r, cy + r);
      }
    } else if (e.type === 'ARC') {
      const cx = e.vals[10], cy = e.vals[20], r = e.vals[40], a1 = e.vals[50], a2 = e.vals[51];
      if (isFinite(cx) && isFinite(cy) && isFinite(r)) {
        shapes.push({ kind: 'arc', cx, cy, r, a1, a2 });
        for (let a = 0; a <= 2; a += 0.25) {
          const ang = (a1 + (a2 - a1) * a) * Math.PI / 180;
          bounding(cx + r * Math.cos(ang), cy + r * Math.sin(ang));
        }
      }
    } else if (e.type === 'TEXT' || e.type === 'MTEXT') {
      const x = e.vals[10], y = e.vals[20];
      if (e.vals[1]) shapes.push({ kind: 'text', x, y, label: e.vals[1] });
      bounding(x, y);
    }
  });

  if (!isFinite(minX)) { ctx.fillStyle = '#adb5bd'; ctx.fillText('لا توجد عناصر قابلة للعرض', W / 2 - 60, H / 2); return; }

  const pad = 30;
  const rangeX = (maxX - minX) || 1;
  const rangeY = (maxY - minY) || 1;
  const scale = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
  const offX = (W - rangeX * scale) / 2;
  const offY = (H - rangeY * scale) / 2;
  const tx = (x, y) => [offX + (x - minX) * scale, H - (offY + (y - minY) * scale)];

  ctx.strokeStyle = '#212529'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  shapes.forEach(s => {
    if (s.kind === 'line') {
      const [a, b] = s.pts.map(([x, y]) => tx(x, y));
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    } else if (s.kind === 'circle') {
      const [c] = tx(s.cx, s.cy); ctx.beginPath(); ctx.arc(c[0], c[1], s.r * scale, 0, Math.PI * 2); ctx.stroke();
    } else if (s.kind === 'arc') {
      const [c] = tx(s.cx, s.cy);
      const a0 = s.a1 * Math.PI / 180, a1a = s.a2 * Math.PI / 180;
      const full = ((a1a - a0 + Math.PI * 4) % (Math.PI * 2));
      const start = Math.atan2(-Math.sin(a0), Math.cos(a0));
      const end = start - full;
      ctx.beginPath(); ctx.arc(c[0], c[1], s.r * scale, end, start, true); ctx.stroke();
    } else if (s.kind === 'text') {
      const [p] = tx(s.x, s.y);
      ctx.fillStyle = '#212529'; ctx.font = `${Math.max(11, scale || 12)}px sans-serif`;
      ctx.fillText(s.label, p[0], p[1]);
    }
  });
}

// ===================== PLT (HPGL) RENDERER =====================
function drawPlt(canvas, text) {
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.width || 400;
  const H = canvas.clientHeight || 400;
  canvas.width = W; canvas.height = H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  const segs = [];
  let cur = null;
  let penDown = false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const handle = (x, y, draw) => {
    if (!isFinite(x) || !isFinite(y)) return;
    const p = [x, y];
    if (draw && penDown && cur) segs.push([cur, p]);
    cur = p;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };

  const parts = String(text || '').split(';');
  for (const seg of parts) {
    const m = seg.trim().match(/^([A-Z]{2})\s*(.*)$/);
    if (!m) continue;
    const op = m[1];
    const nums = (m[2] || '').match(/-?\d+(?:\.\d+)?/g);
    if (!nums) {
      if (op === 'PU') penDown = false;
      else if (op === 'PD') penDown = true;
      continue;
    }
    const vals = nums.map(Number);
    if (op === 'PU') {
      penDown = false;
      for (let i = 0; i + 1 < vals.length; i += 2) handle(vals[i], vals[i + 1], false);
    } else if (op === 'PD') {
      penDown = true;
      for (let i = 0; i + 1 < vals.length; i += 2) handle(vals[i], vals[i + 1], true);
    } else if (op === 'PA' || op === 'PC') {
      penDown = true;
      for (let i = 0; i + 1 < vals.length; i += 2) handle(vals[i], vals[i + 1], true);
    } else if (op === 'PR') {
      penDown = true;
      if (!cur) continue;
      for (let i = 0; i + 1 < vals.length; i += 2) handle(cur[0] + vals[i], cur[1] + vals[i + 1], true);
    }
  }

  if (!isFinite(minX) || segs.length === 0) {
    ctx.fillStyle = '#adb5bd';
    ctx.font = '15px sans-serif';
    ctx.fillText('لا توجد عناصر قابلة للعرض', W / 2 - 70, H / 2);
    return;
  }
  const pad = 30;
  const rangeX = (maxX - minX) || 1;
  const rangeY = (maxY - minY) || 1;
  const scale = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
  const offX = (W - rangeX * scale) / 2;
  const offY = (H - rangeY * scale) / 2;
  const tx = (x, y) => [offX + (x - minX) * scale, H - (offY + (y - minY) * scale)];

  ctx.strokeStyle = '#212529'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  segs.forEach(([a, b]) => {
    const p1 = tx(a[0], a[1]), p2 = tx(b[0], b[1]);
    ctx.moveTo(p1[0], p1[1]);
    ctx.lineTo(p2[0], p2[1]);
  });
  ctx.stroke();
}

// ===================== SVG RENDERER =====================
function drawSvg(canvas, text) {
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.width;
  const H = 400;
  canvas.width = W; canvas.height = H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
  const img = new Image();
  img.onload = () => {
    const s = Math.min((W - 40) / img.width, (H - 40) / img.height);
    const dw = img.width * s, dh = img.height * s;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
}
