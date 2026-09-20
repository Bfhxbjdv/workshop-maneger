// Agents Management JavaScript - Admin & Agent Pages

// ==================== Utility Functions ====================

function formatNumber(num) {
  return (num || 0).toLocaleString('ar-SA');
}

function formatCurrency(num) {
  return formatNumber(num) + ' ريال';
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
  alertDiv.innerHTML = `
    ${message}
    <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
  `;
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
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'المبلغ (ريال)' }, grid: { drawOnChartArea: false } }
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
        y1: { type: 'linear', position: 'right', title: { display: true, text: 'المبلغ (ريال)' }, grid: { drawOnChartArea: false } }
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
    ...data.map(row => headers.map(h => `"${(row[h] || '').toString().replace(/"/g, '""')}"`).join(','))
  ].join('\n');
  
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `${filename}_${new Date().toISOString().slice(0,10)}.csv`;
  link.click();
}

function exportAgents() {
  // Will be called from agents page
}

function exportAgentClients() {
  // Will be called from agent detail page
}

function exportAgentOrders() {
  // Will be called from agent detail page
}

function exportAgentCommissions() {
  // Will be called from agent detail page
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
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPut(path, body) {
  const res = await fetch(path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(path, { method: 'DELETE', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ==================== Payout Modal Handler ====================

document.addEventListener('DOMContentLoaded', () => {
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
          if (typeof loadAgentPayouts === 'function') loadAgentPayouts();
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