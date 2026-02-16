const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_MINUTE_MS = 60 * 1000;
const HOURS_PER_DAY = 24;
const HALF_DAY_HOURS = 12;
const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const toDateOnly = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
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
  parseDateTimeInput,
  normalizeStoredDateTime,
  validateRentalWindow,
  getInclusiveBillingDays,
  getRentalDurationHours,
  getTimeBasedBillingDays,
  calculateTimeBasedRentalAmount,
  toDateOnly,
};
