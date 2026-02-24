const ABSOLUTE_URL_PATTERN = /^(https?:)?\/\//i;

export const resolveImageUrl = (value) => {
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

export const hasValidImageUrl = (value) => Boolean(resolveImageUrl(value));

