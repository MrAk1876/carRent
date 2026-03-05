const mongoose = require('mongoose');
const { resolveAvailabilityConflict } = require('./conflictResolver');
const {
  MIN_RENTAL_DAYS,
  MAX_RENTAL_DAYS,
  normalizeRentalDaysValue,
  resolveRentalDaysForFixedDrop,
  calculateFixedDropDateTime,
} = require('../utils/rentalDateUtils');

const VALIDATION_RULE = Object.freeze({
  VALID: 'VALID',
  INVALID_CAR_ID: 'INVALID_CAR_ID',
  CAR_NOT_FOUND: 'CAR_NOT_FOUND',
  MISSING_PICKUP_DATE: 'MISSING_PICKUP_DATE',
  INVALID_PICKUP_DATE: 'INVALID_PICKUP_DATE',
  MISSING_RENTAL_DAYS: 'MISSING_RENTAL_DAYS',
  INVALID_RENTAL_DAYS: 'INVALID_RENTAL_DAYS',
  PICKUP_IN_PAST: 'PICKUP_IN_PAST',
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

const parseDateInput = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
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
  const pickupDate = body.pickupDate || body.fromDate || body.startDate || body.pickupDateTime;
  const dropDate = body.dropDate || body.toDate || body.endDate || body.dropDateTime;
  const rentalDays = body.rentalDays ?? body.days;
  return { pickupDate, dropDate, rentalDays };
};

const validateBookingDates = async (options = {}) => {
  const {
    carId,
    pickupDate,
    dropDate,
    rentalDays,
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

  const pickupDateTime = parseDateInput(pickupDate);
  if (!pickupDateTime) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.INVALID_PICKUP_DATE,
      reason: 'Invalid pickupDate. Expected ISO date/date-time',
    });
  }

  const safeMinDays = Math.max(Number(minRentalDays || MIN_RENTAL_DAYS), 1);
  const safeMaxDays = Math.max(Number(maxRentalDays || MAX_RENTAL_DAYS), safeMinDays);

  const legacyDropDateTime = parseDateInput(dropDate);
  const resolvedRentalDays = resolveRentalDaysForFixedDrop({
    rentalDays,
    pickupDateTime,
    dropDateTime: legacyDropDateTime,
    min: safeMinDays,
    max: safeMaxDays,
  });

  if (!resolvedRentalDays) {
    if (rentalDays === undefined || rentalDays === null || rentalDays === '') {
      return buildResult({
        valid: false,
        ruleViolated: VALIDATION_RULE.MISSING_RENTAL_DAYS,
        reason: 'rentalDays is required',
      });
    }

    const numericRentalDays = normalizeRentalDaysValue(rentalDays, {
      min: safeMinDays,
      max: safeMaxDays,
      allowNull: true,
    });

    if (!numericRentalDays) {
      return buildResult({
        valid: false,
        ruleViolated:
          Number(rentalDays) < safeMinDays
            ? VALIDATION_RULE.MIN_RENTAL_NOT_MET
            : VALIDATION_RULE.MAX_RENTAL_EXCEEDED,
        reason:
          Number(rentalDays) < safeMinDays
            ? `Minimum rental duration is ${safeMinDays} day`
            : `Maximum rental duration is ${safeMaxDays} days`,
        details: {
          rentalDays: Number(rentalDays),
          minRentalDays: safeMinDays,
          maxRentalDays: safeMaxDays,
        },
      });
    }

    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.INVALID_RENTAL_DAYS,
      reason: `rentalDays must be between ${safeMinDays} and ${safeMaxDays}`,
    });
  }

  const computedDropDateTime = calculateFixedDropDateTime(pickupDateTime, resolvedRentalDays);
  if (!computedDropDateTime) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.INVALID_RENTAL_DAYS,
      reason: 'Unable to derive drop date from rentalDays',
    });
  }

  const pickup = toStartOfDay(pickupDateTime);
  const drop = toStartOfDay(computedDropDateTime);
  const today = toStartOfDay(now) || toStartOfDay(new Date());

  if (!pickup || !drop || !today) {
    return buildResult({
      valid: false,
      ruleViolated: VALIDATION_RULE.INVALID_PICKUP_DATE,
      reason: 'Invalid booking date values',
    });
  }

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

  try {
    const availability = await resolveAvailabilityConflict({
      carId: normalizedCarId,
      startDate: pickupDateTime,
      endDate: computedDropDateTime,
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
          computedDropDate: toDateOnlyKey(drop),
          rentalDays: resolvedRentalDays,
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
      computedDropDate: toDateOnlyKey(drop),
      computedDropDateTime: computedDropDateTime.toISOString(),
      dropTimePolicy: '06:00',
      rentalDays: resolvedRentalDays,
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
