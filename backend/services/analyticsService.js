const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Car = require('../models/Car');
const Branch = require('../models/Branch');
const Maintenance = require('../models/Maintenance');
const User = require('../models/User');
const UserSubscription = require('../models/UserSubscription');
const AuditLog = require('../models/AuditLog');
const { ROLE, normalizeRole } = require('../utils/rbac');
const {
  getScopedBranchIds,
  getScopedCarIds,
  applyBookingScopeToQuery,
} = require('./adminScopeService');
const { ensureBranchById } = require('./branchService');
const { buildPredictiveDemandAnalytics } = require('./predictiveDemandService');

const DEFAULT_CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 150;
const DEFAULT_ANALYTICS_TIMEZONE = process.env.ANALYTICS_TIMEZONE || 'UTC';
const GEO_CLUSTER_PRECISION = 2;
const MOST_RENTED_SORT_TYPE = Object.freeze({
  BOOKINGS: 'bookings',
  REVENUE: 'revenue',
});
const CUSTOMER_SORT_TYPE = Object.freeze({
  HIGHEST_REVENUE: 'highestRevenue',
  MOST_BOOKINGS: 'mostBookings',
  HIGHEST_LATE_RISK: 'highestLateRisk',
  HIGHEST_CANCELLATION_RATE: 'highestCancellationRate',
});
const analyticsCache = new Map();

const normalizeRangeKey = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');

const normalizeTimezone = (value = '') => {
  const trimmed = String(value || '').trim();
  return trimmed || DEFAULT_ANALYTICS_TIMEZONE;
};

const normalizeMostRentedSortType = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (normalized === MOST_RENTED_SORT_TYPE.REVENUE) return MOST_RENTED_SORT_TYPE.REVENUE;
  return MOST_RENTED_SORT_TYPE.BOOKINGS;
};

const normalizeCustomerSortType = (value = '') => {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'mostbookings') return CUSTOMER_SORT_TYPE.MOST_BOOKINGS;
  if (normalized === 'highestlaterisk') return CUSTOMER_SORT_TYPE.HIGHEST_LATE_RISK;
  if (normalized === 'highestcancellationrate') return CUSTOMER_SORT_TYPE.HIGHEST_CANCELLATION_RATE;
  return CUSTOMER_SORT_TYPE.HIGHEST_REVENUE;
};

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toObjectId = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const startOfDay = (date) => {
  const cloned = new Date(date);
  cloned.setHours(0, 0, 0, 0);
  return cloned;
};

const endOfDay = (date) => {
  const cloned = new Date(date);
  cloned.setHours(23, 59, 59, 999);
  return cloned;
};

const clampToDateWindow = (fromDate, toDate) => {
  if (!fromDate || !toDate) return null;
  if (fromDate.getTime() > toDate.getTime()) return null;
  return { fromDate, toDate };
};

const resolveDateRange = (options = {}) => {
  const now = options.now instanceof Date ? options.now : new Date();
  const normalizedRange = normalizeRangeKey(options.range || options.preset || 'last30days');
  const customStart = toValidDate(options.startDate || options.fromDate);
  const customEnd = toValidDate(options.endDate || options.toDate);

  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (normalizedRange === 'today') {
    return {
      rangeKey: 'today',
      label: 'Today',
      fromDate: todayStart,
      toDate: todayEnd,
      isCustom: false,
    };
  }

  if (['last7days', '7days', 'last7'].includes(normalizedRange)) {
    const fromDate = startOfDay(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
    return {
      rangeKey: 'last7days',
      label: 'Last 7 Days',
      fromDate,
      toDate: todayEnd,
      isCustom: false,
    };
  }

  if (['custom', 'customrange'].includes(normalizedRange)) {
    const fromDate = customStart ? startOfDay(customStart) : null;
    const toDate = customEnd ? endOfDay(customEnd) : null;
    const clamped = clampToDateWindow(fromDate, toDate);

    if (clamped) {
      return {
        rangeKey: 'custom',
        label: 'Custom Range',
        fromDate: clamped.fromDate,
        toDate: clamped.toDate,
        isCustom: true,
      };
    }
  }

  const fallbackFromDate = startOfDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000));
  return {
    rangeKey: 'last30days',
    label: 'Last 30 Days',
    fromDate: fallbackFromDate,
    toDate: todayEnd,
    isCustom: false,
  };
};

const normalizeStatusExpression = (fieldExpression) => ({
  $let: {
    vars: {
      raw: {
        $toUpper: {
          $trim: {
            input: { $ifNull: [fieldExpression, ''] },
          },
        },
      },
    },
    in: {
      $replaceAll: {
        input: {
          $replaceAll: {
            input: {
              $replaceAll: {
                input: '$$raw',
                find: ' ',
                replacement: '',
              },
            },
            find: '_',
            replacement: '',
          },
        },
        find: '-',
        replacement: '',
      },
    },
  },
});

const roundCurrency = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(2));
};

const safeNumber = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return numericValue;
};

const roundPercent = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(2));
};

const toSafeHours = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue) || numericValue < 0) return 0;
  return numericValue;
};

const computeRangeHours = (range) => {
  const fromDate = toValidDate(range?.fromDate);
  const toDate = toValidDate(range?.toDate);
  if (!fromDate || !toDate) return 0;
  const deltaMs = toDate.getTime() - fromDate.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return deltaMs / (1000 * 60 * 60);
};

const normalizeObjectIdString = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return '';
  return String(new mongoose.Types.ObjectId(normalized));
};

const mergeIntervalsToHours = (intervals = []) => {
  if (!Array.isArray(intervals) || intervals.length === 0) return 0;
  const sortedIntervals = intervals
    .map((interval) => ({
      startAt: toValidDate(interval?.startAt),
      endAt: toValidDate(interval?.endAt),
    }))
    .filter((interval) => interval.startAt && interval.endAt && interval.endAt.getTime() > interval.startAt.getTime())
    .sort((left, right) => left.startAt.getTime() - right.startAt.getTime());

  if (!sortedIntervals.length) return 0;

  const merged = [];
  for (const interval of sortedIntervals) {
    if (!merged.length) {
      merged.push(interval);
      continue;
    }

    const previous = merged[merged.length - 1];
    if (interval.startAt.getTime() <= previous.endAt.getTime()) {
      if (interval.endAt.getTime() > previous.endAt.getTime()) {
        previous.endAt = interval.endAt;
      }
      continue;
    }

    merged.push(interval);
  }

  const totalMs = merged.reduce(
    (sum, interval) => sum + (interval.endAt.getTime() - interval.startAt.getTime()),
    0,
  );
  return totalMs > 0 ? totalMs / (1000 * 60 * 60) : 0;
};

const normalizeStatusKey = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');

const toDurationHours = (startValue, endValue) => {
  const startDate = toValidDate(startValue);
  const endDate = toValidDate(endValue);
  if (!startDate || !endDate) return 0;
  const deltaMs = endDate.getTime() - startDate.getTime();
  if (!Number.isFinite(deltaMs) || deltaMs <= 0) return 0;
  return deltaMs / (1000 * 60 * 60);
};

const average = (values = []) => {
  const filtered = Array.isArray(values)
    ? values.map((value) => Number(value || 0)).filter((value) => Number.isFinite(value) && value >= 0)
    : [];
  if (filtered.length === 0) return 0;
  const total = filtered.reduce((sum, value) => sum + value, 0);
  return total / filtered.length;
};

const isDateWithinRange = (value, fromDate, toDate) => {
  const parsed = toValidDate(value);
  if (!parsed) return false;
  const timestamp = parsed.getTime();
  return timestamp >= fromDate.getTime() && timestamp <= toDate.getTime();
};

const makeSegmentBucket = (label) => ({
  label,
  count: 0,
  customers: [],
});

const DAY_OF_WEEK_LABELS = {
  1: 'Sun',
  2: 'Mon',
  3: 'Tue',
  4: 'Wed',
  5: 'Thu',
  6: 'Fri',
  7: 'Sat',
};

const andQuery = (baseQuery = {}, condition = null) => {
  if (!condition || typeof condition !== 'object') return baseQuery;
  const base = baseQuery && typeof baseQuery === 'object' ? baseQuery : {};
  if (Object.keys(base).length === 0) return condition;
  return { $and: [base, condition] };
};

const toBranchFilter = (branchIds = []) => {
  if (!Array.isArray(branchIds)) return {};
  const objectIds = branchIds.map(toObjectId).filter(Boolean);
  if (objectIds.length === 0) return { _id: { $in: [] } };
  return { _id: { $in: objectIds } };
};

const getRoleView = (roleValue) => {
  const role = normalizeRole(roleValue, ROLE.USER);
  const canViewFinancial = [
    ROLE.PLATFORM_SUPER_ADMIN,
    ROLE.SUPER_ADMIN,
    ROLE.BRANCH_ADMIN,
    ROLE.FINANCE_MANAGER,
  ].includes(role);
  const canViewFleet = [
    ROLE.PLATFORM_SUPER_ADMIN,
    ROLE.SUPER_ADMIN,
    ROLE.BRANCH_ADMIN,
    ROLE.FLEET_MANAGER,
  ].includes(role);
  return {
    role,
    canViewFinancial,
    canViewFleet,
  };
};

const resolveScope = async (user, requestedBranchId = '') => {
  const scopedBranchIds = getScopedBranchIds(user);
  const normalizedRequestedBranchId = String(requestedBranchId || '').trim();

  if (normalizedRequestedBranchId) {
    const branch = await ensureBranchById(normalizedRequestedBranchId);
    if (!branch) {
      const error = new Error('Branch not found');
      error.status = 404;
      throw error;
    }

    if (Array.isArray(scopedBranchIds) && !scopedBranchIds.includes(String(branch._id))) {
      const error = new Error('Not allowed for this branch scope');
      error.status = 403;
      throw error;
    }

    return {
      scopedBranchIds,
      selectedBranchId: String(branch._id),
      bookingBranchQuery: { branchId: branch._id },
      carBranchQuery: { branchId: branch._id },
    };
  }

  if (Array.isArray(scopedBranchIds)) {
    if (scopedBranchIds.length === 0) {
      const error = new Error('No branch assigned for this staff account');
      error.status = 403;
      throw error;
    }

    const branchObjectIds = scopedBranchIds.map(toObjectId).filter(Boolean);
    return {
      scopedBranchIds,
      selectedBranchId: '',
      bookingBranchQuery: { branchId: { $in: branchObjectIds } },
      carBranchQuery: { branchId: { $in: branchObjectIds } },
    };
  }

  return {
    scopedBranchIds: null,
    selectedBranchId: '',
    bookingBranchQuery: {},
    carBranchQuery: {},
  };
};

const buildCacheKey = (user, options, scope, range) => {
  const roleView = getRoleView(user?.role);
  const assignedBranches = Array.isArray(user?.assignedBranches) ? [...user.assignedBranches].sort() : [];
  return JSON.stringify({
    userId: String(user?._id || ''),
    tenantId: String(user?.tenantId || ''),
    role: roleView.role,
    assignedBranches,
    selectedBranchId: scope.selectedBranchId,
    rangeKey: range.rangeKey,
    timezone: normalizeTimezone(options?.timezone),
    sortType: normalizeMostRentedSortType(options?.sortType),
    customerSort: normalizeCustomerSortType(options?.customerSort),
    fromDate: range.fromDate?.toISOString(),
    toDate: range.toDate?.toISOString(),
    requestedBranchId: String(options?.branchId || ''),
  });
};

const getCachedAnalytics = (cacheKey, cacheTtlMs) => {
  const nowMs = Date.now();
  const cached = analyticsCache.get(cacheKey);
  if (!cached) return null;
  if (nowMs - cached.createdAtMs > cacheTtlMs) {
    analyticsCache.delete(cacheKey);
    return null;
  }
  return cached.value;
};

const setCachedAnalytics = (cacheKey, value) => {
  analyticsCache.set(cacheKey, { createdAtMs: Date.now(), value });
  if (analyticsCache.size <= MAX_CACHE_ENTRIES) return;

  const entries = [...analyticsCache.entries()].sort((left, right) => left[1].createdAtMs - right[1].createdAtMs);
  while (entries.length > MAX_CACHE_ENTRIES) {
    const [oldestKey] = entries.shift();
    analyticsCache.delete(oldestKey);
  }
};

