const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const HOURS_PER_DAY = 24;
const HALF_DAY_HOURS = 12;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const FIXED_DROP_HOUR = 6;
const FIXED_DROP_MINUTE = 0;
const MIN_RENTAL_DAYS = 1;
const MAX_RENTAL_DAYS = 30;

const toDateOnly = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

const normalizeRentalDaysValue = (value, options = {}) => {
  const { min = MIN_RENTAL_DAYS, max = MAX_RENTAL_DAYS, allowNull = false } = options;
  if ((value === undefined || value === null || value === '') && allowNull) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  const normalized = Math.floor(parsed);
  if (normalized < Math.max(Number(min || 0), 1)) return null;
  if (normalized > Math.max(Number(max || 0), Math.max(Number(min || 0), 1))) return null;

  return normalized;
};

const isDateOnlyInput = (value) => DATE_ONLY_REGEX.test(String(value || '').trim());

const parseDateTimeInput = (value, options = {}) => {
  const { treatDateOnlyAsDropBoundary = false } = options;

  if (value === undefined || value === null || value === '') {
    return null;
  }

  const rawValue = String(value).trim();
  if (!rawValue) return null;

  const parsed = new Date(rawValue);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (isDateOnlyInput(rawValue)) {
    if (treatDateOnlyAsDropBoundary) {
      parsed.setHours(23, 59, 59, 999);
    } else {
      parsed.setHours(0, 0, 0, 0);
    }
  }

  return parsed;
};

const normalizeStoredDateTime = (value, options = {}) => {
  const { treatMidnightAsDropBoundary = false } = options;
  if (!value) return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  if (treatMidnightAsDropBoundary) {
    const atMidnight =
      parsed.getHours() === 0 &&
      parsed.getMinutes() === 0 &&
      parsed.getSeconds() === 0 &&
      parsed.getMilliseconds() === 0;
    if (atMidnight) {
      parsed.setHours(23, 59, 59, 999);
    }
  }

  return parsed;
};

const validateRentalWindow = (pickupDateTime, dropDateTime, options = {}) => {
  const { minDurationHours = 1, pastToleranceMinutes = 1, now = new Date() } = options;
  const minDurationMs = Math.max(Number(minDurationHours || 0), 0) * ONE_HOUR_MS;
  const pastToleranceMs = Math.max(Number(pastToleranceMinutes || 0), 0) * ONE_MINUTE_MS;

  if (!pickupDateTime || Number.isNaN(pickupDateTime.getTime())) {
    return 'Invalid pickup date and time';
  }

  if (!dropDateTime || Number.isNaN(dropDateTime.getTime())) {
    return 'Invalid drop date and time';
  }

  if (pickupDateTime.getTime() < now.getTime() - pastToleranceMs) {
    return 'Pickup date and time cannot be in the past';
  }

  if (dropDateTime <= pickupDateTime) {
    return 'Drop date and time must be after pickup date and time';
  }

  if (dropDateTime.getTime() - pickupDateTime.getTime() < minDurationMs) {
    return `Minimum rental duration is ${Math.max(minDurationHours, 1)} hour`;
  }

  return '';
};

const calculateRentalDaysByCalendar = (pickupDateTime, dropDateTime) => {
  if (!pickupDateTime || !dropDateTime) return 0;

  const pickup = new Date(pickupDateTime);
  const drop = new Date(dropDateTime);
  if (Number.isNaN(pickup.getTime()) || Number.isNaN(drop.getTime())) return 0;

  const pickupDay = toDateOnly(pickup);
  const dropDay = toDateOnly(drop);
  const diffMs = dropDay.getTime() - pickupDay.getTime();
  if (diffMs <= 0) return 0;

  return Math.floor(diffMs / ONE_DAY_MS);
};

