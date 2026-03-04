const mongoose = require('mongoose');
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const User = require('../models/User');
const { isStaffRole } = require('../utils/rbac');

let vapidConfigured = false;

const createPushError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toObjectIdString = (value) => String(value || '').trim();

const ensureObjectId = (value, fieldName) => {
  const normalized = toObjectIdString(value);
  if (!mongoose.Types.ObjectId.isValid(normalized)) {
    throw createPushError(400, `Invalid ${fieldName}`);
  }
  return normalized;
};

const ensureWebPushConfigured = () => {
  if (vapidConfigured) return true;

  const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || '').trim();
  const vapidPrivateKey = String(process.env.VAPID_PRIVATE_KEY || '').trim();
  const vapidSubject =
    String(process.env.VAPID_SUBJECT || '').trim() || 'mailto:support@example.com';

  if (!vapidPublicKey || !vapidPrivateKey) {
    return false;
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  vapidConfigured = true;
  return true;
};

const normalizePushSubscriptionPayload = (input) => {
  const payload = input && typeof input === 'object' ? input : {};
  const endpoint = String(payload.endpoint || '').trim();
  const keys = payload.keys && typeof payload.keys === 'object' ? payload.keys : {};
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();

  if (!endpoint || !p256dh || !auth) {
    throw createPushError(422, 'Invalid push subscription payload');
  }

  return {
    endpoint,
    keys: {
      p256dh,
      auth,
    },
  };
};

const resolveUserTenantContext = async (userId) => {
  const user = await User.findById(userId)
    .setOptions({ skipTenantFilter: true })
    .select('_id tenantId role')
    .lean();

  if (!user) {
    throw createPushError(404, 'User not found');
  }

  const tenantId = toObjectIdString(user.tenantId);
  if (!tenantId) {
    throw createPushError(403, 'User is not associated with an active tenant');
  }

  return {
    userId: String(user._id),
    tenantId,
    role: user.role,
  };
};

const subscribePushNotifications = async (userId, subscriptionPayload, options = {}) => {
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const receiver = await resolveUserTenantContext(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || receiver.tenantId);
  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createPushError(400, 'Invalid tenant id for push subscription');
  }
  if (receiver.tenantId !== tenantId) {
    throw createPushError(403, 'Push subscription tenant mismatch');
  }

  const normalizedSubscription = normalizePushSubscriptionPayload(subscriptionPayload);

  const saved = await PushSubscription.findOneAndUpdate(
    {
      endpoint: normalizedSubscription.endpoint,
    },
    {
      $set: {
        userId: new mongoose.Types.ObjectId(normalizedUserId),
        tenantId: new mongoose.Types.ObjectId(tenantId),
        keys: normalizedSubscription.keys,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
      runValidators: true,
    },
  )
    .setOptions({ skipTenantFilter: true })
    .lean();

  return saved;
};

const buildPushPayload = (title, message, options = {}) => {
  const normalizedTitle = String(title || '').trim() || 'Notification';
  const normalizedMessage = String(message || '').trim() || 'You have a new update';
  const clickUrl = String(options.clickUrl || '').trim();

  return {
    title: normalizedTitle,
    message: normalizedMessage,
    icon: String(options.icon || '').trim() || '/favicon.svg',
    badge: String(options.badge || '').trim() || '/favicon.svg',
    tag: String(options.tag || '').trim() || `push-${Date.now()}`,
    data: {
      url: clickUrl || '',
      type: String(options.type || '').trim() || 'system',
      referenceId: toObjectIdString(options.referenceId || ''),
    },
  };
};

const removeInvalidEndpoints = async (tenantId, userId, endpoints = []) => {
  const uniqueEndpoints = [...new Set((Array.isArray(endpoints) ? endpoints : []).map((entry) => String(entry || '').trim()).filter(Boolean))];
  if (uniqueEndpoints.length === 0) return 0;

  const result = await PushSubscription.deleteMany({
    tenantId: new mongoose.Types.ObjectId(tenantId),
    userId: new mongoose.Types.ObjectId(userId),
    endpoint: { $in: uniqueEndpoints },
  }).setOptions({ skipTenantFilter: true });

  return Number(result?.deletedCount || 0);
};

const sendPushNotification = async (userId, title, message, options = {}) => {
  const normalizedUserId = ensureObjectId(userId, 'user id');
  const receiver = await resolveUserTenantContext(normalizedUserId);
  const tenantId = toObjectIdString(options.tenantId || receiver.tenantId);

  if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
    throw createPushError(400, 'Invalid tenant id for push notification');
  }
  if (receiver.tenantId !== tenantId) {
    throw createPushError(403, 'Push notification tenant mismatch');
  }

  if (!ensureWebPushConfigured()) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: 'web-push-not-configured',
    };
  }

  const subscriptions = await PushSubscription.find({
    userId: new mongoose.Types.ObjectId(normalizedUserId),
    tenantId: new mongoose.Types.ObjectId(tenantId),
  })
    .setOptions({ skipTenantFilter: true })
    .lean();

  if (!Array.isArray(subscriptions) || subscriptions.length === 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: 'no-subscriptions',
    };
  }

  const defaultClickUrl = isStaffRole(receiver.role) ? '/owner?chat=open' : '/?chat=open';
  const payload = JSON.stringify(
    buildPushPayload(title, message, {
      ...options,
      clickUrl: String(options.clickUrl || '').trim() || defaultClickUrl,
    }),
  );

  const invalidEndpoints = [];
  let sent = 0;
  let failed = 0;

  for (const subscriptionEntry of subscriptions) {
    const endpoint = String(subscriptionEntry?.endpoint || '').trim();
    const p256dh = String(subscriptionEntry?.keys?.p256dh || '').trim();
    const auth = String(subscriptionEntry?.keys?.auth || '').trim();
    if (!endpoint || !p256dh || !auth) {
      failed += 1;
      invalidEndpoints.push(endpoint);
      continue;
    }

    try {
      await webpush.sendNotification(
        {
          endpoint,
          keys: { p256dh, auth },
        },
        payload,
      );
      sent += 1;
    } catch (error) {
      failed += 1;
      const statusCode = Number(error?.statusCode || error?.status || 0);
      if (statusCode === 404 || statusCode === 410) {
        invalidEndpoints.push(endpoint);
      } else {
        console.error('push send failed:', {
          userId: normalizedUserId,
          endpoint,
          message: error?.message || error,
        });
      }
    }
  }

  if (invalidEndpoints.length > 0) {
    await removeInvalidEndpoints(tenantId, normalizedUserId, invalidEndpoints);
  }

  return {
    sent,
    failed,
    skipped: false,
    removedEndpoints: invalidEndpoints.length,
  };
};

module.exports = {
  createPushError,
  ensureWebPushConfigured,
  subscribePushNotifications,
  sendPushNotification,
};
