const mongoose = require('mongoose');
const AutoMessageTemplate = require('../models/AutoMessageTemplate');
const { AUTO_MESSAGE_EVENT_KEY } = require('../models/AutoMessageTemplate');

const SYSTEM_TEMPLATE_DEFINITIONS = Object.freeze([
  {
    eventKey: AUTO_MESSAGE_EVENT_KEY.DROP_REMINDER_2H,
    name: 'Drop Reminder (2 Hours)',
    description: 'Sent automatically when 2 hours remain before scheduled drop time.',
    messageTemplate:
      'Hi {{userName}}, your return time for {{carName}} is in 2 hours ({{dropTime}}). Please return at {{dropLocation}}. Booking {{bookingId}}.',
    notificationTitleTemplate: '2 hours left to return your car',
    smsTemplate:
      'CarRental: 2h left to return {{carName}}. Drop by {{dropTime}} at {{dropLocation}}. Booking {{bookingId}}.',
    emailSubjectTemplate: 'Reminder: Return your car in 2 hours ({{bookingId}})',
    emailTemplate:
      'Hi {{userName}},\n\nThis is a reminder that your return time for {{carName}} is in 2 hours.\nDrop time: {{dropTime}}\nDrop location: {{dropLocation}}\nBooking ID: {{bookingId}}\n\nThank you,\nCar Rental Team',
    delivery: { inApp: true, email: true, sms: true },
  },
  {
    eventKey: AUTO_MESSAGE_EVENT_KEY.DROP_REMINDER_1H,
    name: 'Drop Reminder (1 Hour)',
    description: 'Sent automatically when 1 hour remains before scheduled drop time.',
    messageTemplate:
      'Hi {{userName}}, only 1 hour left to return {{carName}}. Return by {{dropTime}} at {{dropLocation}} to avoid late penalties. Booking {{bookingId}}.',
    notificationTitleTemplate: '1 hour left to return your car',
    smsTemplate:
      'CarRental: 1h left to return {{carName}} by {{dropTime}} at {{dropLocation}}. Booking {{bookingId}}.',
    emailSubjectTemplate: 'Final reminder: Return your car in 1 hour ({{bookingId}})',
    emailTemplate:
      'Hi {{userName}},\n\nThis is your final 1-hour reminder for returning {{carName}}.\nDrop time: {{dropTime}}\nDrop location: {{dropLocation}}\nBooking ID: {{bookingId}}\n\nPlease return on time to avoid late charges.\nCar Rental Team',
    delivery: { inApp: true, email: true, sms: true },
  },
  {
    eventKey: AUTO_MESSAGE_EVENT_KEY.DROP_TIME_COMPLETE,
    name: 'Drop Time Completed',
    description: 'Sent automatically once drop time is passed and booking is still active.',
    messageTemplate:
      'Hi {{userName}}, your return time for {{carName}} has been completed ({{dropTime}}). Please return immediately at {{dropLocation}}. Booking {{bookingId}}.',
    notificationTitleTemplate: 'Return time completed',
    smsTemplate:
      'CarRental: Return time completed for {{carName}} ({{dropTime}}). Return now at {{dropLocation}}. Booking {{bookingId}}.',
    emailSubjectTemplate: 'Return time completed for booking {{bookingId}}',
    emailTemplate:
      'Hi {{userName}},\n\nYour scheduled return time has passed.\nCar: {{carName}}\nDrop time: {{dropTime}}\nDrop location: {{dropLocation}}\nBooking ID: {{bookingId}}\n\nPlease return the car immediately.\nCar Rental Team',
    delivery: { inApp: true, email: true, sms: true },
  },
  {
    eventKey: AUTO_MESSAGE_EVENT_KEY.BOOKING_CONFIRMED,
    name: 'Booking Confirmed',
    description: 'Template reserved for booking confirmation automation.',
    messageTemplate:
      'Hi {{userName}}, your booking {{bookingId}} for {{carName}} is confirmed.',
    notificationTitleTemplate: 'Booking confirmed',
    smsTemplate:
      'CarRental: Booking {{bookingId}} for {{carName}} is confirmed.',
    emailSubjectTemplate: 'Booking confirmed ({{bookingId}})',
    emailTemplate:
      'Hi {{userName}},\n\nYour booking {{bookingId}} for {{carName}} is confirmed.\nPickup: {{pickupTime}} at {{pickupLocation}}',
    delivery: { inApp: true, email: true, sms: true },
  },
  {
    eventKey: AUTO_MESSAGE_EVENT_KEY.BOOKING_COMPLETED,
    name: 'Booking Completed',
    description: 'Template reserved for booking completion automation.',
    messageTemplate:
      'Hi {{userName}}, booking {{bookingId}} for {{carName}} is completed.',
    notificationTitleTemplate: 'Booking completed',
    smsTemplate:
      'CarRental: Booking {{bookingId}} completed.',
    emailSubjectTemplate: 'Booking completed ({{bookingId}})',
    emailTemplate:
      'Hi {{userName}},\n\nYour booking {{bookingId}} for {{carName}} has been completed.',
    delivery: { inApp: true, email: true, sms: true },
  },
  {
    eventKey: AUTO_MESSAGE_EVENT_KEY.BOOKING_CANCELLED,
    name: 'Booking Cancelled',
    description: 'Template reserved for booking cancellation automation.',
    messageTemplate:
      'Hi {{userName}}, booking {{bookingId}} for {{carName}} has been cancelled.',
    notificationTitleTemplate: 'Booking cancelled',
    smsTemplate:
      'CarRental: Booking {{bookingId}} has been cancelled.',
    emailSubjectTemplate: 'Booking cancelled ({{bookingId}})',
    emailTemplate:
      'Hi {{userName}},\n\nYour booking {{bookingId}} for {{carName}} has been cancelled.',
    delivery: { inApp: true, email: true, sms: true },
  },
  {
    eventKey: AUTO_MESSAGE_EVENT_KEY.PAYMENT_PENDING,
    name: 'Payment Pending',
    description: 'Template reserved for pending payment automation.',
    messageTemplate:
      'Hi {{userName}}, payment is pending for booking {{bookingId}}.',
    notificationTitleTemplate: 'Payment pending',
    smsTemplate:
      'CarRental: Payment pending for booking {{bookingId}}.',
    emailSubjectTemplate: 'Payment pending ({{bookingId}})',
    emailTemplate:
      'Hi {{userName}},\n\nPayment is pending for booking {{bookingId}}. Please complete payment to avoid cancellation.',
    delivery: { inApp: true, email: true, sms: true },
  },
]);

