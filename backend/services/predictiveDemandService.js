const Booking = require('../models/Booking');
const Car = require('../models/Car');

const DEFAULT_ANALYTICS_TIMEZONE = process.env.ANALYTICS_TIMEZONE || 'UTC';
const DAY_MS = 24 * 60 * 60 * 1000;
const FORECAST_WINDOW_DAYS = 7;
const FORECAST_BASELINE_WEEKS = 8;
const FORECAST_HISTORY_DAYS = 365;
const HIGH_DEMAND_MULTIPLIER = 1.25;
const FORECAST_MIN_MULTIPLIER = 0.6;
const FORECAST_MAX_MULTIPLIER = 1.8;

const DAY_OF_WEEK_LABELS = {
  1: 'Sun',
  2: 'Mon',
  3: 'Tue',
  4: 'Wed',
  5: 'Thu',
  6: 'Fri',
  7: 'Sat',
};

const WEEKDAY_SHORT_TO_INDEX = {
  SUN: 1,
  MON: 2,
  TUE: 3,
  WED: 4,
  THU: 5,
  FRI: 6,
  SAT: 7,
};

const safeNumber = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return numericValue;
};

const roundCurrency = (value) => Number(safeNumber(value).toFixed(2));
const roundPercent = (value) => Number(safeNumber(value).toFixed(2));

const average = (values = []) => {
  const entries = Array.isArray(values)
    ? values.map((value) => safeNumber(value)).filter((value) => value >= 0)
    : [];
  if (entries.length === 0) return 0;
  return entries.reduce((sum, value) => sum + value, 0) / entries.length;
};

const clampNumber = (value, min, max) => {
  const numericValue = safeNumber(value);
  if (numericValue < min) return min;
  if (numericValue > max) return max;
  return numericValue;
};

const startOfDay = (date) => {
  const parsed = new Date(date);
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const endOfDay = (date) => {
  const parsed = new Date(date);
  parsed.setHours(23, 59, 59, 999);
  return parsed;
};

const normalizeTimezone = (value = '') => {
  const trimmed = String(value || '').trim();
  return trimmed || DEFAULT_ANALYTICS_TIMEZONE;
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

const normalizeStatusKey = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');

const normalizeObjectIdString = (value) => {
  const normalized = String(value || '').trim();
  return normalized && normalized !== 'null' && normalized !== 'undefined' ? normalized : '';
};

const formatDateKeyWithTimezone = (date, timezone) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '';

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || DEFAULT_ANALYTICS_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(parsed);
    const year = parts.find((part) => part.type === 'year')?.value || '';
    const month = parts.find((part) => part.type === 'month')?.value || '';
    const day = parts.find((part) => part.type === 'day')?.value || '';
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch (error) {
    // Fallback handled below.
  }

  return parsed.toISOString().slice(0, 10);
};

const getWeekdayNumberWithTimezone = (date, timezone) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;

  try {
    const weekdayShort = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || DEFAULT_ANALYTICS_TIMEZONE,
      weekday: 'short',
    }).format(parsed);
    const normalized = String(weekdayShort || '').slice(0, 3).toUpperCase();
    return WEEKDAY_SHORT_TO_INDEX[normalized] || null;
  } catch (error) {
    const fallback = parsed.getUTCDay();
    return Number.isFinite(fallback) ? fallback + 1 : null;
  }
};

const getMonthNumberWithTimezone = (date, timezone) => {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;

  try {
    const monthValue = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || DEFAULT_ANALYTICS_TIMEZONE,
      month: 'numeric',
    }).format(parsed);
    const parsedMonth = Number(monthValue);
    if (Number.isFinite(parsedMonth) && parsedMonth >= 1 && parsedMonth <= 12) return parsedMonth;
  } catch (error) {
    // Fallback handled below.
  }

  const fallback = parsed.getUTCMonth() + 1;
  return Number.isFinite(fallback) ? fallback : null;
};

const toHourLabel = (hour) => `${String(safeNumber(hour)).padStart(2, '0')}:00`;