const buildMonthTemplate = (now = new Date()) => {
  const cursor = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
  const rows = [];

  for (let index = 0; index < 12; index += 1) {
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const key = `${year}-${String(month).padStart(2, '0')}`;
    rows.push({
      key,
      label: cursor.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return rows;
};

const formatDateKeyWithTimezone = (date, timezone) => {
  const parsedDate = date instanceof Date ? date : toValidDate(date);
  if (!parsedDate) return '';

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || DEFAULT_ANALYTICS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(parsedDate);
    const year = parts.find((part) => part.type === 'year')?.value || '';
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const day = parts.find((part) => part.type === 'day')?.value || '';
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch (error) {
    // Fallback to UTC string if timezone is invalid at runtime.
  }

  return parsedDate.toISOString().slice(0, 10);
};

const buildDailyDateTemplate = (fromDate, toDate, timezone) => {
  const from = toValidDate(fromDate);
  const to = toValidDate(toDate);
  if (!from || !to || from.getTime() > to.getTime()) return [];

  const cursor = startOfDay(from);
  const last = endOfDay(to);
  const keys = new Set();

  while (cursor.getTime() <= last.getTime() && keys.size < 5000) {
    keys.add(formatDateKeyWithTimezone(cursor, timezone));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return [...keys].sort();
};

const buildBookingAnalytics = async (bookingQuery, range, options = {}) => {
  const timezone = normalizeTimezone(options.timezone);
  const now = options.now instanceof Date ? options.now : new Date();
  const monthlyTemplate = buildMonthTemplate(now);
  const monthlyFromDate = toValidDate(`${monthlyTemplate[0]?.key || '1970-01'}-01T00:00:00.000Z`) || new Date(0);
  const monthlyToDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) - 1);

  const createdDateMatch = { _eventCreatedAt: { $gte: range.fromDate, $lte: range.toDate } };
  const fullPaymentDateMatch = { _eventFullPaidAt: { $gte: range.fromDate, $lte: range.toDate } };
  const refundDateMatch = { _eventRefundAt: { $gte: range.fromDate, $lte: range.toDate } };
  const completedDateMatch = { _eventCompletedAt: { $gte: range.fromDate, $lte: range.toDate } };

  const [aggregation] = await Booking.aggregate([
    { $match: bookingQuery },
    {
      $addFields: {
        _paymentStatusKey: normalizeStatusExpression('$paymentStatus'),
        _bookingStatusKey: normalizeStatusExpression('$bookingStatus'),
        _rentalStageKey: normalizeStatusExpression('$rentalStage'),
        _tripStatusKey: normalizeStatusExpression('$tripStatus'),
        _refundStatusKey: normalizeStatusExpression('$refundStatus'),
        _priceSourceKey: normalizeStatusExpression('$priceSource'),
        _bargainStatusKey: normalizeStatusExpression('$bargain.status'),
        _eventCreatedAt: { $ifNull: ['$createdAt', '$updatedAt'] },
        _eventFullPaidAt: { $ifNull: ['$fullPaymentReceivedAt', '$updatedAt'] },
        _eventRefundAt: { $ifNull: ['$refundProcessedAt', '$updatedAt'] },
        _eventCompletedAt: {
          $ifNull: ['$fullPaymentReceivedAt', { $ifNull: ['$actualReturnTime', '$updatedAt'] }],
        },
        _effectiveFinalAmount: {
          $let: {
            vars: {
              finalAmount: { $ifNull: ['$finalAmount', 0] },
              totalAmount: { $ifNull: ['$totalAmount', 0] },
            },
            in: {
              $cond: [
                { $gt: ['$$finalAmount', 0] },
                '$$finalAmount',
                { $max: ['$$totalAmount', 0] },
              ],
            },
          },
        },
        _advancePaidSafe: { $max: [{ $ifNull: ['$advancePaid', 0] }, 0] },
        _lateFeeSafe: { $max: [{ $ifNull: ['$lateFee', 0] }, 0] },
        _lateHoursSafe: { $max: [{ $ifNull: ['$lateHours', 0] }, 0] },
        _refundAmountSafe: { $max: [{ $ifNull: ['$refundAmount', 0] }, 0] },
        _priceAdjustmentPercentSafe: {
          $let: {
            vars: {
              raw: { $ifNull: ['$priceAdjustmentPercent', 0] },
            },
            in: {
              $cond: [
                { $lt: ['$$raw', -20] },
                -20,
                {
                  $cond: [{ $gt: ['$$raw', 30] }, 30, '$$raw'],
                },
              ],
            },
          },
        },
        _pricingBaseAmountSafe: {
          $max: [
            {
              $ifNull: [
                '$pricingBaseAmount',
                {
                  $ifNull: ['$finalAmount', '$totalAmount'],
                },
              ],
            },
            0,
          ],
        },
        _pricingLockedAmountSafe: {
          $max: [
            {
              $ifNull: [
                '$pricingLockedAmount',
                {
                  $ifNull: ['$finalAmount', '$totalAmount'],
                },
              ],
            },
            0,
          ],
        },
        _damageCostSafe: {
          $cond: [
            { $eq: [{ $ifNull: ['$returnInspection.damageDetected', false] }, true] },
            { $max: [{ $ifNull: ['$returnInspection.damageCost', 0] }, 0] },
            0,
          ],
        },
        _isCompleted: {
          $or: [
            { $eq: [normalizeStatusExpression('$bookingStatus'), 'COMPLETED'] },
            { $eq: [normalizeStatusExpression('$rentalStage'), 'COMPLETED'] },
            { $eq: [normalizeStatusExpression('$tripStatus'), 'COMPLETED'] },
            { $ne: [{ $ifNull: ['$actualReturnTime', null] }, null] },
          ],
        },
      },
    },
    {
      $addFields: {
        _isNegotiated: {
          $and: [
            { $ne: ['$_bargainStatusKey', ''] },
            { $ne: ['$_bargainStatusKey', 'NONE'] },
          ],
        },
        _pricingDeltaAmount: {
          $subtract: ['$_pricingLockedAmountSafe', '$_pricingBaseAmountSafe'],
        },
      },
    },
    {
      $facet: {
        counts: [
          { $match: createdDateMatch },
          {
            $group: {
              _id: null,
              totalBookings: { $sum: 1 },
              activeRentalsCount: {
                $sum: { $cond: [{ $eq: ['$_rentalStageKey', 'ACTIVE'] }, 1, 0] },
              },
              overdueRentalsCount: {
                $sum: { $cond: [{ $eq: ['$_rentalStageKey', 'OVERDUE'] }, 1, 0] },
              },
              cancelledBookings: {
                $sum: {
                  $cond: [
                    { $in: ['$_bookingStatusKey', ['CANCELLED', 'CANCELLEDBYUSER', 'REJECTED']] },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
        advance: [
          { $match: createdDateMatch },
          {
            $group: {
              _id: null,
              totalAdvanceCollected: { $sum: '$_advancePaidSafe' },
            },
          },
        ],
        financial: [
          {
            $match: {
              ...fullPaymentDateMatch,
              _paymentStatusKey: 'FULLYPAID',
            },
          },
          {
            $group: {
              _id: null,
              baseRevenue: { $sum: '$_effectiveFinalAmount' },
              lateFeeRevenue: { $sum: '$_lateFeeSafe' },
              damageRevenue: { $sum: '$_damageCostSafe' },
            },
          },
        ],
        smartPricing: [
          {
            $match: {
              ...fullPaymentDateMatch,
              _paymentStatusKey: 'FULLYPAID',
            },
          },
          {
            $group: {
              _id: null,
              dynamicRevenueContribution: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$_priceSourceKey', 'DYNAMIC'] },
                        { $eq: ['$_isNegotiated', false] },
                        { $gt: ['$_pricingDeltaAmount', 0] },
                      ],
                    },
                    '$_pricingDeltaAmount',
                    0,
                  ],
                },
              },
              dynamicRevenueTotal: {
                $sum: {
                  $cond: [{ $eq: ['$_priceSourceKey', 'DYNAMIC'] }, '$_effectiveFinalAmount', 0],
                },
              },
              manualRevenueTotal: {
                $sum: {
                  $cond: [{ $eq: ['$_priceSourceKey', 'MANUAL'] }, '$_effectiveFinalAmount', 0],
                },
              },
              baseRevenueTotal: {
                $sum: {
                  $cond: [
                    {
                      $or: [
                        { $eq: ['$_priceSourceKey', 'BASE'] },
                        { $eq: ['$_priceSourceKey', ''] },
                      ],
                    },
                    '$_effectiveFinalAmount',
                    0,
                  ],
                },
              },
              dynamicBookingCount: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$_priceSourceKey', 'DYNAMIC'] },
                        { $eq: ['$_isNegotiated', false] },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
              dynamicAdjustmentPercentTotal: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $eq: ['$_priceSourceKey', 'DYNAMIC'] },
                        { $eq: ['$_isNegotiated', false] },
                      ],
                    },
                    '$_priceAdjustmentPercentSafe',
                    0,
                  ],
                },
              },
            },
          },
        ],
        refunds: [
          {
            $match: {
              ...refundDateMatch,
              _refundStatusKey: 'PROCESSED',
            },
          },
          {
            $group: {
              _id: null,
              totalRefundAmount: { $sum: '$_refundAmountSafe' },
            },
          },
        ],
        dailyRevenue: [
          {
            $match: {
              ...fullPaymentDateMatch,
              _paymentStatusKey: 'FULLYPAID',
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$_eventFullPaidAt',
                  timezone,
                },
              },
              baseRevenue: { $sum: '$_effectiveFinalAmount' },
              lateFeeRevenue: { $sum: '$_lateFeeSafe' },
              damageRevenue: { $sum: '$_damageCostSafe' },
              bookingCount: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        dailyRefund: [
          {
            $match: {
              ...refundDateMatch,
              _refundStatusKey: 'PROCESSED',
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$_eventRefundAt',
                  timezone,
                },
              },
              refundAmount: { $sum: '$_refundAmountSafe' },
            },
          },
          { $sort: { _id: 1 } },
        ],
        monthlyRevenue: [
          {
            $match: {
              _paymentStatusKey: 'FULLYPAID',
              _eventFullPaidAt: { $gte: monthlyFromDate, $lte: monthlyToDate },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m',
                  date: '$_eventFullPaidAt',
                  timezone,
                },
              },
              baseRevenue: { $sum: '$_effectiveFinalAmount' },
              lateFeeRevenue: { $sum: '$_lateFeeSafe' },
              damageRevenue: { $sum: '$_damageCostSafe' },
              bookingCount: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        dailyLate: [
          {
            $match: {
              ...completedDateMatch,
              _isCompleted: true,
            },
          },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: '%Y-%m-%d',
                  date: '$_eventCompletedAt',
                  timezone,
                },
              },
              completedCount: { $sum: 1 },
              overdueCount: {
                $sum: {
                  $cond: [{ $gt: ['$_lateHoursSafe', 0] }, 1, 0],
                },
              },
              totalLateHours: { $sum: '$_lateHoursSafe' },
              totalLateFee: { $sum: '$_lateFeeSafe' },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ]);

  const counts = aggregation?.counts?.[0] || {};
  const advance = aggregation?.advance?.[0] || {};
  const financial = aggregation?.financial?.[0] || {};
  const smartPricing = aggregation?.smartPricing?.[0] || {};
  const refunds = aggregation?.refunds?.[0] || {};

  const baseRevenue = roundCurrency(financial.baseRevenue || 0);
  const lateFeeRevenue = roundCurrency(financial.lateFeeRevenue || 0);
  const damageRevenue = roundCurrency(financial.damageRevenue || 0);
  const totalRefundAmount = roundCurrency(refunds.totalRefundAmount || 0);
  const totalRevenue = roundCurrency(baseRevenue + lateFeeRevenue + damageRevenue - totalRefundAmount);
  const dynamicRevenueContribution = roundCurrency(smartPricing.dynamicRevenueContribution || 0);
  const dynamicRevenueTotal = roundCurrency(smartPricing.dynamicRevenueTotal || 0);
  const manualRevenueTotal = roundCurrency(smartPricing.manualRevenueTotal || 0);
  const baseSourceRevenueTotal = roundCurrency(smartPricing.baseRevenueTotal || 0);
  const dynamicBookingCount = Number(smartPricing.dynamicBookingCount || 0);
  const priceAdjustmentImpact =
    dynamicBookingCount > 0
      ? roundCurrency((smartPricing.dynamicAdjustmentPercentTotal || 0) / dynamicBookingCount)
      : 0;
  const dailyDateTemplate = buildDailyDateTemplate(range.fromDate, range.toDate, timezone);

  const dailyRefundRows = Array.isArray(aggregation?.dailyRefund) ? aggregation.dailyRefund : [];
  const dailyRefundMap = new Map(
    dailyRefundRows.map((row) => [String(row?._id || ''), roundCurrency(row?.refundAmount || 0)]),
  );
  const dailyRevenueRows = Array.isArray(aggregation?.dailyRevenue) ? aggregation.dailyRevenue : [];
  const dailyRevenueMap = new Map(
    dailyRevenueRows.map((row) => [
      String(row?._id || ''),
      {
        baseRevenue: roundCurrency(row?.baseRevenue || 0),
        lateFeeRevenue: roundCurrency(row?.lateFeeRevenue || 0),
        damageRevenue: roundCurrency(row?.damageRevenue || 0),
        bookingCount: Number(row?.bookingCount || 0),
      },
    ]),
  );
  const dailyRevenueKeys = [...new Set([...dailyDateTemplate, ...dailyRevenueMap.keys(), ...dailyRefundMap.keys()])].sort();
  const dailyRevenue = dailyRevenueKeys.map((date) => {
    const revenueRow = dailyRevenueMap.get(date) || {};
    const rowBase = roundCurrency(revenueRow.baseRevenue || 0);
    const rowLate = roundCurrency(revenueRow.lateFeeRevenue || 0);
    const rowDamage = roundCurrency(revenueRow.damageRevenue || 0);
    const rowRefund = roundCurrency(dailyRefundMap.get(date) || 0);
    const rowTotal = roundCurrency(rowBase + rowLate + rowDamage - rowRefund);

    return {
      date,
      baseRevenue: rowBase,
      lateFeeRevenue: rowLate,
      damageRevenue: rowDamage,
      refundAmount: rowRefund,
      totalRevenue: rowTotal,
      bookingCount: Number(revenueRow.bookingCount || 0),
    };
  });

  const monthlyRevenueRows = Array.isArray(aggregation?.monthlyRevenue) ? aggregation.monthlyRevenue : [];
  const monthlyMap = new Map(
    monthlyRevenueRows.map((row) => {
      const monthKey = String(row?._id || '');
      const rowBase = roundCurrency(row?.baseRevenue || 0);
      const rowLate = roundCurrency(row?.lateFeeRevenue || 0);
      const rowDamage = roundCurrency(row?.damageRevenue || 0);
      return [
        monthKey,
        {
          monthKey,
          baseRevenue: rowBase,
          lateFeeRevenue: rowLate,
          damageRevenue: rowDamage,
          totalRevenue: roundCurrency(rowBase + rowLate + rowDamage),
          bookingCount: Number(row?.bookingCount || 0),
        },
      ];
    }),
  );
  const monthlyRevenue = monthlyTemplate.map((entry) => {
    const row = monthlyMap.get(entry.key) || {
      monthKey: entry.key,
      baseRevenue: 0,
      lateFeeRevenue: 0,
      damageRevenue: 0,
      totalRevenue: 0,
      bookingCount: 0,
    };
    return {
      ...row,
      label: entry.label,
    };
  });

  const dailyLateRows = Array.isArray(aggregation?.dailyLate) ? aggregation.dailyLate : [];
  const dailyLateMap = new Map(
    dailyLateRows.map((row) => [
      String(row?._id || ''),
      {
        completedCount: Number(row?.completedCount || 0),
        overdueCount: Number(row?.overdueCount || 0),
        totalLateHours: roundCurrency(row?.totalLateHours || 0),
        totalLateFee: roundCurrency(row?.totalLateFee || 0),
      },
    ]),
  );
  const dailyLateKeys = [...new Set([...dailyDateTemplate, ...dailyLateMap.keys()])].sort();
  const dailyLateTrend = dailyLateKeys.map((date) => {
    const row = dailyLateMap.get(date) || {};
    const completedCount = Number(row.completedCount || 0);
    const overdueCount = Number(row.overdueCount || 0);
    const totalLateHours = roundCurrency(row.totalLateHours || 0);
    const totalLateFee = roundCurrency(row.totalLateFee || 0);

    return {
      date,
      completedCount,
      overdueCount,
      totalLateHours,
      totalLateFee,
      averageLateHours: completedCount > 0 ? roundCurrency(totalLateHours / completedCount) : 0,
      overduePercentage: completedCount > 0 ? roundPercent((overdueCount / completedCount) * 100) : 0,
    };
  });
  const overduePercentageTrend = dailyLateTrend.map((row) => ({
    date: row.date,
    overduePercentage: row.overduePercentage,
  }));
  const lateTotals = dailyLateTrend.reduce(
    (accumulator, row) => ({
      completedCount: accumulator.completedCount + Number(row.completedCount || 0),
      overdueCount: accumulator.overdueCount + Number(row.overdueCount || 0),
      totalLateHours: accumulator.totalLateHours + Number(row.totalLateHours || 0),
      totalLateFee: accumulator.totalLateFee + Number(row.totalLateFee || 0),
    }),
    { completedCount: 0, overdueCount: 0, totalLateHours: 0, totalLateFee: 0 },
  );
  const lateSummary = {
    completedCount: lateTotals.completedCount,
    overdueCount: lateTotals.overdueCount,
    totalLateFee: roundCurrency(lateTotals.totalLateFee),
    averageLateHours:
      lateTotals.completedCount > 0
        ? roundCurrency(lateTotals.totalLateHours / lateTotals.completedCount)
        : 0,
    overduePercentage:
      lateTotals.completedCount > 0
        ? roundPercent((lateTotals.overdueCount / lateTotals.completedCount) * 100)
        : 0,
  };

  return {
    totals: {
      totalRevenue,
      totalAdvanceCollected: roundCurrency(advance.totalAdvanceCollected || 0),
      totalLateFeesCollected: lateFeeRevenue,
      totalRefundAmount,
      dynamicRevenueContribution,
      priceAdjustmentImpact,
      activeRentalsCount: Number(counts.activeRentalsCount || 0),
      overdueRentalsCount: Number(counts.overdueRentalsCount || 0),
      totalBookings: Number(counts.totalBookings || 0),
      cancelledBookings: Number(counts.cancelledBookings || 0),
    },
    financialBreakdown: {
      baseRevenue,
      lateFeeRevenue,
      damageRevenue,
      refundDeduction: totalRefundAmount,
      netRevenue: totalRevenue,
      dynamicRevenueContribution,
      priceAdjustmentImpact,
      dynamicVsManualRevenue: {
        dynamicRevenue: dynamicRevenueTotal,
        manualRevenue: manualRevenueTotal,
        baseRevenue: baseSourceRevenueTotal,
      },
    },
    trendData: {
      dailyRevenue,
      monthlyRevenue,
      dailyLateTrend,
      overduePercentageTrend,
      lateSummary,
    },
  };
};

