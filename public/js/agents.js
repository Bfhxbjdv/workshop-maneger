// Agents Management JavaScript - Admin & Agent Pages

// ==================== Utility Functions ====================

function formatNumber(num) {
  return (num || 0).toLocaleString('ar-SA');
}

function formatCurrency(num) {
  return '$' + formatNumber(num) + ' USD';
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('ar-SA');
}

function formatDateTime(dateStr) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleString('ar-SA');
}

function getStatusBadge(status) {
  const badges = {
    'active': 'bg-success',
    'inactive': 'bg-secondary',
    'suspended': 'bg-danger',
    'بانتظار الموافقة': 'bg-warning text-dark',
    'قيد التصميم': 'bg-secondary',
    'جاهز للقص': 'bg-info',
    'قيد التنفيذ': 'bg-primary',
    'تم الانتهاء من القص': 'bg-success',
    'تم التسليم': 'bg-dark',
    'ملغي': 'bg-danger',
    'pending': 'bg-warning text-dark',
    'approved': 'bg-success',
    'paid': 'bg-primary',
    'cancelled': 'bg-danger',
    'processing': 'bg-info'
  };
  return `<span class="badge ${badges[status] || 'bg-secondary'}">${status}</span>`;
}

function getCommissionTypeBadge(type) {
  const badges = {
    'order': 'bg-primary',
    'client_bonus': 'bg-success',
    'milestone': 'bg-warning text-dark'
  };
  return `<span class="badge ${badges[type] || 'bg-secondary'}">${type === 'order' ? 'طلب' : type === 'client_bonus' ? 'مكافأة عميل' : 'مرحلية'}</span>`;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

const debouncedSearch = debounce(() => {
  if (typeof loadAgents === 'function') loadAgents();
}, 300);

const debouncedClientSearch = debounce(() => {
  if (typeof loadAgentClients === 'function') loadAgentClients();
}, 300);

function showAlert(message, type = 'success') {
  const alertDiv = document.createElement('div');
  alertDiv.className = `alert alert-${type} alert-dismissible fade show position-fixed top-0 end-0 m-3`;
  alertDiv.style.zIndex = '9999';
  alertDiv.style.minWidth = '300px';
  alertDiv.textContent = String(message);
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'btn-close';
  close.setAttribute('data-bs-dismiss', 'alert');
  alertDiv.appendChild(close);
  document.body.appendChild(alertDiv);
  setTimeout(() => alertDiv.remove(), 5000);
}

// ==================== Chart Helpers ====================

let trendChart = null;
let statusChart = null;
let monthlyChart = null;

function destroyCharts() {
  [trendChart, statusChart, monthlyChart].forEach(c => { if (c) c.destroy(); });
  trendChart = statusChart = monthlyChart = null;
}

function renderTrendChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (trendChart) trendChart.destroy();
  
  const labels = data.map(d => d.date);
  const ordersData = data.map(d => d.orders_count);
  const revenueData = data.map(d => d.revenue);
  const commissionData = data.map(d => d.commission);
  
  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'الطلبات',
          data: ordersData,
          borderColor: '#0d6efd',
          backgroundColor: 'rgba(13,110,253,0.1)',
          yAxisID: 'y',
          tension: 0.3
        },
        {
          label: 'الإيرادات',
          data: revenueData,
          borderColor: '#198754',
          backgroundColor: 'rgba(25,135,84,0.1)',
          yAxisID: 'y1',
          tension: 0.3
        },
        {
          label: 'العمولة',
          data: commissionData,
          borderColor: '#ffc107',
          backgroundColor: 'rgba(255,193,7,0.1)',
          yAxisID: 'y1',
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        y: { type: 'linear', position: 'left', title: { display: true, text: 'عدد الطلبات' } },
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'المبلغ (USD)' }, grid: { drawOnChartArea: false } }
      },
      plugins: { legend: { position: 'top' } }
    }
  });
}

function renderStatusChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (statusChart) statusChart.destroy();
  
  const labels = data.map(d => d.Status);
  const dataValues = data.map(d => d.count);
  const colors = data.map(d => {
    const colors = {
      'بانتظار الموافقة': '#ffc107',
      'قيد التصميم': '#6c757d',
      'جاهز للقص': '#0dcaf0',
      'قيد التنفيذ': '#0d6efd',
      'تم الانتهاء من القص': '#198754',
      'تم التسليم': '#212529',
      'ملغي': '#dc3545'
    };
    return colors[d.Status] || '#6c757d';
  });
  
  statusChart = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: dataValues, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}

