const Booking = require('../models/Booking');
const { normalizeStatusKey, isAdvancePaidStatus, isFullyPaidStatus } = require('../utils/paymentUtils');

const ONE_HOUR_MS = 60 * 60 * 1000;
const LATE_RATE_MULTIPLIER = 1.5;

const STAGE_ORDER = {
  SCHEDULED: 1,
  ACTIVE: 2,
  OVERDUE: 3,
  COMPLETED: 4,
};

const normalizeStageName = (value) => {
  const key = normalizeStatusKey(value);
  if (!key) return '';
  if (key === 'SCHEDULED') return 'Scheduled';
  if (key === 'ACTIVE') return 'Active';
  if (key === 'OVERDUE') return 'Overdue';
  if (key === 'COMPLETED') return 'Completed';
  return '';
};

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const getNormalizedGracePeriodHours = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return 1;
  return numericValue;
};

const roundCurrency = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(2));
};

const toPositiveNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }
  return numericValue;
};

const isCompletedRecord = (booking, stageOverride = '') => {
  const bookingStatusKey = normalizeStatusKey(booking?.bookingStatus);
  const tripStatusKey = normalizeStatusKey(booking?.tripStatus);
  const stageKey = normalizeStatusKey(stageOverride || booking?.rentalStage);

  return (
    bookingStatusKey === 'COMPLETED' ||
    tripStatusKey === 'COMPLETED' ||
    stageKey === 'COMPLETED' ||
    Boolean(booking?.actualReturnTime)
  );
};

const resolveFinalAmount = (booking) => {
  const finalAmount = Number(booking?.finalAmount);
  if (Number.isFinite(finalAmount) && finalAmount > 0) {
    return finalAmount;
  }

  const fallback = Number(booking?.totalAmount);
  if (Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }

  return 0;
};

const resolveAdvancePaidAmount = (booking) => {
  const advancePaid = toPositiveNumber(booking?.advancePaid, 0);
  if (advancePaid > 0) {
    return advancePaid;
  }

  if (isAdvancePaidStatus(booking?.paymentStatus)) {
    return Math.max(
      toPositiveNumber(booking?.advanceRequired, 0),
      toPositiveNumber(booking?.advanceAmount, 0),
    );
  }

  return 0;
};

const resolvePerDayPrice = (booking) => {
  const fromPopulatedCar = Number(booking?.car?.pricePerDay);
  if (Number.isFinite(fromPopulatedCar) && fromPopulatedCar > 0) {
    return fromPopulatedCar;
  }

  const fromRecord = Number(booking?.pricePerDay);
  if (Number.isFinite(fromRecord) && fromRecord > 0) {
    return fromRecord;
  }

  return 0;
};

const calculateHourlyLateRate = (perDayPrice) => {
  const normalizedPerDayPrice = Number(perDayPrice);
  if (!Number.isFinite(normalizedPerDayPrice) || normalizedPerDayPrice <= 0) {
    return 0;
  }

  return roundCurrency((normalizedPerDayPrice / 24) * LATE_RATE_MULTIPLIER);
};

const areSameNumber = (left, right, epsilon = 0.009) => {
  const leftNumber = Number(left);
  const rightNumber = Number(right);

  if (!Number.isFinite(leftNumber) && !Number.isFinite(rightNumber)) {
    return true;
  }

  if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) {
    return false;
  }

  return Math.abs(leftNumber - rightNumber) <= epsilon;
};

const buildLateFeeSnapshot = (booking, effectiveStage, now) => {
  const normalizedStage = normalizeStageName(effectiveStage) || normalizeStageName(booking?.rentalStage);
  const shouldFreezeLateFees = isCompletedRecord(booking, normalizedStage);

  const existingLateHours = Math.max(Math.floor(toPositiveNumber(booking?.lateHours, 0)), 0);
  const existingLateFee = roundCurrency(toPositiveNumber(booking?.lateFee, 0));
  const existingHourlyLateRate = roundCurrency(toPositiveNumber(booking?.hourlyLateRate, 0));

  const perDayPrice = resolvePerDayPrice(booking);
  const derivedHourlyLateRate = calculateHourlyLateRate(perDayPrice);
  const canLockHourlyRate =
    normalizedStage === 'Active' ||
    normalizedStage === 'Overdue' ||
    (normalizedStage === 'Completed' && existingHourlyLateRate > 0);
  const hourlyLateRate =
    existingHourlyLateRate > 0
      ? existingHourlyLateRate
      : canLockHourlyRate
        ? derivedHourlyLateRate
        : 0;

  let lateHours = existingLateHours;
  let lateFee = existingLateFee;

  if (!shouldFreezeLateFees && normalizedStage === 'Overdue') {
    const dropDateTime = toValidDate(booking?.dropDateTime || booking?.toDate);
    if (dropDateTime) {
      const gracePeriodHours = getNormalizedGracePeriodHours(booking?.gracePeriodHours);
      const overdueThresholdMs = dropDateTime.getTime() + gracePeriodHours * ONE_HOUR_MS;
      const overdueTimeMs = now.getTime() - overdueThresholdMs;

      if (overdueTimeMs > 0) {
        const computedLateHours = Math.max(Math.ceil(overdueTimeMs / ONE_HOUR_MS), 0);
        lateHours = Math.max(existingLateHours, computedLateHours);

        const calculatedLateFee = roundCurrency(lateHours * hourlyLateRate);
        lateFee = Math.max(existingLateFee, calculatedLateFee);
      }
    }
  }

  if (isFullyPaidStatus(booking?.paymentStatus)) {
    return {
      hourlyLateRate,
      lateHours,
      lateFee,
      remainingAmount: 0,
    };
  }

  const finalAmount = resolveFinalAmount(booking);
  const advancePaid = resolveAdvancePaidAmount(booking);
  const remainingAmount = roundCurrency(Math.max(finalAmount - advancePaid, 0) + lateFee);

  return {
    hourlyLateRate,
    lateHours,
    lateFee,
    remainingAmount,
  };
};

