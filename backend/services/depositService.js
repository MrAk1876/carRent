const mongoose = require('mongoose');
const DepositRule = require('../models/DepositRule');
const { getTenantIdFromContext } = require('./tenantContextService');
const {
  RANGE_TYPES,
  RANGE_TYPE_VALUES,
  normalizeRangeType,
  resolveRangeTypeForPrice,
  toPositiveAmount,
} = require('../utils/depositRangeUtils');

const DEFAULT_PRICE_WINDOWS = Object.freeze({
  [RANGE_TYPES.LOW_RANGE]: { minPrice: 0, maxPrice: 3000, depositAmount: 2000 },
  [RANGE_TYPES.MEDIUM_RANGE]: { minPrice: 3001, maxPrice: 7000, depositAmount: 5000 },
  [RANGE_TYPES.HIGH_RANGE]: { minPrice: 7001, maxPrice: 999999, depositAmount: 10000 },
});

const toObjectId = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const resolveScopedTenantObjectId = (tenantId = null) => {
  const explicitTenant = toObjectId(tenantId);
  if (explicitTenant) return explicitTenant;
  return toObjectId(getTenantIdFromContext());
};

const normalizeRuleInput = (payload = {}, options = {}) => {
  const allowPartial = Boolean(options.allowPartial);
  const hasRangeNameInput = payload.rangeName !== undefined || payload.rangeType !== undefined;
  const normalizedRangeName = normalizeRangeType(payload.rangeName || payload.rangeType, '');
  const fallbackRangeName = RANGE_TYPE_VALUES.includes(normalizedRangeName)
    ? normalizedRangeName
    : RANGE_TYPES.LOW_RANGE;
  const defaultWindow = DEFAULT_PRICE_WINDOWS[fallbackRangeName] || DEFAULT_PRICE_WINDOWS[RANGE_TYPES.LOW_RANGE];

  const parseNumber = (value, fallback = NaN) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return numericValue;
  };

  const hasMinPrice = payload.minPrice !== undefined;
  const hasMaxPrice = payload.maxPrice !== undefined;
  const hasDepositAmount = payload.depositAmount !== undefined;

  const minPriceRaw = parseNumber(payload.minPrice, defaultWindow.minPrice);
  const maxPriceRaw = parseNumber(payload.maxPrice, defaultWindow.maxPrice);
  const depositAmountRaw = toPositiveAmount(payload.depositAmount, defaultWindow.depositAmount);

  const minPrice = Number.isFinite(minPriceRaw) && minPriceRaw >= 0 ? Number(minPriceRaw.toFixed(2)) : NaN;
  const maxPrice = Number.isFinite(maxPriceRaw) && maxPriceRaw >= 0 ? Number(maxPriceRaw.toFixed(2)) : NaN;
  const depositAmount = Number.isFinite(depositAmountRaw) && depositAmountRaw >= 0 ? depositAmountRaw : NaN;

  if (!allowPartial && !hasRangeNameInput) {
    const error = new Error('rangeName is required');
    error.status = 422;
    throw error;
  }

  if ((!allowPartial || hasRangeNameInput) && !RANGE_TYPE_VALUES.includes(normalizedRangeName)) {
    const error = new Error('rangeName must be LOW_RANGE, MEDIUM_RANGE, or HIGH_RANGE');
    error.status = 422;
    throw error;
  }

  if ((!allowPartial || hasMinPrice) && (!Number.isFinite(minPrice) || minPrice < 0)) {
    const error = new Error('minPrice must be a non-negative number');
    error.status = 422;
    throw error;
  }

  if ((!allowPartial || hasMaxPrice) && (!Number.isFinite(maxPrice) || maxPrice < 0)) {
    const error = new Error('maxPrice must be a non-negative number');
    error.status = 422;
    throw error;
  }

  if ((!allowPartial || hasDepositAmount) && (!Number.isFinite(depositAmount) || depositAmount < 0)) {
    const error = new Error('depositAmount must be a non-negative number');
    error.status = 422;
    throw error;
  }

  if (
    (!allowPartial || (hasMinPrice || hasMaxPrice)) &&
    Number.isFinite(minPrice) &&
    Number.isFinite(maxPrice) &&
    maxPrice < minPrice
  ) {
    const error = new Error('maxPrice must be greater than or equal to minPrice');
    error.status = 422;
    throw error;
  }

  const normalized = {};

  if (!allowPartial || hasRangeNameInput) {
    normalized.rangeName = fallbackRangeName;
    normalized.rangeType = fallbackRangeName;
  }
  if (!allowPartial || hasMinPrice) {
    normalized.minPrice = Number.isFinite(minPrice) ? minPrice : defaultWindow.minPrice;
  }
  if (!allowPartial || hasMaxPrice) {
    normalized.maxPrice = Number.isFinite(maxPrice) ? maxPrice : defaultWindow.maxPrice;
  }
  if (!allowPartial || hasDepositAmount) {
    normalized.depositAmount = Number.isFinite(depositAmount) ? depositAmount : defaultWindow.depositAmount;
  }
  if (payload.isActive !== undefined) {
    normalized.isActive = Boolean(payload.isActive);
  } else if (!allowPartial) {
    normalized.isActive = true;
  }

  return normalized;
};

