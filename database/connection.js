const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'workshop.db');
let db = null;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA journal_mode=WAL');
  db.run('PRAGMA foreign_keys=ON');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

function query(sql, params = []) {
  const stmt = db.prepare(sql);
  const results = [];
  if (sql.trim().toUpperCase().startsWith('SELECT') || sql.trim().toUpperCase().startsWith('WITH') || sql.trim().toUpperCase().startsWith('PRAGMA')) {
    stmt.bind(params);
    while (stmt.step()) results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function run(sql, params = []) {
  db.run(sql, params);
  const lastId = db.exec("SELECT last_insert_rowid() as id");
  const changes = db.getRowsModified();
  saveDb();
  return { changes, lastId: lastId.length > 0 ? lastId[0].values[0][0] : null };
}

function get(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

function all(sql, params = []) {
  return query(sql, params);
}

function exec(sql) {
  db.exec(sql);
  saveDb();
}

function close() {
  if (db) { saveDb(); db.close(); db = null; }
}

let idCounter = Date.now();
function nextId() { return ++idCounter; }

module.exports = { getDb, saveDb, query, run, get, all, exec, close, nextId };