const buildSubscriptionAnalytics = async (scope = {}, range, options = {}) => {
  const now = options.now instanceof Date ? options.now : new Date();
  const branchFilter = {};

  if (scope?.selectedBranchId) {
    const selectedBranchObjectId = toObjectId(scope.selectedBranchId);
    branchFilter.branchId = selectedBranchObjectId || { $in: [] };
  } else if (Array.isArray(scope?.scopedBranchIds)) {
    const scopedBranchObjectIds = scope.scopedBranchIds.map(toObjectId).filter(Boolean);
    branchFilter.branchId = scopedBranchObjectIds.length > 0 ? { $in: scopedBranchObjectIds } : { $in: [] };
  }

  const [aggregation] = await UserSubscription.aggregate([
    { $match: branchFilter },
    {
      $addFields: {
        _statusKey: normalizeStatusExpression('$subscriptionStatus'),
        _paymentStatusKey: normalizeStatusExpression('$paymentStatus'),
        _eventCreatedAt: { $ifNull: ['$createdAt', '$updatedAt'] },
        _eventEndAt: { $ifNull: ['$endDate', '$updatedAt'] },
        _amountPaidSafe: {
          $max: [{ $ifNull: ['$amountPaid', { $ifNull: ['$planSnapshot.price', 0] }] }, 0],
        },
        _durationDaysSafe: {
          $max: [
            0,
            {
              $divide: [
                {
                  $subtract: [
                    { $ifNull: ['$endDate', '$updatedAt'] },
                    { $ifNull: ['$startDate', '$createdAt'] },
                  ],
                },
                1000 * 60 * 60 * 24,
              ],
            },
          ],
        },
      },
    },
    {
      $facet: {
        revenue: [
          {
            $match: {
              _eventCreatedAt: { $gte: range.fromDate, $lte: range.toDate },
              _paymentStatusKey: 'PAID',
            },
          },
          {
            $group: {
              _id: null,
              subscriptionRevenue: { $sum: '$_amountPaidSafe' },
              subscribers: { $addToSet: '$userId' },
            },
          },
        ],
        active: [
          {
            $match: {
              _statusKey: 'ACTIVE',
              _paymentStatusKey: 'PAID',
              startDate: { $lte: now },
              endDate: { $gt: now },
            },
          },
          { $count: 'count' },
        ],
        churned: [
          {
            $match: {
              _statusKey: { $in: ['EXPIRED', 'CANCELLED'] },
              _eventEndAt: { $gte: range.fromDate, $lte: range.toDate },
            },
          },
          { $count: 'count' },
        ],
        durations: [
          {
            $match: {
              _eventCreatedAt: { $gte: range.fromDate, $lte: range.toDate },
            },
          },
          {
            $group: {
              _id: null,
              averageDurationDays: { $avg: '$_durationDaysSafe' },
              count: { $sum: 1 },
            },
          },
        ],
      },
    },
  ]);

  const revenueRow = aggregation?.revenue?.[0] || {};
  const activeRow = aggregation?.active?.[0] || {};
  const churnedRow = aggregation?.churned?.[0] || {};
  const durationRow = aggregation?.durations?.[0] || {};

  const subscriptionRevenue = roundCurrency(revenueRow?.subscriptionRevenue || 0);
  const uniqueSubscribers = Array.isArray(revenueRow?.subscribers)
    ? revenueRow.subscribers.filter(Boolean).length
    : 0;
  const activeSubscribersCount = Number(activeRow?.count || 0);
  const churnedCount = Number(churnedRow?.count || 0);
  const durationSampleCount = Number(durationRow?.count || 0);
  const averageSubscriptionDurationDays =
    durationSampleCount > 0 ? roundCurrency(durationRow?.averageDurationDays || 0) : 0;
  const churnRatePercent =
    durationSampleCount > 0
      ? roundPercent((churnedCount / Math.max(durationSampleCount, 1)) * 100)
      : 0;
  const revenuePerSubscriber =
    uniqueSubscribers > 0 ? roundCurrency(subscriptionRevenue / uniqueSubscribers) : 0;

  return {
    subscriptionRevenue,
    activeSubscribersCount,
    churnRatePercent,
    averageSubscriptionDurationDays,
    revenuePerSubscriber,
    meta: {
      churnedCount,
      uniqueSubscribers,
      durationSampleCount,
    },
  };
};

