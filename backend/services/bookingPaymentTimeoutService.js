const Booking = require('../models/Booking');
const {
  isAdvancePaidStatus,
  normalizeStatusKey,
} = require('../utils/paymentUtils');
const { queueAutoCancelledEmail } = require('./bookingEmailNotificationService');
const { releaseManyCarsIfUnblocked } = require('./fleetService');
const { releaseDriverForBooking } = require('./driverAllocationService');

const PAYMENT_TIMEOUT_MINUTES = 15;
const PAYMENT_TIMEOUT_MS = PAYMENT_TIMEOUT_MINUTES * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 1000;

let lastSweepAtMs = 0;

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toPositiveNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return 0;
  return numeric;
};

const resolvePaymentDeadline = (booking) => {
  const explicitDeadline = toValidDate(booking?.paymentDeadline);
  if (explicitDeadline) return explicitDeadline;

  const createdAt = toValidDate(booking?.createdAt);
  if (!createdAt) return null;

  return new Date(createdAt.getTime() + PAYMENT_TIMEOUT_MS);
};

const isPendingPaymentBooking = (booking) => normalizeStatusKey(booking?.bookingStatus) === 'PENDINGPAYMENT';

const shouldCancelForTimeout = (booking, now) => {
  if (!isPendingPaymentBooking(booking)) return false;

  const advancePaid = toPositiveNumber(booking?.advancePaid);
  if (advancePaid > 0) return false;

  if (isAdvancePaidStatus(booking?.paymentStatus)) return false;

  const deadline = resolvePaymentDeadline(booking);
  if (!deadline) return false;

  return now.getTime() > deadline.getTime();
};

const releaseCarsIfUnoccupied = async (carIds) => {
  if (!Array.isArray(carIds) || carIds.length === 0) return 0;

  const { releasedCount } = await releaseManyCarsIfUnblocked(carIds);
  return Number(releasedCount || 0);
};

const runPendingPaymentTimeoutSweep = async (options = {}) => {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();
  const minIntervalMs = Number.isFinite(Number(options.minIntervalMs))
    ? Math.max(Number(options.minIntervalMs), 0)
    : DEFAULT_SWEEP_INTERVAL_MS;

  if (!options.force && nowMs - lastSweepAtMs < minIntervalMs) {
    return {
      ran: false,
      cancelledCount: 0,
      deadlineBackfilledCount: 0,
      releasedCarCount: 0,
    };
  }

  lastSweepAtMs = nowMs;

  const pendingBookings = await Booking.find({
    $or: [{ bookingStatus: 'PendingPayment' }, { bookingStatus: 'PENDINGPAYMENT' }],
  }).select('_id car bookingStatus paymentStatus advancePaid paymentDeadline createdAt');

  if (!Array.isArray(pendingBookings) || pendingBookings.length === 0) {
    return {
      ran: true,
      cancelledCount: 0,
      deadlineBackfilledCount: 0,
      releasedCarCount: 0,
    };
  }

  const operations = [];
  const cancelledCarIds = [];
  const cancelledBookingIds = [];
  let cancelledCount = 0;
  let deadlineBackfilledCount = 0;

  for (const booking of pendingBookings) {
    if (!booking?._id) continue;

    const normalizedStatus = normalizeStatusKey(booking.bookingStatus);
    if (normalizedStatus !== 'PENDINGPAYMENT') continue;

    const resolvedDeadline = resolvePaymentDeadline(booking);
    const hasExplicitDeadline = Boolean(toValidDate(booking.paymentDeadline));

    if (shouldCancelForTimeout(booking, now)) {
      const updatePayload = {
        bookingStatus: 'Cancelled',
        paymentStatus: 'Unpaid',
        rentalStage: null,
        remainingAmount: 0,
        cancellationReason: 'Payment timeout',
        cancelledAt: now,
      };

      if (resolvedDeadline && !hasExplicitDeadline) {
        updatePayload.paymentDeadline = resolvedDeadline;
      }

      operations.push({
        updateOne: {
          filter: { _id: booking._id, bookingStatus: booking.bookingStatus },
          update: { $set: updatePayload },
        },
      });

      cancelledCount += 1;
      cancelledBookingIds.push(String(booking._id));
      if (booking.car) cancelledCarIds.push(booking.car);
      continue;
    }

    if (resolvedDeadline && !hasExplicitDeadline) {
      operations.push({
        updateOne: {
          filter: { _id: booking._id, bookingStatus: booking.bookingStatus },
          update: { $set: { paymentDeadline: resolvedDeadline } },
        },
      });
      deadlineBackfilledCount += 1;
    }
  }

  if (operations.length > 0) {
    await Booking.bulkWrite(operations, { ordered: false });
  }

  const releasedCarCount = await releaseCarsIfUnoccupied(cancelledCarIds);
  if (cancelledBookingIds.length > 0) {
    for (const bookingId of cancelledBookingIds) {
      try {
        await releaseDriverForBooking(bookingId, { incrementTripCount: false });
      } catch (driverReleaseError) {
        console.error('driver release failed on payment-timeout cancel:', {
          bookingId,
          error: driverReleaseError?.message || driverReleaseError,
        });
      }
    }
  }

  if (cancelledBookingIds.length > 0) {
    for (const bookingId of cancelledBookingIds) {
      queueAutoCancelledEmail(bookingId);
    }
  }

  return {
    ran: true,
    cancelledCount,
    deadlineBackfilledCount,
    releasedCarCount,
  };
};

const hasTimedOutPayment = (booking, now = new Date()) => {
  if (!booking) return false;

  const normalizedStatus = normalizeStatusKey(booking.bookingStatus);
  if (normalizedStatus !== 'CANCELLED') return false;

  const advancePaid = toPositiveNumber(booking.advancePaid);
  if (advancePaid > 0 || isAdvancePaidStatus(booking.paymentStatus)) return false;

  const deadline = resolvePaymentDeadline(booking);
  if (!deadline) return false;

  return now.getTime() > deadline.getTime();
};

module.exports = {
  PAYMENT_TIMEOUT_MINUTES,
  PAYMENT_TIMEOUT_MS,
  DEFAULT_SWEEP_INTERVAL_MS,
  runPendingPaymentTimeoutSweep,
  resolvePaymentDeadline,
  hasTimedOutPayment,
};