function renderMonthlyChart(canvasId, data) {
  const ctx = document.getElementById(canvasId);
  if (!ctx) return;
  if (monthlyChart) monthlyChart.destroy();
  
  const labels = data.map(d => d.month);
  const ordersData = data.map(d => d.orders);
  const revenueData = data.map(d => d.revenue);
  const commissionData = data.map(d => d.commission);
  
  monthlyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'الطلبات', data: ordersData, backgroundColor: 'rgba(13,110,253,0.7)', yAxisID: 'y' },
        { label: 'الإيرادات', data: revenueData, backgroundColor: 'rgba(25,135,84,0.7)', yAxisID: 'y1' },
        { label: 'العمولة', data: commissionData, backgroundColor: 'rgba(255,193,7,0.7)', yAxisID: 'y1' }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { type: 'linear', position: 'left', title: { display: true, text: 'الطلبات' } },
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'المبلغ (USD)' }, grid: { drawOnChartArea: false } }
      },
      plugins: { legend: { position: 'top' } }
    }
  });
}

// ==================== Pagination ====================

function renderPagination(total, page, pages, containerId, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (pages <= 1) { container.innerHTML = ''; return; }
  
  let html = '';
  html += `<li class="page-item ${page === 1 ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${page - 1}"><i class="bi bi-chevron-right"></i></a></li>`;
  
  const start = Math.max(1, page - 2);
  const end = Math.min(pages, page + 2);
  
  for (let i = start; i <= end; i++) {
    html += `<li class="page-item ${i === page ? 'active' : ''}"><a class="page-link" href="#" data-page="${i}">${i}</a></li>`;
  }
  
  html += `<li class="page-item ${page === pages ? 'disabled' : ''}"><a class="page-link" href="#" data-page="${page + 1}"><i class="bi bi-chevron-left"></i></a></li>`;
  
  container.innerHTML = html;
  
  container.querySelectorAll('.page-link').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const p = parseInt(link.dataset.page);
      if (!isNaN(p) && p >= 1 && p <= pages) onPageChange(p);
    });
  });
}

// ==================== Export Functions ====================

function exportToCSV(data, filename) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const value = String(row[h] ?? '');
      const safe = /^[=+@\-\t\r]/.test(value) ? `'${value}` : value;
      return `"${safe.replace(/"/g, '""')}"`;
    }).join(','))
  ].join('\n');
  
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
}

async function exportAgents() {
  try {
    const rows = [];
    let page = 1;
    let pages = 1;
    do {
      const data = await apiGet('/api/agents', { page, limit: 100,
        search: document.getElementById('agentSearch')?.value.trim() || '',
        status: document.getElementById('statusFilter')?.value || '',
        sort: document.getElementById('sortFilter')?.value || 'newest' });
      rows.push(...(data.agents || []));
      pages = Number(data.pages) || 1;
      page++;
    } while (page <= pages);
    if (!rows.length) return showAlert('لا توجد بيانات لتصديرها', 'warning');
    exportToCSV(rows.map(agent => ({
      'الاسم': agent.Name,
      'اسم المستخدم': agent.Username,
      'الحالة': agent.Status,
      'العملاء': agent.Client_Count,
      'الطلبات': agent.Order_Count,
      'الإيرادات USD': agent.Total_Revenue,
      'العمولة USD': agent.Total_Commission,
      'بانتظار الموافقة': agent.Pending_Orders,
      'تاريخ الانضمام': agent.Hired_Date || agent.Created_At
    })), 'agents');
  } catch (error) { showAlert(error.message || 'تعذر تصدير بيانات الوكلاء', 'danger'); }
}

async function exportAgentClients() {
  await exportAgentRows('clients', rows => rows.map(client => ({
    'الاسم': client.Full_Name, 'الهاتف': client.Phone_Number,
    'الطلبات': client.order_count, 'إجمالي الإنفاق USD': client.total_spent,
    'تاريخ الإضافة': client.Created_At
  })));
}

async function exportAgentOrders() {
  await exportAgentRows('orders', rows => rows.map(order => ({
    'رقم الطلب': order.Task_ID, 'العميل': order.Client_Name, 'الماكينة': order.Machine_Type,
    'الكمية': order.Material_Qty, 'الوحدة': order.Quantity_Unit,
    'السعر الأساسي USD': order.Agent_Price, 'العمولة USD': order.Agent_Commission,
    'السعر الإجمالي USD': order.Final_Price, 'الحالة': order.Status, 'التاريخ': order.Created_At
  })));
}

