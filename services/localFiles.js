const fs = require('fs');
const path = require('path');

const storageRoot = path.resolve(__dirname, '..', 'Server_Storage');
const archiveRoot = path.join(storageRoot, 'Clients_Archive');
const imageRoot = path.join(storageRoot, 'Agent_Images');
const customDesignRoot = path.join(storageRoot, 'Custom_Designs');

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

// Older library records contain absolute paths; ordinary order files are relative.
function resolveLocalFile(filePath, roots = [archiveRoot, imageRoot, customDesignRoot], base = archiveRoot) {
  if (typeof filePath !== 'string' || !filePath || filePath.includes('\0') || filePath.includes('://')) return null;
  const candidate = path.resolve(base, filePath);
  if (!roots.some(root => inside(root, candidate))) return null;
  try {
    const real = fs.realpathSync(candidate);
    if (!roots.filter(root => inside(root, candidate)).some(root => inside(fs.realpathSync(root), real)) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

function resolveLibraryImage(image) {
  return resolveLocalFile(image.File_Path, [imageRoot], imageRoot) ||
    (image.Stored_Name && path.basename(image.Stored_Name) === image.Stored_Name
      ? resolveLocalFile(image.Stored_Name, [imageRoot], imageRoot) : null);
}

function imageHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
}

module.exports = { resolveLocalFile, resolveLibraryImage, imageHeaders };
