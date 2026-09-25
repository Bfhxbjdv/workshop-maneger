const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

test('expense list renders stored user input as text', async () => {
  const template = readFileSync(resolve(__dirname, '../views/expenses.ejs'), 'utf8');
  const script = template.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'expense page inline script is present');

  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', addEventListener() {} });
    return elements.get(id);
  };
  const markup = '<img src=x onerror=alert(1)>';
  const sandbox = {
    document: { getElementById: element },
    debounce: fn => fn,
    fetch: async url => ({
      json: async () => url.startsWith('/admin/api/expenses')
        ? { expenses: [{ Expense_ID: 7, Description: markup, Category: markup, Amount: 3, Expense_Date: markup, Notes: markup }], page: 1, pages: 1, total: 12 }
        : { totalExpenses: 3, totalRevenue: 10 }
    })
  };

  runInNewContext(script, sandbox);
  await sandbox.loadExpenses();
  const rows = element('expensesTableBody').innerHTML;
  assert.equal(rows.includes(markup), false);
  assert.equal((rows.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length, 4);
  assert.match(rows, /deleteExpense\(7\)/);
  assert.equal(element('expenseCount').textContent, 12);
});

test('expense deletion reports an API failure instead of claiming success', async () => {
  const template = readFileSync(resolve(__dirname, '../views/expenses.ejs'), 'utf8');
  const script = template.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { value: '', innerHTML: '', textContent: '', addEventListener() {} });
    return elements.get(id);
  };
  const toasts = [];
  const sandbox = {
    document: { getElementById: element },
    debounce: fn => fn,
    confirm: () => true,
    showToast: (message, type) => toasts.push({ message, type }),
    fetch: async (url, options) => ({
      ok: options?.method !== 'DELETE',
      json: async () => options?.method === 'DELETE'
        ? { error: 'المصروف غير موجود' }
        : url.startsWith('/admin/api/expenses')
          ? { expenses: [], page: 1, pages: 1, total: 0 }
          : { totalExpenses: 0, totalRevenue: 0 }
    })
  };

  runInNewContext(script, sandbox);
  await sandbox.deleteExpense(7);
  assert.deepEqual(toasts, [{ message: 'المصروف غير موجود', type: 'danger' }]);
});
