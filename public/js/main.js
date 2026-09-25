const socket = (typeof io !== 'undefined') ? io() : null;
let currentPage = 1;
let currentFilter = 'all';

if (socket) {
  socket.on('order-update', () => {
    if (document.getElementById('ordersTableBody')) loadOrders();
    if (document.getElementById('laserOrdersBody')) loadLaserOrders();
    if (document.getElementById('routerOrdersBody')) loadRouterOrders();
  });

  socket.on('notification', (notif) => showToast(notif.message, notif.type));
}

function showToast(msg, type = 'info') {
  const container = document.getElementById('toastContainer') || (() => {
    const c = document.createElement('div');
    c.id = 'toastContainer';
    c.style.cssText = 'position:fixed;top:20px;left:20px;z-index:9999';
    document.body.appendChild(c);
    return c;
  })();
  const colors = { info: 'primary', success: 'success', warning: 'warning', danger: 'danger' };
  const toast = document.createElement('div');
  toast.className = `alert alert-${colors[type] || 'primary'} alert-dismissible fade show`;
  toast.textContent = msg;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-close';
  close.setAttribute('data-bs-dismiss', 'alert');
  toast.appendChild(close);
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

async function readApiResponse(response) {
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(response.ok ? 'استجابة الخادم غير صالحة' : `خطأ من الخادم (${response.status})`); }
  if (!response.ok || data.error) throw new Error(data.error || `تعذر تنفيذ العملية (${response.status})`);
  return data;
}

let currentRolePromise;
function currentRole() {
  if (!currentRolePromise) {
    currentRolePromise = fetch('/api/auth/me')
      .then(readApiResponse)
      .then(data => data.user?.Role || document.body.dataset.role || null)
      .catch(() => document.body.dataset.role || null);
  }
  return currentRolePromise;
}

// ============== DESIGNER PAGE ==============
function loadOrders(page = 1, filter = currentFilter) {
  currentPage = page;
  currentFilter = filter;
  let url = `/api/orders?page=${page}&limit=20`;
  if (filter !== 'all') url += `&status=${encodeURIComponent(filter)}`;
  const search = document.getElementById('orderSearchInput')?.value || '';
  if (search) url += `&search=${encodeURIComponent(search)}`;
  const sort = document.getElementById('sortSelect')?.value || 'newest';
  url += `&sort=${sort}`;
  fetch(url).then(readApiResponse).then(data => {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!data.orders || data.orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center">لا توجد طلبات</td></tr>';
      renderPagination('ordersPagination', data.page || 1, data.pages || 1);
      return;
    }
    data.orders.forEach(o => {
      const statusColors = { 'قيد التصميم': 'warning', 'جاهز للقص': 'info', 'قيد التنفيذ': 'primary', 'تم الانتهاء من القص': 'dark', 'تم التغليف': 'secondary', 'تم التسليم': 'success' };
      const sc = statusColors[o.Status] || 'secondary';

      let materialsHtml = o.Materials && o.Materials.length
        ? o.Materials.map(m => `<span class="badge bg-secondary me-1">${escapeHtml(m.Material_Name)} ${escapeHtml(m.Thickness || '')} (${Number(m.Quantity) || 0} لوح)</span>`).join('')
        : o.Material_Name ? `<span class="badge bg-secondary">${escapeHtml(o.Material_Name)} ${escapeHtml(o.Thickness || '')}</span>` : '-';
      if (Number(o.Material_Qty) > 0) materialsHtml += `<div class="small mt-1">المطلوب: <strong>${Number(o.Material_Qty)} ${escapeHtml(o.Quantity_Unit || 'لوح')}</strong></div>`;

      const showUploadBtn = o.Status === 'قيد التصميم';
      const hasFile = o.File_Path;

      tbody.innerHTML += `<tr>
        <td>${o.Task_ID}</td>
        <td><a href="/client/${o.Client_ID}" class="text-decoration-none">${escapeHtml(o.Client_Name || '---')}</a></td>
        <td><span class="badge bg-${o.Machine_Type === 'Laser' ? 'danger' : 'success'}">${o.Machine_Type}</span></td>
        <td>${materialsHtml}</td>
        <td><small class="text-muted">${escapeHtml((o.Notes || '').substring(0, 30))}</small></td>
        <td><span class="badge bg-${sc}">${o.Status}</span></td>
        <td>${showUploadBtn
          ? `<button class="btn btn-sm btn-outline-primary" onclick="openUploadModal(${o.Task_ID}, ${Number(o.Material_Qty) || 0}, '${o.Quantity_Unit === 'قطعة' ? 'قطعة' : 'لوح'}')" title="الملفات والصور"><i class="bi bi-images"></i></button>${o.File_Count > 0 ? ` <span class="badge bg-success">${o.File_Count}</span>` : ''}`
          : hasFile ? `<span class="badge bg-success"><i class="bi bi-check"></i>${o.File_Count > 0 ? ` ${o.File_Count}` : ''}</span>` : '-'}</td>
        <td>
          <div class="d-flex align-items-center gap-1">
            ${hasFile
              ? `<a href="/api/files/download/${o.Task_ID}" class="btn btn-sm btn-outline-primary" title="تحميل أحدث ملف تصميم"><i class="bi bi-download"></i></a>`
              : `<span class="text-muted">-</span>`}
          </div>
        </td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary" onclick="openUpdateModal(${o.Task_ID},'${o.Status}')" title="تحديث الحالة"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-outline-info" onclick="duplicateOrder(${o.Task_ID})" title="تكرار الطلب"><i class="bi bi-copy"></i></button>
            <button class="btn btn-outline-info" onclick="openRestoreFromOrder(${o.Task_ID})" title="استرجاع ملفات من طلب قديم"><i class="bi bi-arrow-counterclockwise"></i></button>
            <a href="/client/${o.Client_ID}" class="btn btn-outline-dark" title="عرض ملفات العميل"><i class="bi bi-folder"></i></a>
            ${hasFile ? `<button class="btn btn-outline-warning" onclick="deleteFile(${o.Task_ID})" title="حذف الملف"><i class="bi bi-file-x"></i></button>` : ''}
          </div>
        </td>
      </tr>`;
    });
    renderPagination('ordersPagination', data.page, data.pages);
  }).catch(error => {
    const tbody = document.getElementById('ordersTableBody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center text-danger">${escapeHtml(error.message)}</td></tr>`;
  });
}

