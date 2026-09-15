const socket = (typeof io !== 'undefined') ? io() : null;
let allDesigns = [];
let allUsers = [];
let currentViewDesign = null;
let previewMode = 'auto';
let viewerCanvasCtx = null;
const isAdmin = () => (document.body.dataset.role === 'Admin') || (document.body.dataset.permAdmin === '1');

document.addEventListener('DOMContentLoaded', () => {
  loadDesigns();
  loadUsersForPerms();
});

function openUploadModal() {
  document.getElementById('uploadDesignForm').reset();
  fillUserMultiSelect('dPermitted');
  new bootstrap.Modal(document.getElementById('uploadDesignModal')).show();
}

function fillUserMultiSelect(selId, selectedIds = []) {
  const sel = document.getElementById(selId);
  if (!sel) return;
  const designers = allUsers.filter(u => u.Role === 'Designer' || u.Role === 'Admin');
  sel.innerHTML = `<option value="__all__">جميع المستخدمين</option>` +
    designers.map(u => `<option value="${u.User_ID}" ${selectedIds.includes(u.User_ID) ? 'selected' : ''}>${u.Name}${u.Role === 'Admin' ? ' (مدير)' : ''}</option>`).join('');
}

async function loadUsersForPerms() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) return;
    allUsers = await res.json();
    fillUserMultiSelect('ePermitted');
  } catch {}
}

async function loadDesigns() {
  const grid = document.getElementById('designsGrid');
  grid.innerHTML = `<div class="col-12 text-center text-muted py-5"><div class="spinner-border"></div></div>`;
  try {
    const res = await fetch('/api/designs');
    if (res.status === 401) { window.location.href = '/login'; return; }
    if (!res.ok) throw new Error((await res.json()).error);
    allDesigns = await res.json();
    buildCategoryList();
    renderDesigns();
  } catch (e) {
    grid.innerHTML = `<div class="col-12 text-center text-danger py-4">خطأ في تحميل التصاميم: ${e.message}</div>`;
  }
}

function buildCategoryList() {
  const cats = new Set(allDesigns.map(d => d.Category).filter(Boolean));
  const sel = document.getElementById('designCategory');
  if (!sel) return;
  sel.innerHTML = `<option value="">كل التصنيفات</option>` + [...cats].map(c => `<option value="${c}">${c}</option>`).join('');
  const list = document.getElementById('categoryList');
  if (list) list.innerHTML = [...cats].map(c => `<option value="${c}">`).join('');
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
  if (list.length === 0) grid.innerHTML = '';
}

