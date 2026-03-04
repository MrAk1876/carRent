const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const { NOTIFICATION_TYPE_VALUES } = require('../models/Notification');
const User = require('../models/User');
const { emitNotificationNew, emitUnreadUpdate } = require('../socket');
const { sendPushNotification } = require('./pushNotificationService');

const DEFAULT_NOTIFICATION_LIMIT = 50;
const MAX_NOTIFICATION_LIMIT = 200;

const createNotificationError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toObjectIdString = (value) => String(value || '').trim();

const ensureObjectId = (value, fieldName) => {
  const normalized = toObjectIdString(value);
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    throw createNotificationError(400, `Invalid ${fieldName}`);
  }
  return normalized;
};

const toOptionalObjectId = (value) => {
  const normalized = toObjectIdString(value);
  if (!normalized) return null;
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    throw createNotificationError(400, 'Invalid notification reference id');
  }
  return new mongoose.Types.ObjectId(normalized);
};

const toSafeLimit = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_NOTIFICATION_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_NOTIFICATION_LIMIT);
};

const resolveUserTenant = async (userId) => {
  const user = await User.findById(userId)
    .setOptions({ skipTenantFilter: true })
    .select('_id tenantId')
    .lean();

  if (!user) {
    throw createNotificationError(404, 'User not found');
  }

  const tenantId = toObjectIdString(user.tenantId);
  if (!tenantId) {
    throw createNotificationError(403, 'User is not associated with an active tenant');
  }

  return {
    userId: String(user._id),
    tenantId,
  };
};

const createNotification = async (userId, type, referenceId, title, body, options = {}) => {
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const receiver = await resolveUserTenant(normalizedUserId);

  const tenantId = toObjectIdString(options.tenantId || receiver.tenantId);
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createNotificationError(400, 'Invalid tenant id for notification');
  }
  if (receiver.tenantId !== tenantId) {
    throw createNotificationError(403, 'Notification tenant mismatch');
  }

  const normalizedType = String(type || '').trim().toLowerCase() || 'system';
  const normalizedTitle = String(title || '').trim();
  const normalizedBody = String(body || '').trim();

  if (!NOTIFICATION_TYPE_VALUES.includes(normalizedType)) {
    throw createNotificationError(422, 'Invalid notification type');
  }

  if (!normalizedTitle) {
    throw createNotificationError(422, 'Notification title is required');
  }
  if (!normalizedBody) {
    throw createNotificationError(422, 'Notification body is required');
  }

  const notification = await Notification.create({
    userId: normalizedUserId,
    tenantId: new mongoose.Types.ObjectId(tenantId),
    type: normalizedType,
    referenceId: toOptionalObjectId(referenceId),
    title: normalizedTitle,
    body: normalizedBody,
  });
  const notificationPayload = typeof notification?.toObject === 'function' ? notification.toObject() : notification;

  try {
    emitNotificationNew({
      tenantId,
      userId: normalizedUserId,
      notification: notificationPayload,
    });
  } catch (realtimeError) {
    console.error('notification realtime emit failed:', realtimeError?.message || realtimeError);
  }

  void emitUnreadUpdate({
    tenantId,
    userId: normalizedUserId,
  }).catch((realtimeError) => {
    console.error('notification unread realtime emit failed:', realtimeError?.message || realtimeError);
  });

  void sendPushNotification(normalizedUserId, normalizedTitle, normalizedBody, {
    tenantId,
    type: normalizedType,
    referenceId: toObjectIdString(notificationPayload?._id || referenceId || ''),
    clickUrl: options.clickUrl,
  }).catch((pushError) => {
    console.error('notification push send failed:', pushError?.message || pushError);
  });

  return notification;
};

const getUserNotifications = async (userId, options = {}) => {
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const receiver = await resolveUserTenant(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || receiver.tenantId);
  const limit = toSafeLimit(options.limit);

  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createNotificationError(400, 'Invalid tenant id for notifications');
  }
  if (receiver.tenantId !== tenantId) {
    throw createNotificationError(403, 'Notification tenant mismatch');
  }

  const query = {
    userId: new mongoose.Types.ObjectId(normalizedUserId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  };

  const [notifications, unreadCount] = await Promise.all([
    Notification.find(query).sort({ createdAt: -1 }).limit(limit).lean(),
    Notification.countDocuments({ ...query, isRead: false }),
  ]);

  return {
    notifications,
    unreadCount: Number(unreadCount || 0),
  };
};

const markNotificationRead = async (notificationId, userId, options = {}) => {
  const normalizedNotificationId = ensureObjectId(notificationId, 'notification id');
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const receiver = await resolveUserTenant(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || receiver.tenantId);

  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createNotificationError(400, 'Invalid tenant id for notification');
  }
  if (receiver.tenantId !== tenantId) {
    throw createNotificationError(403, 'Notification tenant mismatch');
  }

  const notification = await Notification.findOneAndUpdate(
    {
      _id: normalizedNotificationId,
      userId: normalizedUserId,
      tenantId,
    },
    {
      $set: { isRead: true },
    },
    { new: true },
  ).lean();

  if (!notification) {
    throw createNotificationError(404, 'Notification not found');
  }

  return notification;
};

module.exports = {
  createNotificationError,
  createNotification,
  getUserNotifications,
  markNotificationRead,
};
