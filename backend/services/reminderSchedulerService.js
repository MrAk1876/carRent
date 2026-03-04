const Booking = require('../models/Booking');
const User = require('../models/User');
const { sendMessage } = require('./messageService');
const { createNotification } = require('./notificationService');
const { sendEmail } = require('./emailService');
const { sendSMS } = require('./smsService');
const { normalizeStatusKey } = require('../utils/paymentUtils');
const { isStaffRole } = require('../utils/rbac');
const {
  AUTO_MESSAGE_EVENT_TYPE,
  renderAutoMessageByEventType,
} = require('./autoMessageService');

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 45 * 1000;

let reminderSchedulerTimer = null;
let reminderSchedulerInitialTimer = null;
let reminderSchedulerRunning = false;
let lastReminderSweepAt = null;

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toSafePositiveNumber = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
};

const normalizeText = (value) => String(value || '').trim();

const formatDateTime = (value) => {
  const parsed = toValidDate(value);
  if (!parsed) return 'N/A';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const resolvePickupDate = (booking) => toValidDate(booking?.pickupDateTime || booking?.fromDate);
const resolveDropDate = (booking) => toValidDate(booking?.dropDateTime || booking?.toDate);

const buildUserName = (booking) => {
  const firstName = normalizeText(booking?.user?.firstName);
  const lastName = normalizeText(booking?.user?.lastName);
  const fullName = normalizeText(`${firstName} ${lastName}`);
  return fullName || 'Customer';
};

const buildCarName = (booking) => {
  const carName = normalizeText(booking?.car?.name);
  if (carName) return carName;
  const brand = normalizeText(booking?.car?.brand);
  const model = normalizeText(booking?.car?.model);
  return normalizeText(`${brand} ${model}`) || 'Car';
};

const buildPickupLocation = (booking) =>
  normalizeText(booking?.pickupLocation?.address) ||
  normalizeText(booking?.car?.location) ||
  'Pickup location will be shared by support team';

const buildDropLocation = (booking) =>
  normalizeText(booking?.dropLocation?.address) ||
  normalizeText(booking?.car?.location) ||
  'Drop location will be shared by support team';

const buildBranchName = (booking) =>
  normalizeText(booking?.branchId?.name) ||
  normalizeText(booking?.branch?.name) ||
  normalizeText(booking?.car?.branchName) ||
  'Main Branch';

const isBookingClosed = (booking) => {
  const bookingStatusKey = normalizeStatusKey(booking?.bookingStatus);
  const tripStatusKey = normalizeStatusKey(booking?.tripStatus);
  const rentalStageKey = normalizeStatusKey(booking?.rentalStage);

  if (['COMPLETED', 'CANCELLED', 'CANCELLEDBYUSER', 'REJECTED'].includes(bookingStatusKey)) {
    return true;
  }
  if (tripStatusKey === 'COMPLETED') {
    return true;
  }
  if (rentalStageKey === 'COMPLETED') {
    return true;
  }
  return false;
};

const findDropReminderCandidates = async ({ now, twoHourCutoff }) =>
  Booking.find({
    actualReturnTime: null,
    $or: [{ reminder2hrSent: { $ne: true } }, { reminder1hrSent: { $ne: true } }],
    $or: [
      { dropDateTime: { $gte: now, $lte: twoHourCutoff } },
      { dropDateTime: null, toDate: { $gte: now, $lte: twoHourCutoff } },
      { dropDateTime: { $exists: false }, toDate: { $gte: now, $lte: twoHourCutoff } },
    ],
  })
    .setOptions({ skipTenantFilter: true })
    .select(
      '_id user car tenantId branchId bookingStatus tripStatus rentalStage pickupDateTime fromDate dropDateTime toDate pickupLocation dropLocation actualReturnTime reminder2hrSent reminder1hrSent reminderDropTimeCompleteSent dropExpiredMessageSent',
    )
    .populate('user', 'firstName lastName email phone')
    .populate('car', 'name brand model location')
    .populate('branchId', 'name')
    .sort({ dropDateTime: 1, toDate: 1 })
    .lean();

const findDropCompletionCandidates = async ({ now }) =>
  Booking.find({
    actualReturnTime: null,
    reminderDropTimeCompleteSent: { $ne: true },
    dropExpiredMessageSent: { $ne: true },
    $or: [
      { dropDateTime: { $lte: now } },
      { dropDateTime: null, toDate: { $lte: now } },
      { dropDateTime: { $exists: false }, toDate: { $lte: now } },
    ],
  })
    .setOptions({ skipTenantFilter: true })
    .select(
      '_id user car tenantId branchId bookingStatus tripStatus rentalStage pickupDateTime fromDate dropDateTime toDate pickupLocation dropLocation actualReturnTime reminder2hrSent reminder1hrSent reminderDropTimeCompleteSent dropExpiredMessageSent',
    )
    .populate('user', 'firstName lastName email phone')
    .populate('car', 'name brand model location')
    .populate('branchId', 'name')
    .sort({ dropDateTime: 1, toDate: 1 })
    .lean();

const resolveSystemSenderForTenant = async (tenantId, receiverId, cache = new Map()) => {
  const cacheKey = `${String(tenantId || '').trim()}::${String(receiverId || '').trim()}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedReceiverId = String(receiverId || '').trim();
  let senderId = '';

  const configuredSenderId = String(process.env.SYSTEM_SENDER_USER_ID || '').trim();
  if (configuredSenderId) {
    const configuredSender = await User.findOne({
      _id: configuredSenderId,
      tenantId: normalizedTenantId,
      isBlocked: { $ne: true },
    })
      .setOptions({ skipTenantFilter: true })
      .select('_id role')
      .lean();

    if (configuredSender?._id) {
      senderId = String(configuredSender._id);
    }
  }

  if (!senderId) {
    const tenantUsers = await User.find({
      tenantId: normalizedTenantId,
      isBlocked: { $ne: true },
    })
      .setOptions({ skipTenantFilter: true })
      .select('_id role createdAt')
      .sort({ createdAt: 1 })
      .lean();

    const staffSender = (tenantUsers || []).find((user) => isStaffRole(user?.role));
    if (staffSender?._id) {
      senderId = String(staffSender._id);
    }
  }

  if (!senderId) {
    senderId = '';
  }

  cache.set(cacheKey, senderId);
  return senderId;
};

const toFieldArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
};

const markReminderSent = async ({ bookingId, fieldName }) => {
  const fieldNames = toFieldArray(fieldName);
  if (fieldNames.length === 0) return false;
  const setPatch = fieldNames.reduce((acc, key) => {
    acc[key] = true;
    return acc;
  }, {});
  const guardPatch = fieldNames.reduce((acc, key) => {
    acc[key] = { $ne: true };
    return acc;
  }, {});
  const result = await Booking.updateOne(
    {
      _id: bookingId,
      ...guardPatch,
    },
    {
      $set: setPatch,
    },
    { runValidators: false },
  );
  return Number(result?.modifiedCount || 0) > 0;
};

const revertReminderSent = async ({ bookingId, fieldName }) => {
  const fieldNames = toFieldArray(fieldName);
  if (fieldNames.length === 0) return;
  const setPatch = fieldNames.reduce((acc, key) => {
    acc[key] = false;
    return acc;
  }, {});
  await Booking.updateOne(
    { _id: bookingId },
    { $set: setPatch },
    { runValidators: false },
  );
};

const buildRenderContext = (booking) => ({
  bookingId: normalizeText(booking?._id),
  userName: buildUserName(booking),
  carName: buildCarName(booking),
  bookingStatus: normalizeText(booking?.bookingStatus),
  rentalStage: normalizeText(booking?.rentalStage),
  branchName: buildBranchName(booking),
  pickupTime: formatDateTime(resolvePickupDate(booking)),
  dropTime: formatDateTime(resolveDropDate(booking)),
  pickupLocation: buildPickupLocation(booking),
  dropLocation: buildDropLocation(booking),
});

const dispatchAutomatedReminder = async ({
  booking,
  tenantId,
  senderId,
  receiverId,
  eventType,
  flagFields,
  stats,
  successCounter,
}) => {
  const bookingId = String(booking?._id || '').trim();
  if (!bookingId) return;

  const rendered = await renderAutoMessageByEventType(tenantId, eventType, buildRenderContext(booking), {
    userId: senderId,
  });
  if (!rendered || !rendered.isActive) {
    stats.skippedInactive += 1;
    return;
  }

  const marked = await markReminderSent({ bookingId, fieldName: flagFields });
  if (!marked) return;

  try {
    const reminderTitle = String(rendered.notificationTitle || rendered.name || 'Booking reminder').trim();
    const reminderBody = String(rendered.messageText || '').trim();
    let notificationCreated = false;

    if (rendered.delivery.inApp && senderId && senderId !== receiverId) {
      await sendMessage(
        senderId,
        receiverId,
        reminderBody,
        'system',
        bookingId,
        {
          tenantId,
          notificationType: 'reminder',
          notificationTitle: reminderTitle,
          notificationBody: reminderBody.slice(0, 180),
          notificationReferenceId: bookingId,
        },
      );
      notificationCreated = true;
    }

    if (!notificationCreated) {
      await createNotification(
        receiverId,
        'reminder',
        bookingId,
        reminderTitle,
        reminderBody.slice(0, 180),
        { tenantId },
      );
    }

    const emailTo = normalizeText(booking?.user?.email);
    const phoneNumber = normalizeText(booking?.user?.phone);
    const emailPromise = rendered.delivery.email
      ? sendEmail(emailTo, rendered.emailSubject, rendered.emailHtml, { text: rendered.emailText })
      : Promise.resolve({ sent: false, skipped: true, reason: 'email-disabled' });
    const smsPromise = rendered.delivery.sms
      ? sendSMS(phoneNumber, rendered.smsText)
      : Promise.resolve({ sent: false, skipped: true, reason: 'sms-disabled' });

    const [emailResult, smsResult] = await Promise.allSettled([emailPromise, smsPromise]);

    if (emailResult.status === 'fulfilled') {
      if (emailResult.value?.sent) {
        stats.emailSent += 1;
      } else if (!emailResult.value?.skipped) {
        stats.emailFailed += 1;
      }
    } else {
      stats.emailFailed += 1;
      console.error('reminder email dispatch failed:', {
        bookingId,
        eventType,
        message: emailResult.reason?.message || emailResult.reason,
      });
    }

    if (smsResult.status === 'fulfilled') {
      if (smsResult.value?.sent) {
        stats.smsSent += 1;
      } else if (!smsResult.value?.skipped) {
        stats.smsFailed += 1;
      }
    } else {
      stats.smsFailed += 1;
      console.error('reminder sms dispatch failed:', {
        bookingId,
        eventType,
        message: smsResult.reason?.message || smsResult.reason,
      });
    }

    stats[successCounter] += 1;
  } catch (error) {
    await revertReminderSent({ bookingId, fieldName: flagFields });
    stats.failed += 1;
    console.error('automated reminder dispatch failed:', {
      bookingId,
      eventType,
      flagFields,
      message: error?.message || error,
    });
  }
};

const runReminderSweep = async (options = {}) => {
  if (reminderSchedulerRunning && !options.force) {
    return {
      ran: false,
      reason: 'already-running',
      sent2hr: 0,
      sent1hr: 0,
      sentDropComplete: 0,
      failed: 0,
      skippedInactive: 0,
      emailSent: 0,
      emailFailed: 0,
      smsSent: 0,
      smsFailed: 0,
      checkedDropReminderBookings: 0,
      checkedDropCompletionBookings: 0,
      checkedBookings: 0,
    };
  }

  reminderSchedulerRunning = true;

  const now = options.now instanceof Date ? options.now : new Date();
  const twoHourCutoff = new Date(now.getTime() + TWO_HOURS_MS);
  const senderCache = new Map();
  const stats = {
    ran: true,
    reason: '',
    sent2hr: 0,
    sent1hr: 0,
    sentDropComplete: 0,
    failed: 0,
    skippedInactive: 0,
    emailSent: 0,
    emailFailed: 0,
    smsSent: 0,
    smsFailed: 0,
    checkedDropReminderBookings: 0,
    checkedDropCompletionBookings: 0,
    checkedBookings: 0,
  };

  try {
    const [dropReminderBookings, dropCompletionBookings] = await Promise.all([
      findDropReminderCandidates({ now, twoHourCutoff }),
      findDropCompletionCandidates({ now }),
    ]);

    stats.checkedDropReminderBookings = Array.isArray(dropReminderBookings)
      ? dropReminderBookings.length
      : 0;
    stats.checkedDropCompletionBookings = Array.isArray(dropCompletionBookings)
      ? dropCompletionBookings.length
      : 0;
    stats.checkedBookings = stats.checkedDropReminderBookings + stats.checkedDropCompletionBookings;

    for (const booking of dropReminderBookings || []) {
      if (isBookingClosed(booking)) {
        continue;
      }

      const tenantId = String(booking?.tenantId || '').trim();
      const receiverId = String(booking?.user || '').trim();
      const dropDate = resolveDropDate(booking);
      if (!tenantId || !receiverId || !dropDate) {
        continue;
      }

      const msToDrop = dropDate.getTime() - now.getTime();
      if (msToDrop < 0) {
        continue;
      }

      const senderId = await resolveSystemSenderForTenant(tenantId, receiverId, senderCache);

      if (msToDrop <= TWO_HOURS_MS && !booking.reminder2hrSent) {
        await dispatchAutomatedReminder({
          booking,
          tenantId,
          senderId,
          receiverId,
          eventType: AUTO_MESSAGE_EVENT_TYPE.DROP_REMINDER_2H,
          flagFields: ['reminder2hrSent'],
          stats,
          successCounter: 'sent2hr',
        });
      }

      if (msToDrop <= ONE_HOUR_MS && !booking.reminder1hrSent) {
        await dispatchAutomatedReminder({
          booking,
          tenantId,
          senderId,
          receiverId,
          eventType: AUTO_MESSAGE_EVENT_TYPE.DROP_REMINDER_1H,
          flagFields: ['reminder1hrSent'],
          stats,
          successCounter: 'sent1hr',
        });
      }
    }

    for (const booking of dropCompletionBookings || []) {
      if (isBookingClosed(booking)) {
        continue;
      }

      const tenantId = String(booking?.tenantId || '').trim();
      const receiverId = String(booking?.user || '').trim();
      const dropDate = resolveDropDate(booking);
      if (!tenantId || !receiverId || !dropDate) {
        continue;
      }

      const msToDrop = dropDate.getTime() - now.getTime();
      if (msToDrop > 0) {
        continue;
      }
      if (booking.reminderDropTimeCompleteSent || booking.dropExpiredMessageSent) {
        continue;
      }

      const senderId = await resolveSystemSenderForTenant(tenantId, receiverId, senderCache);
      await dispatchAutomatedReminder({
        booking,
        tenantId,
        senderId,
        receiverId,
        eventType: AUTO_MESSAGE_EVENT_TYPE.DROP_TIME_EXPIRED,
        flagFields: ['reminderDropTimeCompleteSent', 'dropExpiredMessageSent'],
        stats,
        successCounter: 'sentDropComplete',
      });
    }
  } catch (error) {
    stats.ran = false;
    stats.reason = error?.message || 'sweep-failed';
    console.error('reminder sweep failed:', error);
  } finally {
    reminderSchedulerRunning = false;
    lastReminderSweepAt = new Date();
  }

  return stats;
};

const startReminderScheduler = (options = {}) => {
  if (reminderSchedulerTimer) {
    return {
      started: false,
      reason: 'already-started',
      intervalMs: DEFAULT_SWEEP_INTERVAL_MS,
    };
  }

  const intervalMs = toSafePositiveNumber(options.intervalMs, DEFAULT_SWEEP_INTERVAL_MS);
  const initialDelayMs = toSafePositiveNumber(options.initialDelayMs, DEFAULT_INITIAL_DELAY_MS);

  reminderSchedulerTimer = setInterval(() => {
    runReminderSweep().catch((error) => {
      console.error('reminder sweep unhandled error:', error);
    });
  }, intervalMs);

  if (typeof reminderSchedulerTimer.unref === 'function') {
    reminderSchedulerTimer.unref();
  }

  if (options.runOnStart !== false) {
    reminderSchedulerInitialTimer = setTimeout(() => {
      runReminderSweep().catch((error) => {
        console.error('initial reminder sweep failed:', error);
      });
      reminderSchedulerInitialTimer = null;
    }, initialDelayMs);
  }

  return {
    started: true,
    intervalMs,
  };
};

const stopReminderScheduler = () => {
  if (!reminderSchedulerTimer) return false;
  clearInterval(reminderSchedulerTimer);
  reminderSchedulerTimer = null;
  if (reminderSchedulerInitialTimer) {
    clearTimeout(reminderSchedulerInitialTimer);
    reminderSchedulerInitialTimer = null;
  }
  return true;
};

const getReminderSchedulerState = () => ({
  started: Boolean(reminderSchedulerTimer),
  running: reminderSchedulerRunning,
  lastSweepAt: lastReminderSweepAt,
});

module.exports = {
  TWO_HOURS_MS,
  ONE_HOUR_MS,
  DEFAULT_SWEEP_INTERVAL_MS,
  runReminderSweep,
  startReminderScheduler,
  stopReminderScheduler,
  getReminderSchedulerState,
};