function designCard(d) {
  const ext = (d.Original_Name || '').split('.').pop().toUpperCase();
  const hasThumb = !!d.ThumbnailPath;
  const needsAdmin = document.body.dataset.role === 'Admin' || document.body.dataset.permAdmin === '1';
  const permCount = d.PermittedUsers?.length || 0;
  return `<div class="col-6 col-md-4 col-lg-3">
    <div class="card design-card h-100" onclick="openViewDesign(${d.Design_ID})">
      <div class="position-relative">
        <span class="badge bg-dark badge-ext">${ext}</span>
        <div class="design-thumb">
          ${hasThumb ? `<img src="/api/designs/${d.Design_ID}/thumbnail" alt="${d.Name}">` : `<i class="bi bi-file-earmark-image placeholder"></i>`}
        </div>
        ${d.PasswordProtected ? `<span class="badge bg-warning lock-badge"><i class="bi bi-lock-fill"></i></span>` : ''}
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

// ===================== UPLOAD =====================
async function uploadDesign() {
  const file = document.getElementById('dFile').files[0];
  const thumb = document.getElementById('dThumb').files[0];
  const name = document.getElementById('dName').value.trim();
  if (!file || !thumb || !name) { showToast('اسم التصميم والملف والصورة مطلوبة', 'warning'); return; }
  const fd = new FormData();
  fd.append('file', file);
  fd.append('thumbnail', thumb);
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
  try {
    const res = await fetch('/api/designs', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'فشل الرفع');
    const sel = document.getElementById('dPermitted');
    if (sel.selectedOptions.length > 0 && ![...sel.selectedOptions].some(o => o.value === '__all__')) {
      await fetch(`/api/designs/${data.Design_ID}/permissions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [...sel.selectedOptions].map(o => parseInt(o.value)) })
      });
    }
    bootstrap.Modal.getInstance(document.getElementById('uploadDesignModal')).hide();
    showToast('تم رفع التصميم بنجاح', 'success');
    loadDesigns();
  } catch (e) { showToast(e.message, 'danger'); }
  finally { btn.disabled = false; btn.innerHTML = '<i class="bi bi-cloud-upload"></i> رفع'; }
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
  try {
    let res = await fetch('/api/designs/' + id, { method: 'PUT', body: fd });
    let data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'فشل الحفظ');
    const sel = document.getElementById('ePermitted');
    const chosen = [...sel.selectedOptions].map(o => o.value);
    const selAll = chosen.includes('__all__') || chosen.length === 0;
    await fetch(`/api/designs/${id}/permissions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userIds: selAll ? [] : chosen.map(v => parseInt(v)) })
    });
    bootstrap.Modal.getInstance(document.getElementById('editDesignModal')).hide();
    showToast('تم الحفظ', 'success');
    loadDesigns();
  } catch (e) { showToast(e.message, 'danger'); }
  finally { btn.disabled = false; }
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
  const res = await fetch('/api/designs/' + id);
  if (res.status === 401) { window.location.href = '/login'; return; }
  if (!res.ok) return showToast((await res.json()).error || 'لا يمكن فتح التصميم', 'danger');
  currentViewDesign = await res.json();
  document.getElementById('viewDesignName').textContent = currentViewDesign.Name;
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
  const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
  modalEl.addEventListener('shown.bs.modal', () => {
    if (!currentViewDesign.NeedsPassword) loadViewFile(currentViewDesign);
  }, { once: true });
  modal.show();
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

async function loadViewFile(d) {
  previewMode = 'auto';
  document.getElementById('viewDownloadBtn').href = `/api/designs/${d.Design_ID}/file`;
  const canvas = document.getElementById('viewerCanvas');
  const placeholder = document.getElementById('viewerPlaceholder');
  const modeBtn = document.getElementById('viewModeBtn');

  try {
    const ext = extOf(d);
    let canRender = ['dxf', 'plt', 'svg'].includes(ext);
    if (canRender) {
      const res = await fetch(`/api/designs/${d.Design_ID}/file`);
      if (!res.ok) throw new Error('لا يمكن فتح الملف' + (res.status === 403 ? ' - لا تملك الصلاحية' : ''));
      const text = await res.text();
      canvas.classList.remove('d-none');
      placeholder.classList.add('d-none');
      modeBtn.classList.remove('d-none');
      modeBtn.style.display = '';
      if (ext === 'dxf') drawDxf(canvas, text);
      else if (ext === 'plt') drawPlt(canvas, text);
      else if (ext === 'svg') drawSvg(canvas, text);
    } else {
      canvas.classList.add('d-none');
      placeholder.classList.remove('d-none');
      modeBtn.classList.add('d-none');
      const img = document.getElementById('viewThumbImg');
      img.onerror = () => { img.style.display = 'none'; };
      img.onload = () => { img.style.display = ''; };
      document.getElementById('viewThumbImg').src = d.ThumbnailPath ? `/api/designs/${d.Design_ID}/thumbnail` : '';
    }
  } catch (e) {
    canvas.classList.add('d-none');
    placeholder.classList.remove('d-none');
    document.getElementById('viewThumbImg').src = d.ThumbnailPath ? `/api/designs/${d.Design_ID}/thumbnail` : '';
    document.querySelector('#viewerPlaceholder .text-muted').innerHTML = `<i class="bi bi-info-circle"></i> ${e.message}. يمكنك تحميل الملف لعرضه في برنامج التصميم.`;
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
  const pass = document.getElementById('viewPassword').value;
  document.getElementById('viewPasswordError').textContent = '';
  const res = await fetch(`/api/designs/${currentViewDesign.Design_ID}/verify-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Password: pass })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { document.getElementById('viewPasswordError').textContent = data.error || 'كلمة المرور غير صحيحة'; return; }
  document.getElementById('viewPasswordWrap').classList.add('d-none');
  document.getElementById('viewContent').classList.remove('d-none');
  window.currentViewDesign.NeedsPassword = false;
  loadViewFile(currentViewDesign);
}