const buildPredictiveDemandAnalytics = async (bookingQuery, carMatch, range, options = {}) => {
  const timezone = normalizeTimezone(options.timezone);
  const now = options.now instanceof Date ? options.now : new Date();
  const visibleBranches = Array.isArray(options.visibleBranches) ? options.visibleBranches : [];
  const selectedBranchId = normalizeObjectIdString(options.selectedBranchId);

  const requestedRangeDays = Math.max(
    Math.ceil(
      Math.max(
        Number(range?.toDate?.getTime() || 0) - Number(range?.fromDate?.getTime() || 0),
        0,
      ) / DAY_MS,
    ) + 1,
    1,
  );
  const historyLookbackDays = Math.round(clampNumber(requestedRangeDays, 180, FORECAST_HISTORY_DAYS));
  const historyEndDate = endOfDay(now);
  const historyStartDate = startOfDay(new Date(historyEndDate.getTime() - (historyLookbackDays - 1) * DAY_MS));

  const baselineLookbackDays = FORECAST_BASELINE_WEEKS * 7;
  const recentEightWeeksStart = startOfDay(new Date(historyEndDate.getTime() - (baselineLookbackDays - 1) * DAY_MS));
  const recentFourWeeksStart = startOfDay(new Date(historyEndDate.getTime() - (28 - 1) * DAY_MS));
  const previousFourWeeksStart = startOfDay(new Date(recentFourWeeksStart.getTime() - 28 * DAY_MS));
  const forecastStartDate = startOfDay(new Date(now.getTime() + DAY_MS));

  const [aggregation, scopedCars] = await Promise.all([
    Booking.aggregate([
      { $match: bookingQuery },
      {
        $addFields: {
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
          _demandDate: {
            $ifNull: ['$pickupDateTime', { $ifNull: ['$fromDate', { $ifNull: ['$createdAt', '$updatedAt'] }] }],
          },
        },
      },
      {
        $match: {
          _demandDate: { $gte: historyStartDate, $lte: historyEndDate },
        },
      },
      {
        $addFields: {
          _forecastRevenueSafe: {
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
          _dayKey: {
            $dateToString: { format: '%Y-%m-%d', date: '$_demandDate', timezone },
          },
          _monthKey: {
            $dateToString: { format: '%Y-%m', date: '$_demandDate', timezone },
          },
          _weekday: { $dayOfWeek: { date: '$_demandDate', timezone } },
          _hourOfDay: { $hour: { date: '$_demandDate', timezone } },
          _isRecentEightWeeks: { $gte: ['$_demandDate', recentEightWeeksStart] },
          _trendBucket: {
            $cond: [
              { $gte: ['$_demandDate', recentFourWeeksStart] },
              'recent',
              { $cond: [{ $gte: ['$_demandDate', previousFourWeeksStart] }, 'previous', 'older'] },
            ],
          },
        },
      },
      {
        $facet: {
          dailyDemand: [
            {
              $group: {
                _id: '$_dayKey',
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
            { $sort: { _id: 1 } },
          ],
          weekdayDemand: [
            {
              $group: {
                _id: { weekday: '$_weekday', dayKey: '$_dayKey' },
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
            {
              $group: {
                _id: '$_id.weekday',
                bookingCount: { $sum: '$bookingCount' },
                totalRevenue: { $sum: '$totalRevenue' },
                activeDayCount: { $sum: 1 },
              },
            },
            { $sort: { _id: 1 } },
          ],
          hourlyDemand: [
            { $group: { _id: '$_hourOfDay', bookingCount: { $sum: 1 } } },
            { $sort: { _id: 1 } },
          ],
          monthlyDemand: [
            {
              $group: {
                _id: '$_monthKey',
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
            { $sort: { _id: 1 } },
          ],
          recentWeekdayBaseline: [
            { $match: { _isRecentEightWeeks: true } },
            {
              $group: {
                _id: { weekday: '$_weekday', dayKey: '$_dayKey' },
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
            {
              $group: {
                _id: '$_id.weekday',
                activeDays: { $sum: 1 },
                totalBookings: { $sum: '$bookingCount' },
                totalRevenue: { $sum: '$totalRevenue' },
              },
            },
            { $sort: { _id: 1 } },
          ],
          recentDailyDemand: [
            { $match: { _isRecentEightWeeks: true } },
            {
              $group: {
                _id: '$_dayKey',
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
            { $sort: { _id: 1 } },
          ],
          recentHourByWeekday: [
            { $match: { _isRecentEightWeeks: true } },
            {
              $group: {
                _id: { weekday: '$_weekday', hourOfDay: '$_hourOfDay' },
                bookingCount: { $sum: 1 },
              },
            },
            { $sort: { '_id.weekday': 1, bookingCount: -1, '_id.hourOfDay': 1 } },
          ],
          branchVolume: [
            {
              $group: {
                _id: '$branchId',
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
            { $sort: { bookingCount: -1, totalRevenue: -1 } },
          ],
          branchTrend: [
            { $match: { _trendBucket: { $in: ['recent', 'previous'] } } },
            {
              $group: {
                _id: { branchId: '$branchId', bucket: '$_trendBucket' },
                bookingCount: { $sum: 1 },
              },
            },
          ],
          categoryDemand: [
            {
              $lookup: {
                from: 'cars',
                localField: 'car',
                foreignField: '_id',
                pipeline: [{ $project: { category: 1 } }],
                as: '_carMeta',
              },
            },
            {
              $addFields: {
                _category: {
                  $trim: { input: { $ifNull: [{ $arrayElemAt: ['$_carMeta.category', 0] }, ''] } },
                },
              },
            },
            {
              $group: {
                _id: { $cond: [{ $gt: [{ $strLenCP: '$_category' }, 0] }, '$_category', 'Unknown'] },
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
            { $sort: { bookingCount: -1, totalRevenue: -1, _id: 1 } },
          ],
          recentCategoryDemand: [
            { $match: { _isRecentEightWeeks: true } },
            {
              $lookup: {
                from: 'cars',
                localField: 'car',
                foreignField: '_id',
                pipeline: [{ $project: { category: 1 } }],
                as: '_carMeta',
              },
            },
            {
              $addFields: {
                _category: {
                  $trim: { input: { $ifNull: [{ $arrayElemAt: ['$_carMeta.category', 0] }, ''] } },
                },
              },
            },
            {
              $group: {
                _id: { $cond: [{ $gt: [{ $strLenCP: '$_category' }, 0] }, '$_category', 'Unknown'] },
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
            { $sort: { bookingCount: -1, totalRevenue: -1, _id: 1 } },
          ],
          recentCarDemand: [
            { $match: { _isRecentEightWeeks: true, car: { $ne: null } } },
            {
              $group: {
                _id: '$car',
                bookingCount: { $sum: 1 },
                totalRevenue: { $sum: '$_forecastRevenueSafe' },
              },
            },
          ],
        },
      },
    ]),
    Car.find(carMatch).select('_id name brand model category branchId fleetStatus isAvailable').lean(),
  ]);

  const demandData = aggregation?.[0] || {};
  const branchMap = new Map(
    visibleBranches.map((branch) => [
      normalizeObjectIdString(branch?._id),
      {
        branchName: String(branch?.branchName || ''),
        branchCode: String(branch?.branchCode || ''),
      },
    ]),
  );

  const toBranchMeta = (branchIdValue) => {
    const branchId = normalizeObjectIdString(branchIdValue);
    const entry = branchMap.get(branchId) || {};
    return {
      branchId,
      branchName: String(entry.branchName || 'Unassigned'),
      branchCode: String(entry.branchCode || ''),
    };
  };

  const bookingsPerDay = (Array.isArray(demandData?.dailyDemand) ? demandData.dailyDemand : []).map((row) => ({
    date: String(row?._id || ''),
    bookingCount: safeNumber(row?.bookingCount),
    totalRevenue: roundCurrency(row?.totalRevenue || 0),
  }));

  const weekdayMap = new Map(
    (Array.isArray(demandData?.weekdayDemand) ? demandData.weekdayDemand : []).map((row) => [
      safeNumber(row?._id),
      {
        bookingCount: safeNumber(row?.bookingCount),
        totalRevenue: roundCurrency(row?.totalRevenue || 0),
        activeDayCount: Math.max(safeNumber(row?.activeDayCount), 1),
      },
    ]),
  );
  const bookingsPerWeekday = Array.from({ length: 7 }, (_, index) => {
    const weekday = index + 1;
    const row = weekdayMap.get(weekday) || { bookingCount: 0, totalRevenue: 0, activeDayCount: 1 };
    return {
      weekday,
      dayLabel: DAY_OF_WEEK_LABELS[weekday] || `Day ${weekday}`,
      bookingCount: safeNumber(row.bookingCount),
      averageBookings: roundCurrency(safeNumber(row.bookingCount) / Math.max(safeNumber(row.activeDayCount), 1)),
      totalRevenue: roundCurrency(row.totalRevenue || 0),
      averageRevenue: roundCurrency(roundCurrency(row.totalRevenue || 0) / Math.max(safeNumber(row.activeDayCount), 1)),
    };
  });

  const hourlyMap = new Map(
    (Array.isArray(demandData?.hourlyDemand) ? demandData.hourlyDemand : []).map((row) => [
      safeNumber(row?._id),
      safeNumber(row?.bookingCount),
    ]),
  );
  const bookingsPerHour = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    hourLabel: toHourLabel(hour),
    bookingCount: safeNumber(hourlyMap.get(hour)),
  }));

  const monthlyBookingVolume = (Array.isArray(demandData?.monthlyDemand) ? demandData.monthlyDemand : [])
    .map((row) => ({
      monthKey: String(row?._id || ''),
      bookingCount: safeNumber(row?.bookingCount),
      totalRevenue: roundCurrency(row?.totalRevenue || 0),
    }))
    .sort((left, right) => String(left.monthKey || '').localeCompare(String(right.monthKey || '')));

  const branchVolumeRows = Array.isArray(demandData?.branchVolume) ? demandData.branchVolume : [];
  const totalBranchBookings = branchVolumeRows.reduce((sum, row) => sum + safeNumber(row?.bookingCount), 0);
  const branchBookingVolume = branchVolumeRows.map((row) => {
    const branchMeta = toBranchMeta(row?._id);
    const bookingCount = safeNumber(row?.bookingCount);
    return {
      ...branchMeta,
      bookingCount,
      totalRevenue: roundCurrency(row?.totalRevenue || 0),
      bookingSharePercent: totalBranchBookings > 0 ? roundPercent((bookingCount / totalBranchBookings) * 100) : 0,
    };
  });

  const categoryDemand = (Array.isArray(demandData?.categoryDemand) ? demandData.categoryDemand : []).map((row) => ({
    category: String(row?._id || 'Unknown'),
    bookingCount: safeNumber(row?.bookingCount),
    totalRevenue: roundCurrency(row?.totalRevenue || 0),
  }));
  const recentCategoryDemand = (Array.isArray(demandData?.recentCategoryDemand) ? demandData.recentCategoryDemand : []).map((row) => ({
    category: String(row?._id || 'Unknown'),
    bookingCount: safeNumber(row?.bookingCount),
    totalRevenue: roundCurrency(row?.totalRevenue || 0),
  }));

  const recentWeekdayBaselineMap = new Map(
    (Array.isArray(demandData?.recentWeekdayBaseline) ? demandData.recentWeekdayBaseline : []).map((row) => {
      const activeDays = Math.max(safeNumber(row?.activeDays), 1);
      const totalBookings = safeNumber(row?.totalBookings);
      const totalRevenue = roundCurrency(row?.totalRevenue || 0);
      return [
        safeNumber(row?._id),
        {
          averageBookings: roundCurrency(totalBookings / activeDays),
          averageRevenue: roundCurrency(totalRevenue / activeDays),
        },
      ];
    }),
  );

  const recentDailyRows = Array.isArray(demandData?.recentDailyDemand) ? demandData.recentDailyDemand : [];
  const averageDailyBookings =
    average(recentDailyRows.map((row) => safeNumber(row?.bookingCount)).filter((value) => value > 0)) ||
    average(bookingsPerDay.map((row) => safeNumber(row.bookingCount)).filter((value) => value > 0));
  const averageDailyRevenue =
    average(recentDailyRows.map((row) => roundCurrency(row?.totalRevenue || 0)).filter((value) => value > 0)) ||
    average(bookingsPerDay.map((row) => safeNumber(row.totalRevenue)).filter((value) => value > 0));

  const overallMonthlyAverage = average(
    monthlyBookingVolume.map((row) => safeNumber(row.bookingCount)).filter((value) => value > 0),
  );
  const monthSeasonalityMap = new Map();
  for (let month = 1; month <= 12; month += 1) {
    const monthRows = monthlyBookingVolume.filter((row) => Number(String(row.monthKey || '').split('-')[1]) === month);
    const monthAverage = monthRows.length
      ? average(monthRows.map((row) => safeNumber(row.bookingCount)))
      : overallMonthlyAverage || 1;
    const ratio = overallMonthlyAverage > 0 ? monthAverage / overallMonthlyAverage : 1;
    monthSeasonalityMap.set(month, clampNumber(ratio, 0.75, 1.35));
  }

  let monthlyGrowthFactor = 1;
  if (monthlyBookingVolume.length >= 2) {
    const latest = monthlyBookingVolume[monthlyBookingVolume.length - 1];
    const previous = monthlyBookingVolume[monthlyBookingVolume.length - 2];
    if (safeNumber(previous.bookingCount) > 0) {
      monthlyGrowthFactor = clampNumber(
        safeNumber(latest.bookingCount) / safeNumber(previous.bookingCount),
        0.8,
        1.25,
      );
    } else if (safeNumber(latest.bookingCount) > 0) {
      monthlyGrowthFactor = 1.05;
    }
  }

  const branchTrendAccumulator = new Map();
  for (const row of Array.isArray(demandData?.branchTrend) ? demandData.branchTrend : []) {
    const branchId = normalizeObjectIdString(row?._id?.branchId);
    const bucket = String(row?._id?.bucket || '').trim().toLowerCase();
    const current = branchTrendAccumulator.get(branchId) || { recent: 0, previous: 0 };
    if (bucket === 'recent') current.recent += safeNumber(row?.bookingCount);
    if (bucket === 'previous') current.previous += safeNumber(row?.bookingCount);
    branchTrendAccumulator.set(branchId, current);
  }

  const branchTrendFactorMap = new Map();
  for (const [branchId, value] of branchTrendAccumulator.entries()) {
    const trendFactor = value.previous > 0 ? value.recent / value.previous : value.recent > 0 ? 1.1 : 1;
    branchTrendFactorMap.set(branchId, clampNumber(trendFactor, 0.7, 1.4));
  }

  let weightedTrend = 0;
  let weightedBase = 0;
  for (const row of branchBookingVolume) {
    const weight = Math.max(safeNumber(row.bookingCount), 1);
    weightedTrend += (branchTrendFactorMap.get(normalizeObjectIdString(row.branchId)) || 1) * weight;
    weightedBase += weight;
  }
  const overallBranchTrendFactor = weightedBase > 0 ? clampNumber(weightedTrend / weightedBase, 0.75, 1.35) : 1;

  const weekdayHourProfileMap = new Map();
  for (const row of Array.isArray(demandData?.recentHourByWeekday) ? demandData.recentHourByWeekday : []) {
    const weekday = safeNumber(row?._id?.weekday);
    const hour = safeNumber(row?._id?.hourOfDay);
    if (weekday < 1 || weekday > 7 || hour < 0 || hour > 23) continue;
    if (!weekdayHourProfileMap.has(weekday)) weekdayHourProfileMap.set(weekday, []);
    weekdayHourProfileMap.get(weekday).push({ hour, bookingCount: safeNumber(row?.bookingCount) });
  }
  for (const [weekday, rows] of weekdayHourProfileMap.entries()) {
    weekdayHourProfileMap.set(
      weekday,
      [...rows].sort(
        (left, right) =>
          safeNumber(right.bookingCount) - safeNumber(left.bookingCount) ||
          safeNumber(left.hour) - safeNumber(right.hour),
      ),
    );
  }

  const fallbackWeekdayBaseline = {
    averageBookings: roundCurrency(averageDailyBookings || 0),
    averageRevenue: roundCurrency(averageDailyRevenue || 0),
  };
  const highDemandThreshold = roundCurrency((averageDailyBookings || 0) * HIGH_DEMAND_MULTIPLIER);

  const demandForecast = [];
  const predictedPeakHours = [];
  for (let index = 0; index < FORECAST_WINDOW_DAYS; index += 1) {
    const forecastDate = new Date(forecastStartDate.getTime() + index * DAY_MS);
    const date = formatDateKeyWithTimezone(forecastDate, timezone);
    const weekday = getWeekdayNumberWithTimezone(forecastDate, timezone) || 1;
    const month = getMonthNumberWithTimezone(forecastDate, timezone) || 1;
    const weekdayBaseline = recentWeekdayBaselineMap.get(weekday) || fallbackWeekdayBaseline;
    const seasonalityFactor = monthSeasonalityMap.get(month) || 1;
    const forecastMultiplier = clampNumber(
      seasonalityFactor * monthlyGrowthFactor * overallBranchTrendFactor,
      FORECAST_MIN_MULTIPLIER,
      FORECAST_MAX_MULTIPLIER,
    );

    const predictedBookings = Math.max(
      Math.round(safeNumber(weekdayBaseline.averageBookings) * forecastMultiplier),
      0,
    );
    const predictedRevenue = roundCurrency(
      Math.max(safeNumber(weekdayBaseline.averageRevenue) * forecastMultiplier, 0),
    );
    const hourRows = (weekdayHourProfileMap.get(weekday) || []).slice(0, 3);
    const hourTotal = hourRows.reduce((sum, row) => sum + safeNumber(row.bookingCount), 0);
    const predictedHighDemandHours = hourRows.map((row) => ({
      hour: safeNumber(row.hour),
      hourLabel: toHourLabel(row.hour),
      bookingCount: safeNumber(row.bookingCount),
      sharePercent: hourTotal > 0 ? roundPercent((safeNumber(row.bookingCount) / hourTotal) * 100) : 0,
    }));
    const highDemandDay = predictedBookings > highDemandThreshold && predictedBookings > 0;

    const dayForecast = {
      date,
      dayLabel: DAY_OF_WEEK_LABELS[weekday] || `Day ${weekday}`,
      weekday,
      predictedBookings,
      predictedRevenue,
      forecastMultiplier: roundCurrency(forecastMultiplier),
      seasonalityFactor: roundCurrency(seasonalityFactor),
      monthlyGrowthFactor: roundCurrency(monthlyGrowthFactor),
      branchTrendFactor: roundCurrency(overallBranchTrendFactor),
      highDemandDay,
      predictedHighDemandHours,
    };
    demandForecast.push(dayForecast);
    predictedPeakHours.push({ date, dayLabel: dayForecast.dayLabel, hours: predictedHighDemandHours });
  }

  const highDemandDays = demandForecast
    .filter((row) => row.highDemandDay)
    .map((row) => ({
      date: row.date,
      dayLabel: row.dayLabel,
      predictedBookings: row.predictedBookings,
      threshold: highDemandThreshold,
      surgePercent:
        highDemandThreshold > 0
          ? roundPercent(((safeNumber(row.predictedBookings) - highDemandThreshold) / highDemandThreshold) * 100)
          : 0,
    }));

  const availableFleetByBranch = new Map();
  let totalAvailableFleet = 0;
  for (const car of Array.isArray(scopedCars) ? scopedCars : []) {
    const branchId = normalizeObjectIdString(car?.branchId);
    const statusKey = normalizeStatusKey(car?.fleetStatus);
    const isAvailableLike = statusKey === 'AVAILABLE' || (!statusKey && car?.isAvailable !== false);
    if (!isAvailableLike) continue;
    totalAvailableFleet += 1;
    availableFleetByBranch.set(branchId, safeNumber(availableFleetByBranch.get(branchId)) + 1);
  }

  const branchShareSource = branchBookingVolume.length
    ? branchBookingVolume.map((row) => ({
      branchId: normalizeObjectIdString(row.branchId),
      share: safeNumber(row.bookingSharePercent) / 100,
    }))
    : [...availableFleetByBranch.entries()].map(([branchId, fleetCount]) => ({
      branchId: normalizeObjectIdString(branchId),
      share: totalAvailableFleet > 0 ? safeNumber(fleetCount) / totalAvailableFleet : 0,
    }));
  const branchShares = branchShareSource.filter((entry) => entry.share > 0);

  const fleetRiskAlerts = [];
  for (const row of demandForecast) {
    if (selectedBranchId) {
      const availableFleet = safeNumber(availableFleetByBranch.get(selectedBranchId));
      if (safeNumber(row.predictedBookings) > availableFleet) {
        fleetRiskAlerts.push({
          date: row.date,
          dayLabel: row.dayLabel,
          ...toBranchMeta(selectedBranchId),
          predictedBookings: safeNumber(row.predictedBookings),
          availableFleet,
          shortageCount: safeNumber(row.predictedBookings) - availableFleet,
          severity: safeNumber(row.predictedBookings) - availableFleet >= 3 ? 'HIGH' : 'MEDIUM',
        });
      }
      continue;
    }

    if (!branchShares.length) {
      if (safeNumber(row.predictedBookings) > totalAvailableFleet) {
        fleetRiskAlerts.push({
          date: row.date,
          dayLabel: row.dayLabel,
          branchId: '',
          branchName: 'All Branches',
          branchCode: '',
          predictedBookings: safeNumber(row.predictedBookings),
          availableFleet: totalAvailableFleet,
          shortageCount: safeNumber(row.predictedBookings) - totalAvailableFleet,
          severity: safeNumber(row.predictedBookings) - totalAvailableFleet >= 3 ? 'HIGH' : 'MEDIUM',
        });
      }
      continue;
    }

    let adjustedTotal = 0;
    const adjustedShares = branchShares.map((entry) => {
      const trendFactor = branchTrendFactorMap.get(entry.branchId) || 1;
      const adjusted = safeNumber(entry.share) * trendFactor;
      adjustedTotal += adjusted;
      return { branchId: entry.branchId, adjusted };
    });

    for (const entry of adjustedShares) {
      const normalizedShare = adjustedTotal > 0 ? entry.adjusted / adjustedTotal : 0;
      const predictedBranchBookings = Math.max(Math.round(safeNumber(row.predictedBookings) * normalizedShare), 0);
      const availableFleet = safeNumber(availableFleetByBranch.get(entry.branchId));
      if (predictedBranchBookings <= availableFleet) continue;
      fleetRiskAlerts.push({
        date: row.date,
        dayLabel: row.dayLabel,
        ...toBranchMeta(entry.branchId),
        predictedBookings: predictedBranchBookings,
        availableFleet,
        shortageCount: predictedBranchBookings - availableFleet,
        severity: predictedBranchBookings - availableFleet >= 3 ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  fleetRiskAlerts.sort(
    (left, right) =>
      safeNumber(right.shortageCount) - safeNumber(left.shortageCount) ||
      String(left.date || '').localeCompare(String(right.date || '')),
  );

  const averageForecastMultiplier = average(demandForecast.map((row) => safeNumber(row.forecastMultiplier))) || 1;
  const categorySource = recentCategoryDemand.length ? recentCategoryDemand : categoryDemand;
  const vehicleDemandPrediction = categorySource
    .map((row) => {
      const weeklyBaseline = safeNumber(row.bookingCount) / Math.max(FORECAST_BASELINE_WEEKS, 1);
      const predictedWeeklyBookings = Math.max(Math.round(weeklyBaseline * averageForecastMultiplier), 0);
      const predictedWeeklyRevenue = roundCurrency(
        (safeNumber(row.totalRevenue) / Math.max(FORECAST_BASELINE_WEEKS, 1)) * averageForecastMultiplier,
      );
      return {
        category: String(row.category || 'Unknown'),
        historicalBookingCount: safeNumber(row.bookingCount),
        historicalRevenue: roundCurrency(row.totalRevenue || 0),
        predictedWeeklyBookings,
        predictedWeeklyRevenue,
      };
    })
    .sort(
      (left, right) =>
        safeNumber(right.predictedWeeklyBookings) - safeNumber(left.predictedWeeklyBookings) ||
        safeNumber(right.predictedWeeklyRevenue) - safeNumber(left.predictedWeeklyRevenue),
    );

  const predictedCategoryTotal = vehicleDemandPrediction.reduce(
    (sum, row) => sum + safeNumber(row.predictedWeeklyBookings),
    0,
  );
  for (const row of vehicleDemandPrediction) {
    row.predictedSharePercent =
      predictedCategoryTotal > 0
        ? roundPercent((safeNumber(row.predictedWeeklyBookings) / predictedCategoryTotal) * 100)
        : 0;
  }

  const recentCarDemandMap = new Map(
    (Array.isArray(demandData?.recentCarDemand) ? demandData.recentCarDemand : []).map((row) => [
      normalizeObjectIdString(row?._id),
      {
        bookingCount: safeNumber(row?.bookingCount),
        totalRevenue: roundCurrency(row?.totalRevenue || 0),
      },
    ]),
  );

  const underutilizedVehicles = (Array.isArray(scopedCars) ? scopedCars : [])
    .map((car) => {
      const carId = normalizeObjectIdString(car?._id);
      const demandMeta = recentCarDemandMap.get(carId) || { bookingCount: 0, totalRevenue: 0 };
      const branchMeta = toBranchMeta(car?.branchId);
      return {
        carId,
        carName: String(car?.name || 'Unknown Car'),
        brand: String(car?.brand || ''),
        model: String(car?.model || ''),
        category: String(car?.category || 'Unknown'),
        branchId: branchMeta.branchId,
        branchName: branchMeta.branchName,
        recentBookingCount: safeNumber(demandMeta.bookingCount),
        recentRevenue: roundCurrency(demandMeta.totalRevenue || 0),
        fleetStatus: String(car?.fleetStatus || ''),
      };
    })
    .filter((row) => safeNumber(row.recentBookingCount) <= 1 && normalizeStatusKey(row.fleetStatus) !== 'INACTIVE')
    .sort(
      (left, right) =>
        safeNumber(left.recentBookingCount) - safeNumber(right.recentBookingCount) ||
        safeNumber(left.recentRevenue) - safeNumber(right.recentRevenue),
    )
    .slice(0, 12);

  const mostDemandedCategory = vehicleDemandPrediction[0] || null;
  const recommendedActions = [];
  const topRisk = fleetRiskAlerts[0];

  if (mostDemandedCategory && safeNumber(mostDemandedCategory.predictedWeeklyBookings) > 0) {
    recommendedActions.push({
      actionType: 'CATEGORY_PRIORITY',
      message: `Prioritize ${mostDemandedCategory.category} inventory next week (forecast ${mostDemandedCategory.predictedWeeklyBookings} bookings).`,
    });
  }

  if (topRisk && safeNumber(topRisk.shortageCount) > 0) {
    recommendedActions.push({
      actionType: 'FLEET_SHORTAGE_RISK',
      message: `${topRisk.branchName || 'All Branches'} may face a shortage of ${topRisk.shortageCount} vehicles on ${topRisk.date}.`,
    });
  }

  if (underutilizedVehicles.length > 0 && topRisk) {
    const movableCount = underutilizedVehicles.filter((row) => row.branchId !== topRisk.branchId).slice(0, 3).length;
    if (movableCount > 0) {
      recommendedActions.push({
        actionType: 'FLEET_REALLOCATION',
        message: `Consider reallocating ${movableCount} underutilized vehicles to ${topRisk.branchName || 'the high-demand branch'}.`,
      });
    }
  }

  if (recommendedActions.length === 0) {
    recommendedActions.push({
      actionType: 'MONITOR',
      message: 'Demand is stable. Continue monitoring branch and category trends.',
    });
  }

  return {
    historicalDemand: {
      historyWindow: {
        fromDate: historyStartDate,
        toDate: historyEndDate,
        lookbackDays: historyLookbackDays,
      },
      bookingsPerDay,
      bookingsPerWeekday,
      bookingsPerHour,
      revenuePerDay: bookingsPerDay.map((entry) => ({ date: entry.date, revenue: entry.totalRevenue })),
      branchBookingVolume,
      vehicleCategoryDemand: categoryDemand,
      monthlyBookingVolume,
    },
    demandForecast,
    highDemandDays,
    predictedPeakHours,
    fleetRiskAlerts,
    vehicleDemandPrediction,
    predictiveInsights: {
      mostDemandedCategory,
      underutilizedVehicles,
      recommendedActions,
      baseline: {
        averageDailyBookings: roundCurrency(averageDailyBookings || 0),
        averageDailyRevenue: roundCurrency(averageDailyRevenue || 0),
        highDemandThreshold,
        monthlyGrowthFactor: roundCurrency(monthlyGrowthFactor),
        branchTrendFactor: roundCurrency(overallBranchTrendFactor),
      },
    },
  };
};

module.exports = {
  buildPredictiveDemandAnalytics,
};
