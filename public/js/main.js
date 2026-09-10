const socket = io();
let currentPage = 1;
let currentFilter = 'all';

socket.on('order-update', () => {
  if (document.getElementById('ordersTableBody')) loadOrders();
  if (document.getElementById('laserOrdersBody')) loadLaserOrders();
  if (document.getElementById('routerOrdersBody')) loadRouterOrders();
});

socket.on('notification', (notif) => showToast(notif.message, notif.type));

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
  toast.className = `alert alert-${colors[type]} alert-dismissible fade show`;
  toast.innerHTML = `${msg} <button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ============== DESIGNER PAGE ==============
function loadOrders(page = 1, filter = currentFilter) {
  currentPage = page;
  currentFilter = filter;
  let url = `/api/orders?page=${page}`;
  if (filter !== 'all') url += `&status=${encodeURIComponent(filter)}`;
  fetch(url).then(r => r.json()).then(data => {
    const tbody = document.getElementById('ordersTableBody');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!data.orders || data.orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" class="text-center">لا توجد طلبات</td></tr>';
      return;
    }
    data.orders.forEach(o => {
      const statusColors = { 'قيد التصميم': 'warning', 'جاهز للقص': 'info', 'قيد التنفيذ': 'primary', 'تم التغليف': 'secondary', 'تم التسليم': 'success' };
      const sc = statusColors[o.Status] || 'secondary';

      let materialsHtml = o.Materials && o.Materials.length
        ? o.Materials.map(m => `<span class="badge bg-secondary me-1">${m.Material_Name} ${m.Thickness || ''} (${m.Quantity})</span>`).join('')
        : o.Material_Name ? `<span class="badge bg-secondary">${o.Material_Name} ${o.Thickness || ''}</span>` : '-';

      const showUploadBtn = o.Status === 'قيد التصميم';
      const hasFile = o.File_Path;

      const isDelivered = o.Status === 'تم التسليم';
      tbody.innerHTML += `<tr>
        <td>${o.Task_ID}</td>
        <td><a href="/client/${o.Client_ID}" class="text-decoration-none">${o.Client_Name || '---'}</a></td>
        <td><span class="badge bg-${o.Machine_Type === 'Laser' ? 'danger' : 'success'}">${o.Machine_Type}</span></td>
        <td>${materialsHtml}</td>
        <td><small class="text-muted">${(o.Notes || '').substring(0, 30)}</small></td>
        <td><span class="badge bg-${sc}">${o.Status}</span></td>
        <td>${showUploadBtn
          ? `<button class="btn btn-sm btn-outline-primary" onclick="openUploadModal(${o.Task_ID})"><i class="bi bi-upload"></i></button>`
          : hasFile ? `<span class="badge bg-success"><i class="bi bi-check"></i></span>` : '-'}</td>
        <td>${hasFile
          ? `<a href="/api/files/download/${o.Task_ID}" class="btn btn-sm btn-outline-primary"><i class="bi bi-download"></i></a>`
          : `<span class="text-muted">-</span>`}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-secondary" onclick="openUpdateModal(${o.Task_ID},'${o.Status}')" title="تحديث الحالة"><i class="bi bi-pencil"></i></button>
            <button class="btn btn-outline-info" onclick="duplicateOrder(${o.Task_ID})" title="تكرار الطلب"><i class="bi bi-copy"></i></button>
            <a href="/client/${o.Client_ID}" class="btn btn-outline-dark" title="عرض ملفات العميل"><i class="bi bi-folder"></i></a>
            ${hasFile ? `<button class="btn btn-outline-warning" onclick="deleteFile(${o.Task_ID})" title="حذف الملف"><i class="bi bi-file-x"></i></button>` : ''}
            ${isDelivered ? `<button class="btn btn-outline-danger" onclick="createInvoiceFromOrder(${o.Task_ID})" title="إنشاء فاتورة"><i class="bi bi-receipt"></i></button>` : ''}
            <button class="btn btn-outline-danger" onclick="deleteOrder(${o.Task_ID})" title="حذف الطلب"><i class="bi bi-trash"></i></button>
          </div>
        </td>
      </tr>`;
    });
    renderPagination('ordersPagination', data.page, data.pages);
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
  const name = document.getElementById('newClientName').value;
  if (!name) { showToast('الاسم مطلوب', 'warning'); return; }
  const data = await fetch('/api/clients', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Full_Name: name, Phone_Number: document.getElementById('newClientPhone').value, Notes: document.getElementById('newClientNotes').value })
  }).then(r => r.json());
  if (data.error) { showToast(data.error, 'danger'); return; }
  document.getElementById('clientId').value = data.Client_ID;
  document.getElementById('clientSearch').value = data.Full_Name;
  document.getElementById('newClientModal').querySelector('.btn-close').click();
  document.getElementById('newClientName').value = '';
  document.getElementById('newClientPhone').value = '';
  document.getElementById('newClientNotes').value = '';
  showToast('تم إضافة العميل', 'success');
}

// ============== MATERIALS ==============
async function loadMaterials(targetSelect) {
  const data = await fetch('/api/inventory').then(r => r.json());
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
function openUploadModal(taskId) {
  document.getElementById('uploadTaskId').value = taskId;
  document.getElementById('uploadFile').value = '';
  document.getElementById('uploadNotes').value = '';
  const container = document.getElementById('materialsContainer');
  container.innerHTML = `<div class="row mb-2 material-row">
    <div class="col-md-5">
      <select class="form-select mat-select"><option value="">-- اختر المادة --</option></select>
    </div>
    <div class="col-md-3">
      <input type="number" class="form-control mat-qty" placeholder="الكمية" step="0.1" min="0">
    </div>
    <div class="col-md-2">
      <span class="form-text mat-stock"></span>
    </div>
    <div class="col-md-2">
      <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.material-row').remove()"><i class="bi bi-x"></i></button>
    </div>
  </div>`;
  loadMaterials(container.querySelector('.mat-select'));
  new bootstrap.Modal(document.getElementById('uploadModal')).show();
}

function addMaterialRow() {
  const container = document.getElementById('materialsContainer');
  const row = document.createElement('div');
  row.className = 'row mb-2 material-row';
  row.innerHTML = `<div class="col-md-5"><select class="form-select mat-select"><option value="">-- اختر المادة --</option></select></div>
    <div class="col-md-3"><input type="number" class="form-control mat-qty" placeholder="الكمية" step="0.1" min="0"></div>
    <div class="col-md-2"><span class="form-text mat-stock"></span></div>
    <div class="col-md-2"><button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.material-row').remove()"><i class="bi bi-x"></i></button></div>`;
  container.appendChild(row);
  loadMaterials(row.querySelector('.mat-select'));
}

