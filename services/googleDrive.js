const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const stream = require('stream');

let driveClient = null;

function getClient() {
  if (driveClient) return driveClient;
  const keyPath = process.env.GOOGLE_DRIVE_KEY_PATH;
  const keyJson = process.env.GOOGLE_DRIVE_KEY_JSON;

  let credentials;
  if (keyJson) {
    credentials = JSON.parse(keyJson);
  } else if (keyPath && fs.existsSync(keyPath)) {
    credentials = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
  } else {
    return null;
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.file']
  });

  driveClient = google.drive({ version: 'v3', auth });
  return driveClient;
}

async function ensureFolder(parentId, name) {
  const drive = getClient();
  if (!drive) return null;

  const res = await drive.files.list({
    q: `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
    pageSize: 1
  });

  if (res.data.files.length > 0) return res.data.files[0].id;

  const folder = await drive.files.create({
    resource: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id'
  });
  return folder.data.id;
}

async function getTreeFolder(clientName, rootFolderId) {
  const drive = getClient();
  if (!drive) return null;

  const safeName = clientName.replace(/[<>:"\/\\|?*]/g, '_').trim();
  const now = new Date();
  const year = now.getFullYear().toString();
  const month = now.toLocaleString('en', { month: 'long' });

  const clientFolderId = await ensureFolder(rootFolderId, safeName);
  const yearFolderId = await ensureFolder(clientFolderId, year);
  const monthFolderId = await ensureFolder(yearFolderId, month);
  return monthFolderId;
}

async function uploadFile(taskId, clientName, originalName, fileBuffer) {
  const drive = getClient();
  if (!drive) return { error: 'Google Drive غير مهيأ. أضف مفتاح الخدمة.' };

  const rootFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!rootFolderId) return { error: 'يرجى تحديد معرف مجلد Google Drive (GOOGLE_DRIVE_FOLDER_ID)' };

  const folderId = await getTreeFolder(clientName, rootFolderId);
  if (!folderId) return { error: 'فشل إنشاء المجلدات في Google Drive' };

  const ext = path.extname(originalName);
  const baseName = path.basename(originalName, ext);
  const newName = `TaskID_${taskId}_${baseName}${ext}`;

  const bufferStream = new stream.PassThrough();
  bufferStream.end(fileBuffer);

  const res = await drive.files.create({
    requestBody: { name: newName, parents: [folderId] },
    media: { mimeType: 'application/octet-stream', body: bufferStream },
    fields: 'id,name'
  });

  return { fileId: res.data.id, fileName: newName };
}

async function downloadFile(fileId) {
  const drive = getClient();
  if (!drive) return null;

  const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' });
  return res.data;
}

async function deleteFile(fileId) {
  const drive = getClient();
  if (!drive) return false;
  try {
    await drive.files.delete({ fileId });
    return true;
  } catch {
    return false;
  }
}

function isConfigured() {
  return !!(process.env.GOOGLE_DRIVE_KEY_PATH || process.env.GOOGLE_DRIVE_KEY_JSON);
}

module.exports = { uploadFile, downloadFile, deleteFile, isConfigured };