function showToast(msg, type = 'info') {
  let c = document.getElementById('toastContainer');
  if (!c) { c = document.createElement('div'); c.id = 'toastContainer'; c.style.cssText = 'position:fixed;top:20px;left:20px;z-index:9999'; document.body.appendChild(c); }
  const colors = { info: 'primary', success: 'success', warning: 'warning', danger: 'danger' };
  const t = document.createElement('div');
  t.className = `alert alert-${colors[type] || 'info'} alert-dismissible fade show`;
  t.innerHTML = `${msg} <button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
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
        if (c === 10) verts.push([parseFloat(v), null]);
        else if (c === 20 && verts.length) verts[verts.length - 1][1] = parseFloat(v);
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
      ctx.fillStyle = '#212529'; ctx.font = `${Math.max(11, s.r * scale || 12)}px sans-serif`;
      ctx.fillText(s.label, p[0], p[1]);
    }
  });
}

// ===================== PLT (HPGL) RENDERER =====================
function drawPlt(canvas, text) {
  const ctx = canvas.getContext('2d');
  const W = canvas.clientWidth || canvas.width;
  const H = 400;
  canvas.width = W; canvas.height = H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);

  const cmds = text.match(/[A-Z]{2}[^;]*/g) || [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const segs = [];
  let penDown = false; let cur = null;
  const handle = (x, y) => {
    if (!isFinite(x) || !isFinite(y)) return;
    if (penDown && cur) segs.push([cur, [x, y]]);
    cur = [x, y];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  };
  cmds.forEach(c => {
    const op = c.substring(0, 2);
    const args = c.substring(2).split(',').map(s => parseFloat(s)).filter(n => isFinite(n));
    if (op === 'PU') penDown = false;
    else if (op === 'PD') penDown = true;
    else if (op === 'PA') { for (let i = 0; i + 1 < args.length; i += 2) handle(args[i], args[i + 1]); }
    else if (op === 'PR') { if (cur) for (let i = 0; i + 1 < args.length; i += 2) handle(cur[0] + args[i], cur[1] + args[i + 1]); }
    else if (op === 'SP') { /* pen select */ }
  });
  if (!isFinite(minX)) { ctx.fillStyle = '#adb5bd'; ctx.fillText('لا توجد عناصر قابلة للعرض', W / 2 - 60, H / 2); return; }
  const pad = 30;
  const rangeX = (maxX - minX) || 1, rangeY = (maxY - minY) || 1;
  const scale = Math.min((W - pad * 2) / rangeX, (H - pad * 2) / rangeY);
  const offX = (W - rangeX * scale) / 2, offY = (H - rangeY * scale) / 2;
  ctx.strokeStyle = '#212529'; ctx.lineWidth = 1.5;
  segs.forEach(([a, b]) => {
    ctx.beginPath();
    ctx.moveTo(offX + (a[0] - minX) * scale, H - (offY + (a[1] - minY) * scale));
    ctx.lineTo(offX + (b[0] - minX) * scale, H - (offY + (b[1] - minY) * scale));
    ctx.stroke();
  });
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