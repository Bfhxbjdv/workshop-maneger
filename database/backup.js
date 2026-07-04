const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const DB_PATH = path.join(__dirname, '..', 'data', 'workshop.db');
const STORAGE_PATH = path.join(__dirname, '..', 'Server_Storage', 'Clients_Archive');
const BACKUP_DIR = path.join(__dirname, '..', 'backups');

function backup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const date = new Date();
  const timestamp = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}_${String(date.getHours()).padStart(2,'0')}-${String(date.getMinutes()).padStart(2,'0')}`;
  const backupName = `backup_${timestamp}`;
  const backupPath = path.join(BACKUP_DIR, backupName);

  fs.mkdirSync(backupPath, { recursive: true });

  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, path.join(backupPath, 'workshop.db'));
  }

  if (fs.existsSync(STORAGE_PATH)) {
    const archiveDest = path.join(backupPath, 'Clients_Archive');
    execSync(`xcopy "${STORAGE_PATH}" "${archiveDest}" /E /I /Q /Y`, { stdio: 'ignore' });
  }

  console.log(`✅ نسخة احتياطية تم إنشاؤها: ${backupName}`);
  return backupPath;
}

if (require.main === module) {
  backup();
  process.exit(0);
}

module.exports = backup;
