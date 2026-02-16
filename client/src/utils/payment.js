const normalizeStatusKey = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');

const ONE_MINUTE_MS = 60 * 1000;
const HOURS_PER_DAY = 24;
const HALF_DAY_HOURS = 12;

export const getRentalDurationHours = (pickupDateTime, dropDateTime) => {
  if (!pickupDateTime || !dropDateTime) return 0;

  const pickup = new Date(pickupDateTime);
  const drop = new Date(dropDateTime);
  if (Number.isNaN(pickup.getTime()) || Number.isNaN(drop.getTime())) return 0;

  const diffMs = drop.getTime() - pickup.getTime();
  if (diffMs <= 0) return 0;

  const totalMinutes = Math.ceil(diffMs / ONE_MINUTE_MS);
  return totalMinutes / 60;
};

export const getTimeBasedBillingDays = (pickupDateTime, dropDateTime) => {
  const totalHours = getRentalDurationHours(pickupDateTime, dropDateTime);
  if (totalHours <= 0) return 0;

  const fullDays = Math.floor(totalHours / HOURS_PER_DAY);
  const remainderHours = Number((totalHours - fullDays * HOURS_PER_DAY).toFixed(4));

  if (remainderHours <= 0) return fullDays;
  if (remainderHours < HALF_DAY_HOURS) return fullDays + 0.5;
  return fullDays + 1;
};

export const calculateTimeBasedRentalAmount = (pickupDateTime, dropDateTime, pricePerDay) => {
  const days = getTimeBasedBillingDays(pickupDateTime, dropDateTime);
  const dailyPrice = Number(pricePerDay || 0);

  if (!Number.isFinite(dailyPrice) || dailyPrice <= 0 || days <= 0) {
    return {
      days,
      amount: 0,
    };
  }

  return {
    days,
    amount: Math.round(days * dailyPrice),
  };
};

export const getAdvanceRate = (rawAmount) => {
  const amount = Number(rawAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0.3;
  if (amount < 3000) return 0.3;
  if (amount <= 10000) return 0.25;
  return 0.2;
};

export const calculateAdvanceBreakdown = (rawAmount) => {
  const finalAmount = Math.max(Number(rawAmount || 0), 0);
  const advanceRate = getAdvanceRate(finalAmount);
  const advanceRequired = Math.max(Math.round(finalAmount * advanceRate), 0);
  const remainingAmount = Math.max(finalAmount - advanceRequired, 0);

  return {
    finalAmount,
    advanceRate,
    advanceRequired,
    remainingAmount,
  };
};

export const resolveFinalAmount = (item) => {
  const finalAmount = Number(item?.finalAmount);
  if (Number.isFinite(finalAmount) && finalAmount > 0) return finalAmount;
  const totalAmount = Number(item?.totalAmount);
  if (Number.isFinite(totalAmount) && totalAmount > 0) return totalAmount;
  return 0;
};

export const resolveAdvanceRequired = (item) => {
  const advanceRequired = Number(item?.advanceRequired);
  if (Number.isFinite(advanceRequired) && advanceRequired >= 0) return advanceRequired;
  const advanceAmount = Number(item?.advanceAmount);
  if (Number.isFinite(advanceAmount) && advanceAmount >= 0) return advanceAmount;
  return 0;
};

export const resolveAdvancePaid = (item) => {
  const advancePaid = Number(item?.advancePaid);
  if (Number.isFinite(advancePaid) && advancePaid >= 0) return advancePaid;
  if (isAdvancePaidStatus(item?.paymentStatus)) return resolveAdvanceRequired(item);
  return 0;
};

export const resolveHourlyLateRate = (item) => {
  const hourlyLateRate = Number(item?.hourlyLateRate);
  if (Number.isFinite(hourlyLateRate) && hourlyLateRate >= 0) return hourlyLateRate;
  return 0;
};

export const resolveLateHours = (item) => {
  const lateHours = Number(item?.lateHours);
  if (Number.isFinite(lateHours) && lateHours >= 0) return Math.floor(lateHours);
  return 0;
};

export const resolveLateFee = (item) => {
  const lateFee = Number(item?.lateFee);
  if (Number.isFinite(lateFee) && lateFee >= 0) return lateFee;

  const lateHours = resolveLateHours(item);
  const hourlyLateRate = resolveHourlyLateRate(item);
  return Math.max(Number((lateHours * hourlyLateRate).toFixed(2)), 0);
};

export const resolveRemainingAmount = (item) => {
  const remainingAmount = Number(item?.remainingAmount);
  if (Number.isFinite(remainingAmount) && remainingAmount >= 0) return remainingAmount;

  const finalAmount = resolveFinalAmount(item);
  if (isFullyPaidStatus(item?.paymentStatus)) return 0;

  const advancePaid = resolveAdvancePaid(item);
  const fallbackAdvance = advancePaid > 0 ? advancePaid : resolveAdvanceRequired(item);
  const lateFee = resolveLateFee(item);
  return Math.max(finalAmount - fallbackAdvance, 0) + lateFee;
};

export const resolvePickupDateTime = (item) => item?.pickupDateTime || item?.fromDate || '';

export const resolveDropDateTime = (item) => item?.dropDateTime || item?.toDate || '';

export const resolveRentalStage = (item) => {
  const normalizedStage = String(item?.rentalStage || '').trim();
  if (normalizedStage) return normalizedStage;

  const normalizedTripStatus = normalizeStatusKey(item?.tripStatus);
  if (normalizedTripStatus === 'COMPLETED') return 'Completed';
  if (normalizedTripStatus === 'ACTIVE') return 'Active';
  return 'Scheduled';
};

export const isAdvancePaidStatus = (status) => {
  const normalized = normalizeStatusKey(status);
  return ['PAID', 'ADVANCEPAID', 'PARTIALLYPAID', 'FULLYPAID'].includes(normalized);
};

export const isFullyPaidStatus = (status) => normalizeStatusKey(status) === 'FULLYPAID';

export const isConfirmedBookingStatus = (status) => normalizeStatusKey(status) === 'CONFIRMED';

export const isPendingPaymentBookingStatus = (status) => {
  const normalized = normalizeStatusKey(status);
  return normalized === 'PENDING' || normalized === 'PENDINGPAYMENT';
};

export const isCancelledBookingStatus = (status) => {
  const normalized = normalizeStatusKey(status);
  return ['CANCELLED', 'CANCELLEDBYUSER', 'REJECTED'].includes(normalized);
};

export const getNormalizedStatusKey = normalizeStatusKey;
