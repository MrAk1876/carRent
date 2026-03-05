const RANGE_TYPES = Object.freeze({
  LOW_RANGE: 'LOW_RANGE',
  MEDIUM_RANGE: 'MEDIUM_RANGE',
  HIGH_RANGE: 'HIGH_RANGE',
});

const RANGE_TYPE_VALUES = Object.freeze(Object.values(RANGE_TYPES));

const DEFAULT_DEPOSIT_RULES = Object.freeze({
  [RANGE_TYPES.LOW_RANGE]: 2000,
  [RANGE_TYPES.MEDIUM_RANGE]: 5000,
  [RANGE_TYPES.HIGH_RANGE]: 10000,
});

const LOW_RANGE_MAX_PRICE = Number(process.env.LOW_RANGE_MAX_PRICE || 3000);
const MEDIUM_RANGE_MAX_PRICE = Number(process.env.MEDIUM_RANGE_MAX_PRICE || 7000);

const normalizeRangeType = (value, fallback = RANGE_TYPES.LOW_RANGE) => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

  if (RANGE_TYPE_VALUES.includes(normalized)) {
    return normalized;
  }

  return fallback;
};

const toPositiveAmount = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return fallback;
  }
  return Number(numericValue.toFixed(2));
};

const resolveRangeTypeForPrice = (value, fallback = RANGE_TYPES.LOW_RANGE) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return fallback;
  }

  if (numericValue <= LOW_RANGE_MAX_PRICE) {
    return RANGE_TYPES.LOW_RANGE;
  }

  if (numericValue <= MEDIUM_RANGE_MAX_PRICE) {
    return RANGE_TYPES.MEDIUM_RANGE;
  }

  return RANGE_TYPES.HIGH_RANGE;
};

const resolveDefaultDepositAmount = (rangeType) =>
  toPositiveAmount(DEFAULT_DEPOSIT_RULES[normalizeRangeType(rangeType)] || 0, 0);

module.exports = {
  RANGE_TYPES,
  RANGE_TYPE_VALUES,
  DEFAULT_DEPOSIT_RULES,
  LOW_RANGE_MAX_PRICE,
  MEDIUM_RANGE_MAX_PRICE,
  normalizeRangeType,
  resolveRangeTypeForPrice,
  resolveDefaultDepositAmount,
  toPositiveAmount,
};