const resolveRentalDaysForFixedDrop = ({
  rentalDays,
  pickupDateTime,
  dropDateTime,
  min = MIN_RENTAL_DAYS,
  max = MAX_RENTAL_DAYS,
} = {}) => {
  const normalizedFromInput = normalizeRentalDaysValue(rentalDays, {
    min,
    max,
    allowNull: true,
  });
  if (normalizedFromInput) {
    return normalizedFromInput;
  }

  const fallbackDays = calculateRentalDaysByCalendar(pickupDateTime, dropDateTime);
  return normalizeRentalDaysValue(fallbackDays, { min, max, allowNull: true });
};

const calculateFixedDropDateTime = (pickupDateTime, rentalDays, options = {}) => {
  const { dropHour = FIXED_DROP_HOUR, dropMinute = FIXED_DROP_MINUTE } = options;
  const pickup = pickupDateTime instanceof Date
    ? new Date(pickupDateTime.getTime())
    : parseDateTimeInput(pickupDateTime);
  if (!pickup || Number.isNaN(pickup.getTime())) return null;

  const normalizedDays = normalizeRentalDaysValue(rentalDays, { allowNull: true });
  if (!normalizedDays) return null;

  const drop = toDateOnly(pickup);
  drop.setDate(drop.getDate() + normalizedDays);
  drop.setHours(dropHour, dropMinute, 0, 0);

  return drop;
};

const getInclusiveBillingDays = (pickupDateTime, dropDateTime) => {
  if (!pickupDateTime || !dropDateTime) return 0;
  const start = toDateOnly(pickupDateTime);
  const end = toDateOnly(dropDateTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;
  return Math.max(Math.ceil((end - start) / ONE_DAY_MS) + 1, 1);
};

const getRentalDurationHours = (pickupDateTime, dropDateTime) => {
  if (!pickupDateTime || !dropDateTime) return 0;

  const pickup = new Date(pickupDateTime);
  const drop = new Date(dropDateTime);
  if (Number.isNaN(pickup.getTime()) || Number.isNaN(drop.getTime())) return 0;

  const diffMs = drop.getTime() - pickup.getTime();
  if (diffMs <= 0) return 0;

  // Any started minute is treated as billable for predictable slab calculations.
  const totalMinutes = Math.ceil(diffMs / ONE_MINUTE_MS);
  return totalMinutes / 60;
};

const getTimeBasedBillingDays = (pickupDateTime, dropDateTime) => {
  const totalHours = getRentalDurationHours(pickupDateTime, dropDateTime);
  if (totalHours <= 0) return 0;

  const fullDays = Math.floor(totalHours / HOURS_PER_DAY);
  const remainderHours = Number((totalHours - fullDays * HOURS_PER_DAY).toFixed(4));

  if (remainderHours <= 0) {
    return Math.max(fullDays, 0);
  }

  if (remainderHours < HALF_DAY_HOURS) {
    return fullDays + 0.5;
  }

  return fullDays + 1;
};

const calculateTimeBasedRentalAmount = (pickupDateTime, dropDateTime, pricePerDay) => {
  const days = getTimeBasedBillingDays(pickupDateTime, dropDateTime);
  const dailyPrice = Number(pricePerDay || 0);
  if (!Number.isFinite(dailyPrice) || dailyPrice <= 0 || days <= 0) {
    return { days, amount: 0 };
  }

  return {
    days,
    amount: Math.round(days * dailyPrice),
  };
};

module.exports = {
  ONE_HOUR_MS,
  ONE_DAY_MS,
  FIXED_DROP_HOUR,
  FIXED_DROP_MINUTE,
  MIN_RENTAL_DAYS,
  MAX_RENTAL_DAYS,
  parseDateTimeInput,
  normalizeStoredDateTime,
  normalizeRentalDaysValue,
  calculateRentalDaysByCalendar,
  resolveRentalDaysForFixedDrop,
  calculateFixedDropDateTime,
  validateRentalWindow,
  getInclusiveBillingDays,
  getRentalDurationHours,
  getTimeBasedBillingDays,
  calculateTimeBasedRentalAmount,
  toDateOnly,
};