document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('ordersTableBody')) {
    loadOrders();
    document.querySelectorAll('#orderTabs .nav-link').forEach(tab => {
      tab.addEventListener('click', function() {
        document.querySelectorAll('#orderTabs .nav-link').forEach(t => t.classList.remove('active'));
        this.classList.add('active');
        loadOrders(1, this.dataset.status);
      });
    });
  }

  if (document.getElementById('newOrderForm')) {
    loadMaterials(document.querySelector('#orderMaterials .mat-select'));
    setupClientSearch();
    document.getElementById('newOrderForm').addEventListener('submit', function(e) {
      e.preventDefault();
      const clientId = document.getElementById('clientId').value;
      if (!clientId) { showToast('يرجى اختيار عميل', 'warning'); return; }
      const materialRows = document.querySelectorAll('#orderMaterials .material-row');
      const materials = [];
      materialRows.forEach(row => {
        const sel = row.querySelector('.mat-select');
        const qty = row.querySelector('.mat-qty');
        if (sel?.value && parseFloat(qty?.value) > 0) {
          materials.push({ Material_ID: parseInt(sel.value), Quantity: parseFloat(qty.value) });
        }
      });
      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Client_ID: parseInt(clientId),
          Machine_Type: document.getElementById('machineType').value,
          Materials: materials,
          Notes: document.getElementById('orderNotes').value
        })
      }).then(r => r.json()).then(data => {
        if (data.error) { showToast(data.error, 'danger'); return; }
        showToast('تم إنشاء الطلب بنجاح', 'success');
        loadOrders();
        document.getElementById('newOrderForm').reset();
        document.getElementById('clientId').value = '';
        document.getElementById('clientSelect').style.display = 'none';
        document.getElementById('orderMaterials').innerHTML = `<div class="row g-1 mb-1 material-row"><div class="col-6"><select class="form-select form-select-sm mat-select"><option value="">-- اختر --</option></select></div><div class="col-3"><input type="number" class="form-control form-control-sm mat-qty" placeholder="كمية" step="0.1" min="0"></div><div class="col-3"><button type="button" class="btn btn-sm btn-outline-danger py-0" onclick="this.closest('.material-row').remove()"><i class="bi bi-x"></i></button></div></div>`;
        loadMaterials(document.querySelector('#orderMaterials .mat-select'));
      });
    });
  }

  if (document.getElementById('laserOrdersBody')) { loadLaserOrders(); setInterval(loadLaserOrders, 15000); }
  if (document.getElementById('routerOrdersBody')) { loadRouterOrders(); setInterval(loadRouterOrders, 15000); }
  if (document.getElementById('clientsTableBody')) {
    loadClients();
    document.getElementById('searchClient')?.addEventListener('input', debounce(() => loadClients(), 300));
  }
  if (document.getElementById('inventoryTableBody')) { loadInventory(); }
  if (document.getElementById('usersTableBody')) { loadUsers(); }
});

// ============== CLIENT SEARCH ==============
function setupClientSearch() {
  const search = document.getElementById('clientSearch');
  const select = document.getElementById('clientSelect');
  const hidden = document.getElementById('clientId');
  search.addEventListener('input', debounce(async function() {
    const q = this.value.trim();
    if (q.length < 1) { select.style.display = 'none'; return; }
    const data = await fetch(`/api/clients/all?search=${encodeURIComponent(q)}`).then(r => r.json());
    select.innerHTML = data.map(c => `<option value="${c.Client_ID}">${c.Full_Name} ${c.Phone_Number ? '- ' + c.Phone_Number : ''}</option>`).join('');
    select.style.display = data.length ? 'block' : 'none';
  }, 300));
  select.addEventListener('click', function() {
    if (this.selectedIndex >= 0) {
      const opt = this.options[this.selectedIndex];
      hidden.value = opt.value;
      search.value = opt.text.split(' -')[0];
      this.style.display = 'none';
    }
  });
}

async function addClient() {
  const name = document.getElementById('newClientName').value.trim();
  if (!name) { showToast('الاسم مطلوب', 'warning'); return; }
  try {
    const data = await fetch('/api/clients', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Full_Name: name, Phone_Number: document.getElementById('newClientPhone').value, Notes: document.getElementById('newClientNotes').value })
    }).then(readApiResponse);
    const client = data.client || data;
    if (!client.Client_ID) throw new Error('لم يُعِد الخادم رقم العميل');
    document.getElementById('clientId').value = client.Client_ID;
    document.getElementById('clientSearch').value = client.Full_Name || name;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('newClientModal')).hide();
    document.getElementById('newClientName').value = '';
    document.getElementById('newClientPhone').value = '';
    document.getElementById('newClientNotes').value = '';
    showToast('تمت إضافة العميل', 'success');
  } catch (error) { showToast(error.message, 'danger'); }
}

// ============== MATERIALS ==============
async function loadMaterials(targetSelect) {
  const payload = await fetch('/api/inventory').then(r => r.json());
  const data = Array.isArray(payload) ? payload : (payload.inventory || []);
  const sel = targetSelect || document.getElementById('materialSelect');
  if (!sel) return;
  const html = '<option value="">-- اختر المادة --</option>' + data.map(m =>
    `<option value="${m.Material_ID}" data-stock="${m.Quantity}">${m.Material_Name} (${m.Thickness || '-'}) - متوفر: ${m.Quantity}</option>`
  ).join('');

  if (targetSelect) { targetSelect.innerHTML = html; }
  else { sel.innerHTML = html; }
  return data;
}

function addOrderMaterialRow() {
  const container = document.getElementById('orderMaterials');
  const row = document.createElement('div');
  row.className = 'row g-1 mb-1 material-row';
  row.innerHTML = `<div class="col-6"><select class="form-select form-select-sm mat-select"><option value="">-- اختر --</option></select></div>
    <div class="col-3"><input type="number" class="form-control form-control-sm mat-qty" placeholder="كمية" step="0.1" min="0"></div>
    <div class="col-3"><button type="button" class="btn btn-sm btn-outline-danger py-0" onclick="this.closest('.material-row').remove()"><i class="bi bi-x"></i></button></div>`;
  container.appendChild(row);
  loadMaterials(row.querySelector('.mat-select'));
}

// ============== UPLOAD MODAL ==============
function openUploadModal(taskId, requestedQuantity = 0, requestedUnit = 'لوح') {
  document.getElementById('uploadTaskId').value = taskId;
  const requested = document.getElementById('uploadRequestedQuantity');
  if (requested) {
    requested.textContent = Number(requestedQuantity) > 0 ? `الكمية المطلوبة: ${Number(requestedQuantity)} ${requestedUnit}` : 'لم تُحدد كمية مطلوبة لهذا الطلب';
  }
  document.getElementById('uploadFile').value = '';
  document.getElementById('uploadImage').value = '';
  document.getElementById('uploadNotes').value = '';
  const fileCountText = document.getElementById('fileCountText');
  if (fileCountText) fileCountText.textContent = '';
  const labelsContainer = document.getElementById('fileLabelsContainer');
  if (labelsContainer) { labelsContainer.style.display = 'none'; labelsContainer.innerHTML = ''; }
  const existingFiles = document.getElementById('existingFilesContainer');
  const existingFilesWrap = document.getElementById('existingFilesWrap');
  const existingImagesWrap = document.getElementById('existingImagesWrap');
  if (existingFiles) { existingFiles.innerHTML = ''; existingFiles.style.display = 'none'; }
  if (existingFilesWrap) existingFilesWrap.style.display = 'none';
  if (existingImagesWrap) { existingImagesWrap.innerHTML = ''; existingImagesWrap.style.display = 'none'; }
  const container = document.getElementById('materialsContainer');
  container.innerHTML = `<div class="row mb-2 material-row">
    <div class="col-md-5">
      <select class="form-select mat-select"><option value="">-- اختر المادة --</option></select>
    </div>
    <div class="col-md-3">
      <input type="number" class="form-control mat-qty" placeholder="عدد الألواح" step="0.1" min="0">
    </div>
    <div class="col-md-2">
      <span class="form-text mat-stock"></span>
    </div>
    <div class="col-md-2">
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.material-row').remove()"><i class="bi bi-x"></i></button>
    </div>
  </div>`;
  loadMaterials(container.querySelector('.mat-select'));
  loadExistingFiles(taskId);
  bootstrap.Modal.getOrCreateInstance(document.getElementById('uploadModal')).show();
}

