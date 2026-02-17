const { normalizeStatusKey, isAdvancePaidStatus, resolveFinalAmount } = require('../utils/paymentUtils');

const REFUND_STATUS_PROCESSED = 'Processed';
const REFUND_STATUS_NONE = 'None';

const toPositiveNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return fallback;
  return numericValue;
};

const roundCurrency = (value) => Number(toPositiveNumber(value, 0).toFixed(2));

const resolveAdvancePaidAmount = (booking) => {
  const advancePaid = toPositiveNumber(booking?.advancePaid, 0);
  if (advancePaid > 0) return advancePaid;

  if (isAdvancePaidStatus(booking?.paymentStatus)) {
    return Math.max(
      toPositiveNumber(booking?.advanceRequired, 0),
      toPositiveNumber(booking?.advanceAmount, 0),
    );
  }

  return 0;
};

const resolveFullPaymentAmount = (booking) => toPositiveNumber(booking?.fullPaymentAmount, 0);

const resolveTotalPaid = (booking) =>
  roundCurrency(resolveAdvancePaidAmount(booking) + resolveFullPaymentAmount(booking));

const resolveLateFee = (booking) => toPositiveNumber(booking?.lateFee, 0);
const resolveLateHours = (booking) => Math.max(Math.floor(toPositiveNumber(booking?.lateHours, 0)), 0);
const resolveDamageCost = (booking) => {
  if (!booking?.returnInspection?.damageDetected) return 0;
  return toPositiveNumber(booking?.returnInspection?.damageCost, 0);
};

const createRefundError = (message, status = 422) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const isCancelledBeforePickup = (booking) => {
  const bookingStatusKey = normalizeStatusKey(booking?.bookingStatus);
  if (bookingStatusKey !== 'CANCELLED') return false;

  const pickupDateTime = new Date(booking?.pickupDateTime || booking?.fromDate || '');
  if (Number.isNaN(pickupDateTime.getTime())) return false;

  const cancellationReference = new Date(
    booking?.cancelledAt || booking?.updatedAt || booking?.createdAt || '',
  );
  if (Number.isNaN(cancellationReference.getTime())) return false;

  return cancellationReference.getTime() < pickupDateTime.getTime();
};

const validateRefundEligibility = (booking) => {
  if (!booking) {
    throw createRefundError('Booking not found', 404);
  }

  const bookingStatusKey = normalizeStatusKey(booking.bookingStatus);
  if (!['CANCELLED', 'COMPLETED'].includes(bookingStatusKey)) {
    throw createRefundError('Refund allowed only for cancelled or completed bookings');
  }

  const paymentStatusKey = normalizeStatusKey(booking.paymentStatus);
  if (!['PARTIALLYPAID', 'FULLYPAID'].includes(paymentStatusKey)) {
    throw createRefundError('Refund allowed only for partially paid or fully paid bookings');
  }

  if (normalizeStatusKey(booking.refundStatus) === 'PROCESSED') {
    throw createRefundError('Refund is already processed for this booking', 409);
  }

  const totalPaid = resolveTotalPaid(booking);
  if (totalPaid <= 0) {
    throw createRefundError('No paid amount available for refund');
  }

  const advancePaid = resolveAdvancePaidAmount(booking);
  const lateFee = resolveLateFee(booking);
  const lateHours = resolveLateHours(booking);
  const damageCost = resolveDamageCost(booking);
  const maxRefundableAmount = roundCurrency(Math.max(totalPaid - damageCost, 0));

  if (maxRefundableAmount <= 0) {
    throw createRefundError('No refund allowed after damage charges adjustment');
  }

  if (lateHours > 0 && lateFee > advancePaid) {
    throw createRefundError('No refund allowed because overdue penalty exceeds advance paid');
  }

  return {
    bookingStatusKey,
    paymentStatusKey,
    totalPaid,
    maxRefundableAmount,
    advancePaid,
    lateFee,
    damageCost,
  };
};

