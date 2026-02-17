const mongoose = require('mongoose');
const Car = require('../models/Car');
const Branch = require('../models/Branch');
const { buildPredictiveDemandAnalytics } = require('./predictiveDemandService');

const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_TTL_MS = Math.max(Number(process.env.SMART_PRICING_CACHE_TTL_MS || 15 * 60 * 1000), 60 * 1000);
const DEMAND_HISTORY_DAYS = 30;
const RULE_CAP_MAX_PERCENT = 30;
const RULE_FLOOR_MIN_PERCENT = -20;

const PRICING_SOURCE = Object.freeze({
  BASE: 'Base',
  DYNAMIC: 'Dynamic',
  MANUAL: 'Manual',
});

const demandSignalCache = new Map();

const safeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return numericValue;
};

const roundCurrency = (value) => Number(safeNumber(value, 0).toFixed(2));

const roundPrice = (value) => {
  const numeric = safeNumber(value, 0);
  if (numeric <= 0) return 0;
  return Math.max(Math.round(numeric), 0);
};

const clampPercent = (value, min = RULE_FLOOR_MIN_PERCENT, max = RULE_CAP_MAX_PERCENT) => {
  const numeric = safeNumber(value, 0);
  if (numeric < min) return min;
  if (numeric > max) return max;
  return Number(numeric.toFixed(2));
};

const toObjectId = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (mongoose.Types.ObjectId.isValid(value)) return String(value);
  if (value?._id && mongoose.Types.ObjectId.isValid(value._id)) return String(value._id);
  return '';
};

const toDayKey = (date = new Date()) => {
  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
};

const normalizeCategoryKey = (value) => String(value || '').trim().toLowerCase();

const isSameDay = (leftDate, rightDate) => {
  if (!leftDate || !rightDate) return false;
  return toDayKey(leftDate) === toDayKey(rightDate);
};

const toNullablePositiveNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
  return roundCurrency(numericValue);
};

const resolveBranchConfig = async (branchId) => {
  const branchObjectId = toObjectId(branchId);
  if (!branchObjectId) {
    return {
      branchId: '',
      branchDynamicPricingEnabled: false,
      branchDynamicPricingMultiplier: 1,
    };
  }

  const branch = await Branch.findById(branchObjectId)
    .select('_id dynamicPricingEnabled dynamicPricingMultiplier')
    .lean();
  return {
    branchId: String(branch?._id || ''),
    branchDynamicPricingEnabled: Boolean(branch?.dynamicPricingEnabled),
    branchDynamicPricingMultiplier: clampPercent((safeNumber(branch?.dynamicPricingMultiplier, 1) - 1) * 100, -10, 10) / 100 + 1,
  };
};

const calculateFleetUtilizationForBranch = async (branchId) => {
  const query = {};
  const branchObjectId = toObjectId(branchId);
  if (branchObjectId) {
    query.branchId = branchObjectId;
  }

  const cars = await Car.find(query).select('fleetStatus isAvailable').lean();
  if (!cars.length) {
    return {
      activeFleetCount: 0,
      engagedFleetCount: 0,
      fleetUtilizationPercent: 0,
    };
  }

  let activeFleetCount = 0;
  let engagedFleetCount = 0;

  for (const car of cars) {
    const statusKey = String(car?.fleetStatus || '').trim().toLowerCase();
    const fallbackStatus = car?.isAvailable === false ? 'inactive' : 'available';
    const normalizedStatus = statusKey || fallbackStatus;

    if (normalizedStatus === 'inactive' || normalizedStatus === 'maintenance') {
      continue;
    }

    activeFleetCount += 1;
    if (normalizedStatus === 'reserved' || normalizedStatus === 'rented') {
      engagedFleetCount += 1;
    }
  }

  return {
    activeFleetCount,
    engagedFleetCount,
    fleetUtilizationPercent:
      activeFleetCount > 0 ? Number(((engagedFleetCount / activeFleetCount) * 100).toFixed(2)) : 0,
  };
};

const buildDemandSignalCacheKey = (branchId, now = new Date()) => {
  const normalizedBranchId = String(branchId || '').trim() || 'GLOBAL';
  return `${normalizedBranchId}:${toDayKey(now)}`;
};

