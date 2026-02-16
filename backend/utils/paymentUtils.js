const normalizeStatusKey = (value) => String(value || '')
  .trim()
  .toUpperCase()
  .replace(/[\s_-]+/g, '');

const getAdvanceRate = (rawAmount) => {
  const amount = Number(rawAmount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return 0.3;
  }

  if (amount < 3000) return 0.3;
  if (amount <= 10000) return 0.25;
  return 0.2;
};

const calculateAdvanceBreakdown = (rawFinalAmount) => {
  const finalAmount = Math.max(Number(rawFinalAmount || 0), 0);
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

const resolveFinalAmount = (record = {}) => {
  const preferred = Number(record.finalAmount);
  if (Number.isFinite(preferred) && preferred > 0) {
    return preferred;
  }

  const fallback = Number(record.totalAmount);
  if (Number.isFinite(fallback) && fallback > 0) {
    return fallback;
  }

  return 0;
};

const isAdvancePaidStatus = (status) => {
  const normalized = normalizeStatusKey(status);
  return normalized === 'PAID' || normalized === 'PARTIALLYPAID' || normalized === 'FULLYPAID' || normalized === 'ADVANCEPAID';
};

const isFullyPaidStatus = (status) => normalizeStatusKey(status) === 'FULLYPAID';

const isConfirmedBookingStatus = (status) => normalizeStatusKey(status) === 'CONFIRMED';

const isPendingPaymentBookingStatus = (status) => {
  const normalized = normalizeStatusKey(status);
  return normalized === 'PENDING' || normalized === 'PENDINGPAYMENT';
};

const isCancelledBookingStatus = (status) => {
  const normalized = normalizeStatusKey(status);
  return normalized === 'CANCELLED' || normalized === 'CANCELLEDBYUSER' || normalized === 'REJECTED';
};

module.exports = {
  calculateAdvanceBreakdown,
  getAdvanceRate,
  resolveFinalAmount,
  isAdvancePaidStatus,
  isFullyPaidStatus,
  isConfirmedBookingStatus,
  isPendingPaymentBookingStatus,
  isCancelledBookingStatus,
  normalizeStatusKey,
};
