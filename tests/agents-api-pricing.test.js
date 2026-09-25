const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const initSqlJs = require('sql.js');

function d1(database) {
  const prepare = (sql, values = []) => ({
    bind(...parameters) { return prepare(sql, parameters); },
    async first() { return this.all().then(result => result.results[0] || null); },
    async all() {
      const statement = database.prepare(sql);
      statement.bind(values);
      const results = [];
      while (statement.step()) results.push(statement.getAsObject());
      statement.free();
      return { results };
    },
    async run() {
      const statement = database.prepare(sql);
      statement.bind(values);
      statement.step();
      statement.free();
      return { meta: { last_row_id: database.exec('SELECT last_insert_rowid()')[0].values[0][0] } };
    }
  });
  return { prepare };
}

test('agent summaries count each order price and commission once, regardless of sheet count', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  const migrationDirectory = path.join(__dirname, '..', 'cloudflare', 'migrations');
  database.exec(fs.readFileSync(path.join(migrationDirectory, '0001_initial.sql'), 'utf8'));
  database.exec(fs.readFileSync(path.join(migrationDirectory, '0002_agent_profile_banking.sql'), 'utf8'));
  database.run("INSERT INTO Users (Name,Role,Username,Password) VALUES ('وكيل','Agent','agent','test')");
  database.run("INSERT INTO Agent_Profiles (User_ID,Status) VALUES (1,'active')");
  database.run("INSERT INTO Clients (Full_Name,Created_By,Agent_ID) VALUES ('عميل',1,1)");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status,Material_Qty,Final_Price,Agent_Commission) VALUES (1,1,'Laser','قيد التصميم','approved',20,150,30)");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status,Material_Qty,Final_Price,Agent_Commission) VALUES (1,1,'Laser','قيد التصميم','approved',5,200,40)");
  database.exec(fs.readFileSync(path.join(migrationDirectory, '0003_backfill_agent_commissions.sql'), 'utf8'));
  database.run("UPDATE Agent_Commissions SET Status='approved'");

  const { handleAgentsApi } = await import('../cloudflare/src/agents-api.mjs');
  const env = { DB: d1(database) };
  const admin = { User_ID: 2, Role: 'Admin' };
  async function get(apiPath) {
    const url = new URL(`https://example.test${apiPath}`);
    const response = await handleAgentsApi(new Request(url), env, admin, url.pathname, url);
    assert.equal(response.status, 200);
    return response.json();
  }

  const listing = await get('/api/agents');
  assert.equal(listing.agents[0].Total_Revenue, 350);
  assert.equal(listing.agents[0].Total_Commission, 70);
  assert.equal(listing.summary.totalRevenue, 350);
  assert.equal(listing.summary.totalCommission, 70);

  const detail = await get('/api/agents/1');
  assert.equal(detail.stats.Total_Revenue, 350);
  assert.equal(detail.stats.Total_Commission, 70);
  const charts = await get('/api/agents/1/stats');
  assert.equal(charts.dailyStats[0].revenue, 350);
  assert.equal(charts.dailyStats[0].commission, 70);
  assert.equal(charts.topClients[0].order_value, 350);
  const clients = await get('/api/agents/1/clients');
  assert.equal(clients.clients[0].order_value, 350);
});

