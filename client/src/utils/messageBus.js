let messageIdCounter = 0;
let lastMessageSignature = '';
let lastMessageTimestamp = 0;
const listeners = new Set();

const shouldSkipDuplicate = (type, message) => {
  const signature = `${type}:${String(message || '').trim()}`;
  const now = Date.now();
  const isDuplicate = signature === lastMessageSignature && now - lastMessageTimestamp < 800;
  if (isDuplicate) return true;
  lastMessageSignature = signature;
  lastMessageTimestamp = now;
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
