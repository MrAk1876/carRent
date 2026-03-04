const {
  AUTO_MESSAGE_EVENT_KEY,
  createAutoMessageTemplateError,
  listAutoMessageTemplates,
  createAutoMessageTemplate,
  updateAutoMessageTemplate,
  deleteAutoMessageTemplate,
  renderAutoMessageForEvent,
} = require('./autoMessageTemplateService');

const AUTO_MESSAGE_EVENT_TYPE = Object.freeze({
  DROP_REMINDER_2H: 'DROP_REMINDER_2H',
  DROP_REMINDER_1H: 'DROP_REMINDER_1H',
  DROP_TIME_EXPIRED: 'DROP_TIME_EXPIRED',
  PICKUP_REMINDER: 'PICKUP_REMINDER',
});

const EVENT_TYPE_TO_KEY = Object.freeze({
  [AUTO_MESSAGE_EVENT_TYPE.DROP_REMINDER_2H]: AUTO_MESSAGE_EVENT_KEY.DROP_REMINDER_2H,
  [AUTO_MESSAGE_EVENT_TYPE.DROP_REMINDER_1H]: AUTO_MESSAGE_EVENT_KEY.DROP_REMINDER_1H,
  [AUTO_MESSAGE_EVENT_TYPE.DROP_TIME_EXPIRED]: AUTO_MESSAGE_EVENT_KEY.DROP_TIME_EXPIRED,
  [AUTO_MESSAGE_EVENT_TYPE.PICKUP_REMINDER]: AUTO_MESSAGE_EVENT_KEY.PICKUP_REMINDER,
  BOOKING_CONFIRMED: AUTO_MESSAGE_EVENT_KEY.BOOKING_CONFIRMED,
  BOOKING_COMPLETED: AUTO_MESSAGE_EVENT_KEY.BOOKING_COMPLETED,
  BOOKING_CANCELLED: AUTO_MESSAGE_EVENT_KEY.BOOKING_CANCELLED,
  PAYMENT_PENDING: AUTO_MESSAGE_EVENT_KEY.PAYMENT_PENDING,
});

const EVENT_KEY_TO_TYPE = Object.freeze(
  Object.entries(EVENT_TYPE_TO_KEY).reduce((acc, [eventType, eventKey]) => {
    if (!acc[eventKey]) {
      acc[eventKey] = eventType;
    }
    return acc;
  }, {}),
);

const normalizeText = (value) => String(value || '').trim();

const normalizeEventType = (value) =>
  normalizeText(value)
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^A-Z0-9_]/g, '');

const normalizeEventKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const normalizeEventKeyAlias = (eventKey) => {
  const normalized = normalizeEventKey(eventKey);
  if (normalized === 'drop_time_complete') {
    return AUTO_MESSAGE_EVENT_KEY.DROP_TIME_EXPIRED;
  }
  return normalized;
};

const toEventKey = (eventTypeOrKey) => {
  const normalizedType = normalizeEventType(eventTypeOrKey);
  if (normalizedType && EVENT_TYPE_TO_KEY[normalizedType]) {
    return EVENT_TYPE_TO_KEY[normalizedType];
  }
  return normalizeEventKeyAlias(eventTypeOrKey);
};

const toEventType = (eventKeyOrType) => {
  const normalizedType = normalizeEventType(eventKeyOrType);
  if (normalizedType && EVENT_TYPE_TO_KEY[normalizedType]) {
    return normalizedType;
  }
  const normalizedKey = normalizeEventKeyAlias(eventKeyOrType);
  return EVENT_KEY_TO_TYPE[normalizedKey] || normalizeEventType(normalizedKey);
};