const calculateRefundAmount = (booking, options = {}) => {
  const { totalPaid, advancePaid, maxRefundableAmount } = validateRefundEligibility(booking);
  const requestedAmount = Number(options.refundAmount);
  const hasRequestedAmount = Number.isFinite(requestedAmount) && requestedAmount > 0;

  const refundTypeKey = normalizeStatusKey(options.refundType || '');
  const fullRefundEligible = isCancelledBeforePickup(booking);

  if (fullRefundEligible) {
    const fullRefundAmount = roundCurrency(Math.min(advancePaid, maxRefundableAmount));
    if (fullRefundAmount <= 0) {
      throw createRefundError('No advance amount available for full refund');
    }

    if (hasRequestedAmount && roundCurrency(requestedAmount) !== fullRefundAmount) {
      throw createRefundError(
        `This booking qualifies for fixed full refund of ${fullRefundAmount}. Partial/manual amount is not allowed.`,
      );
    }

    return {
      refundAmount: fullRefundAmount,
      refundType: 'Full',
      totalPaid,
      fullRefundEligible,
    };
  }

  if (refundTypeKey === 'FULL') {
    throw createRefundError('Full refund is allowed only when cancellation happens before pickup');
  }

  if (!hasRequestedAmount) {
    throw createRefundError('refundAmount is required for partial refund');
  }

  const normalizedRequestedAmount = roundCurrency(requestedAmount);
  if (normalizedRequestedAmount <= 0) {
    throw createRefundError('refundAmount must be greater than 0');
  }

  if (normalizedRequestedAmount > maxRefundableAmount) {
    throw createRefundError(`refundAmount cannot exceed refundable amount (${maxRefundableAmount})`);
  }

  return {
    refundAmount: normalizedRequestedAmount,
    refundType: 'Partial',
    totalPaid,
    fullRefundEligible,
  };
};

const applyRefundToBooking = (booking, options = {}) => {
  const now = options.now instanceof Date ? options.now : new Date();
  const refundReason = String(options.refundReason || '').trim();
  const { refundAmount, refundType, totalPaid } = calculateRefundAmount(booking, options);

  let remainingRefund = refundAmount;
  const currentFullPayment = resolveFullPaymentAmount(booking);
  const refundFromFullPayment = Math.min(currentFullPayment, remainingRefund);
  const nextFullPayment = roundCurrency(currentFullPayment - refundFromFullPayment);
  remainingRefund = roundCurrency(remainingRefund - refundFromFullPayment);

  const currentAdvancePaid = resolveAdvancePaidAmount(booking);
  const refundFromAdvance = Math.min(currentAdvancePaid, remainingRefund);
  const nextAdvancePaid = roundCurrency(currentAdvancePaid - refundFromAdvance);

  booking.fullPaymentAmount = nextFullPayment;
  booking.advancePaid = nextAdvancePaid;
  booking.refundAmount = refundAmount;
  booking.refundStatus = REFUND_STATUS_PROCESSED;
  booking.refundReason = refundReason;
  booking.refundProcessedAt = now;
  booking.remainingAmount = 0;

  if (refundAmount >= totalPaid - 0.009) {
    booking.paymentStatus = 'REFUNDED';
  } else if (normalizeStatusKey(booking.bookingStatus) === 'CANCELLED') {
    booking.paymentStatus = 'Partially Paid';
  } else {
    booking.paymentStatus = 'Fully Paid';
  }

  const totalPaidAfterRefund = resolveTotalPaid(booking);

  return {
    refundAmount,
    refundType,
    totalPaidBeforeRefund: totalPaid,
    totalPaidAfterRefund,
    remainingAmount: roundCurrency(booking.remainingAmount),
    refundReason,
  };
};

const rejectRefundRequest = (booking, reason = '') => {
  if (!booking) {
    throw createRefundError('Booking not found', 404);
  }

  if (normalizeStatusKey(booking.refundStatus) === 'PROCESSED') {
    throw createRefundError('Cannot reject a processed refund', 409);
  }

  booking.refundStatus = 'Rejected';
  booking.refundReason = String(reason || '').trim();
  booking.refundProcessedAt = null;
};

module.exports = {
  REFUND_STATUS_NONE,
  REFUND_STATUS_PROCESSED,
  resolveTotalPaid,
  resolveAdvancePaidAmount,
  validateRefundEligibility,
  calculateRefundAmount,
  applyRefundToBooking,
  rejectRefundRequest,
};