const hasOverlappingRange = (targetRule, existingRule) => {
  const targetMin = Number(targetRule?.minPrice);
  const targetMax = Number(targetRule?.maxPrice);
  const currentMin = Number(existingRule?.minPrice);
  const currentMax = Number(existingRule?.maxPrice);
  if (!Number.isFinite(targetMin) || !Number.isFinite(targetMax)) return false;
  if (!Number.isFinite(currentMin) || !Number.isFinite(currentMax)) return false;
  return targetMin <= currentMax && currentMin <= targetMax;
};

const formatRule = (rule) => ({
  _id: String(rule?._id || ''),
  rangeName: normalizeRangeType(rule?.rangeName || rule?.rangeType, RANGE_TYPES.LOW_RANGE),
  rangeType: normalizeRangeType(rule?.rangeType || rule?.rangeName, RANGE_TYPES.LOW_RANGE),
  minPrice: Number(rule?.minPrice || 0),
  maxPrice: Number(rule?.maxPrice || 0),
  depositAmount: toPositiveAmount(rule?.depositAmount, 0),
  isActive: Boolean(rule?.isActive),
  createdAt: rule?.createdAt || null,
  updatedAt: rule?.updatedAt || null,
});

const buildDefaultRules = () =>
  RANGE_TYPE_VALUES.map((rangeName) => {
    const defaults = DEFAULT_PRICE_WINDOWS[rangeName];
    return {
      rangeName,
      rangeType: rangeName,
      minPrice: defaults.minPrice,
      maxPrice: defaults.maxPrice,
      depositAmount: defaults.depositAmount,
      isActive: true,
    };
  });

const ensureDefaultDepositRules = async (tenantId = null) => {
  const scopedTenantId = resolveScopedTenantObjectId(tenantId);
  const existingCount = await DepositRule.countDocuments({});
  if (existingCount > 0) return;

  const defaults = buildDefaultRules().map((entry) =>
    scopedTenantId
      ? {
          ...entry,
          tenantId: scopedTenantId,
        }
      : entry,
  );

  try {
    await DepositRule.insertMany(defaults, { ordered: false });
  } catch (error) {
    if (Number(error?.code) !== 11000) {
      throw error;
    }
  }
};

const getDepositRules = async (options = {}) => {
  await ensureDefaultDepositRules(options.tenantId || null);
  const rules = await DepositRule.find({})
    .sort({ minPrice: 1, rangeName: 1 })
    .lean();
  return rules.map(formatRule);
};

const assertNoOverlappingRule = async ({ minPrice, maxPrice, ignoreRuleId = '' }) => {
  const existingRules = await DepositRule.find({})
    .select('_id minPrice maxPrice')
    .lean();

  const overlap = existingRules.find((rule) => {
    const isSameRule = ignoreRuleId && String(rule?._id || '') === String(ignoreRuleId || '');
    if (isSameRule) return false;
    return hasOverlappingRange({ minPrice, maxPrice }, rule);
  });

  if (overlap?._id) {
    const error = new Error('Rule range overlaps with an existing deposit rule');
    error.status = 422;
    throw error;
  }
};

