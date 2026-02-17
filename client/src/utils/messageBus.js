let messageIdCounter = 0;
const recentMessageTimestamps = new Map();
const DUPLICATE_WINDOW_MS = 4000;
const listeners = new Set();

const shouldSkipDuplicate = (type, message) => {
  const signature = `${type}:${String(message || '').trim()}`;
  const now = Date.now();
  const lastSeenAt = Number(recentMessageTimestamps.get(signature) || 0);
  if (lastSeenAt && now - lastSeenAt < DUPLICATE_WINDOW_MS) {
    return true;
  }

  recentMessageTimestamps.set(signature, now);

  // Best-effort cleanup for stale signatures.
  for (const [key, seenAt] of recentMessageTimestamps.entries()) {
    if (now - seenAt > DUPLICATE_WINDOW_MS * 2) {
      recentMessageTimestamps.delete(key);
    }
  }

  return false;
};

const emit = (payload) => {
  listeners.forEach((listener) => listener(payload));
};

export const subscribeMessages = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notify = (type, message, options = {}) => {
  const normalizedMessage = String(message || '').trim();
  if (!normalizedMessage) return null;
  if (shouldSkipDuplicate(type, normalizedMessage)) return null;

  const payload = {
    id: ++messageIdCounter,
    type,
    message: normalizedMessage,
    duration: Number.isFinite(options.duration) ? Number(options.duration) : 3600,
  };

  emit(payload);
  return payload.id;
};

export const notifySuccess = (message, options) => notify('success', message, options);
export const notifyError = (message, options) => notify('error', message, options);
export const notifyInfo = (message, options) => notify('info', message, options);
export const notifyWarning = (message, options) => notify('warning', message, options);