async function exportAgentCommissions() {
  await exportAgentRows('commissions', rows => rows.map(commission => ({
    'رقم العمولة': commission.Commission_ID, 'رقم الطلب': commission.Order_ID,
    'العميل': commission.Client_Name, 'النوع': commission.Commission_Type,
    'المبلغ USD': commission.Commission_Amount, 'الحالة': commission.Status,
    'تاريخ الحساب': commission.Calculated_At
  })));
}

// ==================== Modal Helpers ====================

function openModal(modalId) {
  const modal = new bootstrap.Modal(document.getElementById(modalId));
  modal.show();
}

function closeModal(modalId) {
  const modalEl = document.getElementById(modalId);
  if (modalEl) bootstrap.Modal.getInstance(modalEl)?.hide();
}

function resetForm(formId) {
  const form = document.getElementById(formId);
  if (form) form.reset();
}

// ==================== API Helpers ====================

async function apiGet(path, params = {}) {
  const query = new URLSearchParams(params).toString();
  const url = path + (query ? '?' + query : '');
  const res = await fetch(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
  return res.json();
}

// ==================== Admin Agent Management ====================

let agentsPage = 1;

function agentsEscape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

async function loadAgents(page = 1) {
  const tbody = document.getElementById('agentsTableBody');
  if (!tbody) return;
  agentsPage = page;
  tbody.innerHTML = '<tr><td colspan="10" class="text-center py-4 text-muted">جارٍ تحميل الوكلاء...</td></tr>';
  try {
    const data = await apiGet('/api/agents', {
      page: agentsPage, limit: 20,
      search: document.getElementById('agentSearch').value.trim(),
      status: document.getElementById('statusFilter').value,
      sort: document.getElementById('sortFilter').value
    });
    const agents = data.agents || [];
    tbody.innerHTML = agents.length ? agents.map(agent => {
      const id = Number(agent.User_ID);
      return `<tr>
        <td>${id}</td>
        <td><strong>${agentsEscape(agent.Name)}</strong><small class="d-block text-muted">@${agentsEscape(agent.Username)}</small></td>
        <td>${getStatusBadge(agentsEscape(agent.Status || 'active'))}</td>
        <td>${Number(agent.Client_Count) || 0}</td>
        <td>${Number(agent.Order_Count) || 0}</td>
        <td>${formatCurrency(Number(agent.Total_Revenue) || 0)}</td>
        <td>${formatCurrency(Number(agent.Total_Commission) || 0)}</td>
        <td>${Number(agent.Pending_Orders) || 0}</td>
        <td>${formatDate(agent.Hired_Date || agent.Created_At)}</td>
        <td class="text-nowrap">
          <a class="btn btn-sm btn-outline-primary" href="/agents/${id}" title="تفاصيل"><i class="bi bi-eye"></i></a>
          <button type="button" class="btn btn-sm btn-outline-secondary" onclick="editAgent(${id})" title="تعديل"><i class="bi bi-pencil"></i></button>
          <button type="button" class="btn btn-sm btn-outline-danger" onclick="deleteAgent(${id})" title="حذف أو تعطيل"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
    }).join('') : '<tr><td colspan="10" class="text-center py-4 text-muted">لا يوجد وكلاء مطابقون</td></tr>';
    const summary = data.summary || {};
    document.getElementById('totalAgents').textContent = Number(summary.totalAgents) || 0;
    document.getElementById('totalOrders').textContent = Number(summary.totalOrders) || 0;
    document.getElementById('totalRevenue').textContent = formatCurrency(Number(summary.totalRevenue) || 0);
    document.getElementById('totalCommission').textContent = formatCurrency(Number(summary.totalCommission) || 0);
    renderPagination(Number(data.total) || 0, Number(data.page) || 1, Number(data.pages) || 1, 'agentsPagination', loadAgents);
  } catch (error) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-4 text-danger">${agentsEscape(error.message || 'تعذر تحميل الوكلاء')}</td></tr>`;
  }
}

function openAgentModal() {
  const form = document.getElementById('agentForm');
  form.reset();
  document.getElementById('editAgentId').value = '';
  document.getElementById('agentPassword').required = true;
  document.getElementById('agentPassword').placeholder = 'كلمة مرور قوية';
  document.getElementById('agentUsername').readOnly = false;
  document.getElementById('modalTitle').innerHTML = '<i class="bi bi-person-plus"></i> إضافة وكيل جديد';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('agentModal')).show();
}

async function editAgent(id) {
  try {
    const data = await apiGet(`/api/agents/${id}`);
    const agent = data.agent;
    const fields = {
      agentName: agent.Name, agentUsername: agent.Username, agentPhone: agent.Phone,
      agentEmail: agent.Email, agentTerritory: agent.Territory,
      agentCommissionRate: (Number(agent.Commission_Rate) || 0) * 100,
      agentBankAccount: agent.Bank_Account, agentIBAN: agent.IBAN,
      agentTaxNumber: agent.Tax_Number, agentStatus: agent.Status || 'active', agentNotes: agent.Notes
    };
    document.getElementById('agentForm').reset();
    for (const [field, value] of Object.entries(fields)) document.getElementById(field).value = value ?? '';
    document.getElementById('editAgentId').value = id;
    document.getElementById('agentPassword').value = '';
    document.getElementById('agentPassword').required = false;
    document.getElementById('agentPassword').placeholder = 'اتركها فارغة للإبقاء على كلمة المرور';
    document.getElementById('modalTitle').innerHTML = '<i class="bi bi-pencil"></i> تعديل الوكيل';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('agentModal')).show();
  } catch (error) { showAlert(error.message || 'تعذر تحميل بيانات الوكيل', 'danger'); }
}

async function saveAgent(event) {
  event.preventDefault();
  const id = document.getElementById('editAgentId').value;
  const form = event.currentTarget;
  const button = form.querySelector('button[type="submit"]');
  const value = field => document.getElementById(field).value.trim();
  const body = {
    Name: value('agentName'), Username: value('agentUsername'), Password: value('agentPassword'),
    Phone: value('agentPhone'), Email: value('agentEmail'), Territory: value('agentTerritory'),
    Commission_Rate: Number(value('agentCommissionRate')),
    Bank_Account: value('agentBankAccount'), IBAN: value('agentIBAN'), Tax_Number: value('agentTaxNumber'),
    Status: value('agentStatus'), Notes: value('agentNotes')
  };
  button.disabled = true;
  try {
    const result = id ? await apiPut(`/api/agents/${id}`, body) : await apiPost('/api/agents', body);
    if (!result.success) throw new Error(result.error || 'فشل حفظ الوكيل');
    bootstrap.Modal.getOrCreateInstance(document.getElementById('agentModal')).hide();
    showAlert(id ? 'تم تحديث بيانات الوكيل' : 'تم إنشاء حساب الوكيل');
    await loadAgents(agentsPage);
  } catch (error) { showAlert(error.message || 'تعذر حفظ الوكيل', 'danger'); }
  finally { button.disabled = false; }
}

async function deleteAgent(id) {
  if (!confirm('هل تريد حذف هذا الوكيل؟ إذا كانت له سجلات سابقة، سيتم تعطيله مع حفظ بياناته.')) return;
  try {
    const result = await apiDelete(`/api/agents/${id}`);
    showAlert(result.message || 'تم تحديث حالة الوكيل');
    await loadAgents(agentsPage);
  } catch (error) { showAlert(error.message || 'تعذر حذف الوكيل', 'danger'); }
}

// ==================== Agent Detail ====================

const agentDetailPages = { clients: 1, orders: 1, commissions: 1, payouts: 1, activity: 1 };

async function exportAgentRows(section, transform) {
  const agentId = window.currentAgentId;
  if (!agentId) return;
  try {
    const rows = [];
    let page = 1;
    let pages = 1;
    do {
      const params = { page, limit: 100 };
      if (section === 'clients') params.search = document.getElementById('clientSearch').value.trim();
      if (section === 'orders') params.status = document.getElementById('orderStatusFilter').value;
      if (section === 'commissions') params.status = document.getElementById('commissionStatusFilter').value;
      const data = await apiGet(`/api/agents/${agentId}/${section}`, params);
      rows.push(...(data[section] || []));
      pages = Number(data.pages) || 1;
      page++;
    } while (page <= pages);
    if (!rows.length) return showAlert('لا توجد بيانات لتصديرها', 'warning');
    exportToCSV(transform(rows), `agent_${agentId}_${section}`);
  } catch (error) { showAlert(error.message || 'تعذر تصدير البيانات', 'danger'); }
}

async function loadAgentDetail() {
  const id = window.currentAgentId;
  if (!id) return;
  try {
    const [data, charts] = await Promise.all([
      apiGet(`/api/agents/${id}`), apiGet(`/api/agents/${id}/stats`)
    ]);
    const agent = data.agent;
    const stats = data.stats || {};
    document.getElementById('agentName').textContent = agent.Name || '-';
    document.getElementById('agentUsername').textContent = '@' + (agent.Username || '');
    const status = document.getElementById('agentStatusBadge');
    status.className = `badge ${agent.Status === 'active' ? 'bg-success' : agent.Status === 'suspended' ? 'bg-danger' : 'bg-secondary'}`;
    status.textContent = { active: 'نشط', inactive: 'معطل', suspended: 'موقوف' }[agent.Status] || agent.Status;
    const values = {
      statClients: stats.Client_Count, statOrders: stats.Order_Count,
      statRevenue: formatCurrency(Number(stats.Total_Revenue) || 0),
      statCommission: formatCurrency(Number(stats.Total_Commission) || 0),
      ovClients: stats.Client_Count, ovOrders: stats.Order_Count,
      ovRevenue: formatCurrency(Number(stats.Total_Revenue) || 0),
      ovCommission: formatCurrency(Number(stats.Total_Commission) || 0),
      ovPending: stats.Pending_Orders, ovApproved: stats.Approved_Orders,
      ovRejected: stats.Rejected_Orders, ovNewClients: stats.New_Clients,
      totalCommissionAmount: Number(stats.Total_Commission) || 0
    };
    for (const [elementId, value] of Object.entries(values)) document.getElementById(elementId).textContent = value ?? 0;
    if (typeof Chart === 'function') {
      renderTrendChart('trendChart', charts.dailyStats || []);
      renderStatusChart('statusChart', charts.statusBreakdown || []);
      renderMonthlyChart('monthlyChart', (charts.monthlyComparison || []).slice().reverse());
    }
    const topClients = document.getElementById('topClientsList');
    topClients.innerHTML = (charts.topClients || []).length
      ? charts.topClients.map(client => `<div class="d-flex justify-content-between border-bottom py-2"><span>${agentsEscape(client.Full_Name)}</span><strong>${formatCurrency(Number(client.total_spent) || 0)}</strong></div>`).join('')
      : '<div class="text-muted py-3">لا توجد بيانات عملاء بعد.</div>';
  } catch (error) { showAlert(error.message || 'تعذر تحميل تفاصيل الوكيل', 'danger'); }
}

function detailError(tbody, columns, error) {
  tbody.innerHTML = `<tr><td colspan="${columns}" class="text-center text-danger py-3">${agentsEscape(error.message || 'تعذر تحميل البيانات')}</td></tr>`;
}

async function loadAgentClients(page = 1) {
  const id = window.currentAgentId;
  if (!id) return;
  const tbody = document.getElementById('clientsTableBody');
  agentDetailPages.clients = page;
  try {
    const data = await apiGet(`/api/agents/${id}/clients`, { page, limit: 20, search: document.getElementById('clientSearch').value.trim() });
    tbody.innerHTML = (data.clients || []).length ? data.clients.map(client => `<tr>
      <td>${Number(client.Client_ID)}</td><td>${agentsEscape(client.Full_Name)}</td><td>${agentsEscape(client.Phone_Number || '-')}</td>
      <td>${Number(client.order_count) || 0}</td><td>${formatCurrency(Number(client.total_spent) || 0)}</td>
      <td>${formatDate(client.Created_At)}</td><td><a class="btn btn-sm btn-outline-primary" href="/client/${Number(client.Client_ID)}">عرض</a></td>
    </tr>`).join('') : '<tr><td colspan="7" class="text-center text-muted py-3">لا يوجد عملاء</td></tr>';
    renderPagination(data.total, data.page, data.pages, 'clientsPagination', loadAgentClients);
  } catch (error) { detailError(tbody, 7, error); }
}

async function loadAgentOrders(page = 1) {
  const id = window.currentAgentId;
  if (!id) return;
  const tbody = document.getElementById('ordersTableBody');
  agentDetailPages.orders = page;
  try {
    const data = await apiGet(`/api/agents/${id}/orders`, { page, limit: 20, status: document.getElementById('orderStatusFilter').value });
    tbody.innerHTML = (data.orders || []).length ? data.orders.map(order => `<tr>
      <td>#${Number(order.Task_ID)}</td><td>${agentsEscape(order.Client_Name || '-')}</td><td>${agentsEscape(order.Machine_Type)}</td>
      <td>${Number(order.Material_Qty) || 0} ${agentsEscape(order.Quantity_Unit || 'لوح')}</td>
      <td>${formatCurrency(Number(order.Agent_Price) || 0)}</td><td>${formatCurrency(Number(order.Agent_Commission) || 0)}</td>
      <td>${formatCurrency(Number(order.Final_Price) || 0)}</td><td>${getStatusBadge(agentsEscape(order.Status))}</td>
      <td>${agentsEscape(order.Approval_Status || '-')}</td><td>${formatDate(order.Created_At)}</td><td>-</td>
    </tr>`).join('') : '<tr><td colspan="11" class="text-center text-muted py-3">لا توجد طلبات</td></tr>';
    renderPagination(data.total, data.page, data.pages, 'ordersPagination', loadAgentOrders);
  } catch (error) { detailError(tbody, 11, error); }
}

async function loadAgentCommissions(page = 1) {
  const id = window.currentAgentId;
  if (!id) return;
  const tbody = document.getElementById('commissionsTableBody');
  agentDetailPages.commissions = page;
  const status = document.getElementById('commissionStatusFilter').value || document.getElementById('commissionStatusFilter2').value;
  try {
    const data = await apiGet(`/api/agents/${id}/commissions`, { page, limit: 20, status });
    tbody.innerHTML = (data.commissions || []).length ? data.commissions.map(commission => `<tr>
      <td>${Number(commission.Commission_ID)}</td><td>${commission.Order_ID ? '#' + Number(commission.Order_ID) : '-'}</td>
      <td>${agentsEscape(commission.Client_Name || '-')}</td><td>${getCommissionTypeBadge(commission.Commission_Type)}</td>
      <td>${formatCurrency(Number(commission.Commission_Amount) || 0)}</td><td>${getStatusBadge(agentsEscape(commission.Status))}</td>
      <td>${formatDate(commission.Calculated_At)}</td><td>${formatDate(commission.Approved_At)}</td>
      <td>${commission.Status === 'pending' ? `<button class="btn btn-sm btn-success" onclick="updateAgentCommission(${Number(commission.Commission_ID)}, 'approve')">اعتماد</button> <button class="btn btn-sm btn-outline-danger" onclick="updateAgentCommission(${Number(commission.Commission_ID)}, 'reject')">رفض</button>` : '-'}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="text-center text-muted py-3">لا توجد عمولات مسجلة</td></tr>';
    renderPagination(data.total, data.page, data.pages, 'commissionsPagination', loadAgentCommissions);
  } catch (error) { detailError(tbody, 9, error); }
}

async function updateAgentCommission(commissionId, action) {
  try {
    await apiPut(`/api/agents/${window.currentAgentId}/commissions/${commissionId}`, { action });
    showAlert(action === 'approve' ? 'تم اعتماد العمولة' : 'تم رفض العمولة');
    await loadAgentCommissions(agentDetailPages.commissions);
  } catch (error) { showAlert(error.message || 'تعذر تحديث العمولة', 'danger'); }
}

async function loadAgentPayouts(page = 1) {
  const id = window.currentAgentId;
  if (!id) return;
  const tbody = document.getElementById('payoutsTableBody');
  agentDetailPages.payouts = page;
  try {
    const data = await apiGet(`/api/agents/${id}/payouts`, { page, limit: 20, status: document.getElementById('payoutStatusFilter').value });
    document.getElementById('totalPayoutAmount').textContent = Number(data.totalAmount || 0).toLocaleString('ar-SA');
    tbody.innerHTML = (data.payouts || []).length ? data.payouts.map(payout => `<tr>
      <td>${Number(payout.Payout_ID)}</td><td>${formatCurrency(Number(payout.Amount) || 0)}</td>
      <td>${agentsEscape(payout.Period_Start)} — ${agentsEscape(payout.Period_End)}</td>
      <td>${agentsEscape(payout.Payment_Method || '-')}</td><td>${agentsEscape(payout.Transaction_Ref || '-')}</td>
      <td>${getStatusBadge(agentsEscape(payout.Status))}</td><td>${formatDate(payout.Requested_At)}</td>
      <td>${formatDate(payout.Processed_At)}</td><td>-</td>
    </tr>`).join('') : '<tr><td colspan="9" class="text-center text-muted py-3">لا توجد عمليات صرف</td></tr>';
    renderPagination(data.total, data.page, data.pages, 'payoutsPagination', loadAgentPayouts);
  } catch (error) { detailError(tbody, 9, error); }
}

async function loadAgentActivity(page = 1) {
  const id = window.currentAgentId;
  if (!id) return;
  const tbody = document.getElementById('activityTableBody');
  agentDetailPages.activity = page;
  try {
    const data = await apiGet(`/api/agents/${id}/activity`, { page, limit: 20 });
    tbody.innerHTML = (data.activities || []).length ? data.activities.map(activity => `<tr>
      <td>${Number(activity.Log_ID)}</td><td>${agentsEscape(activity.Action)}</td><td>${agentsEscape(activity.Entity_Type || '-')}</td>
      <td>${Number(activity.Entity_ID) || '-'}</td><td>${agentsEscape(activity.Details || '-')}</td><td>${formatDateTime(activity.Created_At)}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted py-3">لا يوجد نشاط مسجل</td></tr>';
    renderPagination(data.total, data.page, data.pages, 'activityPagination', loadAgentActivity);
  } catch (error) { detailError(tbody, 6, error); }
}

// ==================== Payout Modal Handler ====================

document.addEventListener('DOMContentLoaded', () => {
  const agentForm = document.getElementById('agentForm');
  if (agentForm) {
    agentForm.addEventListener('submit', saveAgent);
    loadAgents();
  }
  const detailId = window.location.pathname.match(/^\/agents\/(\d+)$/);
  if (detailId && document.getElementById('agentHeader')) {
    window.currentAgentId = Number(detailId[1]);
    loadAgentDetail();
    document.getElementById('agentTabs').addEventListener('shown.bs.tab', event => {
      const section = event.target.getAttribute('data-bs-target');
      if (section === '#clients') loadAgentClients();
      if (section === '#orders') loadAgentOrders();
      if (section === '#commissions') loadAgentCommissions();
      if (section === '#payouts') loadAgentPayouts();
      if (section === '#activity') loadAgentActivity();
    });
    document.getElementById('commissionStatusFilter').addEventListener('change', event => {
      document.getElementById('commissionStatusFilter2').value = event.target.value;
    });
    document.getElementById('commissionStatusFilter2').addEventListener('change', event => {
      document.getElementById('commissionStatusFilter').value = event.target.value;
    });
  }
  const payoutForm = document.getElementById('payoutForm');
  if (payoutForm) {
    payoutForm.addEventListener('submit', async e => {
      e.preventDefault();
      const agentId = window.currentAgentId;
      if (!agentId) return;
      
      const payload = {
        amount: parseFloat(document.getElementById('payoutAmount').value),
        period_start: document.getElementById('payoutPeriodStart').value,
        period_end: document.getElementById('payoutPeriodEnd').value,
        payment_method: document.getElementById('payoutPaymentMethod').value,
        transaction_ref: document.getElementById('payoutTransactionRef').value,
        notes: document.getElementById('payoutNotes').value
      };
      
      try {
        const res = await apiPost(`/api/agents/${window.currentAgentId}/payouts`, payload);
        if (res.success) {
          showAlert('تم تسجيل الصرف بنجاح');
          closeModal('payoutModal');
          payoutForm.reset();
          if (typeof loadAgentPayouts === 'function') loadAgentPayouts();
          if (window.currentAgentId) loadAgentDetail();
        } else {
          showAlert(res.error || 'فشل التسجيل', 'danger');
        }
      } catch (e) { showAlert('خطأ في الاتصال', 'danger'); }
    });
  }
});

// ==================== Global Exports ====================

window.AgentsUtils = {
  formatNumber,
  formatCurrency,
  formatDate,
  formatDateTime,
  getStatusBadge,
  getCommissionTypeBadge,
  debounce,
  showAlert,
  renderTrendChart,
  renderStatusChart,
  renderMonthlyChart,
  renderPagination,
  exportToCSV,
  openModal,
  closeModal,
  resetForm,
  apiGet,
  apiPost,
  apiPut,
  apiDelete
};

console.log('Agents.js loaded successfully');
