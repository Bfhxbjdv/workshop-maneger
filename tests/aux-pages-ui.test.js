const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { runInNewContext } = require('node:vm');
const test = require('node:test');

function inlineScript(page) {
  const template = readFileSync(resolve(__dirname, `../views/${page}.ejs`), 'utf8');
  const scripts = [...template.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(scripts.length, `${page} has an inline script`);
  return scripts.map(match => match[1]).join('\n');
}

test('inventory add button is shown only to an admin', async () => {
  const template = readFileSync(resolve(__dirname, '../views/inventory.ejs'), 'utf8');
  assert.match(template, /id="addInventoryMaterialButton"[^>]*\bd-none\b/);

  for (const role of ['Admin', 'Designer']) {
    let revealed = false;
    const button = { classList: { remove(name) { if (name === 'd-none') revealed = true; } } };
    runInNewContext(inlineScript('inventory'), {
      fetch: async () => ({ ok: true, json: async () => ({ user: { Role: role } }) }),
      document: { getElementById: () => button }
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(revealed, role === 'Admin');
  }
});

test('account display renders a changed username through a text node', async () => {
  const username = '<img src=x onerror=alert(1)>';
  const fields = new Map([
    ['currentPassword', { value: 'old-password' }],
    ['newUsername', { value: username }],
    ['newPassword', { value: '' }],
    ['confirmPassword', { value: '' }],
    ['accountError', { classList: { add() {}, remove() {} } }],
    ['accountSuccess', { classList: { add() {}, remove() {} } }]
  ]);
  const label = { replaceChildren(...children) { this.children = children; } };
  const sandbox = {
    document: {
      getElementById: id => fields.get(id),
      querySelector: () => label,
      createElement: tag => ({ tag }),
      createTextNode: text => ({ text })
    },
    fetch: async () => ({ ok: true, json: async () => ({ success: true }) })
  };

  runInNewContext(inlineScript('account'), sandbox);
  await sandbox.saveAccount();
  assert.equal(label.children[1].text, ` ${username}`);
  assert.equal(label.children[0].tag, 'i');
});

test('custom permissions expose supported routes and preserve order access', () => {
  const template = readFileSync(resolve(__dirname, '../views/users.ejs'), 'utf8');
  for (const key of ['dashboard', 'expenses', 'admin', 'users']) {
    assert.match(template, new RegExp(`id="perm_${key}" disabled`));
  }
  assert.match(template, /id="perm_orders"(?! disabled)/);

  const fields = new Map();
  const sandbox = {
    document: { getElementById(id) {
      if (!fields.has(id)) fields.set(id, { checked: false });
      return fields.get(id);
    } }
  };
  runInNewContext(inlineScript('users'), sandbox);
  const initial = sandbox.getPermissions();
  for (const key of ['dashboard', 'expenses', 'admin', 'users']) assert.equal(initial[key], false);
  sandbox.setPermissions({ dashboard: true, orders: true, inventory: true, expenses: true, admin: true, users: true });
  const granted = sandbox.getPermissions();
  assert.equal(granted.orders, true);
  assert.equal(granted.inventory, true);
  for (const key of ['dashboard', 'expenses', 'admin', 'users']) {
    assert.equal(fields.get(`perm_${key}`).checked, false);
    assert.equal(granted[key], true, 'editing a legacy account must preserve existing grants');
  }
});