function loadExistingFiles(taskId) {
  fetch(`/api/files/list/${taskId}`).then(readApiResponse).then(payload => {
    if (document.getElementById('uploadTaskId')?.value !== String(taskId)) return;
    const files = Array.isArray(payload) ? payload : (payload.files || []);
    const container = document.getElementById('existingFilesContainer');
    const fileWrap = document.getElementById('existingFilesWrap');
    const imgWrap = document.getElementById('existingImagesWrap');
    if (container) { container.innerHTML = ''; container.style.display = 'none'; }
    if (imgWrap) { imgWrap.innerHTML = ''; imgWrap.style.display = 'none'; }
    if (fileWrap) fileWrap.style.display = 'none';
    if (!files.length) return;
    const designFiles = files.filter(f => f.File_Type !== 'image' && Number(f.Is_Current) !== 0);
    const imageFiles = files.filter(f => f.File_Type === 'image');

    if (fileWrap && (designFiles.length || imageFiles.length)) fileWrap.style.display = 'block';
    if (container && designFiles.length > 0) {
      container.innerHTML = designFiles.map(f => `
        <li class="list-group-item d-flex justify-content-between align-items-center py-1">
          <small><i class="bi bi-file-earmark"></i> ${f.Label ? `<strong>${escapeHtml(f.Label)}</strong> - ` : ''}${escapeHtml(f.Original_Name)}</small>
          <div>
            <a href="/api/files/download-file/${f.File_ID}" class="btn btn-xs btn-outline-primary py-0 me-1" title="تحميل"><i class="bi bi-download"></i></a>
            <button class="btn btn-xs btn-outline-danger py-0" onclick="deleteFileById(${f.File_ID})" title="حذف"><i class="bi bi-trash"></i></button>
          </div>
        </li>
      `).join('');
      container.style.display = 'block';
    }

    if (imgWrap && imageFiles.length > 0) {
      imgWrap.style.display = 'flex';
      imgWrap.innerHTML = imageFiles.map(f => `
        <div class="position-relative" style="width:80px;height:80px">
          <img src="/api/files/image/${f.File_ID}" class="img-thumbnail" style="width:80px;height:80px;object-fit:cover" alt="${escapeHtml(f.Label || '')}">
          <button class="btn btn-xs btn-danger position-absolute top-0 start-0 p-0" style="width:18px;height:18px;border-radius:50%" onclick="deleteFileById(${f.File_ID})">&times;</button>
        </div>
      `).join('');
    }
  }).catch(error => showToast(`تعذر عرض ملفات الطلب: ${error.message}`, 'danger'));
}

function onUploadFileChange(input) {
  const txt = document.getElementById('fileCountText');
  const labelsContainer = document.getElementById('fileLabelsContainer');
  if (!txt || !labelsContainer) return;
  if (input.files && input.files.length > 0) {
    txt.textContent = `✅ تم اختيار ${input.files.length} ملف(ات) - يمكنك تحديد اسم/مواصفة لكل ملف`;
    labelsContainer.style.display = 'block';
    labelsContainer.innerHTML = Array.from(input.files).map((f, i) => `
      <div class="input-group input-group-sm mb-1">
        <span class="input-group-text" style="min-width:100px"><small>${escapeHtml(f.name.substring(0, 25))}</small></span>
        <input type="text" class="form-control file-label-input" placeholder="اسم/مواصفة الملف (مثال: غرفة نوم 1)" data-index="${i}">
      </div>
    `).join('');
  } else {
    txt.textContent = '';
    labelsContainer.style.display = 'none';
    labelsContainer.innerHTML = '';
  }
}

function deleteFileById(fileId) {
  if (!confirm('هل أنت متأكد من حذف هذا الملف؟')) return;
  fetch(`/api/files/file/${fileId}`, { method: 'DELETE' }).then(readApiResponse).then(() => {
    showToast('تم حذف الملف', 'success');
    const taskId = document.getElementById('uploadTaskId')?.value;
    if (taskId) loadExistingFiles(taskId);
    loadOrders(currentPage, currentFilter);
  }).catch(error => showToast(error.message, 'danger'));
}

function addMaterialRow() {
  const container = document.getElementById('materialsContainer');
  const row = document.createElement('div');
  row.className = 'row mb-2 material-row';
  row.innerHTML = `<div class="col-md-5"><select class="form-select mat-select"><option value="">-- اختر المادة --</option></select></div>
    <div class="col-md-3"><input type="number" class="form-control mat-qty" placeholder="عدد الألواح" step="0.1" min="0"></div>
    <div class="col-md-2"><span class="form-text mat-stock"></span></div>
    <div class="col-md-2"><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.material-row').remove()"><i class="bi bi-x"></i></button></div>`;
  container.appendChild(row);
  loadMaterials(row.querySelector('.mat-select'));
}

async function uploadOrderImages(taskId = document.getElementById('uploadTaskId')?.value, silent = false) {
  const input = document.getElementById('uploadImage');
  const images = Array.from(input?.files || []);
  if (!images.length) {
    if (!silent) showToast('اختر صورة واحدة على الأقل', 'warning');
    return false;
  }
  const form = new FormData();
  images.forEach(image => form.append('image', image));
  try {
    await fetch(`/api/files/upload-image/${taskId}`, { method: 'POST', body: form }).then(readApiResponse);
    input.value = '';
    loadExistingFiles(taskId);
    if (!silent) showToast(`تم رفع ${images.length} صورة بنجاح`, 'success');
    return true;
  } catch (error) {
    if (silent) throw error;
    showToast(`تعذر رفع الصور: ${error.message}`, 'danger');
    return false;
  }
}

async function uploadDesignFile(button) {
  const taskId = document.getElementById('uploadTaskId').value;
  const fileInput = document.getElementById('uploadFile');
  const imageInput = document.getElementById('uploadImage');
  const files = fileInput.files;
  if (!files || files.length === 0) { showToast('يرجى اختيار ملف واحد على الأقل', 'warning'); return; }

  const container = document.getElementById('materialsContainer');
  const materialRows = container.querySelectorAll('.material-row');
  const materials = [];
  materialRows.forEach(row => {
    const matSelect = row.querySelector('.mat-select');
    const qty = row.querySelector('.mat-qty');
    if (matSelect?.value && parseFloat(qty?.value) > 0) {
      materials.push({ Material_ID: parseInt(matSelect.value), Quantity: parseFloat(qty.value) });
    }
  });

  const labels = [];
  document.querySelectorAll('.file-label-input').forEach(inp => labels.push(inp.value.trim()));

  const btn = button || document.querySelector('#uploadModal .btn-primary');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> جاري الرفع...'; }

  const formData = new FormData();
  for (let i = 0; i < files.length; i++) {
    formData.append('files', files[i]);
  }
  formData.append('materials', JSON.stringify(materials));
  formData.append('labels', JSON.stringify(labels));
  formData.append('notes', document.getElementById('uploadNotes')?.value || '');

  showToast(`جاري رفع ${files.length} ملف...`, 'info');
  try {
    const data = await fetch(`/api/files/upload/${taskId}`, { method: 'POST', body: formData }).then(readApiResponse);
    loadOrders(currentPage, currentFilter);
    fileInput.value = '';
    loadExistingFiles(taskId);
    const hadImages = Boolean(imageInput?.files?.length);
    if (hadImages) {
      try { await uploadOrderImages(taskId, true); }
      catch (error) {
        showToast(`تم حفظ ملفات التصميم، لكن تعذر رفع الصور: ${error.message}. أعد رفع الصور من الزر المخصص داخل النافذة.`, 'warning');
        return;
      }
    }
    showToast(`تم رفع ${data.count || files.length} ملف${hadImages ? ' والصور' : ''} بنجاح`, 'success');
    bootstrap.Modal.getInstance(document.getElementById('uploadModal'))?.hide();
  } catch (error) {
    showToast(`فشل رفع ملفات التصميم: ${error.message}`, 'danger');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-cloud-upload"></i> رفع الملفات مع المواد'; }
    if (!fileInput.files.length) {
      fileInput.value = '';
      const txt = document.getElementById('fileCountText');
      if (txt) txt.textContent = '';
      const lc = document.getElementById('fileLabelsContainer');
      if (lc) { lc.style.display = 'none'; lc.innerHTML = ''; }
    }
  }
}