function uploadDesignFile() {
  const taskId = document.getElementById('uploadTaskId').value;
  const file = document.getElementById('uploadFile').files[0];
  if (!file) { showToast('يرجى اختيار ملف', 'warning'); return; }

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

  const formData = new FormData();
  formData.append('file', file);
  formData.append('materials', JSON.stringify(materials));

  showToast('جاري رفع الملف...', 'info');
  fetch(`/api/files/upload/${taskId}`, { method: 'POST', body: formData })
    .then(r => r.json().then(data => ({status: r.status, data})))
    .then(({status, data}) => {
      if (data.error) { showToast(data.error, 'danger'); return; }
      if (status !== 200) { showToast('خطأ في السيرفر: ' + (data.error || status), 'danger'); return; }
      showToast('✅ تم رفع الملف مع تحديد المواد المستهلكة', 'success');
      bootstrap.Modal.getInstance(document.getElementById('uploadModal')).hide();
      loadOrders();
    }).catch(e => showToast('فشل رفع الملف - تأكد من اتصال السيرفر: ' + e.message, 'danger'));
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

// ============== LASER ==============
async function loadLaserOrders() {
  const data = await fetch("/api/orders?status=جاهز للقص&machine=Laser").then(r => r.json());
  const tbody = document.getElementById('laserOrdersBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data.orders || data.orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">لا توجد طلبات جاهزة حالياً</td></tr>';
    return;
  }
  data.orders.forEach(o => {
    tbody.innerHTML += `<tr>
      <td>${o.Task_ID}</td><td>${o.Client_Name || '---'}</td>
      <td>${o.Material_Name || '-'}</td><td>${o.Thickness || '-'}</td>
      <td>${o.Notes || '-'}</td>
      <td>${o.File_Path ? `<a href="/api/files/download/${o.Task_ID}" class="btn btn-sm btn-primary"><i class="bi bi-download"></i> تحميل</a>` : '-'}</td>
      <td><button class="btn btn-sm btn-success" onclick="completeOrder(${o.Task_ID})"><i class="bi bi-check-lg"></i> تم الإنجاز</button></td>
    </tr>`;
  });
  const recent = await fetch("/api/orders?status=تم التسليم&machine=Laser&page=1").then(r => r.json());
  const recentBody = document.getElementById('recentLaserOrders');
  if (recentBody && recent.orders) {
    recentBody.innerHTML = recent.orders.slice(0, 5).map(o =>
      `<tr><td>${o.Task_ID}</td><td>${o.Client_Name || ''}</td><td><span class="badge bg-success">${o.Status}</span></td><td>${o.Created_At || ''}</td></tr>`
    ).join('');
  }
}

async function loadRouterOrders() {
  const data = await fetch("/api/orders?status=جاهز للقص&machine=Router").then(r => r.json());
  const tbody = document.getElementById('routerOrdersBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (!data.orders || data.orders.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">لا توجد طلبات جاهزة حالياً</td></tr>';
    return;
  }
  data.orders.forEach(o => {
    tbody.innerHTML += `<tr>
      <td>${o.Task_ID}</td><td>${o.Client_Name || '---'}</td>
      <td>${o.Material_Name || '-'}</td><td>${o.Thickness || '-'}</td>
      <td>${o.Notes || '-'}</td>
      <td>${o.File_Path ? `<a href="/api/files/download/${o.Task_ID}" class="btn btn-sm btn-primary"><i class="bi bi-download"></i> تحميل</a>` : '-'}</td>
      <td><button class="btn btn-sm btn-success" onclick="completeOrder(${o.Task_ID})"><i class="bi bi-check-lg"></i> تم الإنجاز</button></td>
    </tr>`;
  });
  const recent = await fetch("/api/orders?status=تم التسليم&machine=Router&page=1").then(r => r.json());
  const recentBody = document.getElementById('recentRouterOrders');
  if (recentBody && recent.orders) {
    recentBody.innerHTML = recent.orders.slice(0, 5).map(o =>
      `<tr><td>${o.Task_ID}</td><td>${o.Client_Name || ''}</td><td><span class="badge bg-success">${o.Status}</span></td><td>${o.Created_At || ''}</td></tr>`
    ).join('');
  }
}

function completeOrder(taskId) {
  fetch(`/api/orders/${taskId}/status`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Status: 'تم التسليم' }) })
    .then(r => r.json()).then(data => {
      if (data.error) { showToast(data.error, 'danger'); return; }
      showToast('تم إنجاز الطلب!', 'success');
      loadLaserOrders();
      loadRouterOrders();
    });
}