const SYSTEM_TEMPLATE_BY_EVENT = Object.freeze(
  SYSTEM_TEMPLATE_DEFINITIONS.reduce((acc, item) => {
    acc[item.eventKey] = item;
    return acc;
  }, {}),
);

const DEFAULT_DELIVERY = Object.freeze({
  inApp: true,
  email: true,
  sms: true,
});
const SEEDED_TENANT_CACHE = new Set();

const createAutoMessageTemplateError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const normalizeText = (value) => String(value || '').trim();
const toObjectIdString = (value) => normalizeText(value);

const ensureObjectId = (value, fieldName) => {
  const normalized = toObjectIdString(value);
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    throw createAutoMessageTemplateError(400, `Invalid ${fieldName}`);
  }
  return normalized;
};

const normalizeEventKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

const normalizeDelivery = (value) => {
  const source = value && typeof value === 'object' ? value : {};
  return {
    inApp: source.inApp !== undefined ? Boolean(source.inApp) : DEFAULT_DELIVERY.inApp,
    email: source.email !== undefined ? Boolean(source.email) : DEFAULT_DELIVERY.email,
    sms: source.sms !== undefined ? Boolean(source.sms) : DEFAULT_DELIVERY.sms,
  };
};

const sanitizePayload = (payload, options = {}) => {
  const source = payload && typeof payload === 'object' ? payload : {};
  const requireEventKey = options.requireEventKey === true;

  const eventKey = normalizeEventKey(source.eventKey);
  if (requireEventKey && !eventKey) {
    throw createAutoMessageTemplateError(422, 'eventKey is required');
  }

  const name = normalizeText(source.name);
  if (!name) {
    throw createAutoMessageTemplateError(422, 'name is required');
  }

  const messageTemplate = normalizeText(source.messageTemplate);
  if (!messageTemplate) {
    throw createAutoMessageTemplateError(422, 'messageTemplate is required');
  }

  const description = normalizeText(source.description);
  const notificationTitleTemplate = normalizeText(source.notificationTitleTemplate) || name;
  const smsTemplate = normalizeText(source.smsTemplate) || messageTemplate;
  const emailSubjectTemplate = normalizeText(source.emailSubjectTemplate) || name;
  const emailTemplate = normalizeText(source.emailTemplate) || messageTemplate;
  const delivery = normalizeDelivery(source.delivery);

  return {
    ...(eventKey ? { eventKey } : {}),
    name,
    description,
    messageTemplate,
    notificationTitleTemplate,
    smsTemplate,
    emailSubjectTemplate,
    emailTemplate,
    delivery,
    isActive: source.isActive === undefined ? true : Boolean(source.isActive),
  };
};