const createDepositRule = async (payload = {}, options = {}) => {
  const normalized = normalizeRuleInput(payload);
  await assertNoOverlappingRule({
    minPrice: normalized.minPrice,
    maxPrice: normalized.maxPrice,
  });

  const scopedTenantId = resolveScopedTenantObjectId(options.tenantId || null);
  let rule;
  try {
    rule = await DepositRule.create({
      ...normalized,
      ...(scopedTenantId ? { tenantId: scopedTenantId } : {}),
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      const duplicateError = new Error('A deposit rule for this range already exists');
      duplicateError.status = 422;
      throw duplicateError;
    }
    throw error;
  }

  return formatRule(rule.toObject());
};

const updateDepositRule = async (ruleId, payload = {}) => {
  const normalizedRuleId = String(ruleId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(normalizedRuleId)) {
    const error = new Error('Invalid rule id');
    error.status = 422;
    throw error;
  }

  const rule = await DepositRule.findById(normalizedRuleId);
  if (!rule) {
    const error = new Error('Deposit rule not found');
    error.status = 404;
    throw error;
  }

  const normalized = normalizeRuleInput(payload, { allowPartial: true });

  const nextRule = {
    minPrice: normalized.minPrice !== undefined ? normalized.minPrice : Number(rule.minPrice || 0),
    maxPrice: normalized.maxPrice !== undefined ? normalized.maxPrice : Number(rule.maxPrice || 0),
  };
  await assertNoOverlappingRule({
    minPrice: nextRule.minPrice,
    maxPrice: nextRule.maxPrice,
    ignoreRuleId: normalizedRuleId,
  });

  if (normalized.rangeName !== undefined) {
    rule.rangeName = normalized.rangeName;
    rule.rangeType = normalized.rangeType || normalized.rangeName;
  }
  if (normalized.minPrice !== undefined) {
    rule.minPrice = normalized.minPrice;
  }
  if (normalized.maxPrice !== undefined) {
    rule.maxPrice = normalized.maxPrice;
  }
  if (normalized.depositAmount !== undefined) {
    rule.depositAmount = normalized.depositAmount;
  }
  if (normalized.isActive !== undefined) {
    rule.isActive = normalized.isActive;
  }

  try {
    await rule.save();
  } catch (error) {
    if (Number(error?.code) === 11000) {
      const duplicateError = new Error('A deposit rule for this range already exists');
      duplicateError.status = 422;
      throw duplicateError;
    }
    throw error;
  }
  return formatRule(rule.toObject());
};

const deleteDepositRule = async (ruleId) => {
  const normalizedRuleId = String(ruleId || '').trim();
  if (!mongoose.Types.ObjectId.isValid(normalizedRuleId)) {
    const error = new Error('Invalid rule id');
    error.status = 422;
    throw error;
  }

  const deleted = await DepositRule.findByIdAndDelete(normalizedRuleId).lean();
  if (!deleted?._id) {
    const error = new Error('Deposit rule not found');
    error.status = 404;
    throw error;
  }

  return formatRule(deleted);
};

const resolveFallbackRuleByRangeName = (rangeName) => {
  const normalizedRange = normalizeRangeType(rangeName, RANGE_TYPES.LOW_RANGE);
  const defaults = DEFAULT_PRICE_WINDOWS[normalizedRange] || DEFAULT_PRICE_WINDOWS[RANGE_TYPES.LOW_RANGE];
  return {
    rangeName: normalizedRange,
    rangeType: normalizedRange,
    minPrice: defaults.minPrice,
    maxPrice: defaults.maxPrice,
    depositAmount: defaults.depositAmount,
    isRuleActive: true,
    source: 'DEFAULT',
    ruleId: null,
  };
};

const resolveDepositForCar = async ({ car = null, perDayPrice = null } = {}) => {
  await ensureDefaultDepositRules();

  const candidatePrice = Number(perDayPrice ?? car?.pricePerDay ?? 0);
  const normalizedPrice = Number.isFinite(candidatePrice) && candidatePrice >= 0 ? candidatePrice : 0;
  const rules = await DepositRule.find({})
    .sort({ minPrice: 1, createdAt: 1 })
    .lean();

  const matchingRule = rules.find((rule) => {
    const minPrice = Number(rule?.minPrice);
    const maxPrice = Number(rule?.maxPrice);
    if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return false;
    return normalizedPrice >= minPrice && normalizedPrice <= maxPrice;
  });

  if (matchingRule) {
    const normalizedRangeName = normalizeRangeType(
      matchingRule.rangeName || matchingRule.rangeType,
      resolveRangeTypeForPrice(normalizedPrice, RANGE_TYPES.LOW_RANGE),
    );
    return {
      rangeName: normalizedRangeName,
      rangeType: normalizedRangeName,
      minPrice: Number(matchingRule.minPrice || 0),
      maxPrice: Number(matchingRule.maxPrice || 0),
      depositAmount: matchingRule.isActive ? toPositiveAmount(matchingRule.depositAmount, 0) : 0,
      isRuleActive: Boolean(matchingRule.isActive),
      source: matchingRule.isActive ? 'RULE' : 'RULE_INACTIVE',
      ruleId: String(matchingRule._id || ''),
    };
  }

  const fallbackRangeName = normalizeRangeType(
    car?.priceRangeType || resolveRangeTypeForPrice(normalizedPrice, RANGE_TYPES.LOW_RANGE),
    RANGE_TYPES.LOW_RANGE,
  );
  return resolveFallbackRuleByRangeName(fallbackRangeName);
};

module.exports = {
  RANGE_TYPES,
  RANGE_TYPE_VALUES,
  DEFAULT_PRICE_WINDOWS,
  ensureDefaultDepositRules,
  getDepositRules,
  createDepositRule,
  updateDepositRule,
  deleteDepositRule,
  resolveDepositForCar,
  normalizeRangeType,
  resolveRangeTypeForPrice,
};
