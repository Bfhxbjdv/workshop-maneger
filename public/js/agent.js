// Agent Dashboard JavaScript

let agentOrdersPage = 1;
let agentImagesPage = 1;
let agentSelectedImageIds = [];
let agentSelectedShapeIds = [];

function loadAgentOrders() {
  const status = document.getElementById('agentStatusFilter').value;
  const search = document.getElementById('agentOrderSearch').value;
  const params = new URLSearchParams({ page: agentOrdersPage, limit: 20 });
  if (status !== 'all') params.append('status', status);
  if (search) params.append('search', search);
  fetch('/api/orders?' + params.toString(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then(r => r.json())
    .then(data => {
      renderAgentOrders(data.orders || []);
      renderPagination(data.total, data.page, data.pages, 'agentOrdersPagination', agentOrdersPage, (p) => { agentOrdersPage = p; loadAgentOrders(); });
    })
    .catch(e => console.error('loadAgentOrders:', e));
}

function renderAgentOrders(orders) {
  const tbody = document.getElementById('agentOrdersTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  orders.forEach(o => {
    const statusBadge = getStatusBadge(o.Status);
    const approvalBadge = o.Approval_Status === 'pending' ? '<span class="badge bg-warning text-dark">بانتظار الموافقة</span>'
      : o.Approval_Status === 'approved' ? '<span class="badge bg-success">مقبول</span>'
      : o.Approval_Status === 'rejected' ? '<span class="badge bg-danger">مرفوض</span>' : '';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${o.Task_ID}</td>
      <td>${o.Client_Name || 'غير معروف'}</td>
      <td>${o.Machine_Type === 'Laser' ? '<i class="bi bi-lightning text-warning"></i> ليزر' : '<i class="bi bi-cpu text-info"></i> راوتر'}</td>
      <td>${o.Material_Qty || 0} لوح</td>
      <td>${statusBadge}</td>
      <td>${approvalBadge}</td>
      <td>${new Date(o.Created_At).toLocaleDateString('ar-EG')}</td>
      <td>
        <button class="btn btn-sm btn-outline-primary" onclick="viewAgentOrder(${o.Task_ID})" title="عرض"><i class="bi bi-eye"></i></button>
        ${o.Status === 'بانتظار الموافقة' ? `<button class="btn btn-sm btn-outline-danger" onclick="cancelAgentOrder(${o.Task_ID})" title="إلغاء"><i class="bi bi-x-circle"></i></button>` : ''}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function getStatusBadge(status) {
  const badges = {
    'قيد التصميم': 'bg-secondary',
    'جاهز للقص': 'bg-info',
    'قيد التنفيذ': 'bg-primary',
    'تم الانتهاء من القص': 'bg-success',
    'تم التسليم': 'bg-dark',
    'ملغي': 'bg-danger',
    'بانتظار الموافقة': 'bg-warning text-dark'
  };
  return `<span class="badge ${badges[status] || 'bg-secondary'}">${status}</span>`;
}

function loadAgentImages() {
  const category = document.getElementById('imageCategoryFilter').value;
  const params = new URLSearchParams();
  if (category) params.append('category', category);
  fetch('/api/orders/agent/images?' + params.toString(), { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then(r => r.json())
    .then(data => renderAgentImages(data.images || []))
    .catch(e => console.error('loadAgentImages:', e));
}

function renderAgentImages(images) {
  const grid = document.getElementById('agentImagesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  images.forEach(img => {
    const col = document.createElement('div');
    col.className = 'col-6 col-md-4 col-lg-3';
    const isSelected = agentSelectedImageIds.includes(img.Image_ID);
    col.innerHTML = `
      <div class="card h-100 ${isSelected ? 'border-primary' : ''} position-relative" onclick="toggleAgentImage(${img.Image_ID}, this)">
        <img src="/api/orders/agent/images/${img.Image_ID}/file" alt="${img.Original_Name}" class="card-img-top" style="height:150px;object-fit:cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iMzIiIHk9IjMyIiBmb250LXNpemU9IjE0IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIj7YqQ=='">
        <div class="card-body p-2">
          <small class="text-truncate d-block">${img.Original_Name}</small>
          <span class="badge bg-secondary">${img.Category}</span>
        </div>
        ${isSelected ? '<div class="position-absolute top-0 end-0 m-2 badge bg-primary"><i class="bi bi-check"></i></div>' : ''}
      </div>
    `;
    grid.appendChild(col);
  });
  // Also update image selector in create order tab
  updateImageSelector(images);
}

function updateImageSelector(images) {
  const selector = document.getElementById('agentImageSelector');
  if (!selector) return;
  selector.innerHTML = '';
  images.forEach(img => {
    const isSelected = agentSelectedImageIds.includes(img.Image_ID);
    const col = document.createElement('div');
    col.className = 'col-6 col-md-4 col-lg-3';
    col.innerHTML = `
      <div class="card h-100 ${isSelected ? 'border-primary' : ''} cursor-pointer" onclick="toggleAgentImageForOrder(${img.Image_ID}, this)">
        <img src="/api/orders/agent/images/${img.Image_ID}/file" class="card-img-top" style="height:120px;object-fit:cover" onerror="this.src='data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCI+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSIjZWVlIi8+PHRleHQgeD0iMzIiIHk9IjMyIiBmb250LXNpemU9IjE0IiBmaWxsPSIjOTk5IiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIj7YqQ=='" />
        <div class="card-body p-1">
          <small class="text-truncate d-block">${img.Original_Name}</small>
        </div>
        ${isSelected ? '<div class="position-absolute top-0 end-0 m-1 badge bg-primary"><i class="bi bi-check"></i></div>' : ''}
      </div>
    `;
    selector.appendChild(col);
  });
  if (!images.length) {
    selector.innerHTML = '<div class="col-12 text-muted small text-center">لا توجد صور مرفوعة. اذهب لتبويب "مكتبة الصور" لرفع صور.</div>';
  }
}

function toggleAgentImage(id, card) {
  if (agentSelectedImageIds.includes(id)) {
    agentSelectedImageIds = agentSelectedImageIds.filter(x => x !== id);
    card.classList.remove('border-primary');
    const badge = card.querySelector('.badge');
    if (badge) badge.remove();
  } else {
    agentSelectedImageIds.push(id);
    card.classList.add('border-primary');
    const badge = document.createElement('div');
    badge.className = 'position-absolute top-0 end-0 m-2 badge bg-primary';
    badge.innerHTML = '<i class="bi bi-check"></i>';
    card.appendChild(badge);
  }
}

function toggleAgentImageForOrder(id, card) {
  toggleAgentImage(id, card);
  document.getElementById('agentSelectedImages').value = agentSelectedImageIds.join(',');
}

function loadAgentShapes() {
  fetch('/api/orders/agent/shapes', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then(r => r.json())
    .then(data => renderAgentShapes(data.shapes || []))
    .catch(e => console.error('loadAgentShapes:', e));
}

function renderAgentShapes(shapes) {
  const grid = document.getElementById('agentShapesGrid');
  if (!grid) return;
  grid.innerHTML = '';
  shapes.forEach(s => {
    const col = document.createElement('div');
    col.className = 'col-6 col-md-4 col-lg-3';
    const isSelected = agentSelectedShapeIds.includes(s.Shape_ID);
    col.innerHTML = `
      <div class="card h-100 ${isSelected ? 'border-primary' : ''} cursor-pointer" onclick="toggleAgentShape(${s.Shape_ID}, this)">
        ${s.Image_Path ? `<img src="/api/orders/agent/images/${s.Image_ID}/file" class="card-img-top" style="height:120px;object-fit:cover" onerror="this.style.display='none'">` : ''}
        <div class="card-body p-2">
          <small class="fw-bold d-block">${s.Name}</small>
          <small class="text-muted">${s.Description || ''}</small>
        </div>
        ${isSelected ? '<div class="position-absolute top-0 end-0 m-2 badge bg-primary"><i class="bi bi-check"></i></div>' : ''}
      </div>
    `;
    grid.appendChild(col);
  });
  // Also update shape selector
  updateShapeSelector(shapes);
}

function updateShapeSelector(shapes) {
  const selector = document.getElementById('agentShapeSelector');
  const shapeSelect = document.getElementById('shapeImageSelect');
  if (selector) {
    selector.innerHTML = '';
    shapes.forEach(s => {
      const isSelected = agentSelectedShapeIds.includes(s.Shape_ID);
      const col = document.createElement('div');
      col.className = 'col-6 col-md-4';
      col.innerHTML = `
        <div class="card h-100 ${isSelected ? 'border-primary' : ''} cursor-pointer" onclick="toggleAgentShapeForOrder(${s.Shape_ID}, this)">
          <div class="card-body p-2 text-center">
            <strong>${s.Name}</strong><br>
            <small class="text-muted">${s.Description || ''}</small>
          </div>
          ${isSelected ? '<div class="position-absolute top-0 end-0 m-1 badge bg-primary"><i class="bi bi-check"></i></div>' : ''}
        </div>
      `;
      selector.appendChild(col);
    });
    if (!shapes.length) {
      selector.innerHTML = '<div class="col-12 text-muted small text-center">لا توجد أشكال. أضف أشكالاً من تبويب "الأشكال".</div>';
    }
  }
  if (shapeSelect) {
    shapeSelect.innerHTML = '<option value="">-- بدون صورة --</option>';
    shapes.forEach(s => {
      if (s.Image_ID) {
        const opt = document.createElement('option');
        opt.value = s.Image_ID;
        opt.textContent = s.Name + (s.Description ? ' - ' + s.Description : '');
        shapeSelect.appendChild(opt);
      }
    });
  }
}

function toggleAgentShape(id, card) {
  if (agentSelectedShapeIds.includes(id)) {
    agentSelectedShapeIds = agentSelectedShapeIds.filter(x => x !== id);
    card.classList.remove('border-primary');
    const badge = card.querySelector('.badge');
    if (badge) badge.remove();
  } else {
    agentSelectedShapeIds.push(id);
    card.classList.add('border-primary');
    const badge = document.createElement('div');
    badge.className = 'position-absolute top-0 end-0 m-2 badge bg-primary';
    badge.innerHTML = '<i class="bi bi-check"></i>';
    card.appendChild(badge);
  }
}

function toggleAgentShapeForOrder(id, card) {
  toggleAgentShape(id, card);
  document.getElementById('agentSelectedShapes').value = agentSelectedShapeIds.join(',');
}

function uploadAgentImages() {
  const form = document.getElementById('uploadImageForm');
  const formData = new FormData(form);
  fetch('/api/orders/agent/images', {
    method: 'POST',
    body: formData
  }).then(r => r.json()).then(data => {
    if (data.success) {
      bootstrap.Modal.getInstance(document.getElementById('uploadImageModal')).hide();
      form.reset();
      loadAgentImages();
    } else {
      alert(data.error || 'فشل الرفع');
    }
  }).catch(e => { console.error(e); alert('خطأ في الرفع'); });
}

function saveShape() {
  const name = document.getElementById('shapeName').value;
  const description = document.getElementById('shapeDescription').value;
  const image_id = document.getElementById('shapeImageSelect').value || null;
  if (!name) return alert('اسم الشكل مطلوب');
  fetch('/api/orders/agent/shapes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description, image_id })
  }).then(r => r.json()).then(data => {
    if (data.success) {
      bootstrap.Modal.getInstance(document.getElementById('addShapeModal')).hide();
      document.getElementById('addShapeForm').reset();
      loadAgentShapes();
    } else {
      alert(data.error || 'فشل الحفظ');
    }
  }).catch(e => { console.error(e); alert('خطأ في الحفظ'); });
}

function agentAddClient() {
  const name = document.getElementById('agentNewClientName').value;
  const phone = document.getElementById('agentNewClientPhone').value;
  const notes = document.getElementById('agentNewClientNotes').value;
  if (!name) return alert('اسم العميل مطلوب');
  fetch('/api/clients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ Full_Name: name, Phone_Number: phone, Notes: notes })
  }).then(r => r.json()).then(data => {
    if (data.Client_ID) {
      bootstrap.Modal.getInstance(document.getElementById('agentNewClientModal')).hide();
      document.getElementById('agentNewClientName').value = '';
      document.getElementById('agentNewClientPhone').value = '';
      document.getElementById('agentNewClientNotes').value = '';
      loadAgentClients();
    } else {
      alert(data.error || 'فشل الإضافة');
    }
  }).catch(e => { console.error(e); alert('خطأ'); });
}

function loadAgentClients() {
  fetch('/api/clients', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then(r => r.json())
    .then(data => {
      const select = document.getElementById('agentClientSelect');
      if (select) {
        select.innerHTML = '<option value="">-- اختر عميل --</option>';
        (data.clients || data).forEach(c => {
          const opt = document.createElement('option');
          opt.value = c.Client_ID;
          opt.textContent = c.Full_Name + (c.Phone_Number ? ' - ' + c.Phone_Number : '');
          select.appendChild(opt);
        });
      }
    });
}

function addAgentMaterialRow() {
  const container = document.getElementById('agentOrderMaterials');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'row g-1 mb-1 material-row';
  div.innerHTML = `
    <div class="col-6">
      <select class="form-select form-select-sm mat-select"><option value="">-- اختر --</option></select>
    </div>
    <div class="col-3">
      <input type="number" class="form-control form-control-sm mat-qty" placeholder="كمية" step="0.1" min="0">
    </div>
    <div class="col-3">
      <button type="button" class="btn btn-sm btn-outline-danger py-0" onclick="this.closest('.material-row').remove()"><i class="bi bi-x"></i></button>
    </div>
  `;
  container.appendChild(div);
  loadMaterialsForSelect(div.querySelector('.mat-select'));
}

function loadMaterialsForSelect(select) {
  fetch('/api/inventory', { headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then(r => r.json())
    .then(data => {
      select.innerHTML = '<option value="">-- اختر --</option>';
      (data.materials || data).forEach(m => {
        const opt = document.createElement('option');
        opt.value = m.Material_ID;
        opt.textContent = `${m.Material_Name} (${m.Thickness || ''}) - ${m.Quantity} متاح`;
        select.appendChild(opt);
      });
    });
}

function viewAgentOrder(id) {
  window.location.href = `/?order=${id}`;
}

function cancelAgentOrder(id) {
  if (!confirm('هل تريد إلغاء هذا الطلب؟')) return;
  fetch('/api/orders/' + id, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } })
    .then(r => r.json())
    .then(data => {
      if (data.success) loadAgentOrders();
      else alert(data.error || 'فشل الإلغاء');
    });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Initialize tab switching
  document.querySelectorAll('#agentTabs button[data-bs-toggle="tab"]').forEach(btn => {
    btn.addEventListener('shown.bs.tab', e => {
      const target = e.target.getAttribute('data-bs-target');
      if (target === '#orders') loadAgentOrders();
      else if (target === '#images') loadAgentImages();
      else if (target === '#shapes') loadAgentShapes();
      else if (target === '#create') {
        loadAgentClients();
        loadMaterialsForSelect(document.querySelector('#agentOrderForm .mat-select'));
        loadAgentImages();
        loadAgentShapes();
      }
    });
  });

  // Load initial tab
  const activeTab = document.querySelector('#agentTabs button.active');
  if (activeTab) {
    const target = activeTab.getAttribute('data-bs-target');
    if (target === '#orders') loadAgentOrders();
    else if (target === '#images') loadAgentImages();
    else if (target === '#shapes') loadAgentShapes();
  }

  // Order form submit
  const form = document.getElementById('agentOrderForm');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      const clientId = document.getElementById('agentClientId').value;
      const machineType = document.getElementById('agentMachineType').value;
      const sheets = document.getElementById('agentSheets').value;
      const notes = document.getElementById('agentOrderNotes').value;
      if (!clientId || !machineType || !sheets) {
        return alert('العميل، نوع الماكينة، والكمية مطلوبة');
      }
      const materials = [];
      document.querySelectorAll('#agentOrderMaterials .material-row').forEach(row => {
        const matId = row.querySelector('.mat-select').value;
        const qty = row.querySelector('.mat-qty').value;
        if (matId && qty > 0) materials.push({ Material_ID: parseInt(matId), Quantity: parseFloat(qty) });
      });
      fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          Client_ID: parseInt(clientId),
          Machine_Type: machineType,
          Materials: materials,
          Notes: notes,
          Sheets: parseFloat(sheets),
          Image_IDs: agentSelectedImageIds,
          Shapes: agentSelectedShapeIds
        })
      }).then(r => r.json()).then(data => {
        if (data.Task_ID) {
          alert('تم إرسال الطلب للموافقة بنجاح!');
          form.reset();
          agentSelectedImageIds = [];
          agentSelectedShapeIds = [];
          document.getElementById('agentSelectedImages').value = '';
          document.getElementById('agentSelectedShapes').value = '';
          document.querySelectorAll('#agentImageSelector .card, #agentShapeSelector .card').forEach(c => c.classList.remove('border-primary'));
          loadAgentOrders();
          // Switch to orders tab
          const tab = new bootstrap.Tab(document.querySelector('#orders-tab'));
          tab.show();
        } else {
          alert(data.error || 'فشل إنشاء الطلب');
        }
      }).catch(e => { console.error(e); alert('خطأ في الإرسال'); });
    });
  }
});