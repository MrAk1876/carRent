const mongoose = require('mongoose');
const Car = require('../models/Car');
const {
  AVAILABILITY_STATE,
  normalizeAvailabilityRange,
  buildAvailabilityTimeline,
} = require('./availabilityService');
const { getScopedCarIds } = require('./adminScopeService');

const DEFAULT_TIMELINE_CONCURRENCY = 6;
const MAX_FLEET_TIMELINE_RANGE_DAYS = 120;

const toPositiveInt = (value, fallback) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(Math.floor(parsed), 1);
};

const toObjectIdOrNull = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const buildDateKeysFromRange = (startDate, endDate) => {
  const dates = [];
  const cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (cursor.getTime() <= end.getTime()) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, '0');
    const day = String(cursor.getDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }

  return dates;
};

const mapWithConcurrency = async (items = [], mapper, concurrency = DEFAULT_TIMELINE_CONCURRENCY) => {
  const safeConcurrency = Math.max(toPositiveInt(concurrency, DEFAULT_TIMELINE_CONCURRENCY), 1);
  const source = Array.isArray(items) ? items : [];
  const results = new Array(source.length);
  let index = 0;

  const worker = async () => {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= source.length) return;
      results[currentIndex] = await mapper(source[currentIndex], currentIndex);
    }
  };

  const workerCount = Math.min(safeConcurrency, source.length || 1);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
};

const toCarMeta = (car) => ({
  _id: String(car?._id || ''),
  name: String(car?.name || ''),
  brand: String(car?.brand || ''),
  model: String(car?.model || ''),
  category: String(car?.category || ''),
  location: String(car?.location || ''),
  branchId: car?.branchId?._id ? String(car.branchId._id) : String(car?.branchId || ''),
  branchName: String(car?.branchId?.branchName || ''),
  branchCode: String(car?.branchId?.branchCode || ''),
  fleetStatus: String(car?.fleetStatus || ''),
  isAvailable: car?.isAvailable !== false,
});

const createEmptyStateCounter = () => ({
  [AVAILABILITY_STATE.AVAILABLE]: 0,
  [AVAILABILITY_STATE.BOOKED]: 0,
  [AVAILABILITY_STATE.MAINTENANCE]: 0,
  [AVAILABILITY_STATE.BLACKOUT]: 0,
  [AVAILABILITY_STATE.RESERVED]: 0,
});

const buildFleetDailySummary = (timelineByCar = [], dateKeys = []) => {
  const dailyCounterMap = new Map(dateKeys.map((date) => [date, createEmptyStateCounter()]));

  for (const carTimeline of timelineByCar) {
    const timeline = Array.isArray(carTimeline?.timeline) ? carTimeline.timeline : [];
    for (const entry of timeline) {
      const date = String(entry?.date || '');
      const state = String(entry?.state || AVAILABILITY_STATE.AVAILABLE);
      if (!dailyCounterMap.has(date)) {
        dailyCounterMap.set(date, createEmptyStateCounter());
      }
      const counter = dailyCounterMap.get(date);
      if (!Object.prototype.hasOwnProperty.call(counter, state)) {
        counter[state] = 0;
      }
      counter[state] += 1;
    }
  }

  const totalCars = timelineByCar.length;
  return [...dailyCounterMap.entries()]
    .sort(([left], [right]) => String(left).localeCompare(String(right)))
    .map(([date, counts]) => {
      const unavailableCount =
        Number(counts[AVAILABILITY_STATE.BOOKED] || 0) +
        Number(counts[AVAILABILITY_STATE.MAINTENANCE] || 0) +
        Number(counts[AVAILABILITY_STATE.BLACKOUT] || 0) +
        Number(counts[AVAILABILITY_STATE.RESERVED] || 0);

      return {
        date,
        counts,
        availableCount: Number(counts[AVAILABILITY_STATE.AVAILABLE] || 0),
        unavailableCount,
        occupancyRatio: totalCars > 0 ? Number((unavailableCount / totalCars).toFixed(4)) : 0,
      };
    });
};

const buildFleetStateTotals = (timelineByCar = []) => {
  const totals = createEmptyStateCounter();
  for (const carTimeline of timelineByCar) {
    const summary = carTimeline?.summary || {};
    Object.keys(totals).forEach((state) => {
      totals[state] += Number(summary[state] || 0);
    });
  }
  return totals;
};

const getFleetAvailabilityTimeline = async (options = {}) => {
  const {
    user,
    fromDate,
    toDate,
    branchId = '',
    maxRangeDays = MAX_FLEET_TIMELINE_RANGE_DAYS,
    concurrency = DEFAULT_TIMELINE_CONCURRENCY,
  } = options;

  const range = normalizeAvailabilityRange({ fromDate, toDate, maxRangeDays });
  const scopedCarIds = await getScopedCarIds(user);
  const requestedBranchId = toObjectIdOrNull(branchId);

  const query = {};
  if (Array.isArray(scopedCarIds)) {
    query._id = { $in: scopedCarIds };
  }
  if (requestedBranchId) {
    query.branchId = requestedBranchId;
  }

  const cars = await Car.find(query)
    .select('_id name brand model category location branchId fleetStatus isAvailable')
    .populate('branchId', '_id branchName branchCode')
    .sort({ brand: 1, model: 1, name: 1, createdAt: 1 })
    .lean();

  if (!cars.length) {
    const dateKeys = buildDateKeysFromRange(range.startDate, range.endDate);
    return {
      from: range.from,
      to: range.to,
      totalDays: range.totalDays,
      totalCars: 0,
      fleet: [],
      dailySummary: dateKeys.map((date) => ({
        date,
        counts: createEmptyStateCounter(),
        availableCount: 0,
        unavailableCount: 0,
        occupancyRatio: 0,
      })),
      stateTotals: createEmptyStateCounter(),
      generatedAt: new Date().toISOString(),
    };
  }

  const fleet = await mapWithConcurrency(
    cars,
    async (car) => {
      const timeline = await buildAvailabilityTimeline({
        carId: car._id,
        fromDate: range.startDate,
        toDate: range.endDate,
        skipCarValidation: true,
      });

      return {
        carId: String(car._id),
        car: toCarMeta(car),
        isRentable: timeline.isRentable,
        summary: timeline.summary,
        timeline: timeline.timeline,
      };
    },
    concurrency,
  );

  const dateKeys = buildDateKeysFromRange(range.startDate, range.endDate);
  const dailySummary = buildFleetDailySummary(fleet, dateKeys);
  const stateTotals = buildFleetStateTotals(fleet);

  return {
    from: range.from,
    to: range.to,
    totalDays: range.totalDays,
    totalCars: fleet.length,
    fleet,
    dailySummary,
    stateTotals,
    generatedAt: new Date().toISOString(),
  };
};

module.exports = {
  DEFAULT_TIMELINE_CONCURRENCY,
  MAX_FLEET_TIMELINE_RANGE_DAYS,
  getFleetAvailabilityTimeline,
};