test('agent client order value excludes rejected orders and orders placed by other users', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  const migrationDirectory = path.join(__dirname, '..', 'cloudflare', 'migrations');
  database.exec(fs.readFileSync(path.join(migrationDirectory, '0001_initial.sql'), 'utf8'));
  database.run("INSERT INTO Users (Name,Role,Username,Password) VALUES ('وكيل أول','Agent','agent-one','test'),('وكيل ثان','Agent','agent-two','test')");
  database.run("INSERT INTO Agent_Profiles (User_ID,Status) VALUES (1,'active'),(2,'active')");
  database.run("INSERT INTO Clients (Full_Name,Created_By,Agent_ID) VALUES ('عميل مشترك',1,1)");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status,Material_Qty,Final_Price,Agent_Commission) VALUES (1,1,'Laser','قيد التصميم','approved',1,23,5)");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status,Material_Qty,Final_Price,Agent_Commission) VALUES (1,1,'Laser','مرفوض','rejected',2,23,7)");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status,Material_Qty,Final_Price,Agent_Commission) VALUES (1,1,'Laser','مرفوض','approved',3,23,11)");
  database.run("INSERT INTO Orders (Client_ID,Created_By,Machine_Type,Status,Approval_Status,Material_Qty,Final_Price,Agent_Commission) VALUES (1,2,'Laser','قيد التصميم','approved',4,23,13)");

  const { handleAgentsApi } = await import('../cloudflare/src/agents-api.mjs');
  const env = { DB: d1(database) };
  const admin = { User_ID: 10, Role: 'Admin' };
  async function get(apiPath) {
    const url = new URL(`https://example.test${apiPath}`);
    const response = await handleAgentsApi(new Request(url), env, admin, url.pathname, url);
    assert.equal(response.status, 200);
    return response.json();
  }

  const charts = await get('/api/agents/1/stats');
  assert.equal(charts.dailyStats[0].orders_count, 3);
  assert.equal(charts.dailyStats[0].total_sheets, 1);
  assert.equal(charts.dailyStats[0].revenue, 23);
  assert.equal(charts.dailyStats[0].commission, 5);
  assert.equal(charts.monthlyComparison[0].orders, 3);
  assert.equal(charts.monthlyComparison[0].revenue, 23);
  assert.equal(charts.monthlyComparison[0].commission, 5);
  assert.equal(charts.statusBreakdown.reduce((sum, row) => sum + row.count, 0), 3);
  assert.equal(charts.topClients[0].order_count, 3);
  assert.equal(charts.topClients[0].order_value, 23);
  const clients = await get('/api/agents/1/clients');
  assert.equal(clients.clients[0].order_count, 3);
  assert.equal(clients.clients[0].order_value, 23);
});

test('admin can create, edit, filter and remove an agent profile with its banking fields', async () => {
  const SQL = await initSqlJs();
  const database = new SQL.Database();
  const migrationDirectory = path.join(__dirname, '..', 'cloudflare', 'migrations');
  database.exec(fs.readFileSync(path.join(migrationDirectory, '0001_initial.sql'), 'utf8'));
  database.exec(fs.readFileSync(path.join(migrationDirectory, '0002_agent_profile_banking.sql'), 'utf8'));
  const { handleAgentsApi } = await import('../cloudflare/src/agents-api.mjs');
  const env = { DB: d1(database) };
  const admin = { User_ID: 100, Role: 'Admin' };
  async function call(apiPath, method = 'GET', body) {
    const url = new URL(`https://example.test${apiPath}`);
    const response = await handleAgentsApi(new Request(url, {
      method,
      ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
    }), env, admin, url.pathname, url);
    return { status: response.status, body: await response.json() };
  }

  const created = await call('/api/agents', 'POST', {
    Name: 'وكيل جديد', Username: 'new-agent', Password: 'test-password',
    Commission_Rate: 10, Bank_Account: '1234', IBAN: 'SY123', Tax_Number: 'VAT-1', Status: 'active'
  });
  assert.equal(created.status, 201);
  const agentId = created.body.agent_id;
  const initial = await call(`/api/agents/${agentId}`);
  assert.equal(initial.body.agent.Commission_Rate, 0.1);
  assert.equal(initial.body.agent.IBAN, 'SY123');

  const updated = await call(`/api/agents/${agentId}`, 'PUT', {
    Name: 'وكيل معدل', Username: 'renamed-agent', Commission_Rate: 15,
    Bank_Account: '9876', IBAN: 'SY999', Tax_Number: 'VAT-2', Status: 'inactive'
  });
  assert.equal(updated.status, 200);
  const filtered = await call('/api/agents?status=inactive');
  assert.equal(filtered.body.agents[0].Name, 'وكيل معدل');
  assert.equal(filtered.body.agents[0].Commission_Rate, 0.15);

  const removed = await call(`/api/agents/${agentId}`, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal((await call('/api/agents')).body.agents.length, 0);
});