const getCachedDemandSignals = (cacheKey) => {
  const cached = demandSignalCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAtMs > CACHE_TTL_MS) {
    demandSignalCache.delete(cacheKey);
    return null;
  }
  return cached.value;
};

const setCachedDemandSignals = (cacheKey, value) => {
  demandSignalCache.set(cacheKey, {
    createdAtMs: Date.now(),
    value,
  });
};

const buildDemandSignalsForBranch = async (branchId, now = new Date()) => {
  const branchObjectId = toObjectId(branchId);
  const branchQuery = branchObjectId ? { branchId: branchObjectId } : {};
  const fromDate = new Date(now.getTime() - (DEMAND_HISTORY_DAYS - 1) * DAY_MS);
  const range = { fromDate, toDate: now };
  const branchMeta = await resolveBranchConfig(branchId);
  const visibleBranches = branchMeta.branchId
    ? [{ _id: branchMeta.branchId, branchName: 'Selected Branch', branchCode: '' }]
    : [];

  const [predictive, fleetUtilization] = await Promise.all([
    buildPredictiveDemandAnalytics(branchQuery, branchQuery, range, {
      now,
      selectedBranchId: branchMeta.branchId,
      visibleBranches,
      timezone: 'UTC',
    }),
    calculateFleetUtilizationForBranch(branchId),
  ]);

  const baselineAverageDailyBookings = safeNumber(
    predictive?.predictiveInsights?.baseline?.averageDailyBookings,
    0,
  );
  const demandForecast = Array.isArray(predictive?.demandForecast) ? predictive.demandForecast : [];
  const nextDemandDay = demandForecast.length > 0 ? demandForecast[0] : null;
  const predictedBookings = safeNumber(nextDemandDay?.predictedBookings, baselineAverageDailyBookings);
  const predictedRevenue = safeNumber(nextDemandDay?.predictedRevenue, 0);
  const predictedHighDemandHours = Array.isArray(nextDemandDay?.predictedHighDemandHours)
    ? nextDemandDay.predictedHighDemandHours
        .map((row) => safeNumber(row?.hour, -1))
        .filter((hour) => hour >= 0 && hour <= 23)
    : [];

  const vehicleDemandPrediction = Array.isArray(predictive?.vehicleDemandPrediction)
    ? predictive.vehicleDemandPrediction
    : [];
  const categoryShareByKey = new Map(
    vehicleDemandPrediction.map((row) => [
      normalizeCategoryKey(row?.category),
      safeNumber(row?.predictedSharePercent, 0),
    ]),
  );

  const shortageAlerts = Array.isArray(predictive?.fleetRiskAlerts)
    ? predictive.fleetRiskAlerts.filter((row) => {
        if (!branchMeta.branchId) return true;
        return String(row?.branchId || '') === branchMeta.branchId;
      })
    : [];
  const topShortageAlert = shortageAlerts
    .sort(
      (left, right) =>
        safeNumber(right?.shortageCount, 0) - safeNumber(left?.shortageCount, 0) ||
        String(left?.date || '').localeCompare(String(right?.date || '')),
    )[0] || null;

  const branchTrendFactor = safeNumber(nextDemandDay?.branchTrendFactor, 1) || 1;
  const demandRatio =
    baselineAverageDailyBookings > 0 ? predictedBookings / baselineAverageDailyBookings : 1;

  return {
    branchId: branchMeta.branchId,
    branchDynamicPricingEnabled: branchMeta.branchDynamicPricingEnabled,
    branchDynamicPricingMultiplier: branchMeta.branchDynamicPricingMultiplier,
    baselineAverageDailyBookings: roundCurrency(baselineAverageDailyBookings),
    predictedBookings: roundCurrency(predictedBookings),
    predictedRevenue: roundCurrency(predictedRevenue),
    demandRatio: Number(demandRatio.toFixed(4)),
    predictedHighDemandHours,
    categoryShareByKey,
    shortageCount: safeNumber(topShortageAlert?.shortageCount, 0),
    branchTrendFactor: roundCurrency(branchTrendFactor),
    activeFleetCount: fleetUtilization.activeFleetCount,
    engagedFleetCount: fleetUtilization.engagedFleetCount,
    fleetUtilizationPercent: roundCurrency(fleetUtilization.fleetUtilizationPercent),
    generatedAt: new Date(),
  };
};