function markDelivered(taskId) {
  if (!confirm('هل تريد تسليم هذا الطلب؟')) return;
  fetch(`/api/orders/${taskId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Status: 'تم التسليم' }) })
    .then(readApiResponse).then(() => {
      showToast('تم تسليم الطلب بنجاح', 'success');
      refreshVisibleOrders();
    }).catch(error => showToast(error.message, 'danger'));
}

// ============== DUPLICATE ORDER ==============
function duplicateOrder(taskId) {
  if (!confirm('هل تريد تكرار هذا الطلب لعميل جديد؟')) return;
  fetch(`/api/orders/${taskId}/duplicate`, { method: 'POST' })
    .then(r => r.json()).then(data => {
      if (data.error) { showToast(data.error, 'danger'); return; }
      showToast(`✅ تم إنشاء طلب مكرر #${data.Task_ID}`, 'success');
      loadOrders();
    });
}

// ============== RESTORE FROM OLD ORDER ==============
let restoreClientId = null;
let restoreSourceOrders = new Map();

function openRestoreModal() {
  document.getElementById('restoreTargetTaskId').value = '';
  document.getElementById('restoreClientSearch').value = '';
  document.getElementById('restoreClientSelect').style.display = 'none';
  document.getElementById('restoreOrdersWrap').style.display = 'none';
  document.getElementById('restoreFilesWrap').style.display = 'none';
  document.getElementById('restoreFilesList').innerHTML = '';
  restoreSourceOrders = new Map();
  const submitBtn = document.getElementById('restoreSubmitBtn');
  if (submitBtn) submitBtn.disabled = true;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('restoreModal')).show();
}

function openRestoreFromOrder(taskId) {
  openRestoreModal();
  document.getElementById('restoreTargetTaskId').value = taskId;
}

async function searchRestoreClients() {
  const q = document.getElementById('restoreClientSearch').value.trim();
  const select = document.getElementById('restoreClientSelect');
  if (q.length < 1) { select.style.display = 'none'; return; }
  const data = await fetch(`/api/clients/all?search=${encodeURIComponent(q)}`).then(r => r.json());
  select.innerHTML = data.map(c => `<option value="${c.Client_ID}">${c.Full_Name} ${c.Phone_Number ? '- ' + c.Phone_Number : ''}</option>`).join('');
  select.style.display = data.length ? 'block' : 'none';
}

document.addEventListener('DOMContentLoaded', function() {
  const rc = document.getElementById('restoreClientSelect');
  if (rc) {
    rc.addEventListener('click', async function() {
      const opt = this.options[this.selectedIndex];
      if (!opt) return;
      restoreClientId = parseInt(opt.value);
      document.getElementById('restoreClientSearch').value = opt.text.split(' -')[0];
      this.style.display = 'none';
      const data = await fetch(`/api/orders?clientId=${restoreClientId}&limit=200`).then(r => r.json());
      const orderSelect = document.getElementById('restoreOrderSelect');
      const orders = (data.orders || []).filter(o => o.Status === 'تم التسليم' || o.Status === 'تم الانتهاء من القص');
      restoreSourceOrders = new Map(orders.map(order => [String(order.Task_ID), order]));
      orderSelect.innerHTML = orders.map(o => `<option value="${o.Task_ID}">#${o.Task_ID} - ${o.Machine_Type} - ${o.Created_At || ''}</option>`).join('');
      document.getElementById('restoreOrdersWrap').style.display = orders.length ? 'block' : 'none';
      if (orders.length) loadRestoreFiles();
      else document.getElementById('restoreFilesWrap').style.display = 'none';
    });
  }
});

async function loadRestoreFiles() {
  const taskId = document.getElementById('restoreOrderSelect').value;
  if (!taskId) return;
  const files = await fetch(`/api/files/list/${taskId}`).then(r => r.json());
  const list = document.getElementById('restoreFilesList');
  const designFiles = (files || []).filter(f => f.File_Type !== 'image');
  list.innerHTML = (designFiles.length ? designFiles : files)
    .map(f => `
      <label class="list-group-item d-flex align-items-center gap-2 py-1">
        <input type="checkbox" class="form-check-input restore-file-cb" value="${f.File_ID}">
        <small><i class="bi bi-file-earmark"></i> ${f.Label && f.Label !== f.Original_Name ? `<strong>${f.Label}</strong> - ` : ''}${f.Original_Name}</small>
      </label>
    `).join('');
  list.innerHTML += `<div class="mt-2 text-muted small"><i class="bi bi-info-circle"></i> الملفات المحددة ستُنسخ إلى الطلب الحالي في مجلد "قيد التصميم"</div>`;
  document.getElementById('restoreFilesWrap').style.display = 'block';
  document.querySelectorAll('.restore-file-cb').forEach(cb => cb.addEventListener('change', updateRestoreBtn));
}

function updateRestoreBtn() {
  const count = document.querySelectorAll('.restore-file-cb:checked').length;
  const btn = document.getElementById('restoreSubmitBtn');
  if (btn) btn.disabled = !(count > 0);
}