const resolveNextRentalStage = (booking, now = new Date()) => {
  const bookingStatusKey = normalizeStatusKey(booking?.bookingStatus);
  const currentStage = normalizeStageName(booking?.rentalStage);
  const currentStageKey = normalizeStatusKey(currentStage);

  if (!bookingStatusKey) {
    return '';
  }

  if (
    bookingStatusKey === 'COMPLETED' ||
    currentStageKey === 'COMPLETED' ||
    normalizeStatusKey(booking?.tripStatus) === 'COMPLETED' ||
    Boolean(booking?.actualReturnTime)
  ) {
    return currentStage || 'Completed';
  }

  if (bookingStatusKey !== 'CONFIRMED') {
    return currentStage || '';
  }

  const pickupDateTime = toValidDate(booking?.pickupDateTime || booking?.fromDate);
  const dropDateTime = toValidDate(booking?.dropDateTime || booking?.toDate);
  const gracePeriodHours = getNormalizedGracePeriodHours(booking?.gracePeriodHours);

  let nextStage = currentStage || 'Scheduled';
  let nextStageKey = normalizeStatusKey(nextStage);

  if (nextStageKey === 'SCHEDULED' && pickupDateTime && now >= pickupDateTime) {
    nextStage = 'Active';
    nextStageKey = 'ACTIVE';
  }

  if (nextStageKey === 'ACTIVE' && dropDateTime) {
    const overdueThreshold = new Date(dropDateTime.getTime() + gracePeriodHours * 60 * 60 * 1000);
    if (now > overdueThreshold) {
      nextStage = 'Overdue';
      nextStageKey = 'OVERDUE';
    }
  }

  const originalStageKey = currentStageKey || 'SCHEDULED';
  const currentOrder = STAGE_ORDER[originalStageKey] || STAGE_ORDER.SCHEDULED;
  const nextOrder = STAGE_ORDER[nextStageKey] || currentOrder;

  if (nextOrder < currentOrder) {
    return currentStage || 'Scheduled';
  }

  return nextStage;
};

const syncRentalStagesForBookings = async (bookings, options = {}) => {
  const { now = new Date(), persist = true } = options;
  if (!Array.isArray(bookings) || bookings.length === 0) {
    return {
      updatedCount: 0,
      bookings: Array.isArray(bookings) ? bookings : [],
    };
  }

  const operations = [];

  for (const booking of bookings) {
    if (!booking?._id) continue;

    const nextStage = resolveNextRentalStage(booking, now);
    const currentStage = normalizeStageName(booking.rentalStage);
    const effectiveStage = nextStage || currentStage;
    if (!effectiveStage) continue;

    const updatePayload = {};
    if (nextStage && currentStage !== nextStage) {
      updatePayload.rentalStage = nextStage;
    }

    if (
      ['Active', 'Overdue'].includes(effectiveStage) &&
      normalizeStatusKey(booking.tripStatus) !== 'ACTIVE' &&
      normalizeStatusKey(booking.tripStatus) !== 'COMPLETED'
    ) {
      updatePayload.tripStatus = 'active';
    }

    const financialSnapshot = buildLateFeeSnapshot(booking, effectiveStage, now);
    if (!areSameNumber(booking.hourlyLateRate, financialSnapshot.hourlyLateRate)) {
      updatePayload.hourlyLateRate = financialSnapshot.hourlyLateRate;
    }

    if (!areSameNumber(booking.lateHours, financialSnapshot.lateHours, 0)) {
      updatePayload.lateHours = financialSnapshot.lateHours;
    }

    if (!areSameNumber(booking.lateFee, financialSnapshot.lateFee)) {
      updatePayload.lateFee = financialSnapshot.lateFee;
    }

    if (!areSameNumber(booking.remainingAmount, financialSnapshot.remainingAmount)) {
      updatePayload.remainingAmount = financialSnapshot.remainingAmount;
    }

    if (Object.keys(updatePayload).length === 0) continue;

    operations.push({
      updateOne: {
        filter: { _id: booking._id },
        update: { $set: updatePayload },
      },
    });

    if (Object.prototype.hasOwnProperty.call(updatePayload, 'rentalStage')) booking.rentalStage = updatePayload.rentalStage;
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'tripStatus')) booking.tripStatus = updatePayload.tripStatus;
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'hourlyLateRate')) {
      booking.hourlyLateRate = updatePayload.hourlyLateRate;
    }
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'lateHours')) booking.lateHours = updatePayload.lateHours;
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'lateFee')) booking.lateFee = updatePayload.lateFee;
    if (Object.prototype.hasOwnProperty.call(updatePayload, 'remainingAmount')) {
      booking.remainingAmount = updatePayload.remainingAmount;
    }
  }

  if (persist && operations.length > 0) {
    await Booking.bulkWrite(operations, { ordered: false });
  }

  return {
    updatedCount: operations.length,
    bookings,
  };
};

module.exports = {
  resolveNextRentalStage,
  syncRentalStagesForBookings,
};