const getDemandSignalsForBranch = async (branchId, now = new Date()) => {
  const cacheKey = buildDemandSignalCacheKey(branchId, now);
  const cached = getCachedDemandSignals(cacheKey);
  if (cached) return cached;

  const computedSignals = await buildDemandSignalsForBranch(branchId, now);
  setCachedDemandSignals(cacheKey, computedSignals);
  return computedSignals;
};

const calculateDemandAdjustmentPercent = (car, demandSignals, now = new Date()) => {
  const rulesApplied = [];
  let adjustmentPercent = 0;

  const baseline = safeNumber(demandSignals?.baselineAverageDailyBookings, 0);
  const predicted = safeNumber(demandSignals?.predictedBookings, 0);
  const demandRatio = baseline > 0 ? predicted / baseline : 1;

  if (baseline > 0 && demandRatio > 1.5) {
    adjustmentPercent += 25;
    rulesApplied.push('EXTREME_DEMAND_25');
  } else if (baseline > 0 && demandRatio > 1.25) {
    const span = (demandRatio - 1.25) / 0.25;
    const scaledPercent = 10 + Math.min(Math.max(span, 0), 1) * 10;
    adjustmentPercent += scaledPercent;
    rulesApplied.push('HIGH_DEMAND_10_20');
  } else if (baseline > 0 && demandRatio < 0.75) {
    adjustmentPercent -= 10;
    rulesApplied.push('LOW_DEMAND_MINUS_10');
  }

  const currentHour = now.getHours();
  const predictedHighHours = Array.isArray(demandSignals?.predictedHighDemandHours)
    ? demandSignals.predictedHighDemandHours
    : [];
  if (predictedHighHours.includes(currentHour)) {
    adjustmentPercent += 3;
    rulesApplied.push('PEAK_HOUR_PLUS_3');
  }

  const utilization = safeNumber(demandSignals?.fleetUtilizationPercent, 0);
  if (utilization >= 85) {
    adjustmentPercent += 5;
    rulesApplied.push('UTILIZATION_PLUS_5');
  } else if (utilization >= 70) {
    adjustmentPercent += 3;
    rulesApplied.push('UTILIZATION_PLUS_3');
  } else if (utilization > 0 && utilization <= 35) {
    adjustmentPercent -= 3;
    rulesApplied.push('LOW_UTILIZATION_MINUS_3');
  }

  const shortageCount = safeNumber(demandSignals?.shortageCount, 0);
  if (shortageCount > 0) {
    const shortageLift = Math.min(2 + shortageCount, 8);
    adjustmentPercent += shortageLift;
    rulesApplied.push('FLEET_SHORTAGE_LIFT');
  }

  const categoryKey = normalizeCategoryKey(car?.category);
  const categoryShare =
    demandSignals?.categoryShareByKey instanceof Map
      ? safeNumber(demandSignals.categoryShareByKey.get(categoryKey), 0)
      : 0;
  if (categoryShare >= 22) {
    adjustmentPercent += 5;
    rulesApplied.push('CATEGORY_POPULARITY_PLUS_5');
  } else if (categoryShare >= 14) {
    adjustmentPercent += 3;
    rulesApplied.push('CATEGORY_POPULARITY_PLUS_3');
  } else if (categoryShare > 0 && categoryShare <= 6) {
    adjustmentPercent -= 3;
    rulesApplied.push('CATEGORY_LOW_DEMAND_MINUS_3');
  }

  const branchMultiplier = safeNumber(demandSignals?.branchDynamicPricingMultiplier, 1);
  if (branchMultiplier > 0 && Math.abs(branchMultiplier - 1) >= 0.01) {
    const branchPercent = (branchMultiplier - 1) * 100;
    adjustmentPercent += branchPercent;
    rulesApplied.push('BRANCH_MULTIPLIER');
  }

  return {
    adjustmentPercent: clampPercent(adjustmentPercent),
    rulesApplied,
    demandRatio: roundCurrency(demandRatio),
    categorySharePercent: roundCurrency(categoryShare),
  };
};

