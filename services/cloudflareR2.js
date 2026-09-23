const fs = require('fs');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

// R2 exposes an S3-compatible API. Keeping this behind a small service lets
// the application continue to read old local records while new uploads use
// durable object storage as soon as the environment variables are supplied.
const accountId = process.env.CLOUDFLARE_R2_ACCOUNT_ID;
const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
const bucket = process.env.CLOUDFLARE_R2_BUCKET;

const configured = Boolean(accountId && accessKeyId && secretAccessKey && bucket);
const client = configured ? new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey }
}) : null;

function keyFor(taskId, storedName, type = 'orders') {
  const safeName = String(storedName || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${type}/task-${Number(taskId) || 'unknown'}/${safeName}`;
}

function isR2Path(filePath) {
  return typeof filePath === 'string' && filePath.startsWith('r2://');
}

function keyFromPath(filePath) {
  return isR2Path(filePath) ? filePath.slice(5) : null;
}

async function uploadLocalFile(key, localPath, contentType) {
  if (!configured) return null;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: fs.createReadStream(localPath),
    ContentType: contentType || 'application/octet-stream'
  }));
  return `r2://${key}`;
}

async function getStream(filePath) {
  const key = keyFromPath(filePath);
  if (!configured || !key) return null;
  const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  return result.Body || null;
}

async function remove(filePath) {
  const key = keyFromPath(filePath);
  if (!configured || !key) return false;
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  return true;
}

module.exports = { configured, isR2Path, keyFor, uploadLocalFile, getStream, remove };