const toPublicTemplate = (doc) => {
  const entry = doc && typeof doc.toObject === 'function' ? doc.toObject() : doc || {};
  return {
    _id: toObjectIdString(entry._id),
    tenantId: toObjectIdString(entry.tenantId),
    eventKey: normalizeEventKey(entry.eventKey),
    name: normalizeText(entry.name),
    description: normalizeText(entry.description),
    messageTemplate: normalizeText(entry.messageTemplate),
    notificationTitleTemplate: normalizeText(entry.notificationTitleTemplate),
    smsTemplate: normalizeText(entry.smsTemplate),
    emailSubjectTemplate: normalizeText(entry.emailSubjectTemplate),
    emailTemplate: normalizeText(entry.emailTemplate),
    delivery: normalizeDelivery(entry.delivery),
    isActive: Boolean(entry.isActive),
    isSystemDefault: Boolean(entry.isSystemDefault),
    createdBy: toObjectIdString(entry.createdBy),
    updatedBy: toObjectIdString(entry.updatedBy),
    createdAt: entry.createdAt || null,
    updatedAt: entry.updatedAt || null,
  };
};

const ensureSystemTemplates = async (tenantId, options = {}) => {
  const normalizedTenantId = ensureObjectId(tenantId, 'tenant id');
  const skipCache = options.skipCache === true;
  if (!skipCache && SEEDED_TENANT_CACHE.has(normalizedTenantId)) {
    return 0;
  }
  const createdBy = toObjectIdString(options.userId);

  const existing = await AutoMessageTemplate.find({
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
    eventKey: { $in: SYSTEM_TEMPLATE_DEFINITIONS.map((entry) => entry.eventKey) },
  })
    .setOptions({ skipTenantFilter: true })
    .select('eventKey')
    .lean();

  const existingKeys = new Set((existing || []).map((entry) => normalizeEventKey(entry?.eventKey)));
  const missingTemplates = SYSTEM_TEMPLATE_DEFINITIONS.filter(
    (entry) => !existingKeys.has(normalizeEventKey(entry.eventKey)),
  );

  if (missingTemplates.length === 0) {
    SEEDED_TENANT_CACHE.add(normalizedTenantId);
    return 0;
  }

  const docs = missingTemplates.map((entry) => ({
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
    eventKey: entry.eventKey,
    name: entry.name,
    description: entry.description,
    messageTemplate: entry.messageTemplate,
    notificationTitleTemplate: entry.notificationTitleTemplate,
    smsTemplate: entry.smsTemplate,
    emailSubjectTemplate: entry.emailSubjectTemplate,
    emailTemplate: entry.emailTemplate,
    delivery: normalizeDelivery(entry.delivery),
    isActive: true,
    isSystemDefault: true,
    createdBy: createdBy && mongoose.Types.ObjectId.isValid(createdBy) ? new mongoose.Types.ObjectId(createdBy) : null,
    updatedBy: createdBy && mongoose.Types.ObjectId.isValid(createdBy) ? new mongoose.Types.ObjectId(createdBy) : null,
  }));

  try {
    await AutoMessageTemplate.insertMany(docs, { ordered: false });
    SEEDED_TENANT_CACHE.add(normalizedTenantId);
    return docs.length;
  } catch (error) {
    if (Number(error?.code) === 11000) {
      SEEDED_TENANT_CACHE.add(normalizedTenantId);
      return 0;
    }
    throw error;
  }
};

const listAutoMessageTemplates = async (tenantId, options = {}) => {
  const normalizedTenantId = ensureObjectId(tenantId, 'tenant id');
  await ensureSystemTemplates(normalizedTenantId, options);

  const rows = await AutoMessageTemplate.find({
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
  })
    .setOptions({ skipTenantFilter: true })
    .sort({ isSystemDefault: -1, name: 1, createdAt: 1 });

  return rows.map(toPublicTemplate);
};

const createAutoMessageTemplate = async (tenantId, userId, payload) => {
  const normalizedTenantId = ensureObjectId(tenantId, 'tenant id');
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const sanitized = sanitizePayload(payload, { requireEventKey: true });

  const duplicate = await AutoMessageTemplate.findOne({
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
    eventKey: sanitized.eventKey,
  })
    .setOptions({ skipTenantFilter: true })
    .select('_id')
    .lean();

  if (duplicate?._id) {
    throw createAutoMessageTemplateError(409, 'eventKey already exists for this tenant');
  }

  const created = await AutoMessageTemplate.create({
    ...sanitized,
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
    isSystemDefault: false,
    createdBy: new mongoose.Types.ObjectId(normalizedUserId),
    updatedBy: new mongoose.Types.ObjectId(normalizedUserId),
  });

  return toPublicTemplate(created);
};