const computePriceFromAdjustment = (basePricePerDay, rawAdjustmentPercent) => {
  const basePrice = safeNumber(basePricePerDay, 0);
  if (basePrice <= 0) {
    return {
      effectivePricePerDay: 0,
      priceAdjustmentPercent: 0,
    };
  }

  const cappedAdjustmentPercent = clampPercent(rawAdjustmentPercent);
  const floorPrice = Math.max(roundPrice(basePrice * (1 + RULE_FLOOR_MIN_PERCENT / 100)), 1);
  const capPrice = Math.max(roundPrice(basePrice * (1 + RULE_CAP_MAX_PERCENT / 100)), floorPrice);
  const adjustedPrice = roundPrice(basePrice * (1 + cappedAdjustmentPercent / 100));
  const effectivePricePerDay = Math.min(capPrice, Math.max(floorPrice, adjustedPrice));
  const actualAdjustmentPercent = clampPercent(((effectivePricePerDay - basePrice) / basePrice) * 100);

  return {
    effectivePricePerDay,
    priceAdjustmentPercent: actualAdjustmentPercent,
  };
};

const persistPricingSnapshotIfRequired = async (carId, existingCar, snapshot, options = {}) => {
  const persist = Boolean(options.persist);
  if (!persist || !carId) return;

  const existingLastUpdatedAt = existingCar?.lastPriceUpdatedAt ? new Date(existingCar.lastPriceUpdatedAt) : null;
  const shouldRefreshDay = !existingLastUpdatedAt || !isSameDay(existingLastUpdatedAt, snapshot.lastPriceUpdatedAt);
  const currentDynamicPrice = roundCurrency(existingCar?.currentDynamicPrice || 0);
  const currentManualOverride = toNullablePositiveNumber(existingCar?.manualOverridePrice);
  const nextManualOverride = toNullablePositiveNumber(snapshot.manualOverridePrice);
  const changed =
    currentDynamicPrice !== roundCurrency(snapshot.currentDynamicPrice) ||
    String(existingCar?.priceSource || '') !== snapshot.priceSource ||
    clampPercent(existingCar?.priceAdjustmentPercent || 0) !== clampPercent(snapshot.priceAdjustmentPercent || 0) ||
    Boolean(existingCar?.dynamicPriceEnabled) !== Boolean(snapshot.dynamicPriceEnabled) ||
    currentManualOverride !== nextManualOverride ||
    shouldRefreshDay;

  if (!changed) return;

  await Car.updateOne(
    { _id: carId },
    {
      $set: {
        dynamicPriceEnabled: Boolean(snapshot.dynamicPriceEnabled),
        currentDynamicPrice: roundCurrency(snapshot.currentDynamicPrice),
        lastPriceUpdatedAt: snapshot.lastPriceUpdatedAt,
        manualOverridePrice: nextManualOverride,
        priceSource: snapshot.priceSource,
        priceAdjustmentPercent: clampPercent(snapshot.priceAdjustmentPercent || 0),
      },
    },
  );
};

