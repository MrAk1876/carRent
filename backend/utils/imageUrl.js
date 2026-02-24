const ABSOLUTE_URL_PATTERN = /^(https?:)?\/\//i;

const normalizeStoredImageUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (ABSOLUTE_URL_PATTERN.test(raw) || raw.startsWith('data:image/')) {
    return raw;
  }

  if (raw.startsWith('/uploads/')) {
    return raw;
  }

  if (raw.startsWith('uploads/')) {
    return `/${raw}`;
  }

  return '';
};

const isLocalUploadUrl = (value) => normalizeStoredImageUrl(value).startsWith('/uploads/');

module.exports = {
  normalizeStoredImageUrl,
  isLocalUploadUrl,
};

