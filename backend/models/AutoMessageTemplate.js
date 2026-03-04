const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const AUTO_MESSAGE_EVENT_KEY = Object.freeze({
  DROP_REMINDER_2H: 'drop_reminder_2h',
  DROP_REMINDER_1H: 'drop_reminder_1h',
  DROP_TIME_EXPIRED: 'drop_time_expired',
  DROP_TIME_COMPLETE: 'drop_time_expired',
  PICKUP_REMINDER: 'pickup_reminder',
  BOOKING_CONFIRMED: 'booking_confirmed',
  BOOKING_COMPLETED: 'booking_completed',
  BOOKING_CANCELLED: 'booking_cancelled',
  PAYMENT_PENDING: 'payment_pending',
});

const AUTO_MESSAGE_EVENT_KEY_VALUES = Object.values(AUTO_MESSAGE_EVENT_KEY);

const autoMessageTemplateSchema = new mongoose.Schema(
  {
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    eventKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
      index: true,
    },
    eventType: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 100,
      default: '',
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    title: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    description: {
      type: String,
      trim: true,
      default: '',
      maxlength: 260,
    },
    messageTemplate: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 4000,
      default: '',
    },
    notificationTitleTemplate: {
      type: String,
      trim: true,
      default: '',
      maxlength: 180,
    },
    smsTemplate: {
      type: String,
      trim: true,
      default: '',
      maxlength: 600,
    },
    emailSubjectTemplate: {
      type: String,
      trim: true,
      default: '',
      maxlength: 180,
    },
    emailTemplate: {
      type: String,
      trim: true,
      default: '',
      maxlength: 5000,
    },
    delivery: {
      inApp: {
        type: Boolean,
        default: true,
      },
      email: {
        type: Boolean,
        default: true,
      },
      sms: {
        type: Boolean,
        default: true,
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    isSystemDefault: {
      type: Boolean,
      default: false,
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

autoMessageTemplateSchema.pre('validate', function normalizeTemplateFields() {
  const normalizeEventType = (value) =>
    String(value || '')
      .trim()
      .toUpperCase()
      .replace(/[\s-]+/g, '_')
      .replace(/[^A-Z0-9_]/g, '');

  const EVENT_KEY_TO_TYPE = Object.freeze({
    [AUTO_MESSAGE_EVENT_KEY.DROP_REMINDER_2H]: 'DROP_REMINDER_2H',
    [AUTO_MESSAGE_EVENT_KEY.DROP_REMINDER_1H]: 'DROP_REMINDER_1H',
    [AUTO_MESSAGE_EVENT_KEY.DROP_TIME_EXPIRED]: 'DROP_TIME_EXPIRED',
    [AUTO_MESSAGE_EVENT_KEY.PICKUP_REMINDER]: 'PICKUP_REMINDER',
    [AUTO_MESSAGE_EVENT_KEY.BOOKING_CONFIRMED]: 'BOOKING_CONFIRMED',
    [AUTO_MESSAGE_EVENT_KEY.BOOKING_COMPLETED]: 'BOOKING_COMPLETED',
    [AUTO_MESSAGE_EVENT_KEY.BOOKING_CANCELLED]: 'BOOKING_CANCELLED',
    [AUTO_MESSAGE_EVENT_KEY.PAYMENT_PENDING]: 'PAYMENT_PENDING',
  });
  const EVENT_TYPE_TO_KEY = Object.freeze(
    Object.entries(EVENT_KEY_TO_TYPE).reduce((acc, [key, type]) => {
      acc[type] = key;
      return acc;
    }, {}),
  );

  const normalizedEventType = normalizeEventType(this.eventType);
  if (!this.eventKey && normalizedEventType) {
    this.eventKey = EVENT_TYPE_TO_KEY[normalizedEventType] || normalizedEventType.toLowerCase();
  }

  this.eventKey = String(this.eventKey || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
  this.eventType = EVENT_KEY_TO_TYPE[this.eventKey] || normalizeEventType(this.eventKey);
  this.name = String(this.name || '').trim();
  if (!this.name && this.title) {
    this.name = String(this.title || '').trim();
  }
  this.title = String(this.title || '').trim() || this.name;
  this.description = String(this.description || '').trim();
  if (!this.messageTemplate && this.message) {
    this.messageTemplate = String(this.message || '').trim();
  }
  this.messageTemplate = String(this.messageTemplate || '').trim();
  this.message = String(this.message || '').trim() || this.messageTemplate;
  this.notificationTitleTemplate = String(this.notificationTitleTemplate || '').trim();
  this.smsTemplate = String(this.smsTemplate || '').trim();
  this.emailSubjectTemplate = String(this.emailSubjectTemplate || '').trim();
  this.emailTemplate = String(this.emailTemplate || '').trim();
  this.delivery = this.delivery || {};
  this.delivery.inApp = Boolean(this.delivery.inApp);
  this.delivery.email = Boolean(this.delivery.email);
  this.delivery.sms = Boolean(this.delivery.sms);
  this.isActive = Boolean(this.isActive);
  this.isSystemDefault = Boolean(this.isSystemDefault);

  if (!this.eventKey) {
    this.invalidate('eventKey', 'Event key is required');
  }
  if (!this.name) {
    this.invalidate('name', 'Template name is required');
  }
  if (!this.messageTemplate) {
    this.invalidate('messageTemplate', 'Message template is required');
  }

  if (!this.notificationTitleTemplate) {
    this.notificationTitleTemplate = this.name;
  }
  if (!this.smsTemplate) {
    this.smsTemplate = this.messageTemplate;
  }
  if (!this.emailSubjectTemplate) {
    this.emailSubjectTemplate = this.name;
  }
  if (!this.emailTemplate) {
    this.emailTemplate = this.messageTemplate;
  }
});

autoMessageTemplateSchema.index({ tenantId: 1, eventKey: 1 }, { unique: true });
autoMessageTemplateSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('AutoMessageTemplate', autoMessageTemplateSchema);
module.exports.AUTO_MESSAGE_EVENT_KEY = AUTO_MESSAGE_EVENT_KEY;
module.exports.AUTO_MESSAGE_EVENT_KEY_VALUES = AUTO_MESSAGE_EVENT_KEY_VALUES;