function openUpdateModal(taskId, currentStatus) {
  document.getElementById('updateTaskId').value = taskId;
  document.getElementById('updateStatus').value = currentStatus;
  new bootstrap.Modal(document.getElementById('updateStatusModal')).show();
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
  document.getElementById('notifCount').textContent = '0';
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
      const colors = { 'قيد التصميم': 'warning', 'جاهز للقص': 'info', 'قيد التنفيذ': 'primary', 'تم التغليف': 'secondary', 'تم التسليم': 'success' };
      return `<div class="d-flex justify-content-between mb-1"><span>${s.Status}</span><span class="badge bg-${colors[s.Status] || 'secondary'}">${s.cnt}</span></div>`;
    }).join('');
  }
}

// ============== CLIENTS PAGE ==============
async function loadClients(page = 1) {
  try {
    const search = document.getElementById('searchClient')?.value || '';
    const res = await fetch(`/api/clients?page=${page}&search=${encodeURIComponent(search)}`);
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
        <td>${c.Client_ID}</td><td>${c.Full_Name}</td><td>${c.Phone_Number || '-'}</td>
        <td class="text-warning">${stars}</td><td>${c.Total_Spent || 0}</td><td>${c.Notes || '-'}</td>
        <td><a href="/client/${c.Client_ID}" class="btn btn-sm btn-outline-info"><i class="bi bi-folder"></i> عرض</a></td>
        <td>
          <button class="btn btn-sm btn-outline-primary" onclick="editClient(${c.Client_ID})" title="تعديل"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-sm btn-outline-danger" onclick="deleteClient(${c.Client_ID})" title="حذف"><i class="bi bi-trash"></i></button>
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
    new bootstrap.Modal(document.getElementById('clientModal')).show();
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
  document.getElementById('clientTotalSpent').textContent = `${client.Total_Spent || 0} رس`;
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

  const statusColors = { 'قيد التصميم': 'warning', 'جاهز للقص': 'info', 'قيد التنفيذ': 'primary', 'تم التغليف': 'secondary', 'تم التسليم': 'success' };

  orders.forEach(o => {
    const sc = statusColors[o.Status] || 'secondary';
    const card = document.createElement('div');
    card.className = 'card mb-2 border-end border-4 border-' + sc;
    card.innerHTML = `<div class="card-body py-2">
      <div class="row align-items-center">
        <div class="col-md-1"><strong>#${o.Task_ID}</strong></div>
        <div class="col-md-2"><span class="badge bg-${o.Machine_Type === 'Laser' ? 'danger' : 'success'}">${o.Machine_Type}</span></div>
        <div class="col-md-3"><small>${o.Materials_List || '-'}</small></div>
        <div class="col-md-2"><span class="badge bg-${sc}">${o.Status}</span></div>
        <div class="col-md-2"><small class="text-muted">${o.Created_At || ''}</small></div>
        <div class="col-md-2">
          <div class="btn-group btn-group-sm">
            ${o.File_Path ? `<a href="/api/files/download/${o.Task_ID}" class="btn btn-outline-primary" title="تحميل"><i class="bi bi-download"></i></a>` : ''}
            <button class="btn btn-outline-info" onclick="duplicateOrder(${o.Task_ID})" title="تكرار الطلب"><i class="bi bi-copy"></i> إعادة</button>
          </div>
        </div>
      </div>
      ${o.Notes ? `<div class="row mt-1"><div class="col-12"><small class="text-muted"><i class="bi bi-chat-dots"></i> ${o.Notes}</small></div></div>` : ''}
    </div>`;
    container.appendChild(card);
  });
}

// ============== INVENTORY ==============
async function loadInventory() {
  const data = await fetch('/api/inventory').then(r => r.json());
  const tbody = document.getElementById('inventoryTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  if (data.length === 0) { tbody.innerHTML = '<tr><td colspan="6" class="text-center">لا توجد مواد</td></tr>'; return; }
  data.forEach(m => {
    const low = m.Quantity < 5 ? 'bg-danger text-white' : '';
    tbody.innerHTML += `<tr class="${low}"><td>${m.Material_ID}</td><td>${m.Material_Name}</td><td>${m.Thickness || '-'}</td><td>${m.Quantity}</td><td>${m.Cost_Per_Unit || 0}</td>
      <td><button class="btn btn-sm btn-outline-primary" onclick="editMaterial(${m.Material_ID})"><i class="bi bi-pencil"></i></button></td></tr>`;
  });
}

function saveMaterial() {
  const id = document.getElementById('editMaterialId').value;
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
      <td>${u.Name}</td>
      <td>${u.Username}</td>
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
      <td><a href="/api/invoices/${inv.Invoice_ID}/view" target="_blank" class="text-decoration-none">${inv.Invoice_Number}</a></td>
      <td>${inv.Client_Name || '-'}</td>
      <td>${inv.Machine_Type || '-'}</td>
      <td>${parseFloat(inv.Amount).toFixed(2)} SYP</td>
      <td><span class="badge bg-${sc}">${inv.Status}</span></td>
      <td>${inv.Created_At || ''}</td>
      <td>
        <a href="/api/invoices/${inv.Invoice_ID}/view" target="_blank" class="btn btn-sm btn-outline-info" title="عرض"><i class="bi bi-eye"></i></a>
        <a href="/api/invoices/${inv.Invoice_ID}/pdf" class="btn btn-sm btn-outline-primary" title="تحميل PDF"><i class="bi bi-download"></i></a>
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