async function submitRestore() {
  const fileIds = Array.from(document.querySelectorAll('.restore-file-cb:checked')).map(cb => parseInt(cb.value));
  if (!fileIds.length) { showToast('اختر ملفات للاسترجاع أولاً', 'warning'); return; }
  const taskId = document.getElementById('restoreTargetTaskId').value;

  if (!taskId) {
    const clientId = restoreClientId;
    const sourceTaskId = document.getElementById('restoreOrderSelect').value;
    const sourceOrder = restoreSourceOrders.get(String(sourceTaskId));
    const machineType = confirm('استرجاع لطلبات الليزر؟\n\nاضغط OK لليزر (Laser)\nاضغط إلغاء للراوتر (Router)') ? 'Laser' : 'Router';
    showToast('جاري إنشاء طلب جديد ثم استرجاع الملفات...', 'info');
    let createdTaskId = null;
    try {
      const res = await fetch('/api/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Client_ID: clientId,
          Machine_Type: machineType,
          Material_ID: sourceOrder?.Material_ID || null,
          Material_Qty: Number(sourceOrder?.Material_Qty || 0),
          Quantity_Unit: sourceOrder?.Quantity_Unit || 'لوح',
          Materials: Array.isArray(sourceOrder?.Materials) ? sourceOrder.Materials.map(material => ({ Material_ID: material.Material_ID, Quantity: material.Quantity })) : [],
          Notes: `استرجاع من طلب #${sourceTaskId}`
        })
      });
      const order = await readApiResponse(res);
      createdTaskId = order.Task_ID;
      const copyRes = await fetch(`/api/files/copy/${order.Task_ID}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds })
      });
      const copyData = await readApiResponse(copyRes);
      showToast(`✅ تم إنشاء طلب جديد #${order.Task_ID} واسترجاع ${copyData.count} ملف`, 'success');
      bootstrap.Modal.getInstance(document.getElementById('restoreModal'))?.hide();
      loadOrders();
    } catch(e) {
      if (createdTaskId) {
        document.getElementById('restoreTargetTaskId').value = createdTaskId;
        showToast(`أُنشئ الطلب #${createdTaskId} لكن تعذر نسخ الملفات: ${e.message}. أعد الضغط على الاسترجاع لإكماله دون إنشاء طلب جديد.`, 'warning');
        loadOrders();
      } else showToast('فشل إنشاء الطلب: ' + e.message, 'danger');
    }
    return;
  }

  try {
    const res = await fetch(`/api/files/copy/${taskId}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileIds })
    });
    const data = await readApiResponse(res);
    showToast(`✅ تم استرجاع ${data.count} ملف إلى الطلب الحالي`, 'success');
    bootstrap.Modal.getInstance(document.getElementById('restoreModal'))?.hide();
    loadOrders();
  } catch (error) { showToast(`تعذر استرجاع الملفات: ${error.message}`, 'danger'); }
}

// ============== LASER ==============
function machineOrderDetails(order) {
  const materials = Array.isArray(order.Materials) ? order.Materials.filter(material => Number(material.Quantity) > 0) : [];
  const fallbackMaterial = order.Material_Name ? escapeHtml(order.Material_Name) : '-';
  const fallbackThickness = order.Thickness ? escapeHtml(order.Thickness) : '-';
  const materialNames = materials.length
    ? materials.map(material => `<div>${escapeHtml(material.Material_Name || '-')}</div>`).join('')
    : fallbackMaterial;
  const thicknesses = materials.length
    ? materials.map(material => `<div>${escapeHtml(material.Thickness || '-')}</div>`).join('')
    : fallbackThickness;
  const requested = Number(order.Material_Qty) > 0
    ? `<div>المطلوب: <strong>${Number(order.Material_Qty)}</strong> ${escapeHtml(order.Quantity_Unit || 'لوح')}</div>`
    : '';
  const cutting = materials.length
    ? materials.map(material => `<div>للقص: <strong>${Number(material.Quantity)}</strong> لوح ${escapeHtml(material.Material_Name || '')}</div>`).join('')
    : '';
  return { materialNames, thicknesses, quantity: requested + cutting || '<span class="text-muted">لم تُحدد كمية</span>' };
}

function refreshVisibleOrders() {
  if (document.getElementById('ordersTableBody')) loadOrders(currentPage, currentFilter);
  if (document.getElementById('laserOrdersBody')) loadLaserOrders();
  if (document.getElementById('routerOrdersBody')) loadRouterOrders();
}

async function openMachineFiles(taskId) {
  const modal = document.getElementById('machineFilesModal');
  const content = document.getElementById('machineFilesContent');
  if (!modal || !content) return;
  content.textContent = 'جارٍ تحميل ملفات الطلب...';
  bootstrap.Modal.getOrCreateInstance(modal).show();
  try {
    const payload = await fetch(`/api/files/list/${taskId}`).then(readApiResponse);
    const files = Array.isArray(payload) ? payload : (payload.files || []);
    const designs = files.filter(file => file.File_Type !== 'image' && (file.Is_Current == null || Number(file.Is_Current) !== 0));
    const images = files.filter(file => file.File_Type === 'image');
    content.innerHTML = `
      <h6>ملفات التصميم الحالية</h6>
      ${designs.length ? `<div class="list-group mb-3">${designs.map(file => `
        <a class="list-group-item list-group-item-action d-flex justify-content-between gap-2" href="/api/files/download-file/${file.File_ID}">
          <span>${escapeHtml(file.Label || file.Original_Name)}</span><span><i class="bi bi-download"></i> تحميل</span>
        </a>`).join('')}</div>` : '<p class="text-muted">لا توجد ملفات تصميم حالية.</p>'}
      <h6>صور الطلب</h6>
      ${images.length ? `<div class="d-flex flex-wrap gap-3">${images.map(file => `
        <a href="/api/files/download-file/${file.File_ID}" title="تحميل ${escapeHtml(file.Original_Name)}" class="text-decoration-none text-center" style="max-width:120px">
          <img src="/api/files/image/${file.File_ID}" alt="${escapeHtml(file.Original_Name)}" loading="lazy" class="img-thumbnail" style="width:110px;height:90px;object-fit:cover">
          <span class="d-block small text-truncate">${escapeHtml(file.Original_Name)}</span>
        </a>`).join('')}</div>` : '<p class="text-muted">لا توجد صور لهذا الطلب.</p>'}`;
  } catch (error) {
    content.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
  }
}

async function loadLaserOrders() {
  const tbody = document.getElementById('laserOrdersBody');
  if (!tbody) return;
  try {
    const data = await fetch('/api/orders?status=جاهز للقص&machine=Laser&limit=200').then(readApiResponse);
    if (!data.orders?.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">لا توجد طلبات جاهزة حالياً</td></tr>';
    } else {
      tbody.innerHTML = data.orders.map(order => {
        const details = machineOrderDetails(order);
        return `<tr>
          <td>${order.Task_ID}</td><td>${escapeHtml(order.Client_Name || '---')}</td>
          <td>${details.materialNames}</td><td>${details.thicknesses}</td>
          <td>${details.quantity}</td>
          <td>${escapeHtml(order.Notes || '-')}</td>
          <td><div class="d-flex gap-1 flex-wrap">${order.File_Path ? `<a href="/api/files/download/${order.Task_ID}" class="btn btn-sm btn-primary"><i class="bi bi-download"></i> أحدث ملف</a>` : ''}<button type="button" class="btn btn-sm btn-outline-primary" onclick="openMachineFiles(${order.Task_ID})"><i class="bi bi-images"></i> الصور والملفات</button></div></td>
          <td><button class="btn btn-sm btn-success" onclick="completeOrder(${order.Task_ID})"><i class="bi bi-check-lg"></i> تم الانتهاء من القص</button></td>
        </tr>`;
      }).join('');
    }
    await loadCutDoneForMachine('Laser', 'recentLaserOrders');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadCutDoneForMachine(machine, targetId) {
  const doneBody = document.getElementById(targetId);
  if (!doneBody) return;
  try {
    const [cutDone, packed] = await Promise.all([
      fetch(`/api/orders?status=${encodeURIComponent('تم الانتهاء من القص')}&machine=${machine}&page=1&limit=10`).then(readApiResponse),
      fetch(`/api/orders?status=${encodeURIComponent('تم التغليف')}&machine=${machine}&page=1&limit=10`).then(readApiResponse)
    ]);
    const completed = [...(cutDone.orders || []), ...(packed.orders || [])]
      .sort((left, right) => String(right.Created_At || '').localeCompare(String(left.Created_At || '')))
      .slice(0, 10);
    doneBody.innerHTML = completed.map(o =>
      `<tr>
        <td>${o.Task_ID}</td><td>${escapeHtml(o.Client_Name || '')}</td>
        <td><span class="badge bg-dark">${escapeHtml(o.Status)}</span></td>
        <td>${escapeHtml(o.Created_At || '')}</td>
        <td><button class="btn btn-sm btn-success" onclick="markDelivered(${o.Task_ID})"><i class="bi bi-check-circle"></i> تم التسليم</button></td>
      </tr>`
    ).join('') || '<tr><td colspan="5" class="text-center text-muted">لا توجد طلبات منتهية القص</td></tr>';
  } catch (error) {
    doneBody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">${escapeHtml(error.message)}</td></tr>`;
  }
}

