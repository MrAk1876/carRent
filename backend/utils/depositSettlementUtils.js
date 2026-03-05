const toPositiveAmount = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }
  return Number(numericValue.toFixed(2));
};

const resolveHeldDepositAmount = (booking = {}) => {
  const paidAmount = toPositiveAmount(booking?.depositPaid, 0);
  if (paidAmount > 0) return paidAmount;

  const configuredAmount = toPositiveAmount(booking?.depositAmount, 0);
  const normalizedDepositStatus = String(booking?.depositStatus || '').trim().toUpperCase();
  if (configuredAmount > 0 && ['HELD', 'DEDUCTED', 'REFUNDED', 'PARTIALLY_DEDUCTED'].includes(normalizedDepositStatus)) {
    return configuredAmount;
  }

  return 0;
};

const resolveDepositSettlementSnapshot = ({ booking = {}, damageCost = null } = {}) => {
  const heldDeposit = resolveHeldDepositAmount(booking);
  if (heldDeposit <= 0) {
    return {
      heldDeposit: 0,
      depositDeducted: 0,
      depositRefunded: 0,
      damageOutstanding: toPositiveAmount(damageCost, 0),
      depositStatus: 'NOT_APPLICABLE',
    };
  }

  if (!Number.isFinite(Number(damageCost))) {
    return {
      heldDeposit,
      depositDeducted: toPositiveAmount(booking?.depositDeducted, 0),
      depositRefunded: toPositiveAmount(booking?.depositRefunded, 0),
      damageOutstanding: 0,
      depositStatus: 'HELD',
    };
  }

  const normalizedDamageCost = toPositiveAmount(damageCost, 0);
  const depositDeducted = Math.min(heldDeposit, normalizedDamageCost);
  const damageOutstanding = Math.max(normalizedDamageCost - depositDeducted, 0);
  const depositRefunded = Math.max(heldDeposit - depositDeducted, 0);
  const depositStatus = depositDeducted > 0 ? 'DEDUCTED' : 'REFUNDED';

  return {
    heldDeposit,
    depositDeducted: toPositiveAmount(depositDeducted, 0),
    depositRefunded: toPositiveAmount(depositRefunded, 0),
    damageOutstanding: toPositiveAmount(damageOutstanding, 0),
    depositStatus,
  };
};

module.exports = {
  toPositiveAmount,
  resolveHeldDepositAmount,
  resolveDepositSettlementSnapshot,
};
