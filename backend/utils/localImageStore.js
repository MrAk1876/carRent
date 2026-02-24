const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { isLocalUploadUrl } = require('./imageUrl');

const UPLOAD_ROOT = path.resolve(__dirname, '..', 'public', 'uploads');

const MIME_EXTENSION_MAP = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/pjpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/jfif': '.jpg',
};

const sanitizeSubDirectory = (value) => String(value || '')
  .trim()
  .replace(/\\/g, '/')
  .replace(/^\/+|\/+$/g, '')
  .replace(/\.\.+/g, '')
  .toLowerCase();

const inferExtension = (file = {}) => {
  const mime = String(file.mimetype || '').toLowerCase().trim();
  if (MIME_EXTENSION_MAP[mime]) return MIME_EXTENSION_MAP[mime];

  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  if (ext) return ext;
  return '.jpg';
};

const ensureWithinUploadRoot = (absolutePath) => {
  if (!absolutePath.startsWith(UPLOAD_ROOT)) {
    const error = new Error('Invalid upload target path');
    error.statusCode = 400;
    throw error;
  }
};

const saveImageFromBuffer = async (file, options = {}) => {
  if (!file || !file.buffer) {
    const error = new Error('Image file buffer is required');
    error.statusCode = 400;
    throw error;
  }

  const subDirectory = sanitizeSubDirectory(options.subDirectory || 'misc') || 'misc';
  const extension = inferExtension(file);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`;
  const targetDirectory = path.join(UPLOAD_ROOT, subDirectory);
  const targetPath = path.join(targetDirectory, filename);

  ensureWithinUploadRoot(targetPath);
  await fs.mkdir(targetDirectory, { recursive: true });
  await fs.writeFile(targetPath, file.buffer);

  return {
    url: `/uploads/${subDirectory}/${filename}`,
    publicId: '',
    provider: 'local',
  };
};

const deleteLocalImageByUrl = async (urlPath) => {
  if (!isLocalUploadUrl(urlPath)) return false;

  const normalized = String(urlPath).replace(/^\/+/, '');
  const absolutePath = path.resolve(path.join(__dirname, '..', 'public', normalized));
  ensureWithinUploadRoot(absolutePath);

  try {
    await fs.unlink(absolutePath);
    return true;
  } catch (error) {
    if (String(error?.code || '') === 'ENOENT') return false;
    throw error;
  }
};

module.exports = {
  saveImageFromBuffer,
  deleteLocalImageByUrl,
};