async function loadRouterOrders() {
  const tbody = document.getElementById('routerOrdersBody');
  if (!tbody) return;
  try {
    const data = await fetch('/api/orders?status=جاهز للقص&machine=Router&limit=200').then(readApiResponse);
    if (!data.orders?.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center text-muted">لا توجد طلبات جاهزة حالياً</td></tr>';
    } else {
      tbody.innerHTML = data.orders.map(order => {
        const details = machineOrderDetails(order);
        return `<tr>
          <td>${order.Task_ID}</td><td>${escapeHtml(order.Client_Name || '---')}</td>
          <td>${details.materialNames}</td><td>${details.thicknesses}</td>
          <td>${details.quantity}</td>
          <td>${escapeHtml(order.Notes || '-')}</td>
          <td><div class="d-flex gap-1 flex-wrap">${order.File_Path ? `<a href="/api/files/download/${order.Task_ID}" class="btn btn-sm btn-primary"><i class="bi bi-download"></i> أحدث ملف</a>` : ''}<button type="button" class="btn btn-sm btn-outline-primary" onclick="openMachineFiles(${order.Task_ID})"><i class="bi bi-images"></i> الصور والملفات</button></div></td>
          <td><button class="btn btn-sm btn-success" onclick="completeOrder(${order.Task_ID})"><i class="bi bi-check-lg"></i> تم الانتهاء من القص</button></td>
        </tr>`;
      }).join('');
    }
    await loadCutDoneForMachine('Router', 'recentRouterOrders');
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center text-danger">${escapeHtml(error.message)}</td></tr>`;
  }
}

function completeOrder(taskId) {
  if (!confirm('هل تم الانتهاء من قص هذا الطلب على الماكينة؟')) return;
  fetch(`/api/orders/${taskId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Status: 'تم الانتهاء من القص' }) })
    .then(readApiResponse).then(() => {
      showToast('✅ تم الانتهاء من القص', 'success');
      refreshVisibleOrders();
    }).catch(error => showToast(error.message, 'danger'));
}

function openUpdateModal(taskId, currentStatus) {
  document.getElementById('updateTaskId').value = taskId;
  document.getElementById('updateStatus').value = currentStatus;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('updateStatusModal')).show();
}

function updateOrderStatus() {
  const taskId = document.getElementById('updateTaskId').value;
  const status = document.getElementById('updateStatus').value;
  fetch(`/api/orders/${taskId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Status: status }) })
    .then(r => r.json()).then(data => {
      if (data.error) { showToast(data.error, 'danger'); return; }
      showToast('تم تحديث الحالة', 'success');
      loadOrders();
      bootstrap.Modal.getInstance(document.getElementById('updateStatusModal')).hide();
    });
}

function deleteOrder(taskId) {
  if (!confirm(`هل أنت متأكد من حذف الطلب #${taskId} بالكامل؟`)) return;
  fetch(`/api/orders/${taskId}`, { method: 'DELETE' })
    .then(r => r.json()).then(d => {
      if (d.error) { showToast(d.error, 'danger'); return; }
      showToast(`✅ تم حذف الطلب #${taskId}`, 'success');
      loadOrders();
    });
}

function deleteFile(taskId) {
  if (!confirm(`حذف الملف المرفوع للطلب #${taskId}؟ ستعود حالة الطلب إلى "قيد التصميم"`)) return;
  fetch(`/api/files/${taskId}`, { method: 'DELETE' })
    .then(r => r.json()).then(d => {
      if (d.error) { showToast(d.error, 'danger'); return; }
      showToast('✅ تم حذف الملف', 'success');
      loadOrders();
    });
}

// ============== DASHBOARD ==============
async function loadStats() {
  const data = await fetch('/api/orders/stats').then(r => r.json());
  document.getElementById('totalOrders').textContent = data.totalOrders;
  document.getElementById('activeOrders').textContent = data.activeOrders;
  document.getElementById('totalClients').textContent = data.totalClients;
  try {
    const notifs = await fetch('/api/orders/notifications').then(r => r.json());
    const unread = Array.isArray(notifs) ? notifs.filter(n => !n.Is_Read).length : 0;
    document.getElementById('notifCount').textContent = unread;
  } catch { document.getElementById('notifCount').textContent = '0'; }
  const tbody = document.getElementById('recentOrders');
  if (tbody && data.recentOrders) {
    tbody.innerHTML = data.recentOrders.map(o => `<tr>
      <td>${o.Task_ID}</td><td>${o.Client_Name || ''}</td>
      <td><span class="badge bg-${o.Machine_Type === 'Laser' ? 'danger' : 'success'}">${o.Machine_Type === 'Laser' ? 'ليزر' : 'راوتر'}</span></td>
      <td><span class="badge bg-info">${o.Status}</span></td>
      <td>${o.Created_At || ''}</td>
    </tr>`).join('');
  }
  const lowStock = document.getElementById('lowStock');
  if (lowStock) {
    if (data.lowStock && data.lowStock.length > 0) {
      lowStock.innerHTML = data.lowStock.map(m => `<div class="alert alert-warning py-1 mb-1">${m.Material_Name} (${m.Thickness}) - متبقي: ${m.Quantity}</div>`).join('');
    } else {
      lowStock.innerHTML = '<div class="text-success">جميع المواد متوفرة بكميات جيدة</div>';
    }
  }
  const chart = document.getElementById('statusChart');
  if (chart && data.statusCounts) {
    chart.innerHTML = data.statusCounts.map(s => {
      const colors = { 'قيد التصميم': 'warning', 'جاهز للقص': 'info', 'قيد التنفيذ': 'primary', 'تم الانتهاء من القص': 'dark', 'تم التغليف': 'secondary', 'تم التسليم': 'success' };
      return `<div class="d-flex justify-content-between mb-1"><span>${s.Status}</span><span class="badge bg-${colors[s.Status] || 'secondary'}">${s.cnt}</span></div>`;
    }).join('');
  }
}

