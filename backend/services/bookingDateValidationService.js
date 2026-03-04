const mongoose = require('mongoose');
const { resolveAvailabilityConflict } = require('./conflictResolver');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MIN_RENTAL_DAYS = 1;
const MAX_RENTAL_DAYS = 30;

const VALIDATION_RULE = Object.freeze({
  VALID: 'VALID',
  INVALID_CAR_ID: 'INVALID_CAR_ID',
  CAR_NOT_FOUND: 'CAR_NOT_FOUND',
  MISSING_PICKUP_DATE: 'MISSING_PICKUP_DATE',
  MISSING_DROP_DATE: 'MISSING_DROP_DATE',
  INVALID_PICKUP_DATE: 'INVALID_PICKUP_DATE',
  INVALID_DROP_DATE: 'INVALID_DROP_DATE',
  PICKUP_IN_PAST: 'PICKUP_IN_PAST',
  DROP_BEFORE_PICKUP: 'DROP_BEFORE_PICKUP',
  SAME_DAY_DROP_NOT_ALLOWED: 'SAME_DAY_DROP_NOT_ALLOWED',
  MIN_RENTAL_NOT_MET: 'MIN_RENTAL_NOT_MET',
  MAX_RENTAL_EXCEEDED: 'MAX_RENTAL_EXCEEDED',
  DATES_NOT_AVAILABLE: 'DATES_NOT_AVAILABLE',
});

const toDateOnlyKey = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toStartOfDay = (value) => {
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const buildResult = ({
  valid,
  reason = '',
  ruleViolated = '',
  conflictingDates = [],
  conflictReason = '',
  details = {},
}) => ({
  valid: Boolean(valid),
  reason: String(reason || ''),
  ruleViolated: String(ruleViolated || (valid ? VALIDATION_RULE.VALID : '')),
  conflictingDates: Array.isArray(conflictingDates) ? conflictingDates : [],
  conflictReason: String(conflictReason || ''),
  details: details && typeof details === 'object' ? details : {},
});

const resolveDateInput = (body = {}) => {
  const pickupDate = body.pickupDate || body.fromDate || body.startDate;
  const dropDate = body.dropDate || body.toDate || body.endDate;
  return { pickupDate, dropDate };
};

const calculateRentalDays = (pickupDate, dropDate) => {
  if (!pickupDate || !dropDate) return 0;
  return Math.floor((dropDate.getTime() - pickupDate.getTime()) / ONE_DAY_MS);
};

const validateBookingDates = async (options = {}) => {
  const {
    carId,
    pickupDate,
    dropDate,
    now = new Date(),
    minRentalDays = MIN_RENTAL_DAYS,
    maxRentalDays = MAX_RENTAL_DAYS,
  } = options;

  const normalizedCarId = String(carId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(normalizedCarId)) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.INVALID_CAR_ID,
      reason: 'Invalid car id',
    });
  }

  if (!pickupDate) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.MISSING_PICKUP_DATE,
      reason: 'pickupDate is required',
    });
  }

  if (!dropDate) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.MISSING_DROP_DATE,
      reason: 'dropDate is required',
    });
  }

  const pickup = toStartOfDay(pickupDate);
  if (!pickup) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.INVALID_PICKUP_DATE,
      reason: 'Invalid pickupDate. Expected YYYY-MM-DD',
    });
  }

  const drop = toStartOfDay(dropDate);
  if (!drop) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.INVALID_DROP_DATE,
      reason: 'Invalid dropDate. Expected YYYY-MM-DD',
    });
  }

  const today = toStartOfDay(now) || toStartOfDay(new Date());
  if (pickup.getTime() < today.getTime()) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.PICKUP_IN_PAST,
      reason: 'Pickup date cannot be in the past',
      details: {
        pickupDate: toDateOnlyKey(pickup),
        today: toDateOnlyKey(today),
      },
    });
  }

  if (drop.getTime() < pickup.getTime()) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.DROP_BEFORE_PICKUP,
      reason: 'Drop date must be after pickup date',
      details: {
        pickupDate: toDateOnlyKey(pickup),
        dropDate: toDateOnlyKey(drop),
      },
    });
  }

  if (drop.getTime() === pickup.getTime()) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.SAME_DAY_DROP_NOT_ALLOWED,
      reason: 'Same-day drop is not allowed',
      details: {
        pickupDate: toDateOnlyKey(pickup),
        dropDate: toDateOnlyKey(drop),
      },
    });
  }

  const rentalDays = calculateRentalDays(pickup, drop);
  const safeMinDays = Math.max(Number(minRentalDays || MIN_RENTAL_DAYS), 1);
  const safeMaxDays = Math.max(Number(maxRentalDays || MAX_RENTAL_DAYS), safeMinDays);

  if (rentalDays < safeMinDays) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.MIN_RENTAL_NOT_MET,
      reason: `Minimum rental duration is ${safeMinDays} day`,
      details: {
        pickupDate: toDateOnlyKey(pickup),
        dropDate: toDateOnlyKey(drop),
        rentalDays,
        minRentalDays: safeMinDays,
      },
    });
  }

  if (rentalDays > safeMaxDays) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.MAX_RENTAL_EXCEEDED,
      reason: `Maximum rental duration is ${safeMaxDays} days`,
      details: {
        pickupDate: toDateOnlyKey(pickup),
        dropDate: toDateOnlyKey(drop),
        rentalDays,
        maxRentalDays: safeMaxDays,
      },
    });
  }

  try {
    const availability = await resolveAvailabilityConflict({
      carId: normalizedCarId,
      startDate: pickup,
      endDate: drop,
    });

    if (!availability.valid) {
      return buildResult({
        valid: false,
        ruleViolated: VALIDATION_RULE.DATES_NOT_AVAILABLE,
        reason: 'One or more selected dates are not available',
        conflictingDates: availability.primaryConflictDates || availability.conflictingDates || [],
        conflictReason: availability.conflictReason || '',
        details: {
          pickupDate: toDateOnlyKey(pickup),
          dropDate: toDateOnlyKey(drop),
          rentalDays,
          availabilitySummary: availability.summary || {},
        },
      });
    }
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status === 404) {
      return buildResult({
        valid: false,
        ruleViolated: VALIDATION_RULE.CAR_NOT_FOUND,
        reason: 'Car not found',
      });
    }

    if (status === 400) {
      return buildResult({
        valid: false,
        ruleViolated: VALIDATION_RULE.INVALID_CAR_ID,
        reason: 'Invalid car id',
      });
    }

    throw error;
  }

  return buildResult({
    valid: true,
    ruleViolated: VALIDATION_RULE.VALID,
    reason: 'Booking date selection is valid',
    details: {
      carId: normalizedCarId,
      pickupDate: toDateOnlyKey(pickup),
      dropDate: toDateOnlyKey(drop),
      rentalDays,
      minRentalDays: safeMinDays,
      maxRentalDays: safeMaxDays,
      evaluatedAvailabilityState: 'AVAILABLE',
      futureRuleFlags: {
        dynamicPricingEligible: true,
        peakDayRulesEvaluated: false,
        subscriptionCoverageEvaluated: false,
      },
    },
  });
};

module.exports = {
  MIN_RENTAL_DAYS,
  MAX_RENTAL_DAYS,
  VALIDATION_RULE,
  resolveDateInput,
  validateBookingDates,
};
