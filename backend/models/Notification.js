const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const NOTIFICATION_TYPE = Object.freeze({
  MESSAGE: 'message',
  REMINDER: 'reminder',
  BOOKING: 'booking',
  SYSTEM: 'system',
});

const NOTIFICATION_TYPE_VALUES = Object.values(NOTIFICATION_TYPE);

const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: NOTIFICATION_TYPE_VALUES,
      default: NOTIFICATION_TYPE.SYSTEM,
      index: true,
    },
    referenceId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1600,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

notificationSchema.pre('validate', function normalizeNotificationFields() {
  this.type = String(this.type || NOTIFICATION_TYPE.SYSTEM).trim().toLowerCase();
  this.title = String(this.title || '').trim();
  this.body = String(this.body || '').trim();

  if (!this.title) {
    this.invalidate('title', 'Notification title is required');
  }

  if (!this.body) {
    this.invalidate('body', 'Notification body is required');
  }
});

notificationSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });
notificationSchema.index({ tenantId: 1, userId: 1, isRead: 1, createdAt: -1 });

notificationSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Notification', notificationSchema);
module.exports.NOTIFICATION_TYPE = NOTIFICATION_TYPE;
module.exports.NOTIFICATION_TYPE_VALUES = NOTIFICATION_TYPE_VALUES;