const toAutoMessagePayload = (payload = {}, options = {}) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const eventType = toEventType(source.eventType || source.eventKey);
  const eventKey = toEventKey(source.eventType || source.eventKey);

  if (options.requireEventType && !eventType) {
    throw createAutoMessageTemplateError(422, 'eventType is required');
  }
  if (options.requireEventType && !eventKey) {
    throw createAutoMessageTemplateError(422, 'eventType is invalid');
  }

  const title = normalizeText(source.title || source.name);
  const message = String(source.message || source.messageTemplate || '').trim();

  if (!title) {
    throw createAutoMessageTemplateError(422, 'title is required');
  }
  if (!message) {
    throw createAutoMessageTemplateError(422, 'message is required');
  }

  const notificationTitleTemplate = normalizeText(source.notificationTitleTemplate) || title;

  return {
    ...(eventKey ? { eventKey } : {}),
    ...(eventType ? { eventType } : {}),
    title,
    name: title,
    description: normalizeText(source.description),
    message,
    messageTemplate: message,
    notificationTitleTemplate,
    smsTemplate: String(source.smsTemplate || '').trim() || message,
    emailSubjectTemplate: String(source.emailSubjectTemplate || '').trim() || title,
    emailTemplate: String(source.emailTemplate || '').trim() || message,
    isActive: source.isActive === undefined ? true : Boolean(source.isActive),
    delivery: {
      inApp: source?.delivery?.inApp === undefined ? true : Boolean(source.delivery.inApp),
      email: source?.delivery?.email === undefined ? true : Boolean(source.delivery.email),
      sms: source?.delivery?.sms === undefined ? true : Boolean(source.delivery.sms),
    },
  };
};

const toPublicAutoMessage = (entry = {}) => ({
  _id: normalizeText(entry._id),
  tenantId: normalizeText(entry.tenantId),
  eventType: toEventType(entry.eventType || entry.eventKey),
  eventKey: toEventKey(entry.eventType || entry.eventKey),
  title: normalizeText(entry.title || entry.name),
  name: normalizeText(entry.name || entry.title),
  description: normalizeText(entry.description),
  message: String(entry.message || entry.messageTemplate || '').trim(),
  messageTemplate: String(entry.messageTemplate || entry.message || '').trim(),
  notificationTitleTemplate: normalizeText(entry.notificationTitleTemplate),
  smsTemplate: String(entry.smsTemplate || '').trim(),
  emailSubjectTemplate: normalizeText(entry.emailSubjectTemplate),
  emailTemplate: String(entry.emailTemplate || '').trim(),
  isActive: Boolean(entry.isActive),
  isSystemDefault: Boolean(entry.isSystemDefault),
  delivery: {
    inApp: entry?.delivery?.inApp === undefined ? true : Boolean(entry.delivery.inApp),
    email: entry?.delivery?.email === undefined ? true : Boolean(entry.delivery.email),
    sms: entry?.delivery?.sms === undefined ? true : Boolean(entry.delivery.sms),
  },
  createdAt: entry.createdAt || null,
  updatedAt: entry.updatedAt || null,
});

const getAutoMessages = async (tenantId, options = {}) => {
  const rows = await listAutoMessageTemplates(tenantId, options);
  return rows.map(toPublicAutoMessage);
};

const createAutoMessage = async (tenantId, userId, payload = {}) => {
  const template = await createAutoMessageTemplate(
    tenantId,
    userId,
    toAutoMessagePayload(payload, { requireEventType: true }),
  );
  return toPublicAutoMessage(template);
};

const updateAutoMessage = async (templateId, tenantId, userId, payload = {}) => {
  const template = await updateAutoMessageTemplate(
    templateId,
    tenantId,
    userId,
    toAutoMessagePayload(payload, { requireEventType: false }),
  );
  return toPublicAutoMessage(template);
};

const deleteAutoMessage = async (templateId, tenantId) => {
  const template = await deleteAutoMessageTemplate(templateId, tenantId);
  return toPublicAutoMessage(template);
};

const renderAutoMessageByEventType = async (tenantId, eventType, context = {}, options = {}) => {
  const eventKey = toEventKey(eventType);
  if (!eventKey) {
    throw createAutoMessageTemplateError(422, 'eventType is required');
  }
  const rendered = await renderAutoMessageForEvent(tenantId, eventKey, context, options);
  if (!rendered) return null;
  return {
    ...rendered,
    eventType: toEventType(rendered.eventType || rendered.eventKey || eventType),
    eventKey: toEventKey(rendered.eventType || rendered.eventKey || eventType),
  };
};

module.exports = {
  AUTO_MESSAGE_EVENT_TYPE,
  toEventKey,
  toEventType,
  toPublicAutoMessage,
  getAutoMessages,
  createAutoMessage,
  updateAutoMessage,
  deleteAutoMessage,
  renderAutoMessageByEventType,
  createAutoMessageError: createAutoMessageTemplateError,
};