const buildFleetPerformanceAnalytics = async (bookingQuery, carMatch, range, options = {}) => {
  const sortType = normalizeMostRentedSortType(options.sortType);
  const normalizedRole = normalizeRole(options.userRole, ROLE.USER);
  const visibleBranches = Array.isArray(options.visibleBranches) ? options.visibleBranches : [];

  const [bookingAggregation, cars] = await Promise.all([
    Booking.aggregate([
      { $match: bookingQuery },
      {
        $addFields: {
          _bookingStatusKey: normalizeStatusExpression('$bookingStatus'),
          _paymentStatusKey: normalizeStatusExpression('$paymentStatus'),
          _rentalStageKey: normalizeStatusExpression('$rentalStage'),
          _effectivePickup: { $ifNull: ['$pickupDateTime', '$fromDate'] },
          _effectiveDrop: { $ifNull: ['$dropDateTime', '$toDate'] },
          _effectiveFinalAmount: {
            $let: {
              vars: {
                finalAmount: { $ifNull: ['$finalAmount', 0] },
                totalAmount: { $ifNull: ['$totalAmount', 0] },
              },
              in: {
                $cond: [{ $gt: ['$$finalAmount', 0] }, '$$finalAmount', { $max: ['$$totalAmount', 0] }],
              },
            },
          },
          _lateFeeSafe: { $max: [{ $ifNull: ['$lateFee', 0] }, 0] },
          _lateHoursSafe: { $max: [{ $ifNull: ['$lateHours', 0] }, 0] },
          _damageCostSafe: {
            $cond: [
              { $eq: [{ $ifNull: ['$returnInspection.damageDetected', false] }, true] },
              { $max: [{ $ifNull: ['$returnInspection.damageCost', 0] }, 0] },
              0,
            ],
          },
          _isCancelledLike: {
            $in: [normalizeStatusExpression('$bookingStatus'), ['CANCELLED', 'CANCELLEDBYUSER', 'REJECTED']],
          },
          _isFullyPaid: { $eq: [normalizeStatusExpression('$paymentStatus'), 'FULLYPAID'] },
        },
      },
      {
        $match: {
          _isCancelledLike: false,
          $expr: {
            $and: [
              { $ne: ['$car', null] },
              { $ne: ['$_effectivePickup', null] },
              { $ne: ['$_effectiveDrop', null] },
              { $gt: ['$_effectiveDrop', '$_effectivePickup'] },
              { $lt: ['$_effectivePickup', range.toDate] },
              { $gt: ['$_effectiveDrop', range.fromDate] },
            ],
          },
        },
      },
      {
        $addFields: {
          _clampedStart: {
            $cond: [{ $lt: ['$_effectivePickup', range.fromDate] }, range.fromDate, '$_effectivePickup'],
          },
          _clampedEnd: {
            $cond: [{ $gt: ['$_effectiveDrop', range.toDate] }, range.toDate, '$_effectiveDrop'],
          },
        },
      },
      {
        $addFields: {
          _rentalHoursClamped: {
            $max: [
              0,
              {
                $divide: [{ $subtract: ['$_clampedEnd', '$_clampedStart'] }, 1000 * 60 * 60],
              },
            ],
          },
        },
      },
      {
        $facet: {
          carMetrics: [
            {
              $group: {
                _id: '$car',
                branchId: { $first: '$branchId' },
                totalBookings: { $sum: 1 },
                overdueBookings: {
                  $sum: {
                    $cond: [
                      {
                        $or: [
                          { $gt: ['$_lateHoursSafe', 0] },
                          { $eq: ['$_rentalStageKey', 'OVERDUE'] },
                        ],
                      },
                      1,
                      0,
                    ],
                  },
                },
                totalRevenueGenerated: {
                  $sum: {
                    $cond: [
                      '$_isFullyPaid',
                      { $add: ['$_effectiveFinalAmount', '$_lateFeeSafe', '$_damageCostSafe'] },
                      0,
                    ],
                  },
                },
                totalLateFeeGenerated: {
                  $sum: {
                    $cond: ['$_isFullyPaid', '$_lateFeeSafe', 0],
                  },
                },
                totalDamageCostCollected: {
                  $sum: {
                    $cond: ['$_isFullyPaid', '$_damageCostSafe', 0],
                  },
                },
                totalRentalHoursRaw: { $sum: '$_rentalHoursClamped' },
              },
            },
          ],
          carIntervals: [
            {
              $project: {
                _id: 0,
                car: '$car',
                branchId: '$branchId',
                startAt: '$_clampedStart',
                endAt: '$_clampedEnd',
              },
            },
          ],
        },
      },
    ]),
    Car.find(carMatch)
      .select('_id branchId name brand model registrationNumber totalTripsCompleted totalMaintenanceCost')
      .lean(),
  ]);

  const carMetricsRows = Array.isArray(bookingAggregation?.[0]?.carMetrics) ? bookingAggregation[0].carMetrics : [];
  const carIntervalsRows = Array.isArray(bookingAggregation?.[0]?.carIntervals) ? bookingAggregation[0].carIntervals : [];

  const intervalMap = new Map();
  for (const row of carIntervalsRows) {
    const carId = normalizeObjectIdString(row?.car);
    if (!carId) continue;
    const startAt = toValidDate(row?.startAt);
    const endAt = toValidDate(row?.endAt);
    if (!startAt || !endAt || endAt.getTime() <= startAt.getTime()) continue;
    if (!intervalMap.has(carId)) {
      intervalMap.set(carId, []);
    }
    intervalMap.get(carId).push({ startAt, endAt });
  }

  const utilizationHoursByCar = new Map();
  for (const [carId, intervals] of intervalMap.entries()) {
    utilizationHoursByCar.set(carId, mergeIntervalsToHours(intervals));
  }

  const carMetricsById = new Map();
  const branchIdsInUse = new Set();
  for (const row of carMetricsRows) {
    const carId = normalizeObjectIdString(row?._id);
    if (!carId) continue;
    const branchId = normalizeObjectIdString(row?.branchId);
    if (branchId) branchIdsInUse.add(branchId);

    carMetricsById.set(carId, {
      carId,
      branchId,
      totalBookings: Number(row?.totalBookings || 0),
      overdueBookings: Number(row?.overdueBookings || 0),
      totalRevenueGenerated: roundCurrency(row?.totalRevenueGenerated || 0),
      totalLateFeeGenerated: roundCurrency(row?.totalLateFeeGenerated || 0),
      totalDamageCostCollected: roundCurrency(row?.totalDamageCostCollected || 0),
      totalRentalHoursRaw: roundCurrency(row?.totalRentalHoursRaw || 0),
    });
  }

  const carBaseById = new Map();
  const scopedCarIds = [];
  for (const car of Array.isArray(cars) ? cars : []) {
    const carId = normalizeObjectIdString(car?._id);
    if (!carId) continue;
    const branchId = normalizeObjectIdString(car?.branchId);
    if (branchId) branchIdsInUse.add(branchId);
    scopedCarIds.push(new mongoose.Types.ObjectId(carId));
    carBaseById.set(carId, {
      carId,
      branchId,
      name: String(car?.name || 'Unknown Car'),
      brand: String(car?.brand || ''),
      model: String(car?.model || ''),
      registrationNumber: String(car?.registrationNumber || ''),
      totalTripsCompleted: Number(car?.totalTripsCompleted || 0),
      lifetimeMaintenanceCost: roundCurrency(car?.totalMaintenanceCost || 0),
    });
  }

  for (const [carId, metric] of carMetricsById.entries()) {
    if (carBaseById.has(carId)) continue;
    carBaseById.set(carId, {
      carId,
      branchId: metric.branchId || '',
      name: 'Unknown Car',
      brand: '',
      model: '',
      registrationNumber: '',
      totalTripsCompleted: metric.totalBookings,
      lifetimeMaintenanceCost: 0,
    });
  }

  const maintenanceByCar = new Map();
  if (scopedCarIds.length > 0) {
    const maintenanceRows = await Maintenance.aggregate([
      {
        $match: {
          carId: { $in: scopedCarIds },
          maintenanceStatus: 'Completed',
          serviceDate: { $gte: range.fromDate, $lte: range.toDate },
        },
      },
      {
        $group: {
          _id: '$carId',
          maintenanceCostInRange: { $sum: { $max: ['$serviceCost', 0] } },
        },
      },
    ]);

    for (const row of maintenanceRows) {
      const carId = normalizeObjectIdString(row?._id);
      if (!carId) continue;
      maintenanceByCar.set(carId, roundCurrency(row?.maintenanceCostInRange || 0));
    }
  }

  const branchMap = new Map();
  for (const branch of visibleBranches) {
    const branchId = normalizeObjectIdString(branch?._id);
    if (!branchId) continue;
    branchMap.set(branchId, {
      branchId,
      branchName: String(branch?.branchName || 'Unknown Branch'),
      branchCode: String(branch?.branchCode || ''),
      city: String(branch?.city || ''),
      state: String(branch?.state || ''),
    });
  }

  if (branchIdsInUse.size > 0) {
    const missingBranchIds = [...branchIdsInUse].filter((branchId) => !branchMap.has(branchId));
    if (missingBranchIds.length > 0) {
      const missingBranches = await Branch.find({ _id: { $in: missingBranchIds.map((id) => new mongoose.Types.ObjectId(id)) } })
        .select('_id branchName branchCode city state')
        .lean();
      for (const branch of missingBranches) {
        const branchId = normalizeObjectIdString(branch?._id);
        if (!branchId) continue;
        branchMap.set(branchId, {
          branchId,
          branchName: String(branch?.branchName || 'Unknown Branch'),
          branchCode: String(branch?.branchCode || ''),
          city: String(branch?.city || ''),
          state: String(branch?.state || ''),
        });
      }
    }
  }

  const rangeHours = computeRangeHours(range);
  const vehicles = [...carBaseById.values()].map((car) => {
    const metric = carMetricsById.get(car.carId) || {
      totalBookings: 0,
      overdueBookings: 0,
      totalRevenueGenerated: 0,
      totalLateFeeGenerated: 0,
      totalDamageCostCollected: 0,
      totalRentalHoursRaw: 0,
      branchId: car.branchId || '',
    };
    const branchId = car.branchId || metric.branchId || '';
    const bookedHours = roundCurrency(toSafeHours(utilizationHoursByCar.get(car.carId)));
    const utilizationPercent = rangeHours > 0 ? roundPercent((bookedHours / rangeHours) * 100) : 0;
    const idleTimePercent = roundPercent(Math.max(100 - utilizationPercent, 0));
    const totalBookings = Number(metric.totalBookings || 0);
    const totalRevenueGenerated = roundCurrency(metric.totalRevenueGenerated || 0);
    const averageRentalDurationHours =
      totalBookings > 0 ? roundCurrency(toSafeHours(metric.totalRentalHoursRaw) / totalBookings) : 0;
    const revenuePerTrip = totalBookings > 0 ? roundCurrency(totalRevenueGenerated / totalBookings) : 0;
    const revenuePerRentalHour = bookedHours > 0 ? roundCurrency(totalRevenueGenerated / bookedHours) : 0;
    const overdueRatePercent =
      totalBookings > 0 ? roundPercent((Number(metric.overdueBookings || 0) / totalBookings) * 100) : 0;
    const branchMeta = branchMap.get(branchId);
    const maintenanceCostInRange = roundCurrency(maintenanceByCar.get(car.carId) || 0);

    return {
      carId: car.carId,
      carName: String(car.name || 'Unknown Car'),
      brand: String(car.brand || ''),
      model: String(car.model || ''),
      registrationNumber: String(car.registrationNumber || ''),
      branchId,
      branchName: String(branchMeta?.branchName || 'Unassigned'),
      branchCode: String(branchMeta?.branchCode || ''),
      totalBookings,
      totalRevenueGenerated,
      totalLateFeeGenerated: roundCurrency(metric.totalLateFeeGenerated || 0),
      totalDamageCostCollected: roundCurrency(metric.totalDamageCostCollected || 0),
      totalRentalHours: bookedHours,
      averageRentalDurationHours,
      overdueRatePercent,
      utilizationPercent,
      idleTimePercent,
      totalTripsCompleted: Number(car.totalTripsCompleted || 0),
      revenuePerTrip,
      revenuePerRentalHour,
      maintenanceCostInRange,
      lifetimeMaintenanceCost: roundCurrency(car.lifetimeMaintenanceCost || 0),
    };
  });

  const revenueSortComparator = (left, right) =>
    safeNumber(right.totalRevenueGenerated) - safeNumber(left.totalRevenueGenerated) ||
    safeNumber(right.totalBookings) - safeNumber(left.totalBookings) ||
    String(left.carName).localeCompare(String(right.carName));
  const bookingSortComparator = (left, right) =>
    safeNumber(right.totalBookings) - safeNumber(left.totalBookings) ||
    safeNumber(right.totalRevenueGenerated) - safeNumber(left.totalRevenueGenerated) ||
    String(left.carName).localeCompare(String(right.carName));
  const selectedComparator =
    sortType === MOST_RENTED_SORT_TYPE.REVENUE ? revenueSortComparator : bookingSortComparator;

  const mostRentedCars = vehicles
    .filter((vehicle) => Number(vehicle.totalBookings || 0) > 0)
    .sort(selectedComparator);

  const utilizationStats = [...vehicles].sort(
    (left, right) =>
      safeNumber(right.utilizationPercent) - safeNumber(left.utilizationPercent) ||
      safeNumber(right.totalBookings) - safeNumber(left.totalBookings) ||
      String(left.carName).localeCompare(String(right.carName)),
  );

  const topPerformers = {
    highestRevenue: [...vehicles].sort(revenueSortComparator).slice(0, 5),
    mostBookings: [...vehicles].sort(bookingSortComparator).slice(0, 5),
    highestLateFeeContribution: [...vehicles]
      .sort(
        (left, right) =>
          safeNumber(right.totalLateFeeGenerated) - safeNumber(left.totalLateFeeGenerated) ||
          revenueSortComparator(left, right),
      )
      .slice(0, 5),
    lowestUtilization: [...vehicles]
      .sort(
        (left, right) =>
          safeNumber(left.utilizationPercent) - safeNumber(right.utilizationPercent) ||
          safeNumber(left.totalBookings) - safeNumber(right.totalBookings) ||
          String(left.carName).localeCompare(String(right.carName)),
      )
      .slice(0, 5),
    lowestRevenue: [...vehicles]
      .sort(
        (left, right) =>
          safeNumber(left.totalRevenueGenerated) - safeNumber(right.totalRevenueGenerated) ||
          safeNumber(left.totalBookings) - safeNumber(right.totalBookings) ||
          String(left.carName).localeCompare(String(right.carName)),
      )
      .slice(0, 5),
    highMaintenanceLowUsage: [...vehicles]
      .filter((vehicle) => safeNumber(vehicle.maintenanceCostInRange) > 0)
      .sort(
        (left, right) =>
          safeNumber(right.maintenanceCostInRange) - safeNumber(left.maintenanceCostInRange) ||
          safeNumber(left.utilizationPercent) - safeNumber(right.utilizationPercent) ||
          safeNumber(left.totalRevenueGenerated) - safeNumber(right.totalRevenueGenerated),
      )
      .slice(0, 5),
  };

  let branchComparison = [];
  if ([ROLE.SUPER_ADMIN, ROLE.PLATFORM_SUPER_ADMIN].includes(normalizedRole)) {
    const currentRangeDurationMs = Math.max(
      Number(range.toDate?.getTime() || 0) - Number(range.fromDate?.getTime() || 0),
      1,
    );
    const previousToDate = new Date(Number(range.fromDate?.getTime() || Date.now()) - 1);
    const previousFromDate = new Date(previousToDate.getTime() - currentRangeDurationMs);

    const branchUtilizationMap = new Map();
    for (const vehicle of vehicles) {
      const branchId = normalizeObjectIdString(vehicle.branchId);
      if (!branchId) continue;
      const current = branchUtilizationMap.get(branchId) || {
        totalUtilizationPercent: 0,
        vehicleCount: 0,
      };
      current.totalUtilizationPercent += safeNumber(vehicle.utilizationPercent);
      current.vehicleCount += 1;
      branchUtilizationMap.set(branchId, current);
    }

    const branchRows = await Booking.aggregate([
      { $match: bookingQuery },
      {
        $addFields: {
          _paymentStatusKey: normalizeStatusExpression('$paymentStatus'),
          _rentalStageKey: normalizeStatusExpression('$rentalStage'),
          _eventCompletedAt: { $ifNull: ['$actualReturnTime', '$updatedAt'] },
          _eventCreatedAt: { $ifNull: ['$createdAt', '$updatedAt'] },
          _eventFullPaidAt: { $ifNull: ['$fullPaymentReceivedAt', '$updatedAt'] },
          _effectiveFinalAmount: {
            $let: {
              vars: {
                finalAmount: { $ifNull: ['$finalAmount', 0] },
                totalAmount: { $ifNull: ['$totalAmount', 0] },
              },
              in: {
                $cond: [{ $gt: ['$$finalAmount', 0] }, '$$finalAmount', { $max: ['$$totalAmount', 0] }],
              },
            },
          },
          _lateFeeSafe: { $max: [{ $ifNull: ['$lateFee', 0] }, 0] },
          _lateHoursSafe: { $max: [{ $ifNull: ['$lateHours', 0] }, 0] },
          _damageCostSafe: {
            $cond: [
              { $eq: [{ $ifNull: ['$returnInspection.damageDetected', false] }, true] },
              { $max: [{ $ifNull: ['$returnInspection.damageCost', 0] }, 0] },
              0,
            ],
          },
          _isCancelledLike: {
            $in: [normalizeStatusExpression('$bookingStatus'), ['CANCELLED', 'CANCELLEDBYUSER', 'REJECTED']],
          },
          _isCompletedLike: {
            $or: [
              { $eq: [normalizeStatusExpression('$bookingStatus'), 'COMPLETED'] },
              { $eq: [normalizeStatusExpression('$rentalStage'), 'COMPLETED'] },
              { $eq: [normalizeStatusExpression('$tripStatus'), 'COMPLETED'] },
              { $ne: [{ $ifNull: ['$actualReturnTime', null] }, null] },
            ],
          },
        },
      },
      {
        $match: {
          _isCancelledLike: false,
        },
      },
      {
        $group: {
          _id: '$branchId',
          currentBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$_eventCreatedAt', range.fromDate] },
                    { $lte: ['$_eventCreatedAt', range.toDate] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          previousBookings: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$_eventCreatedAt', previousFromDate] },
                    { $lte: ['$_eventCreatedAt', previousToDate] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          currentRevenue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$_paymentStatusKey', 'FULLYPAID'] },
                    { $gte: ['$_eventFullPaidAt', range.fromDate] },
                    { $lte: ['$_eventFullPaidAt', range.toDate] },
                  ],
                },
                { $add: ['$_effectiveFinalAmount', '$_lateFeeSafe', '$_damageCostSafe'] },
                0,
              ],
            },
          },
          currentCompleted: {
            $sum: {
              $cond: [
                {
                  $and: [
                    '$_isCompletedLike',
                    { $gte: ['$_eventCompletedAt', range.fromDate] },
                    { $lte: ['$_eventCompletedAt', range.toDate] },
                  ],
                },
                1,
                0,
              ],
            },
          },
          currentOverdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    {
                      $or: [
                        { $gt: ['$_lateHoursSafe', 0] },
                        { $eq: ['$_rentalStageKey', 'OVERDUE'] },
                      ],
                    },
                    { $gte: ['$_eventCompletedAt', range.fromDate] },
                    { $lte: ['$_eventCompletedAt', range.toDate] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const branchMetricsMap = new Map();
    for (const row of branchRows) {
      const branchId = normalizeObjectIdString(row?._id);
      if (!branchId) continue;
      branchMetricsMap.set(branchId, {
        currentBookings: Number(row?.currentBookings || 0),
        previousBookings: Number(row?.previousBookings || 0),
        currentRevenue: roundCurrency(row?.currentRevenue || 0),
        currentCompleted: Number(row?.currentCompleted || 0),
        currentOverdue: Number(row?.currentOverdue || 0),
      });
    }

    const allBranchIds = new Set([
      ...visibleBranches.map((branch) => normalizeObjectIdString(branch?._id)).filter(Boolean),
      ...branchMetricsMap.keys(),
      ...branchUtilizationMap.keys(),
    ]);

    branchComparison = [...allBranchIds]
      .map((branchId) => {
        const branchMeta = branchMap.get(branchId);
        const metrics = branchMetricsMap.get(branchId) || {
          currentBookings: 0,
          currentRevenue: 0,
          currentCompleted: 0,
          currentOverdue: 0,
          previousBookings: 0,
        };
        const previousBookings = Number(metrics.previousBookings || 0);
        const utilizationMeta = branchUtilizationMap.get(branchId) || { totalUtilizationPercent: 0, vehicleCount: 0 };
        const averageUtilizationPercent =
          utilizationMeta.vehicleCount > 0
            ? roundPercent(utilizationMeta.totalUtilizationPercent / utilizationMeta.vehicleCount)
            : 0;
        const averageLateRatePercent =
          Number(metrics.currentCompleted || 0) > 0
            ? roundPercent((Number(metrics.currentOverdue || 0) / Number(metrics.currentCompleted || 0)) * 100)
            : 0;
        const currentBookings = Number(metrics.currentBookings || 0);
        const bookingGrowthPercent =
          previousBookings > 0
            ? roundPercent(((currentBookings - previousBookings) / previousBookings) * 100)
            : currentBookings > 0
              ? 100
              : 0;

        return {
          branchId,
          branchName: String(branchMeta?.branchName || 'Unassigned'),
          branchCode: String(branchMeta?.branchCode || ''),
          totalRevenue: roundCurrency(metrics.currentRevenue || 0),
          averageUtilizationPercent,
          averageLateRatePercent,
          currentBookings,
          previousBookings,
          bookingGrowthPercent,
          previousFromDate,
          previousToDate,
        };
      })
      .sort(
        (left, right) =>
          safeNumber(right.totalRevenue) - safeNumber(left.totalRevenue) ||
          safeNumber(right.currentBookings) - safeNumber(left.currentBookings) ||
          String(left.branchName).localeCompare(String(right.branchName)),
      );
  }

  return {
    sortType,
    mostRentedCars,
    utilizationStats,
    topPerformers,
    branchComparison,
  };
};

const buildCustomerBehaviorAnalytics = async (bookingQuery, range, options = {}) => {
  const customerSortType = normalizeCustomerSortType(options.customerSort);

  const [rangeRows, lifetimeRows] = await Promise.all([
    Booking.aggregate([
      { $match: bookingQuery },
      {
        $addFields: {
          _eventCreatedAt: { $ifNull: ['$createdAt', '$updatedAt'] },
          _bookingStatusKey: normalizeStatusExpression('$bookingStatus'),
          _paymentStatusKey: normalizeStatusExpression('$paymentStatus'),
          _refundStatusKey: normalizeStatusExpression('$refundStatus'),
          _rentalStageKey: normalizeStatusExpression('$rentalStage'),
          _effectivePickup: { $ifNull: ['$pickupDateTime', '$fromDate'] },
          _effectiveDrop: { $ifNull: ['$dropDateTime', '$toDate'] },
          _effectiveFinalAmount: {
            $let: {
              vars: {
                finalAmount: { $ifNull: ['$finalAmount', 0] },
                totalAmount: { $ifNull: ['$totalAmount', 0] },
              },
              in: {
                $cond: [{ $gt: ['$$finalAmount', 0] }, '$$finalAmount', { $max: ['$$totalAmount', 0] }],
              },
            },
          },
          _lateHoursSafe: { $max: [{ $ifNull: ['$lateHours', 0] }, 0] },
          _lateFeeSafe: { $max: [{ $ifNull: ['$lateFee', 0] }, 0] },
          _refundAmountSafe: { $max: [{ $ifNull: ['$refundAmount', 0] }, 0] },
          _damageCostSafe: {
            $cond: [
              { $eq: [{ $ifNull: ['$returnInspection.damageDetected', false] }, true] },
              { $max: [{ $ifNull: ['$returnInspection.damageCost', 0] }, 0] },
              0,
            ],
          },
        },
      },
      {
        $match: {
          _eventCreatedAt: { $gte: range.fromDate, $lte: range.toDate },
          user: { $ne: null },
        },
      },
      {
        $addFields: {
          _durationHours: {
            $cond: [
              {
                $and: [
                  { $ne: ['$_effectivePickup', null] },
                  { $ne: ['$_effectiveDrop', null] },
                  { $gt: ['$_effectiveDrop', '$_effectivePickup'] },
                ],
              },
              { $divide: [{ $subtract: ['$_effectiveDrop', '$_effectivePickup'] }, 1000 * 60 * 60] },
              0,
            ],
          },
          _isCancelledLike: {
            $in: ['$_bookingStatusKey', ['CANCELLED', 'CANCELLEDBYUSER', 'REJECTED']],
          },
          _isOverdueLike: {
            $or: [{ $gt: ['$_lateHoursSafe', 0] }, { $eq: ['$_rentalStageKey', 'OVERDUE'] }],
          },
          _isFullyPaid: { $eq: ['$_paymentStatusKey', 'FULLYPAID'] },
          _netRevenueSafe: {
            $cond: [
              { $eq: ['$_paymentStatusKey', 'FULLYPAID'] },
              {
                $max: [
                  {
                    $subtract: [
                      { $add: ['$_effectiveFinalAmount', '$_lateFeeSafe', '$_damageCostSafe'] },
                      {
                        $cond: [{ $eq: ['$_refundStatusKey', 'PROCESSED'] }, '$_refundAmountSafe', 0],
                      },
                    ],
                  },
                  0,
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: '$user',
          totalBookings: { $sum: 1 },
          cancelledBookings: { $sum: { $cond: ['$_isCancelledLike', 1, 0] } },
          overdueBookings: { $sum: { $cond: ['$_isOverdueLike', 1, 0] } },
          totalRevenueGenerated: { $sum: '$_netRevenueSafe' },
          totalLateHours: { $sum: '$_lateHoursSafe' },
          totalLateFees: { $sum: '$_lateFeeSafe' },
          totalRefundsReceived: {
            $sum: {
              $cond: [{ $eq: ['$_refundStatusKey', 'PROCESSED'] }, '$_refundAmountSafe', 0],
            },
          },
          totalRentalHours: { $sum: '$_durationHours' },
          bookingDates: { $push: '$_eventCreatedAt' },
        },
      },
    ]),
    Booking.aggregate([
      { $match: bookingQuery },
      {
        $addFields: {
          _paymentStatusKey: normalizeStatusExpression('$paymentStatus'),
          _refundStatusKey: normalizeStatusExpression('$refundStatus'),
          _effectiveFinalAmount: {
            $let: {
              vars: {
                finalAmount: { $ifNull: ['$finalAmount', 0] },
                totalAmount: { $ifNull: ['$totalAmount', 0] },
              },
              in: {
                $cond: [{ $gt: ['$$finalAmount', 0] }, '$$finalAmount', { $max: ['$$totalAmount', 0] }],
              },
            },
          },
          _lateFeeSafe: { $max: [{ $ifNull: ['$lateFee', 0] }, 0] },
          _refundAmountSafe: { $max: [{ $ifNull: ['$refundAmount', 0] }, 0] },
          _damageCostSafe: {
            $cond: [
              { $eq: [{ $ifNull: ['$returnInspection.damageDetected', false] }, true] },
              { $max: [{ $ifNull: ['$returnInspection.damageCost', 0] }, 0] },
              0,
            ],
          },
        },
      },
      {
        $match: {
          _paymentStatusKey: 'FULLYPAID',
          user: { $ne: null },
        },
      },
      {
        $group: {
          _id: '$user',
          lifetimeValue: {
            $sum: {
              $max: [
                {
                  $subtract: [
                    { $add: ['$_effectiveFinalAmount', '$_lateFeeSafe', '$_damageCostSafe'] },
                    {
                      $cond: [{ $eq: ['$_refundStatusKey', 'PROCESSED'] }, '$_refundAmountSafe', 0],
                    },
                  ],
                },
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const lifetimeMap = new Map(
    (Array.isArray(lifetimeRows) ? lifetimeRows : []).map((row) => [
      normalizeObjectIdString(row?._id),
      roundCurrency(row?.lifetimeValue || 0),
    ]),
  );

  const userIds = (Array.isArray(rangeRows) ? rangeRows : [])
    .map((row) => normalizeObjectIdString(row?._id))
    .filter(Boolean);
  const users = userIds.length
    ? await User.find({ _id: { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) } })
      .select('_id firstName lastName email')
      .lean()
    : [];
  const userMap = new Map(
    users.map((user) => {
      const userId = normalizeObjectIdString(user?._id);
      const fullName = `${String(user?.firstName || '').trim()} ${String(user?.lastName || '').trim()}`.trim();
      return [
        userId,
        {
          fullName: fullName || String(user?.email || 'Unknown Customer'),
          email: String(user?.email || ''),
        },
      ];
    }),
  );

  const customerInsights = (Array.isArray(rangeRows) ? rangeRows : []).map((row) => {
    const customerId = normalizeObjectIdString(row?._id);
    const totalBookings = Number(row?.totalBookings || 0);
    const cancelledBookings = Number(row?.cancelledBookings || 0);
    const overdueBookings = Number(row?.overdueBookings || 0);
    const totalRevenueGenerated = roundCurrency(row?.totalRevenueGenerated || 0);
    const totalLateHours = roundCurrency(row?.totalLateHours || 0);
    const totalLateFees = roundCurrency(row?.totalLateFees || 0);
    const totalRefundsReceived = roundCurrency(row?.totalRefundsReceived || 0);
    const totalRentalHours = roundCurrency(row?.totalRentalHours || 0);
    const cancellationRatePercent = totalBookings > 0 ? roundPercent((cancelledBookings / totalBookings) * 100) : 0;
    const overdueFrequencyPercent = totalBookings > 0 ? roundPercent((overdueBookings / totalBookings) * 100) : 0;
    const averageRentalDurationHours = totalBookings > 0 ? roundCurrency(totalRentalHours / totalBookings) : 0;
    const averageLateHoursPerBooking = totalBookings > 0 ? roundCurrency(totalLateHours / totalBookings) : 0;
    const lateRiskScore = roundPercent(
      Math.min(overdueFrequencyPercent * 0.7 + averageLateHoursPerBooking * 6 + cancellationRatePercent * 0.2, 100),
    );
    const bookingDates = (Array.isArray(row?.bookingDates) ? row.bookingDates : [])
      .map((value) => toValidDate(value))
      .filter(Boolean)
      .sort((left, right) => left.getTime() - right.getTime());
    const userMeta = userMap.get(customerId) || {
      fullName: 'Unknown Customer',
      email: '',
    };

    return {
      customerId,
      customerName: userMeta.fullName,
      email: userMeta.email,
      totalBookings,
      totalRevenueGenerated,
      totalLateHours,
      totalLateFees,
      totalRefundsReceived,
      cancellationRatePercent,
      averageRentalDurationHours,
      lifetimeValue: roundCurrency(lifetimeMap.get(customerId) || totalRevenueGenerated),
      overdueFrequencyPercent,
      lateRiskScore,
      bookingDates,
    };
  });

  const revenueValues = customerInsights.map((row) => safeNumber(row.totalRevenueGenerated));
  const bookingValues = customerInsights.map((row) => safeNumber(row.totalBookings));
  const revenueThreshold = Math.max(roundCurrency(average(revenueValues) * 1.5), 5000);
  const frequentBookingThreshold = Math.max(Math.ceil(average(bookingValues) * 1.3), 3);
  const segments = {
    vipCustomers: makeSegmentBucket('VIP Customers'),
    highRiskCustomers: makeSegmentBucket('High Risk Customers'),
    frequentRenters: makeSegmentBucket('Frequent Renters'),
    oneTimeUsers: makeSegmentBucket('One-Time Users'),
  };

  for (const row of customerInsights) {
    const customerLite = {
      customerId: row.customerId,
      customerName: row.customerName,
      email: row.email,
      totalBookings: row.totalBookings,
      totalRevenueGenerated: row.totalRevenueGenerated,
      cancellationRatePercent: row.cancellationRatePercent,
      overdueFrequencyPercent: row.overdueFrequencyPercent,
      totalLateHours: row.totalLateHours,
    };

    if (row.totalRevenueGenerated >= revenueThreshold && row.cancellationRatePercent <= 15) {
      segments.vipCustomers.count += 1;
      if (segments.vipCustomers.customers.length < 10) segments.vipCustomers.customers.push(customerLite);
    }

    if (row.overdueFrequencyPercent >= 30 || row.totalLateHours >= 8 || row.lateRiskScore >= 40) {
      segments.highRiskCustomers.count += 1;
      if (segments.highRiskCustomers.customers.length < 10) segments.highRiskCustomers.customers.push(customerLite);
    }

    if (row.totalBookings >= frequentBookingThreshold) {
      segments.frequentRenters.count += 1;
      if (segments.frequentRenters.customers.length < 10) segments.frequentRenters.customers.push(customerLite);
    }

    if (row.totalBookings === 1) {
      segments.oneTimeUsers.count += 1;
      if (segments.oneTimeUsers.customers.length < 10) segments.oneTimeUsers.customers.push(customerLite);
    }
  }

  const rangeDurationMs = Math.max(range.toDate.getTime() - range.fromDate.getTime(), 1);
  const midpointMs = range.fromDate.getTime() + Math.floor(rangeDurationMs / 2);
  const bookingGapHours = [];
  let repeatCustomers = 0;
  let retainedCustomers = 0;

  for (const row of customerInsights) {
    const dates = row.bookingDates;
    if (dates.length >= 2) {
      repeatCustomers += 1;
    }

    let hasFirstHalfBooking = false;
    let hasSecondHalfBooking = false;
    for (let index = 0; index < dates.length; index += 1) {
      const currentMs = dates[index].getTime();
      if (currentMs <= midpointMs) hasFirstHalfBooking = true;
      if (currentMs > midpointMs) hasSecondHalfBooking = true;
      if (index > 0) {
        const previousMs = dates[index - 1].getTime();
        const diffMs = currentMs - previousMs;
        if (diffMs > 0) {
          bookingGapHours.push(diffMs / (1000 * 60 * 60));
        }
      }
    }

    if (hasFirstHalfBooking && hasSecondHalfBooking) retainedCustomers += 1;
  }

  const activeCustomers = customerInsights.length;
  const repeatMetrics = {
    activeCustomers,
    repeatCustomers,
    oneTimeCustomers: customerInsights.filter((row) => row.totalBookings === 1).length,
    repeatBookingRatePercent: activeCustomers > 0 ? roundPercent((repeatCustomers / activeCustomers) * 100) : 0,
    averageTimeBetweenBookingsHours: roundCurrency(average(bookingGapHours)),
    retentionRatePercent: activeCustomers > 0 ? roundPercent((retainedCustomers / activeCustomers) * 100) : 0,
  };

  const sortComparators = {
    [CUSTOMER_SORT_TYPE.HIGHEST_REVENUE]: (left, right) =>
      safeNumber(right.totalRevenueGenerated) - safeNumber(left.totalRevenueGenerated) ||
      safeNumber(right.totalBookings) - safeNumber(left.totalBookings) ||
      String(left.customerName).localeCompare(String(right.customerName)),
    [CUSTOMER_SORT_TYPE.MOST_BOOKINGS]: (left, right) =>
      safeNumber(right.totalBookings) - safeNumber(left.totalBookings) ||
      safeNumber(right.totalRevenueGenerated) - safeNumber(left.totalRevenueGenerated) ||
      String(left.customerName).localeCompare(String(right.customerName)),
    [CUSTOMER_SORT_TYPE.HIGHEST_LATE_RISK]: (left, right) =>
      safeNumber(right.lateRiskScore) - safeNumber(left.lateRiskScore) ||
      safeNumber(right.totalLateHours) - safeNumber(left.totalLateHours) ||
      safeNumber(right.totalBookings) - safeNumber(left.totalBookings),
    [CUSTOMER_SORT_TYPE.HIGHEST_CANCELLATION_RATE]: (left, right) =>
      safeNumber(right.cancellationRatePercent) - safeNumber(left.cancellationRatePercent) ||
      safeNumber(right.totalBookings) - safeNumber(left.totalBookings) ||
      safeNumber(right.totalRevenueGenerated) - safeNumber(left.totalRevenueGenerated),
  };

  const sortedInsights = [...customerInsights]
    .sort(sortComparators[customerSortType] || sortComparators[CUSTOMER_SORT_TYPE.HIGHEST_REVENUE])
    .map((row) => ({
      ...row,
      bookingDates: undefined,
    }));

  const totalSegmentBase = Math.max(customerInsights.length, 1);
  const customerSegments = {
    ...segments,
    distribution: [
      {
        key: 'vipCustomers',
        label: segments.vipCustomers.label,
        count: segments.vipCustomers.count,
        sharePercent: roundPercent((segments.vipCustomers.count / totalSegmentBase) * 100),
      },
      {
        key: 'highRiskCustomers',
        label: segments.highRiskCustomers.label,
        count: segments.highRiskCustomers.count,
        sharePercent: roundPercent((segments.highRiskCustomers.count / totalSegmentBase) * 100),
      },
      {
        key: 'frequentRenters',
        label: segments.frequentRenters.label,
        count: segments.frequentRenters.count,
        sharePercent: roundPercent((segments.frequentRenters.count / totalSegmentBase) * 100),
      },
      {
        key: 'oneTimeUsers',
        label: segments.oneTimeUsers.label,
        count: segments.oneTimeUsers.count,
        sharePercent: roundPercent((segments.oneTimeUsers.count / totalSegmentBase) * 100),
      },
    ],
    thresholds: {
      vipRevenueThreshold: roundCurrency(revenueThreshold),
      frequentBookingThreshold,
    },
  };

  return {
    customerSortType,
    customerInsights: sortedInsights,
    customerSegments,
    repeatMetrics,
  };
};

const buildAdminPerformanceAnalytics = async (bookingQuery, carMatch, range, options = {}) => {
  const scopedBranchIds = Array.isArray(options.scopedBranchIds)
    ? options.scopedBranchIds.map((id) => String(id || '').trim()).filter(Boolean)
    : null;
  const selectedBranchId = String(options.selectedBranchId || '').trim();
  const effectiveBranchScope = selectedBranchId
    ? [selectedBranchId]
    : Array.isArray(scopedBranchIds)
      ? scopedBranchIds
      : null;
  const visibleBranches = Array.isArray(options.visibleBranches) ? options.visibleBranches : [];

  const staffQuery = { role: { $ne: ROLE.USER } };
  if (Array.isArray(effectiveBranchScope)) {
    if (effectiveBranchScope.length === 0) {
      staffQuery._id = { $in: [] };
    } else {
      staffQuery.$or = [
        { role: ROLE.SUPER_ADMIN },
        { assignedBranches: { $in: effectiveBranchScope } },
      ];
    }
  }

  const staffUsers = await User.find(staffQuery)
    .select('_id firstName lastName email role assignedBranches')
    .lean();
  const staffIds = staffUsers.map((user) => normalizeObjectIdString(user?._id)).filter(Boolean);
  const staffIdSet = new Set(staffIds);
  const staffMeta = new Map(
    staffUsers.map((user) => {
      const userId = normalizeObjectIdString(user?._id);
      const fullName = `${String(user?.firstName || '').trim()} ${String(user?.lastName || '').trim()}`.trim();
      return [
        userId,
        {
          adminId: userId,
          adminName: fullName || String(user?.email || 'Staff'),
          email: String(user?.email || ''),
          role: normalizeRole(user?.role, ROLE.USER),
          assignedBranches: Array.isArray(user?.assignedBranches)
            ? user.assignedBranches.map((entry) => String(entry || '').trim()).filter(Boolean)
            : [],
        },
      ];
    }),
  );

  const relevantActionTypes = [
    'REFUND_PROCESSED',
    'REFUND_REJECTED',
    'DRIVER_ASSIGNED',
    'MAINTENANCE_ADDED',
    'VEHICLE_MARKED_MAINTENANCE',
  ];

  const logs = await AuditLog.find({
    actionType: { $in: relevantActionTypes },
    createdAt: { $gte: range.fromDate, $lte: range.toDate },
  })
    .select('userId actionType targetEntity targetId createdAt')
    .lean();

  const scopedCars = await Car.find(carMatch).select('_id').lean();
  const scopedCarIdSet = new Set(scopedCars.map((car) => normalizeObjectIdString(car?._id)).filter(Boolean));

  const bookingTargetIdSet = new Set();
  for (const log of logs) {
    const userId = normalizeObjectIdString(log?.userId);
    if (!userId || (staffIdSet.size > 0 && !staffIdSet.has(userId))) continue;
    if (String(log?.targetEntity || '').trim().toLowerCase() !== 'booking') continue;
    const bookingId = normalizeObjectIdString(log?.targetId);
    if (bookingId) bookingTargetIdSet.add(bookingId);
  }

  const activityConditions = [
    { 'pickupInspection.inspectedAt': { $gte: range.fromDate, $lte: range.toDate } },
    { 'returnInspection.inspectedAt': { $gte: range.fromDate, $lte: range.toDate } },
  ];
  if (bookingTargetIdSet.size > 0) {
    activityConditions.push({
      _id: { $in: [...bookingTargetIdSet].map((id) => new mongoose.Types.ObjectId(id)) },
    });
  }

  const bookingActivityQuery =
    activityConditions.length > 0 ? andQuery(bookingQuery, { $or: activityConditions }) : bookingQuery;
  const bookingDocs = await Booking.find(bookingActivityQuery)
    .select(
      '_id createdAt paymentStatus finalAmount totalAmount lateFee refundAmount pickupInspection returnInspection',
    )
    .lean();
  const bookingMap = new Map(
    bookingDocs.map((booking) => [normalizeObjectIdString(booking?._id), booking]),
  );

  const branchNameMap = new Map(
    visibleBranches.map((branch) => [
      String(branch?._id || ''),
      String(branch?.branchName || ''),
    ]),
  );

  const ensureMetric = (metricMap, adminId) => {
    if (!metricMap.has(adminId)) {
      metricMap.set(adminId, {
        adminId,
        bookingIds: new Set(),
        bookingFirstTouchById: new Map(),
        driverAllocationDurations: [],
        confirmDurations: [],
        inspectionCompletionDurations: [],
        totalBookingsManaged: 0,
        totalRefundsProcessed: 0,
        totalRefundsRejected: 0,
        totalRevenueHandled: 0,
        averageBookingProcessingTimeHours: 0,
        numberOfDriverAssignments: 0,
        numberOfMaintenanceRecordsAdded: 0,
        damageInspectionsConducted: 0,
        refundApprovalRatePercent: 0,
        averageTimeToConfirmBookingHours: 0,
        inspectionCompletionTimeHours: 0,
        driverAllocationSpeedHours: 0,
      });
    }
    return metricMap.get(adminId);
  };

  const metricMap = new Map();

  for (const log of logs) {
    const adminId = normalizeObjectIdString(log?.userId);
    if (!adminId || (staffIdSet.size > 0 && !staffIdSet.has(adminId))) continue;

    const targetEntity = String(log?.targetEntity || '').trim().toLowerCase();
    const targetId = normalizeObjectIdString(log?.targetId);
    const actionType = String(log?.actionType || '').trim().toUpperCase();
    const actionAt = toValidDate(log?.createdAt);
    if (!actionAt) continue;

    if (targetEntity === 'car') {
      if (!targetId || !scopedCarIdSet.has(targetId)) continue;
      const metric = ensureMetric(metricMap, adminId);
      if (actionType === 'MAINTENANCE_ADDED') {
        metric.numberOfMaintenanceRecordsAdded += 1;
      }
      continue;
    }

    if (targetEntity !== 'booking') continue;
    if (!targetId || !bookingMap.has(targetId)) continue;

    const booking = bookingMap.get(targetId);
    const metric = ensureMetric(metricMap, adminId);
    metric.bookingIds.add(targetId);

    const currentFirstTouch = metric.bookingFirstTouchById.get(targetId);
    if (!currentFirstTouch || actionAt.getTime() < currentFirstTouch.getTime()) {
      metric.bookingFirstTouchById.set(targetId, actionAt);
    }

    if (actionType === 'DRIVER_ASSIGNED') {
      metric.numberOfDriverAssignments += 1;
      const durationHours = toDurationHours(booking?.createdAt, actionAt);
      if (durationHours > 0) metric.driverAllocationDurations.push(durationHours);
    } else if (actionType === 'REFUND_PROCESSED') {
      metric.totalRefundsProcessed += 1;
    } else if (actionType === 'REFUND_REJECTED') {
      metric.totalRefundsRejected += 1;
    }
  }

  for (const booking of bookingDocs) {
    const bookingId = normalizeObjectIdString(booking?._id);
    if (!bookingId) continue;

    const pickupInspectorId = normalizeObjectIdString(booking?.pickupInspection?.inspectedBy);
    const pickupInspectedAt = toValidDate(booking?.pickupInspection?.inspectedAt);
    if (pickupInspectorId && isDateWithinRange(pickupInspectedAt, range.fromDate, range.toDate)) {
      const metric = ensureMetric(metricMap, pickupInspectorId);
      metric.bookingIds.add(bookingId);
      const confirmHours = toDurationHours(booking?.createdAt, pickupInspectedAt);
      if (confirmHours > 0) metric.confirmDurations.push(confirmHours);
    }

    const returnInspectorId = normalizeObjectIdString(booking?.returnInspection?.inspectedBy);
    const returnInspectedAt = toValidDate(booking?.returnInspection?.inspectedAt);
    if (returnInspectorId && isDateWithinRange(returnInspectedAt, range.fromDate, range.toDate)) {
      const metric = ensureMetric(metricMap, returnInspectorId);
      metric.bookingIds.add(bookingId);
      if (Boolean(booking?.returnInspection?.damageDetected)) {
        metric.damageInspectionsConducted += 1;
      }

      const inspectionCompletionHours = toDurationHours(pickupInspectedAt, returnInspectedAt);
      if (inspectionCompletionHours > 0) {
        metric.inspectionCompletionDurations.push(inspectionCompletionHours);
      }
    }
  }

  const buildBookingRevenue = (booking) => {
    const paymentStatusKey = normalizeStatusKey(booking?.paymentStatus);
    if (paymentStatusKey !== 'FULLYPAID') return 0;

    const finalAmount = Math.max(Number(booking?.finalAmount || booking?.totalAmount || 0), 0);
    const lateFee = Math.max(Number(booking?.lateFee || 0), 0);
    const damageCost = Boolean(booking?.returnInspection?.damageDetected)
      ? Math.max(Number(booking?.returnInspection?.damageCost || 0), 0)
      : 0;
    const refundAmount = Math.max(Number(booking?.refundAmount || 0), 0);
    return roundCurrency(Math.max(finalAmount + lateFee + damageCost - refundAmount, 0));
  };

  const adminPerformance = [];
  for (const staffId of staffIds) {
    const baseMeta = staffMeta.get(staffId);
    const metric = ensureMetric(metricMap, staffId);
    const bookingProcessingDurations = [];
    let totalRevenueHandled = 0;

    for (const bookingId of metric.bookingIds) {
      const booking = bookingMap.get(bookingId);
      if (!booking) continue;
      totalRevenueHandled += buildBookingRevenue(booking);
    }

    for (const [bookingId, firstTouchAt] of metric.bookingFirstTouchById.entries()) {
      const booking = bookingMap.get(bookingId);
      if (!booking) continue;
      const processingHours = toDurationHours(booking?.createdAt, firstTouchAt);
      if (processingHours > 0) bookingProcessingDurations.push(processingHours);
    }

    const refundDecisions = metric.totalRefundsProcessed + metric.totalRefundsRejected;
    adminPerformance.push({
      adminId: staffId,
      adminName: baseMeta?.adminName || 'Staff',
      email: baseMeta?.email || '',
      role: baseMeta?.role || ROLE.USER,
      assignedBranches: (baseMeta?.assignedBranches || []).map((branchId) => ({
        branchId,
        branchName: branchNameMap.get(branchId) || '',
      })),
      totalBookingsManaged: metric.bookingIds.size,
      totalRefundsProcessed: metric.totalRefundsProcessed,
      totalRevenueHandled: roundCurrency(totalRevenueHandled),
      averageBookingProcessingTimeHours: roundCurrency(average(bookingProcessingDurations)),
      numberOfDriverAssignments: metric.numberOfDriverAssignments,
      numberOfMaintenanceRecordsAdded: metric.numberOfMaintenanceRecordsAdded,
      damageInspectionsConducted: metric.damageInspectionsConducted,
      refundApprovalRatePercent: refundDecisions > 0
        ? roundPercent((metric.totalRefundsProcessed / refundDecisions) * 100)
        : 0,
      averageTimeToConfirmBookingHours: roundCurrency(average(metric.confirmDurations)),
      inspectionCompletionTimeHours: roundCurrency(average(metric.inspectionCompletionDurations)),
      driverAllocationSpeedHours: roundCurrency(average(metric.driverAllocationDurations)),
    });
  }

  adminPerformance.sort(
    (left, right) =>
      safeNumber(right.totalBookingsManaged) - safeNumber(left.totalBookingsManaged) ||
      safeNumber(right.totalRefundsProcessed) - safeNumber(left.totalRefundsProcessed) ||
      safeNumber(right.totalRevenueHandled) - safeNumber(left.totalRevenueHandled) ||
      String(left.adminName).localeCompare(String(right.adminName)),
  );

  return adminPerformance;
};

const buildGeographicAnalytics = async (bookingQuery, range, options = {}) => {
  const precision = Number.isFinite(Number(options.precision))
    ? Math.max(Math.min(Math.trunc(Number(options.precision)), 5), 0)
    : GEO_CLUSTER_PRECISION;
  const timezone = normalizeTimezone(options.timezone);
  const visibleBranches = Array.isArray(options.visibleBranches) ? options.visibleBranches : [];

  const validPickupExpr = {
    $and: [
      { $ne: ['$_pickupLat', null] },
      { $ne: ['$_pickupLng', null] },
      { $gte: ['$_pickupLat', -90] },
      { $lte: ['$_pickupLat', 90] },
      { $gte: ['$_pickupLng', -180] },
      { $lte: ['$_pickupLng', 180] },
    ],
  };
  const validDropExpr = {
    $and: [
      { $ne: ['$_dropLat', null] },
      { $ne: ['$_dropLng', null] },
      { $gte: ['$_dropLat', -90] },
      { $lte: ['$_dropLat', 90] },
      { $gte: ['$_dropLng', -180] },
      { $lte: ['$_dropLng', 180] },
    ],
  };

  const [aggregation] = await Booking.aggregate([
    { $match: bookingQuery },
    {
      $addFields: {
        _eventCreatedAt: { $ifNull: ['$createdAt', '$updatedAt'] },
        _paymentStatusKey: normalizeStatusExpression('$paymentStatus'),
        _rentalStageKey: normalizeStatusExpression('$rentalStage'),
        _effectiveFinalAmount: {
          $let: {
            vars: {
              finalAmount: { $ifNull: ['$finalAmount', 0] },
              totalAmount: { $ifNull: ['$totalAmount', 0] },
            },
            in: {
              $cond: [{ $gt: ['$$finalAmount', 0] }, '$$finalAmount', { $max: ['$$totalAmount', 0] }],
            },
          },
        },
        _lateHoursSafe: { $max: [{ $ifNull: ['$lateHours', 0] }, 0] },
        _lateFeeSafe: { $max: [{ $ifNull: ['$lateFee', 0] }, 0] },
        _damageCostSafe: {
          $cond: [
            { $eq: [{ $ifNull: ['$returnInspection.damageDetected', false] }, true] },
            { $max: [{ $ifNull: ['$returnInspection.damageCost', 0] }, 0] },
            0,
          ],
        },
        _pickupLat: {
          $convert: {
            input: '$pickupLocation.latitude',
            to: 'double',
            onError: null,
            onNull: null,
          },
        },
        _pickupLng: {
          $convert: {
            input: '$pickupLocation.longitude',
            to: 'double',
            onError: null,
            onNull: null,
          },
        },
        _dropLat: {
          $convert: {
            input: '$dropLocation.latitude',
            to: 'double',
            onError: null,
            onNull: null,
          },
        },
        _dropLng: {
          $convert: {
            input: '$dropLocation.longitude',
            to: 'double',
            onError: null,
            onNull: null,
          },
        },
        _pickupAddress: {
          $trim: {
            input: { $ifNull: ['$pickupLocation.address', ''] },
          },
        },
        _dropAddress: {
          $trim: {
            input: { $ifNull: ['$dropLocation.address', ''] },
          },
        },
        _pickupDateRef: { $ifNull: ['$pickupDateTime', '$fromDate'] },
      },
    },
    {
      $match: {
        _eventCreatedAt: { $gte: range.fromDate, $lte: range.toDate },
      },
    },
    {
      $addFields: {
        _isOverdueLike: {
          $or: [{ $gt: ['$_lateHoursSafe', 0] }, { $eq: ['$_rentalStageKey', 'OVERDUE'] }],
        },
        _netRevenueSafe: {
          $cond: [
            { $eq: ['$_paymentStatusKey', 'FULLYPAID'] },
            { $add: ['$_effectiveFinalAmount', '$_lateFeeSafe', '$_damageCostSafe'] },
            0,
          ],
        },
      },
    },
    {
      $facet: {
        pickupHeatmap: [
          { $match: { $expr: validPickupExpr } },
          {
            $group: {
              _id: {
                latitude: { $round: ['$_pickupLat', precision] },
                longitude: { $round: ['$_pickupLng', precision] },
              },
              bookingCount: { $sum: 1 },
              totalRevenue: { $sum: '$_netRevenueSafe' },
              overdueCount: { $sum: { $cond: ['$_isOverdueLike', 1, 0] } },
              sampleAddress: { $first: '$_pickupAddress' },
            },
          },
          {
            $project: {
              _id: 0,
              latitude: '$_id.latitude',
              longitude: '$_id.longitude',
              bookingCount: 1,
              totalRevenue: { $round: ['$totalRevenue', 2] },
              overdueCount: 1,
              overdueRatePercent: {
                $cond: [
                  { $gt: ['$bookingCount', 0] },
                  { $round: [{ $multiply: [{ $divide: ['$overdueCount', '$bookingCount'] }, 100] }, 2] },
                  0,
                ],
              },
              sampleAddress: 1,
            },
          },
          { $sort: { bookingCount: -1, totalRevenue: -1 } },
        ],
        dropHeatmap: [
          { $match: { $expr: validDropExpr } },
          {
            $group: {
              _id: {
                latitude: { $round: ['$_dropLat', precision] },
                longitude: { $round: ['$_dropLng', precision] },
              },
              bookingCount: { $sum: 1 },
              sampleAddress: { $first: '$_dropAddress' },
            },
          },
          {
            $project: {
              _id: 0,
              latitude: '$_id.latitude',
              longitude: '$_id.longitude',
              bookingCount: 1,
              sampleAddress: 1,
            },
          },
          { $sort: { bookingCount: -1 } },
        ],
        areaRevenueStats: [
          { $match: { $expr: validPickupExpr } },
          {
            $group: {
              _id: {
                latitude: { $round: ['$_pickupLat', precision] },
                longitude: { $round: ['$_pickupLng', precision] },
                branchId: '$branchId',
              },
              bookingCount: { $sum: 1 },
              totalRevenue: { $sum: '$_netRevenueSafe' },
              totalLateFee: { $sum: '$_lateFeeSafe' },
              totalDamageCost: { $sum: '$_damageCostSafe' },
              sampleAddress: { $first: '$_pickupAddress' },
            },
          },
          {
            $project: {
              _id: 0,
              latitude: '$_id.latitude',
              longitude: '$_id.longitude',
              branchId: '$_id.branchId',
              bookingCount: 1,
              totalRevenue: { $round: ['$totalRevenue', 2] },
              totalLateFee: { $round: ['$totalLateFee', 2] },
              totalDamageCost: { $round: ['$totalDamageCost', 2] },
              sampleAddress: 1,
            },
          },
          { $sort: { totalRevenue: -1, bookingCount: -1 } },
        ],
        areaOverdueStats: [
          { $match: { $expr: validPickupExpr } },
          {
            $group: {
              _id: {
                latitude: { $round: ['$_pickupLat', precision] },
                longitude: { $round: ['$_pickupLng', precision] },
                branchId: '$branchId',
              },
              bookingCount: { $sum: 1 },
              overdueCount: { $sum: { $cond: ['$_isOverdueLike', 1, 0] } },
              totalLateHours: { $sum: '$_lateHoursSafe' },
              totalLateFee: { $sum: '$_lateFeeSafe' },
              sampleAddress: { $first: '$_pickupAddress' },
            },
          },
          {
            $project: {
              _id: 0,
              latitude: '$_id.latitude',
              longitude: '$_id.longitude',
              branchId: '$_id.branchId',
              bookingCount: 1,
              overdueCount: 1,
              overdueRatePercent: {
                $cond: [
                  { $gt: ['$bookingCount', 0] },
                  { $round: [{ $multiply: [{ $divide: ['$overdueCount', '$bookingCount'] }, 100] }, 2] },
                  0,
                ],
              },
              totalLateHours: { $round: ['$totalLateHours', 2] },
              totalLateFee: { $round: ['$totalLateFee', 2] },
              sampleAddress: 1,
            },
          },
          { $sort: { overdueRatePercent: -1, overdueCount: -1, totalLateHours: -1 } },
        ],
        areaHourStats: [
          {
            $match: {
              $expr: {
                $and: [validPickupExpr, { $ne: ['$_pickupDateRef', null] }],
              },
            },
          },
          {
            $group: {
              _id: {
                latitude: { $round: ['$_pickupLat', precision] },
                longitude: { $round: ['$_pickupLng', precision] },
                branchId: '$branchId',
                hourOfDay: {
                  $hour: {
                    date: '$_pickupDateRef',
                    timezone,
                  },
                },
              },
              bookingCount: { $sum: 1 },
              totalRevenue: { $sum: '$_netRevenueSafe' },
            },
          },
          { $sort: { bookingCount: -1, totalRevenue: -1 } },
        ],
        areaDayStats: [
          {
            $match: {
              $expr: {
                $and: [validPickupExpr, { $ne: ['$_pickupDateRef', null] }],
              },
            },
          },
          {
            $group: {
              _id: {
                latitude: { $round: ['$_pickupLat', precision] },
                longitude: { $round: ['$_pickupLng', precision] },
                branchId: '$branchId',
                dayOfWeek: {
                  $dayOfWeek: {
                    date: '$_pickupDateRef',
                    timezone,
                  },
                },
              },
              bookingCount: { $sum: 1 },
            },
          },
          { $sort: { bookingCount: -1 } },
        ],
        branchHourStats: [
          {
            $match: {
              $expr: { $ne: ['$_pickupDateRef', null] },
            },
          },
          {
            $group: {
              _id: {
                branchId: '$branchId',
                hourOfDay: {
                  $hour: {
                    date: '$_pickupDateRef',
                    timezone,
                  },
                },
              },
              bookingCount: { $sum: 1 },
            },
          },
          { $sort: { bookingCount: -1 } },
        ],
      },
    },
  ]);

  const branchMap = new Map(
    visibleBranches.map((branch) => [
      normalizeObjectIdString(branch?._id),
      {
        branchName: String(branch?.branchName || ''),
        branchCode: String(branch?.branchCode || ''),
      },
    ]),
  );

  const pickupHeatmap = Array.isArray(aggregation?.pickupHeatmap) ? aggregation.pickupHeatmap : [];
  const dropHeatmap = Array.isArray(aggregation?.dropHeatmap) ? aggregation.dropHeatmap : [];
  const areaRevenueStats = (Array.isArray(aggregation?.areaRevenueStats) ? aggregation.areaRevenueStats : []).map((row) => {
    const branchId = normalizeObjectIdString(row?.branchId);
    const branchMeta = branchMap.get(branchId) || {};
    return {
      latitude: safeNumber(row?.latitude),
      longitude: safeNumber(row?.longitude),
      branchId,
      branchName: String(branchMeta.branchName || 'Unassigned'),
      branchCode: String(branchMeta.branchCode || ''),
      bookingCount: safeNumber(row?.bookingCount),
      totalRevenue: roundCurrency(row?.totalRevenue || 0),
      totalLateFee: roundCurrency(row?.totalLateFee || 0),
      totalDamageCost: roundCurrency(row?.totalDamageCost || 0),
      sampleAddress: String(row?.sampleAddress || ''),
    };
  });
  const areaOverdueStats = (Array.isArray(aggregation?.areaOverdueStats) ? aggregation.areaOverdueStats : []).map((row) => {
    const branchId = normalizeObjectIdString(row?.branchId);
    const branchMeta = branchMap.get(branchId) || {};
    return {
      latitude: safeNumber(row?.latitude),
      longitude: safeNumber(row?.longitude),
      branchId,
      branchName: String(branchMeta.branchName || 'Unassigned'),
      branchCode: String(branchMeta.branchCode || ''),
      bookingCount: safeNumber(row?.bookingCount),
      overdueCount: safeNumber(row?.overdueCount),
      overdueRatePercent: roundPercent(row?.overdueRatePercent || 0),
      totalLateHours: roundCurrency(row?.totalLateHours || 0),
      totalLateFee: roundCurrency(row?.totalLateFee || 0),
      sampleAddress: String(row?.sampleAddress || ''),
    };
  });

  const areaTimeMap = new Map();
  for (const row of Array.isArray(aggregation?.areaHourStats) ? aggregation.areaHourStats : []) {
    const latitude = safeNumber(row?._id?.latitude);
    const longitude = safeNumber(row?._id?.longitude);
    const branchId = normalizeObjectIdString(row?._id?.branchId);
    const key = `${latitude}|${longitude}|${branchId}`;
    if (!areaTimeMap.has(key)) {
      const branchMeta = branchMap.get(branchId) || {};
      areaTimeMap.set(key, {
        latitude,
        longitude,
        branchId,
        branchName: String(branchMeta.branchName || 'Unassigned'),
        branchCode: String(branchMeta.branchCode || ''),
        peakHour: null,
        peakHourBookingCount: 0,
        peakHourRevenue: 0,
        peakDayOfWeek: null,
        peakDayBookingCount: 0,
      });
    }
    const entry = areaTimeMap.get(key);
    const hourOfDay = safeNumber(row?._id?.hourOfDay);
    const bookingCount = safeNumber(row?.bookingCount);
    const totalRevenue = roundCurrency(row?.totalRevenue || 0);
    if (
      bookingCount > safeNumber(entry.peakHourBookingCount) ||
      (bookingCount === safeNumber(entry.peakHourBookingCount) && totalRevenue > safeNumber(entry.peakHourRevenue))
    ) {
      entry.peakHour = hourOfDay;
      entry.peakHourBookingCount = bookingCount;
      entry.peakHourRevenue = totalRevenue;
    }
  }

  for (const row of Array.isArray(aggregation?.areaDayStats) ? aggregation.areaDayStats : []) {
    const latitude = safeNumber(row?._id?.latitude);
    const longitude = safeNumber(row?._id?.longitude);
    const branchId = normalizeObjectIdString(row?._id?.branchId);
    const key = `${latitude}|${longitude}|${branchId}`;
    if (!areaTimeMap.has(key)) {
      const branchMeta = branchMap.get(branchId) || {};
      areaTimeMap.set(key, {
        latitude,
        longitude,
        branchId,
        branchName: String(branchMeta.branchName || 'Unassigned'),
        branchCode: String(branchMeta.branchCode || ''),
        peakHour: null,
        peakHourBookingCount: 0,
        peakHourRevenue: 0,
        peakDayOfWeek: null,
        peakDayBookingCount: 0,
      });
    }
    const entry = areaTimeMap.get(key);
    const dayOfWeek = safeNumber(row?._id?.dayOfWeek);
    const bookingCount = safeNumber(row?.bookingCount);
    if (bookingCount > safeNumber(entry.peakDayBookingCount)) {
      entry.peakDayOfWeek = dayOfWeek;
      entry.peakDayBookingCount = bookingCount;
    }
  }

  const areaRevenueMap = new Map(
    areaRevenueStats.map((row) => [
      `${row.latitude}|${row.longitude}|${row.branchId}`,
      row,
    ]),
  );
  const areaOverdueMap = new Map(
    areaOverdueStats.map((row) => [
      `${row.latitude}|${row.longitude}|${row.branchId}`,
      row,
    ]),
  );

  const peakTimeByArea = [...new Set([...areaTimeMap.keys(), ...areaRevenueMap.keys(), ...areaOverdueMap.keys()])]
    .map((key) => {
      const timeEntry = areaTimeMap.get(key) || {};
      const revenueEntry = areaRevenueMap.get(key) || {};
      const overdueEntry = areaOverdueMap.get(key) || {};
      const branchId = normalizeObjectIdString(timeEntry.branchId || revenueEntry.branchId || overdueEntry.branchId);
      const branchMeta = branchMap.get(branchId) || {};

      return {
        latitude: safeNumber(timeEntry.latitude ?? revenueEntry.latitude ?? overdueEntry.latitude),
        longitude: safeNumber(timeEntry.longitude ?? revenueEntry.longitude ?? overdueEntry.longitude),
        branchId,
        branchName: String(branchMeta.branchName || timeEntry.branchName || revenueEntry.branchName || overdueEntry.branchName || 'Unassigned'),
        branchCode: String(branchMeta.branchCode || ''),
        peakHour: timeEntry.peakHour === null || timeEntry.peakHour === undefined ? null : safeNumber(timeEntry.peakHour),
        peakHourLabel:
          timeEntry.peakHour === null || timeEntry.peakHour === undefined
            ? ''
            : `${String(safeNumber(timeEntry.peakHour)).padStart(2, '0')}:00`,
        peakHourBookingCount: safeNumber(timeEntry.peakHourBookingCount),
        peakDayOfWeek: timeEntry.peakDayOfWeek === null || timeEntry.peakDayOfWeek === undefined
          ? null
          : safeNumber(timeEntry.peakDayOfWeek),
        peakDayLabel: DAY_OF_WEEK_LABELS[safeNumber(timeEntry.peakDayOfWeek)] || '',
        peakDayBookingCount: safeNumber(timeEntry.peakDayBookingCount),
        bookingCount: safeNumber(revenueEntry.bookingCount || overdueEntry.bookingCount),
        totalRevenue: roundCurrency(revenueEntry.totalRevenue || 0),
        overdueCount: safeNumber(overdueEntry.overdueCount),
        overdueRatePercent: roundPercent(overdueEntry.overdueRatePercent || 0),
      };
    })
    .sort(
      (left, right) =>
        safeNumber(right.peakHourBookingCount) - safeNumber(left.peakHourBookingCount) ||
        safeNumber(right.totalRevenue) - safeNumber(left.totalRevenue),
    );

  const branchPeakMap = new Map();
  for (const row of Array.isArray(aggregation?.branchHourStats) ? aggregation.branchHourStats : []) {
    const branchId = normalizeObjectIdString(row?._id?.branchId);
    const hourOfDay = safeNumber(row?._id?.hourOfDay);
    const bookingCount = safeNumber(row?.bookingCount);
    const current = branchPeakMap.get(branchId);
    if (!current || bookingCount > safeNumber(current.bookingCount)) {
      const branchMeta = branchMap.get(branchId) || {};
      branchPeakMap.set(branchId, {
        branchId,
        branchName: String(branchMeta.branchName || 'Unassigned'),
        branchCode: String(branchMeta.branchCode || ''),
        peakHour: hourOfDay,
        peakHourLabel: `${String(hourOfDay).padStart(2, '0')}:00`,
        bookingCount,
      });
    }
  }

  const geoStrategicInsights = {
    topHighDemandAreas: [...pickupHeatmap]
      .sort(
        (left, right) =>
          safeNumber(right.bookingCount) - safeNumber(left.bookingCount) ||
          safeNumber(right.totalRevenue) - safeNumber(left.totalRevenue),
      )
      .slice(0, 3),
    topHighLateAreas: [...areaOverdueStats]
      .sort(
        (left, right) =>
          safeNumber(right.overdueRatePercent) - safeNumber(left.overdueRatePercent) ||
          safeNumber(right.overdueCount) - safeNumber(left.overdueCount) ||
          safeNumber(right.totalLateHours) - safeNumber(left.totalLateHours),
      )
      .slice(0, 3),
    mostProfitableArea: areaRevenueStats.length > 0 ? areaRevenueStats[0] : null,
    peakHourByBranch: [...branchPeakMap.values()].sort(
      (left, right) => safeNumber(right.bookingCount) - safeNumber(left.bookingCount),
    ),
  };

  return {
    pickupHeatmap,
    dropHeatmap,
    areaRevenueStats,
    areaOverdueStats,
    peakTimeByArea,
    geoStrategicInsights,
  };
};

const buildFleetAnalytics = async (carMatch, range) => {
  const [fleetSummary] = await Car.aggregate([
    { $match: carMatch },
    {
      $group: {
        _id: null,
        totalVehicles: { $sum: 1 },
        activeVehicles: {
          $sum: {
            $cond: [
              {
                $ne: [
                  {
                    $ifNull: [
                      '$fleetStatus',
                      { $cond: [{ $eq: ['$isAvailable', false] }, 'Inactive', 'Available'] },
                    ],
                  },
                  'Inactive',
                ],
              },
              1,
              0,
            ],
          },
        },
        rentedVehicles: {
          $sum: {
            $cond: [
              {
                $eq: [
                  {
                    $ifNull: [
                      '$fleetStatus',
                      { $cond: [{ $eq: ['$isAvailable', false] }, 'Inactive', 'Available'] },
                    ],
                  },
                  'Rented',
                ],
              },
              1,
              0,
            ],
          },
        },
      },
    },
  ]);

  const carIds = await Car.find(carMatch).select('_id').lean();
  const scopedCarIdList = carIds.map((row) => row._id).filter(Boolean);

  let totalMaintenanceCost = 0;
  if (scopedCarIdList.length > 0) {
    const [maintenanceSummary] = await Maintenance.aggregate([
      {
        $match: {
          carId: { $in: scopedCarIdList },
          maintenanceStatus: 'Completed',
          serviceDate: { $gte: range.fromDate, $lte: range.toDate },
        },
      },
      {
        $group: {
          _id: null,
          totalMaintenanceCost: { $sum: { $max: ['$serviceCost', 0] } },
        },
      },
    ]);

    totalMaintenanceCost = roundCurrency(maintenanceSummary?.totalMaintenanceCost || 0);
  }

  const activeVehicles = Number(fleetSummary?.activeVehicles || 0);
  const rentedVehicles = Number(fleetSummary?.rentedVehicles || 0);
  const fleetUtilizationPercent = activeVehicles > 0 ? roundPercent((rentedVehicles / activeVehicles) * 100) : 0;

  return {
    fleetUtilizationPercent,
    totalMaintenanceCost,
    fleetMeta: {
      totalVehicles: Number(fleetSummary?.totalVehicles || 0),
      activeVehicles,
      rentedVehicles,
    },
  };
};

const getVisibleBranches = async (scopedBranchIds) => {
  const branchQuery = Array.isArray(scopedBranchIds) ? toBranchFilter(scopedBranchIds) : {};
  const branches = await Branch.find(branchQuery)
    .select('_id branchName branchCode city state isActive')
    .sort({ branchName: 1 })
    .lean();

  return branches.map((branch) => ({
    _id: String(branch._id),
    branchName: String(branch.branchName || ''),
    branchCode: String(branch.branchCode || ''),
    city: String(branch.city || ''),
    state: String(branch.state || ''),
    isActive: Boolean(branch.isActive),
  }));
};

const filterByRoleView = (payload, roleView) => {
  const { canViewFinancial, canViewFleet } = roleView;
  const isSuperAdmin = [ROLE.SUPER_ADMIN, ROLE.PLATFORM_SUPER_ADMIN].includes(roleView.role);

  return {
    summary: {
      totalRevenue: canViewFinancial ? payload.summary.totalRevenue : null,
      totalAdvanceCollected: canViewFinancial ? payload.summary.totalAdvanceCollected : null,
      totalLateFeesCollected: canViewFinancial ? payload.summary.totalLateFeesCollected : null,
      totalRefundAmount: canViewFinancial ? payload.summary.totalRefundAmount : null,
      dynamicRevenueContribution: canViewFinancial ? payload.summary.dynamicRevenueContribution : null,
      priceAdjustmentImpact: canViewFinancial ? payload.summary.priceAdjustmentImpact : null,
      subscriptionRevenue: canViewFinancial ? payload.summary.subscriptionRevenue : null,
      activeSubscribersCount: canViewFinancial ? payload.summary.activeSubscribersCount : null,
      churnRatePercent: canViewFinancial ? payload.summary.churnRatePercent : null,
      averageSubscriptionDurationDays: canViewFinancial ? payload.summary.averageSubscriptionDurationDays : null,
      revenuePerSubscriber: canViewFinancial ? payload.summary.revenuePerSubscriber : null,
      activeRentalsCount: canViewFleet ? payload.summary.activeRentalsCount : null,
      overdueRentalsCount: canViewFleet ? payload.summary.overdueRentalsCount : null,
      totalBookings: canViewFleet ? payload.summary.totalBookings : null,
      cancelledBookings: canViewFleet ? payload.summary.cancelledBookings : null,
      fleetUtilizationPercent: canViewFleet ? payload.summary.fleetUtilizationPercent : null,
      totalMaintenanceCost: canViewFleet ? payload.summary.totalMaintenanceCost : null,
    },
    financialBreakdown: canViewFinancial ? payload.financialBreakdown : null,
    fleetMeta: canViewFleet ? payload.fleetMeta : null,
    trendData: {
      dailyRevenue: canViewFinancial ? payload.trendData.dailyRevenue : [],
      monthlyRevenue: canViewFinancial ? payload.trendData.monthlyRevenue : [],
      dailyLateTrend: canViewFleet ? payload.trendData.dailyLateTrend : [],
      overduePercentageTrend: canViewFleet ? payload.trendData.overduePercentageTrend : [],
      lateSummary: canViewFleet ? payload.trendData.lateSummary : null,
    },
    mostRentedCars: canViewFleet || canViewFinancial ? payload.mostRentedCars : [],
    utilizationStats: canViewFleet ? payload.utilizationStats : [],
    topPerformers: canViewFleet || canViewFinancial ? payload.topPerformers : null,
    branchComparison: isSuperAdmin ? payload.branchComparison : [],
    fleetSortType: payload.fleetSortType,
    customerInsights: canViewFleet || canViewFinancial ? payload.customerInsights : [],
    customerSegments: canViewFleet || canViewFinancial ? payload.customerSegments : null,
    repeatMetrics: canViewFleet || canViewFinancial ? payload.repeatMetrics : null,
    customerSortType: payload.customerSortType,
    adminPerformance: canViewFleet || canViewFinancial ? payload.adminPerformance : [],
    pickupHeatmap: canViewFleet || canViewFinancial ? payload.pickupHeatmap : [],
    dropHeatmap: canViewFleet || canViewFinancial ? payload.dropHeatmap : [],
    areaRevenueStats: canViewFleet || canViewFinancial ? payload.areaRevenueStats : [],
    areaOverdueStats: canViewFleet || canViewFinancial ? payload.areaOverdueStats : [],
    peakTimeByArea: canViewFleet || canViewFinancial ? payload.peakTimeByArea : [],
    geoStrategicInsights: canViewFleet || canViewFinancial ? payload.geoStrategicInsights : null,
    historicalDemand: canViewFleet || canViewFinancial ? payload.historicalDemand : null,
    demandForecast: canViewFleet || canViewFinancial ? payload.demandForecast : [],
    highDemandDays: canViewFleet || canViewFinancial ? payload.highDemandDays : [],
    predictedPeakHours: canViewFleet || canViewFinancial ? payload.predictedPeakHours : [],
    fleetRiskAlerts: canViewFleet || canViewFinancial ? payload.fleetRiskAlerts : [],
    vehicleDemandPrediction: canViewFleet || canViewFinancial ? payload.vehicleDemandPrediction : [],
    predictiveInsights: canViewFleet || canViewFinancial ? payload.predictiveInsights : null,
    subscriptionMetrics: canViewFinancial ? payload.subscriptionMetrics : null,
    roleView: {
      role: roleView.role,
      canViewFinancial,
      canViewFleet,
    },
  };
};

const getAnalyticsDashboard = async (user, options = {}) => {
  const roleView = getRoleView(user?.role);
  const range = resolveDateRange(options);
  const scope = await resolveScope(user, options.branchId);
  const sortType = normalizeMostRentedSortType(options.sortType);
  const customerSortType = normalizeCustomerSortType(options.customerSort);
  const cacheTtlMs = Math.max(Number(options.cacheTtlMs || DEFAULT_CACHE_TTL_MS), 0);
  const cacheKey = buildCacheKey(user, options, scope, range);
  const timezone = normalizeTimezone(options.timezone);

  if (cacheTtlMs > 0) {
    const cached = getCachedAnalytics(cacheKey, cacheTtlMs);
    if (cached) return cached;
  }

  const bookingQuery = await applyBookingScopeToQuery(user, { ...scope.bookingBranchQuery });
  const branches = await getVisibleBranches(scope.scopedBranchIds);

  const scopedCarIds = await getScopedCarIds(user);
  const carMatch = { ...scope.carBranchQuery };
  if (Array.isArray(scopedCarIds)) {
    if (scopedCarIds.length === 0) {
      carMatch._id = { $in: [] };
    } else {
      const scopedObjectIds = scopedCarIds
        .map((id) => (mongoose.Types.ObjectId.isValid(String(id)) ? new mongoose.Types.ObjectId(String(id)) : null))
        .filter(Boolean);
      carMatch._id = { $in: scopedObjectIds };
    }
  }

  const [
    bookingAnalytics,
    fleetAnalytics,
    fleetPerformance,
    customerBehavior,
    adminPerformance,
    geographicAnalytics,
    predictiveAnalytics,
    subscriptionAnalytics,
  ] = await Promise.all([
    buildBookingAnalytics(bookingQuery, range, {
      timezone,
      now: options.now instanceof Date ? options.now : new Date(),
    }),
    buildFleetAnalytics(carMatch, range),
    buildFleetPerformanceAnalytics(bookingQuery, carMatch, range, {
      sortType,
      userRole: roleView.role,
      visibleBranches: branches,
    }),
    buildCustomerBehaviorAnalytics(bookingQuery, range, {
      customerSort: customerSortType,
    }),
    buildAdminPerformanceAnalytics(bookingQuery, carMatch, range, {
      scopedBranchIds: scope.scopedBranchIds,
      selectedBranchId: scope.selectedBranchId,
      visibleBranches: branches,
    }),
    buildGeographicAnalytics(bookingQuery, range, {
      timezone,
      visibleBranches: branches,
      precision: GEO_CLUSTER_PRECISION,
    }),
    buildPredictiveDemandAnalytics(bookingQuery, carMatch, range, {
      timezone,
      now: options.now instanceof Date ? options.now : new Date(),
      visibleBranches: branches,
      selectedBranchId: scope.selectedBranchId,
    }),
    buildSubscriptionAnalytics(scope, range, {
      now: options.now instanceof Date ? options.now : new Date(),
    }),
  ]);

  const mergedPayload = {
    summary: {
      ...bookingAnalytics.totals,
      fleetUtilizationPercent: fleetAnalytics.fleetUtilizationPercent,
      totalMaintenanceCost: fleetAnalytics.totalMaintenanceCost,
      subscriptionRevenue: subscriptionAnalytics.subscriptionRevenue,
      activeSubscribersCount: subscriptionAnalytics.activeSubscribersCount,
      churnRatePercent: subscriptionAnalytics.churnRatePercent,
      averageSubscriptionDurationDays: subscriptionAnalytics.averageSubscriptionDurationDays,
      revenuePerSubscriber: subscriptionAnalytics.revenuePerSubscriber,
    },
    financialBreakdown: {
      ...bookingAnalytics.financialBreakdown,
      subscriptionRevenue: subscriptionAnalytics.subscriptionRevenue,
    },
    fleetMeta: fleetAnalytics.fleetMeta,
    trendData: bookingAnalytics.trendData,
    mostRentedCars: fleetPerformance.mostRentedCars,
    utilizationStats: fleetPerformance.utilizationStats,
    topPerformers: fleetPerformance.topPerformers,
    branchComparison: fleetPerformance.branchComparison,
    fleetSortType: fleetPerformance.sortType,
    customerInsights: customerBehavior.customerInsights,
    customerSegments: customerBehavior.customerSegments,
    repeatMetrics: customerBehavior.repeatMetrics,
    customerSortType: customerBehavior.customerSortType,
    adminPerformance,
    pickupHeatmap: geographicAnalytics.pickupHeatmap,
    dropHeatmap: geographicAnalytics.dropHeatmap,
    areaRevenueStats: geographicAnalytics.areaRevenueStats,
    areaOverdueStats: geographicAnalytics.areaOverdueStats,
    peakTimeByArea: geographicAnalytics.peakTimeByArea,
    geoStrategicInsights: geographicAnalytics.geoStrategicInsights,
    historicalDemand: predictiveAnalytics.historicalDemand,
    demandForecast: predictiveAnalytics.demandForecast,
    highDemandDays: predictiveAnalytics.highDemandDays,
    predictedPeakHours: predictiveAnalytics.predictedPeakHours,
    fleetRiskAlerts: predictiveAnalytics.fleetRiskAlerts,
    vehicleDemandPrediction: predictiveAnalytics.vehicleDemandPrediction,
    predictiveInsights: predictiveAnalytics.predictiveInsights,
    subscriptionMetrics: subscriptionAnalytics,
    range: {
      rangeKey: range.rangeKey,
      label: range.label,
      fromDate: range.fromDate,
      toDate: range.toDate,
      isCustom: range.isCustom,
    },
    selectedBranchId: scope.selectedBranchId,
    branches,
    timezone,
  };

  const roleFiltered = filterByRoleView(mergedPayload, roleView);
  const result = {
    ...roleFiltered,
    range: mergedPayload.range,
    selectedBranchId: mergedPayload.selectedBranchId,
    branches: mergedPayload.branches,
    timezone: mergedPayload.timezone,
  };

  if (cacheTtlMs > 0) {
    setCachedAnalytics(cacheKey, result);
  }

  return result;
};

module.exports = {
  getAnalyticsDashboard,
  resolveDateRange,
};