const updateAutoMessageTemplate = async (templateId, tenantId, userId, payload) => {
  const normalizedTemplateId = ensureObjectId(templateId, 'template id');
  const normalizedTenantId = ensureObjectId(tenantId, 'tenant id');
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const sanitized = sanitizePayload(payload, { requireEventKey: false });

  const template = await AutoMessageTemplate.findOne({
    _id: new mongoose.Types.ObjectId(normalizedTemplateId),
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
  }).setOptions({ skipTenantFilter: true });

  if (!template) {
    throw createAutoMessageTemplateError(404, 'Template not found');
  }

  template.name = sanitized.name;
  template.description = sanitized.description;
  template.messageTemplate = sanitized.messageTemplate;
  template.notificationTitleTemplate = sanitized.notificationTitleTemplate;
  template.smsTemplate = sanitized.smsTemplate;
  template.emailSubjectTemplate = sanitized.emailSubjectTemplate;
  template.emailTemplate = sanitized.emailTemplate;
  template.delivery = sanitized.delivery;
  template.isActive = sanitized.isActive;
  template.updatedBy = new mongoose.Types.ObjectId(normalizedUserId);

  await template.save();
  return toPublicTemplate(template);
};

const deleteAutoMessageTemplate = async (templateId, tenantId) => {
  const normalizedTemplateId = ensureObjectId(templateId, 'template id');
  const normalizedTenantId = ensureObjectId(tenantId, 'tenant id');

  const template = await AutoMessageTemplate.findOne({
    _id: new mongoose.Types.ObjectId(normalizedTemplateId),
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
  }).setOptions({ skipTenantFilter: true });

  if (!template) {
    throw createAutoMessageTemplateError(404, 'Template not found');
  }

  if (template.isSystemDefault) {
    throw createAutoMessageTemplateError(422, 'System default templates cannot be deleted');
  }

  await template.deleteOne();
  return toPublicTemplate(template);
};

const escapeHtml = (value) =>
  String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const renderTemplateText = (template, context = {}) =>
  String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, token) => {
    const value = context[token];
    return value === undefined || value === null ? '' : String(value);
  });

const toHtmlFromText = (value) =>
  `<div style="font-family: Arial, sans-serif; line-height: 1.55;">${escapeHtml(value).replace(/\n/g, '<br/>')}</div>`;

const resolveTemplateForEvent = async (tenantId, eventKey, options = {}) => {
  const normalizedTenantId = ensureObjectId(tenantId, 'tenant id');
  const normalizedEventKey = normalizeEventKey(eventKey);
  if (!normalizedEventKey) {
    throw createAutoMessageTemplateError(422, 'eventKey is required');
  }

  await ensureSystemTemplates(normalizedTenantId, options);

  const template = await AutoMessageTemplate.findOne({
    tenantId: new mongoose.Types.ObjectId(normalizedTenantId),
    eventKey: normalizedEventKey,
  })
    .setOptions({ skipTenantFilter: true })
    .lean();

  if (template) {
    return toPublicTemplate(template);
  }

  const fallback = SYSTEM_TEMPLATE_BY_EVENT[normalizedEventKey];
  if (!fallback) {
    return null;
  }

  return {
    _id: '',
    tenantId: normalizedTenantId,
    eventKey: normalizedEventKey,
    name: fallback.name,
    description: fallback.description,
    messageTemplate: fallback.messageTemplate,
    notificationTitleTemplate: fallback.notificationTitleTemplate,
    smsTemplate: fallback.smsTemplate,
    emailSubjectTemplate: fallback.emailSubjectTemplate,
    emailTemplate: fallback.emailTemplate,
    delivery: normalizeDelivery(fallback.delivery),
    isActive: true,
    isSystemDefault: true,
    createdBy: '',
    updatedBy: '',
    createdAt: null,
    updatedAt: null,
  };
};

const renderAutoMessageForEvent = async (tenantId, eventKey, context = {}, options = {}) => {
  const template = await resolveTemplateForEvent(tenantId, eventKey, options);
  if (!template) {
    return null;
  }

  const messageText = renderTemplateText(template.messageTemplate, context);
  const notificationTitle = renderTemplateText(template.notificationTitleTemplate, context) || template.name;
  const smsText = renderTemplateText(template.smsTemplate, context) || messageText;
  const emailSubject = renderTemplateText(template.emailSubjectTemplate, context) || template.name;
  const emailText = renderTemplateText(template.emailTemplate, context) || messageText;

  return {
    ...template,
    messageText,
    notificationTitle,
    smsText,
    emailSubject,
    emailText,
    emailHtml: toHtmlFromText(emailText),
  };
};

module.exports = {
  AUTO_MESSAGE_EVENT_KEY,
  SYSTEM_TEMPLATE_DEFINITIONS,
  createAutoMessageTemplateError,
  normalizeEventKey,
  ensureSystemTemplates,
  listAutoMessageTemplates,
  createAutoMessageTemplate,
  updateAutoMessageTemplate,
  deleteAutoMessageTemplate,
  resolveTemplateForEvent,
  renderAutoMessageForEvent,
};