// ============== CLIENTS PAGE ==============
async function loadClients(page = 1) {
  try {
    const search = document.getElementById('searchClient')?.value || '';
    const [res, role] = await Promise.all([
      fetch(`/api/clients?page=${page}&search=${encodeURIComponent(search)}`),
      currentRole()
    ]);
    if (!res.ok) { showToast('فشل تحميل العملاء', 'danger'); return; }
    const data = await res.json();
    const tbody = document.getElementById('clientsTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!data.clients || data.clients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-center">لا يوجد عملاء</td></tr>';
      renderPagination('clientsPagination', 1, 1);
      return;
    }
    data.clients.forEach(c => {
      const stars = '★'.repeat(c.Rating || 3) + '☆'.repeat(5 - (c.Rating || 3));
      tbody.innerHTML += `<tr>
        <td>${c.Client_ID}</td><td>${escapeHtml(c.Full_Name)}</td><td>${escapeHtml(c.Phone_Number || '-')}</td>
        <td class="text-warning">${stars}</td><td>${c.Total_Spent || 0}</td><td>${escapeHtml(c.Notes || '-')}</td>
        <td><a href="/client/${c.Client_ID}" class="btn btn-sm btn-outline-info"><i class="bi bi-folder"></i> عرض</a></td>
        <td>
          <button class="btn btn-sm btn-outline-primary" onclick="editClient(${c.Client_ID})" title="تعديل"><i class="bi bi-pencil"></i></button>
          ${role === 'Admin' ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteClient(${c.Client_ID})" title="حذف"><i class="bi bi-trash"></i></button>` : ''}
        </td>
      </tr>`;
    });
    renderPagination('clientsPagination', data.page, data.pages);
  } catch (e) {
    showToast('خطأ في تحميل العملاء: ' + e.message, 'danger');
  }
}

async function resetClientForm() {
  document.getElementById('editClientId').value = '';
  document.getElementById('clientName').value = '';
  document.getElementById('clientPhone').value = '';
  document.getElementById('clientRating').value = '3';
  document.getElementById('clientNotes').value = '';
}

document.addEventListener('DOMContentLoaded', function() {
  const m = document.getElementById('clientModal');
  if (m) m.addEventListener('hidden.bs.modal', resetClientForm);
});

async function editClient(id) {
  try {
    const res = await fetch(`/api/clients/${id}`);
    const data = await res.json();
    if (data.error) { showToast(data.error, 'danger'); return; }
    document.getElementById('editClientId').value = data.Client_ID;
    document.getElementById('clientName').value = data.Full_Name || '';
    document.getElementById('clientPhone').value = data.Phone_Number || '';
    document.getElementById('clientRating').value = data.Rating || 3;
    document.getElementById('clientNotes').value = data.Notes || '';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('clientModal')).show();
  } catch (e) {
    showToast('فشل تحميل بيانات العميل: ' + e.message, 'danger');
  }
}

function deleteClient(id) {
  if (!confirm('هل أنت متأكد من حذف هذا العميل بالكامل؟\nسيتم حذف جميع طلباته وملفاته ولن يمكن التراجع.')) return;
  fetch(`/api/clients/${id}`, { method: 'DELETE' }).then(r => r.json()).then(d => {
    if (d.error) { showToast(d.error, 'danger'); return; }
    showToast('✅ تم حذف العميل', 'success');
    loadClients();
  });
}

function saveClient() {
  const id = document.getElementById('editClientId').value;
  const data = { Full_Name: document.getElementById('clientName').value, Phone_Number: document.getElementById('clientPhone').value, Rating: parseInt(document.getElementById('clientRating').value), Notes: document.getElementById('clientNotes').value };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/clients/${id}` : '/api/clients';
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(r => r.json()).then(d => { if (d.error) { showToast(d.error, 'danger'); return; } showToast('تم الحفظ', 'success'); bootstrap.Modal.getInstance(document.getElementById('clientModal')).hide(); loadClients(); });
}

// ============== CLIENT DETAIL PAGE ==============
async function loadClientDetail(clientId) {
  const client = await fetch(`/api/clients/${clientId}`).then(r => r.json());
  if (client.error) { document.getElementById('clientInfo').innerHTML = `<div class="alert alert-danger">${client.error}</div>`; return; }
  document.getElementById('clientFullName').textContent = client.Full_Name;
  document.getElementById('clientPhone').textContent = client.Phone_Number || 'لا يوجد';
  document.getElementById('clientRating').textContent = '★'.repeat(client.Rating || 3) + '☆'.repeat(5 - (client.Rating || 3));
  document.getElementById('clientTotalSpent').textContent = `${client.Total_Spent || 0} USD`;
  document.getElementById('clientNotes').textContent = client.Notes || '---';
  document.getElementById('clientDate').textContent = client.Created_At || '---';

  const orders = await fetch(`/api/clients/${clientId}/orders`).then(r => r.json());
  document.getElementById('orderCount').textContent = `${orders.length} طلب`;
  const container = document.getElementById('ordersContainer');
  container.innerHTML = '';

  if (orders.length === 0) {
    container.innerHTML = '<div class="alert alert-info">لا توجد طلبات سابقة لهذا العميل</div>';
    return;
  }

  const statusColors = { 'قيد التصميم': 'warning', 'جاهز للقص': 'info', 'قيد التنفيذ': 'primary', 'تم الانتهاء من القص': 'dark', 'تم التغليف': 'secondary', 'تم التسليم': 'success' };

  orders.forEach(o => {
    const sc = statusColors[o.Status] || 'secondary';
    const card = document.createElement('div');
    card.className = 'card mb-2 border-end border-4 border-' + sc;
    card.innerHTML = `<div class="card-body py-2">
      <div class="row align-items-center">
        <div class="col-md-1"><strong>#${o.Task_ID}</strong></div>
        <div class="col-md-2"><span class="badge bg-${o.Machine_Type === 'Laser' ? 'danger' : 'success'}">${o.Machine_Type}</span></div>
        <div class="col-md-3"><small>${escapeHtml(o.Materials_List || '-')}</small></div>
        <div class="col-md-2"><span class="badge bg-${sc}">${o.Status}</span></div>
        <div class="col-md-2"><small class="text-muted">${escapeHtml(o.Created_At || '')}</small></div>
        <div class="col-md-2">
          <div class="btn-group btn-group-sm">
            ${o.File_Path ? `<a href="/api/files/download/${o.Task_ID}" class="btn btn-outline-primary" title="تحميل"><i class="bi bi-download"></i></a>` : ''}
            <button class="btn btn-outline-info" onclick="duplicateOrder(${o.Task_ID})" title="تكرار الطلب"><i class="bi bi-copy"></i> إعادة</button>
            <button class="btn btn-outline-secondary" onclick="openRestoreFromOrder(${o.Task_ID})" title="استرجاع ملفات لهذا الطلب"><i class="bi bi-arrow-counterclockwise"></i></button>
          </div>
        </div>
      </div>
      ${o.Notes ? `<div class="row mt-1"><div class="col-12"><small class="text-muted"><i class="bi bi-chat-dots"></i> ${escapeHtml(o.Notes)}</small></div></div>` : ''}
    </div>`;
    container.appendChild(card);
  });
}

// ============== INVENTORY ==============
async function loadInventory() {
  const [payload, role] = await Promise.all([
    fetch('/api/inventory').then(readApiResponse),
    currentRole()
  ]);
  const data = Array.isArray(payload) ? payload : (payload.inventory || []);
  const tbody = document.getElementById('inventoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="text-center">لا توجد مواد</td></tr>'; return; }
  data.forEach(m => {
    const low = m.Quantity < 5 ? 'bg-danger text-white' : '';
    tbody.innerHTML += `<tr class="${low}"><td>${m.Material_ID}</td><td>${escapeHtml(m.Material_Name)}</td><td>${escapeHtml(m.Thickness || '-')}</td><td>${m.Quantity}</td><td>${m.Cost_Per_Unit || 0}</td>
      <td>${role === 'Admin' ? `<button class="btn btn-sm btn-outline-primary" onclick="editMaterial(${m.Material_ID})"><i class="bi bi-pencil"></i></button>` : '-'}</td></tr>`;
  });
}

async function editMaterial(id) {
  try {
    const payload = await fetch('/api/inventory').then(r => r.json());
    const materials = Array.isArray(payload) ? payload : (payload.inventory || []);
    const material = materials.find(m => Number(m.Material_ID) === Number(id));
    if (!material) { showToast('المادة غير موجودة', 'danger'); return; }
    const modal = document.getElementById('inventoryModal');
    modal.dataset.materialId = String(id);
    document.getElementById('editMaterialId').value = id;
    document.getElementById('materialName').value = material.Material_Name || '';
    document.getElementById('materialThickness').value = material.Thickness || '';
    document.getElementById('materialQty').value = material.Quantity ?? 0;
    document.getElementById('materialCost').value = material.Cost_Per_Unit ?? 0;
    bootstrap.Modal.getOrCreateInstance(document.getElementById('inventoryModal')).show();
  } catch (e) {
    showToast('فشل تحميل بيانات المادة: ' + e.message, 'danger');
  }
}

function resetMaterialForm() {
  document.getElementById('inventoryModal')?.removeAttribute('data-material-id');
  document.getElementById('editMaterialId').value = '';
  document.getElementById('materialName').value = '';
  document.getElementById('materialThickness').value = '';
  document.getElementById('materialQty').value = '';
  document.getElementById('materialCost').value = '';
}

document.addEventListener('DOMContentLoaded', function() {
  const modal = document.getElementById('inventoryModal');
  if (modal) modal.addEventListener('hidden.bs.modal', resetMaterialForm);
});

function saveMaterial() {
  const id = document.getElementById('editMaterialId').value || document.getElementById('inventoryModal')?.dataset.materialId || '';
  const data = { Material_Name: document.getElementById('materialName').value, Thickness: document.getElementById('materialThickness').value, Quantity: parseFloat(document.getElementById('materialQty').value) || 0, Cost_Per_Unit: parseFloat(document.getElementById('materialCost').value) || 0 };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/inventory/${id}` : '/api/inventory';
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(r => r.json()).then(d => { if (d.error) { showToast(d.error, 'danger'); return; } showToast('تم الحفظ', 'success'); bootstrap.Modal.getInstance(document.getElementById('inventoryModal')).hide(); loadInventory(); loadMaterials(); });
}

// ============== USERS ==============
async function loadUsers() {
  const data = await fetch('/api/users').then(r => r.json());
  const tbody = document.getElementById('usersTableBody');
  if (!tbody) return;
  const roles = { 'Admin': 'مدير', 'Designer': 'مصمم', 'Laser_Op': 'عامل ليزر', 'Router_Op': 'عامل راوتر', 'Custom': 'مخصص' };
  const permNames = {
    dashboard: 'لوحة التحكم', clients: 'العملاء', orders: 'الطلبات',
    inventory: 'المخزون', invoices: 'الفواتير', expenses: 'المصروفات',
    admin: 'لوحة المدير', users: 'المستخدمين'
  };
  tbody.innerHTML = data.map(u => {
    let permsHtml = '-';
    if (u.Role === 'Custom' && u.Permissions) {
      try {
        const perms = JSON.parse(u.Permissions);
        const activePerms = Object.entries(perms).filter(([k, v]) => v).map(([k]) => permNames[k] || k);
        permsHtml = activePerms.length > 0
          ? activePerms.map(p => `<span class="badge bg-info me-1">${p}</span>`).join('')
          : '<span class="text-muted">لا توجد صلاحيات</span>';
      } catch {}
    }
    return `<tr>
      <td>${u.User_ID}</td>
      <td>${escapeHtml(u.Name)}</td>
      <td>${escapeHtml(u.Username)}</td>
      <td><span class="badge bg-dark">${roles[u.Role] || u.Role}</span></td>
      <td>${permsHtml}</td>
      <td>${u.Created_At || ''}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="editUser(${u.User_ID})" title="تعديل"><i class="bi bi-pencil"></i></button>
        <button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${u.User_ID})" title="حذف"><i class="bi bi-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

function saveUser() {
  const id = document.getElementById('editUserId').value;
  const role = document.getElementById('userRole').value;
  const data = {
    Name: document.getElementById('userName').value,
    Username: document.getElementById('userUsername').value,
    Password: document.getElementById('userPassword').value,
    Role: role,
    Permissions: role === 'Custom' ? getPermissions() : {}
  };
  const method = id ? 'PUT' : 'POST';
  const url = id ? `/api/users/${id}` : '/api/users';
  fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
    .then(r => r.json()).then(d => {
      if (d.error) { showToast(d.error, 'danger'); return; }
      showToast('تم الحفظ بنجاح', 'success');
      bootstrap.Modal.getInstance(document.getElementById('userModal')).hide();
      loadUsers();
    });
}

function deleteUser(id) {
  if (!confirm('هل أنت متأكد من حذف هذا المستخدم؟')) return;
  fetch(`/api/users/${id}`, { method: 'DELETE' }).then(r => r.json()).then(d => {
    if (d.error) { showToast(d.error, 'danger'); return; }
    showToast('تم الحذف بنجاح', 'success');
    loadUsers();
  });
}

// ============== INVOICES ==============
async function loadInvoices(page = 1) {
  const search = document.getElementById('searchInput')?.value || '';
  const status = document.getElementById('statusFilter')?.value || '';
  let url = `/api/invoices?page=${page}`;
  if (search) url += `&search=${encodeURIComponent(search)}`;
  if (status) url += `&status=${encodeURIComponent(status)}`;
  const data = await fetch(url).then(r => r.json());
  const tbody = document.getElementById('invoicesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data.invoices || data.invoices.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center">لا توجد فواتير</td></tr>';
    renderPagination('pagination', 1, 1);
    return;
  }
  data.invoices.forEach(inv => {
    const statusColors = { 'مدفوعة': 'success', 'غير مدفوعة': 'warning', 'ملغية': 'secondary' };
    const sc = statusColors[inv.Status] || 'secondary';
    tbody.innerHTML += `<tr>
      <td>${inv.Invoice_ID}</td>
      <td><a href="/api/invoices/${inv.Invoice_ID}/view" target="_blank" rel="noopener" class="text-decoration-none">${escapeHtml(inv.Invoice_Number)}</a></td>
      <td>${escapeHtml(inv.Client_Name || '-')}</td>
      <td>${escapeHtml(inv.Machine_Type || '-')}</td>
      <td>${parseFloat(inv.Amount).toFixed(2)} USD</td>
      <td><span class="badge bg-${sc}">${inv.Status}</span></td>
      <td>${escapeHtml(inv.Created_At || '')}</td>
      <td>
        <a href="/api/invoices/${inv.Invoice_ID}/view" target="_blank" class="btn btn-sm btn-outline-info" title="عرض"><i class="bi bi-eye"></i></a>
        <a href="/api/invoices/${inv.Invoice_ID}/view" target="_blank" rel="noopener" class="btn btn-sm btn-outline-primary" title="عرض صفحة الطباعة"><i class="bi bi-printer"></i></a>
      </td>
    </tr>`;
  });
  renderPagination('pagination', page, data.pages || 1);
}

async function createInvoiceFromOrder(taskId) {
  const amount = prompt('أدخل المبلغ الإجمالي للفاتورة:');
  if (!amount || isNaN(parseFloat(amount))) { showToast('يرجى إدخال مبلغ صحيح', 'danger'); return; }
  try {
    const r = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Order_Task_ID: taskId, Amount: parseFloat(amount) })
    });
    const d = await r.json();
    if (d.error) { showToast(d.error, 'danger'); return; }
    showToast(`تم إنشاء الفاتورة #${d.Invoice_Number}`, 'success');
    if (document.getElementById('ordersTableBody')) loadOrders();
    if (document.getElementById('invoicesTableBody')) loadInvoices();
  } catch(e) { showToast('خطأ في إنشاء الفاتورة', 'danger'); }
}

// ============== UTILITIES ==============
function debounce(fn, delay) { let timer; return function(...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), delay); }; }

function renderPagination(elementId, currentPage, totalPages) {
  const ul = document.getElementById(elementId);
  if (!ul) return;
  ul.innerHTML = '';
  if (totalPages <= 1) return;
  for (let i = 1; i <= totalPages; i++) {
    const li = document.createElement('li');
    li.className = `page-item ${i === currentPage ? 'active' : ''}`;
    li.innerHTML = `<a class="page-link" href="#" data-page="${i}">${i}</a>`;
    li.addEventListener('click', (e) => { e.preventDefault(); const p = parseInt(e.target.dataset.page); if (elementId === 'ordersPagination') loadOrders(p); else if (elementId === 'clientsPagination') loadClients(p); });
    ul.appendChild(li);
  }
}