const resolveSmartPriceForCar = async (carInput, options = {}) => {
  const now = options.now instanceof Date ? options.now : new Date();
  const basePricePerDay = roundCurrency(carInput?.pricePerDay || 0);
  const dynamicPriceEnabled = Boolean(carInput?.dynamicPriceEnabled);
  const manualOverridePrice = toNullablePositiveNumber(carInput?.manualOverridePrice);
  const branchId = options.branchId || toObjectIdString(carInput?.branchId);
  const demandSignals = await getDemandSignalsForBranch(branchId, now);
  const branchDynamicPricingEnabled = Boolean(demandSignals?.branchDynamicPricingEnabled);

  let priceSource = PRICING_SOURCE.BASE;
  let effectivePricePerDay = roundPrice(basePricePerDay);
  let priceAdjustmentPercent = 0;
  let rulesApplied = [];
  let demandSnapshot = null;

  if (manualOverridePrice && manualOverridePrice > 0) {
    priceSource = PRICING_SOURCE.MANUAL;
    effectivePricePerDay = roundPrice(manualOverridePrice);
    if (basePricePerDay > 0) {
      priceAdjustmentPercent = clampPercent(((effectivePricePerDay - basePricePerDay) / basePricePerDay) * 100);
    }
    rulesApplied = ['MANUAL_OVERRIDE'];
  } else if (dynamicPriceEnabled && branchDynamicPricingEnabled && basePricePerDay > 0) {
    const adjustmentPayload = calculateDemandAdjustmentPercent(carInput, demandSignals, now);
    const dynamicPrice = computePriceFromAdjustment(basePricePerDay, adjustmentPayload.adjustmentPercent);

    priceSource = PRICING_SOURCE.DYNAMIC;
    effectivePricePerDay = dynamicPrice.effectivePricePerDay;
    priceAdjustmentPercent = dynamicPrice.priceAdjustmentPercent;
    rulesApplied = adjustmentPayload.rulesApplied;
    demandSnapshot = {
      demandRatio: adjustmentPayload.demandRatio,
      categorySharePercent: adjustmentPayload.categorySharePercent,
      baselineAverageDailyBookings: roundCurrency(demandSignals?.baselineAverageDailyBookings || 0),
      predictedBookings: roundCurrency(demandSignals?.predictedBookings || 0),
      fleetUtilizationPercent: roundCurrency(demandSignals?.fleetUtilizationPercent || 0),
      shortageCount: safeNumber(demandSignals?.shortageCount || 0),
    };
  } else {
    priceSource = PRICING_SOURCE.BASE;
    effectivePricePerDay = roundPrice(basePricePerDay);
    priceAdjustmentPercent = 0;
    rulesApplied = ['BASE_PRICE'];
  }

  const snapshot = {
    basePricePerDay: roundCurrency(basePricePerDay),
    effectivePricePerDay: roundCurrency(effectivePricePerDay),
    currentDynamicPrice: roundCurrency(effectivePricePerDay),
    dynamicPriceEnabled,
    manualOverridePrice,
    priceSource,
    priceAdjustmentPercent: clampPercent(priceAdjustmentPercent),
    branchDynamicPricingEnabled,
    rulesApplied,
    demandSnapshot,
    lastPriceUpdatedAt: now,
  };

  const carId = toObjectIdString(carInput?._id);
  await persistPricingSnapshotIfRequired(carId, carInput, snapshot, options);

  return snapshot;
};

const applySmartPricingToCars = async (cars = [], options = {}) => {
  if (!Array.isArray(cars) || cars.length === 0) return [];

  const now = options.now instanceof Date ? options.now : new Date();
  const persist = Boolean(options.persist);
  const results = [];

  for (const car of cars) {
    const pricing = await resolveSmartPriceForCar(car, { now, persist });
    const plain = typeof car?.toObject === 'function' ? car.toObject() : { ...car };
    results.push({
      ...plain,
      basePricePerDay: pricing.basePricePerDay,
      effectivePricePerDay: pricing.effectivePricePerDay,
      pricePerDay: pricing.effectivePricePerDay,
      currentDynamicPrice: pricing.currentDynamicPrice,
      dynamicPriceEnabled: pricing.dynamicPriceEnabled,
      manualOverridePrice: pricing.manualOverridePrice,
      priceSource: pricing.priceSource,
      priceAdjustmentPercent: pricing.priceAdjustmentPercent,
      branchDynamicPricingEnabled: pricing.branchDynamicPricingEnabled,
      pricingRuleSummary: pricing.rulesApplied,
    });
  }

  return results;
};

const buildPricingAmounts = ({ basePerDayPrice, lockedPerDayPrice, billingDays }) => {
  const safeBillingDays = Math.max(safeNumber(billingDays, 0), 0);
  const safeBasePricePerDay = Math.max(safeNumber(basePerDayPrice, 0), 0);
  const safeLockedPerDayPrice = Math.max(safeNumber(lockedPerDayPrice, 0), 0);

  return {
    basePerDayPrice: roundCurrency(safeBasePricePerDay),
    lockedPerDayPrice: roundCurrency(safeLockedPerDayPrice),
    pricingBaseAmount: roundCurrency(safeBillingDays * safeBasePricePerDay),
    pricingLockedAmount: roundCurrency(safeBillingDays * safeLockedPerDayPrice),
  };
};

const clearSmartPricingCache = () => {
  demandSignalCache.clear();
};

module.exports = {
  PRICING_SOURCE,
  resolveSmartPriceForCar,
  applySmartPricingToCars,
  buildPricingAmounts,
  clearSmartPricingCache,
};
