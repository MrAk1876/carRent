const mongoose = require('mongoose');
const Car = require('../models/Car');
const Booking = require('../models/Booking');
const Maintenance = require('../models/Maintenance');
const Request = require('../models/Request');
const CarBlackout = require('../models/CarBlackout');

const AVAILABILITY_STATE = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  BOOKED: 'BOOKED',
  MAINTENANCE: 'MAINTENANCE',
  BLACKOUT: 'BLACKOUT',
  RESERVED: 'RESERVED',
});

const AVAILABILITY_PRIORITY = Object.freeze({
  [AVAILABILITY_STATE.AVAILABLE]: 0,
  [AVAILABILITY_STATE.RESERVED]: 1,
  [AVAILABILITY_STATE.BLACKOUT]: 2,
  [AVAILABILITY_STATE.MAINTENANCE]: 3,
  [AVAILABILITY_STATE.BOOKED]: 4,
});

const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_AVAILABILITY_RANGE_DAYS = 400;

const CLOSED_BOOKING_STATUS_KEYS = new Set(['CANCELLED', 'CANCELLEDBYUSER', 'REJECTED']);
const BOOKED_BOOKING_STATUS_KEYS = new Set(['CONFIRMED', 'COMPLETED']);
const RESERVED_BOOKING_STATUS_KEYS = new Set(['PENDING', 'PENDINGPAYMENT']);

const createAvailabilityError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const normalizeStatusKey = (value) => String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');

const toLocalDateFromDateOnlyText = (value) => {
  const match = DATE_ONLY_REGEX.exec(String(value || '').trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);

  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null;
  }

  return parsed;
};

const toValidDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getTime());
  }

  const fromDateOnly = toLocalDateFromDateOnlyText(value);
  if (fromDateOnly) return fromDateOnly;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toStartOfDay = (value) => {
  const parsed = toValidDate(value);
  if (!parsed) return null;
  parsed.setHours(0, 0, 0, 0);
  return parsed;
};

const formatDateKey = (value) => {
  const date = toStartOfDay(value);
  if (!date) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const addDays = (date, days = 1) => {
  const next = toStartOfDay(date);
  next.setDate(next.getDate() + Number(days || 0));
  return next;
};

const isRangeOverlapping = (startA, endA, startB, endB) => {
  if (!startA || !endA || !startB || !endB) return false;
  return startA.getTime() <= endB.getTime() && endA.getTime() >= startB.getTime();
};

const parseAvailabilityDateInput = (value, options = {}) => {
  const { fieldName = 'date', required = true } = options;
  if ((value === undefined || value === null || value === '') && !required) {
    return null;
  }

  const parsed = toStartOfDay(value);
  if (!parsed) {
    throw createAvailabilityError(422, `Invalid ${fieldName}. Expected YYYY-MM-DD`);
  }
  return parsed;
};

const normalizeAvailabilityRange = (options = {}) => {
  const {
    fromDate,
    toDate,
    maxRangeDays = MAX_AVAILABILITY_RANGE_DAYS,
  } = options;

  const startDate = parseAvailabilityDateInput(fromDate, { fieldName: 'from' });
  const endDate = parseAvailabilityDateInput(toDate, { fieldName: 'to' });

  if (endDate.getTime() < startDate.getTime()) {
    throw createAvailabilityError(422, 'to date cannot be earlier than from date');
  }

  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / ONE_DAY_MS) + 1;
  if (totalDays > Math.max(Number(maxRangeDays || 0), 1)) {
    throw createAvailabilityError(422, `Date range cannot exceed ${maxRangeDays} days`);
  }

  return {
    startDate,
    endDate,
    totalDays,
    from: formatDateKey(startDate),
    to: formatDateKey(endDate),
  };
};

const getNormalizedRecordRange = (startValue, endValue) => {
  const startDate = toStartOfDay(startValue);
  const endDate = toStartOfDay(endValue || startValue);

  if (!startDate || !endDate) return null;
  if (endDate.getTime() < startDate.getTime()) return null;

  return { startDate, endDate };
};

const classifyBookingState = (booking) => {
  const bookingStatusKey = normalizeStatusKey(booking?.bookingStatus);
  const rentalStageKey = normalizeStatusKey(booking?.rentalStage);
  const tripStatusKey = normalizeStatusKey(booking?.tripStatus);

  if (CLOSED_BOOKING_STATUS_KEYS.has(bookingStatusKey)) return '';

  if (BOOKED_BOOKING_STATUS_KEYS.has(bookingStatusKey)) return AVAILABILITY_STATE.BOOKED;
  if (RESERVED_BOOKING_STATUS_KEYS.has(bookingStatusKey)) return AVAILABILITY_STATE.RESERVED;

  if (['ACTIVE', 'OVERDUE', 'COMPLETED'].includes(rentalStageKey)) {
    return AVAILABILITY_STATE.BOOKED;
  }

  if (rentalStageKey === 'SCHEDULED') {
    return AVAILABILITY_STATE.RESERVED;
  }

  if (tripStatusKey === 'ACTIVE') {
    return AVAILABILITY_STATE.BOOKED;
  }

  if (tripStatusKey === 'UPCOMING') {
    return AVAILABILITY_STATE.RESERVED;
  }

  return '';
};

const resolveMaintenanceRange = (maintenance, rangeEndDate, todayDate) => {
  const startDate = toStartOfDay(maintenance?.serviceDate);
  if (!startDate) return null;

  const nextServiceDueDate = toStartOfDay(maintenance?.nextServiceDueDate);
  if (nextServiceDueDate && nextServiceDueDate.getTime() >= startDate.getTime()) {
    return { startDate, endDate: nextServiceDueDate };
  }

  if (startDate.getTime() <= todayDate.getTime()) {
    return { startDate, endDate: rangeEndDate };
  }

  return { startDate, endDate: startDate };
};

const ensureCarExists = async (carId) => {
  if (!mongoose.Types.ObjectId.isValid(String(carId || ''))) {
    throw createAvailabilityError(400, 'Invalid car id');
  }

  const car = await Car.findById(carId).select('_id').lean();
  if (!car) {
    throw createAvailabilityError(404, 'Car not found');
  }
};

const loadAvailabilitySources = async ({ carId, startDate, endDate }) => {
  const [bookings, maintenanceEntries, blackoutEntries, pendingRequests] = await Promise.all([
    Booking.find({
      car: carId,
      fromDate: { $lte: endDate },
      toDate: { $gte: startDate },
    })
      .select('_id bookingStatus rentalStage tripStatus fromDate toDate pickupDateTime dropDateTime')
      .lean(),
    Maintenance.find({
      carId,
      maintenanceStatus: 'Scheduled',
      serviceDate: { $lte: endDate },
      $or: [
        { nextServiceDueDate: { $gte: startDate } },
        { nextServiceDueDate: null },
        { nextServiceDueDate: { $exists: false } },
      ],
    })
      .select('_id serviceDate nextServiceDueDate maintenanceStatus')
      .lean(),
    CarBlackout.find({
      carId,
      startDate: { $lte: endDate },
      endDate: { $gte: startDate },
    })
      .select('_id startDate endDate reason')
      .lean(),
    Request.find({
      car: carId,
      status: 'pending',
      fromDate: { $lte: endDate },
      toDate: { $gte: startDate },
    })
      .select('_id status fromDate toDate pickupDateTime dropDateTime')
      .lean(),
  ]);

  return { bookings, maintenanceEntries, blackoutEntries, pendingRequests };
};

const initializeTimelineMap = (startDate, endDate) => {
  const map = new Map();
  for (let cursor = startDate; cursor.getTime() <= endDate.getTime(); cursor = addDays(cursor, 1)) {
    map.set(formatDateKey(cursor), AVAILABILITY_STATE.AVAILABLE);
  }
  return map;
};

const applyStateRange = (timelineMap, block, range) => {
  if (!block || !timelineMap) return;

  const boundedStart =
    block.startDate.getTime() < range.startDate.getTime() ? range.startDate : block.startDate;
  const boundedEnd =
    block.endDate.getTime() > range.endDate.getTime() ? range.endDate : block.endDate;

  if (!isRangeOverlapping(boundedStart, boundedEnd, range.startDate, range.endDate)) return;

  for (let cursor = boundedStart; cursor.getTime() <= boundedEnd.getTime(); cursor = addDays(cursor, 1)) {
    const key = formatDateKey(cursor);
    const currentState = timelineMap.get(key) || AVAILABILITY_STATE.AVAILABLE;
    const currentPriority = AVAILABILITY_PRIORITY[currentState] ?? 0;
    const nextPriority = AVAILABILITY_PRIORITY[block.state] ?? 0;

    if (nextPriority >= currentPriority) {
      timelineMap.set(key, block.state);
    }
  }
};

const buildAvailabilityBlocks = (sources, range) => {
  const todayDate = toStartOfDay(new Date());
  const blocks = {
    booked: [],
    maintenance: [],
    blackout: [],
    reserved: [],
  };

  for (const booking of sources.bookings || []) {
    const state = classifyBookingState(booking);
    if (!state) continue;

    const normalizedRange = getNormalizedRecordRange(
      booking.pickupDateTime || booking.fromDate,
      booking.dropDateTime || booking.toDate,
    );
    if (!normalizedRange) continue;

    if (!isRangeOverlapping(normalizedRange.startDate, normalizedRange.endDate, range.startDate, range.endDate)) {
      continue;
    }

    if (state === AVAILABILITY_STATE.BOOKED) {
      blocks.booked.push({ ...normalizedRange, state });
    } else {
      blocks.reserved.push({ ...normalizedRange, state: AVAILABILITY_STATE.RESERVED });
    }
  }

  for (const maintenance of sources.maintenanceEntries || []) {
    const normalizedRange = resolveMaintenanceRange(maintenance, range.endDate, todayDate);
    if (!normalizedRange) continue;
    if (!isRangeOverlapping(normalizedRange.startDate, normalizedRange.endDate, range.startDate, range.endDate)) {
      continue;
    }
    blocks.maintenance.push({ ...normalizedRange, state: AVAILABILITY_STATE.MAINTENANCE });
  }

  for (const blackout of sources.blackoutEntries || []) {
    const normalizedRange = getNormalizedRecordRange(blackout.startDate, blackout.endDate);
    if (!normalizedRange) continue;
    if (!isRangeOverlapping(normalizedRange.startDate, normalizedRange.endDate, range.startDate, range.endDate)) {
      continue;
    }
    blocks.blackout.push({ ...normalizedRange, state: AVAILABILITY_STATE.BLACKOUT });
  }

  for (const reservation of sources.pendingRequests || []) {
    const normalizedRange = getNormalizedRecordRange(
      reservation.pickupDateTime || reservation.fromDate,
      reservation.dropDateTime || reservation.toDate,
    );
    if (!normalizedRange) continue;
    if (!isRangeOverlapping(normalizedRange.startDate, normalizedRange.endDate, range.startDate, range.endDate)) {
      continue;
    }
    blocks.reserved.push({ ...normalizedRange, state: AVAILABILITY_STATE.RESERVED });
  }

  return blocks;
};

const buildTimelineArray = (timelineMap, range) => {
  const timeline = [];
  for (let cursor = range.startDate; cursor.getTime() <= range.endDate.getTime(); cursor = addDays(cursor, 1)) {
    const date = formatDateKey(cursor);
    timeline.push({
      date,
      state: timelineMap.get(date) || AVAILABILITY_STATE.AVAILABLE,
    });
  }
  return timeline;
};

const buildStateSummary = (timeline = []) => {
  return timeline.reduce(
    (acc, entry) => {
      const key = entry?.state || AVAILABILITY_STATE.AVAILABLE;
      if (!Object.prototype.hasOwnProperty.call(acc, key)) {
        acc[key] = 0;
      }
      acc[key] += 1;
      return acc;
    },
    {
      [AVAILABILITY_STATE.AVAILABLE]: 0,
      [AVAILABILITY_STATE.BOOKED]: 0,
      [AVAILABILITY_STATE.MAINTENANCE]: 0,
      [AVAILABILITY_STATE.BLACKOUT]: 0,
      [AVAILABILITY_STATE.RESERVED]: 0,
    },
  );
};

const getHighestPriorityConflictState = (states = []) => {
  let winner = '';
  let winnerPriority = -1;

  for (const state of states) {
    const priority = AVAILABILITY_PRIORITY[state] ?? -1;
    if (priority > winnerPriority) {
      winnerPriority = priority;
      winner = state;
    }
  }

  return winner;
};

const buildAvailabilityTimeline = async (options = {}) => {
  const {
    carId,
    fromDate,
    toDate,
    maxRangeDays = MAX_AVAILABILITY_RANGE_DAYS,
    skipCarValidation = false,
  } = options;

  if (!skipCarValidation) {
    await ensureCarExists(carId);
  }

  const range = normalizeAvailabilityRange({
    fromDate,
    toDate,
    maxRangeDays,
  });

  const sources = await loadAvailabilitySources({
    carId,
    startDate: range.startDate,
    endDate: range.endDate,
  });

  // Future rules (dynamic pricing, seasonal blocks, weekend policies) can
  // append additional block lists here without changing consumers.
  const blocks = buildAvailabilityBlocks(sources, range);
  const timelineMap = initializeTimelineMap(range.startDate, range.endDate);

  for (const block of blocks.reserved) {
    applyStateRange(timelineMap, block, range);
  }
  for (const block of blocks.blackout) {
    applyStateRange(timelineMap, block, range);
  }
  for (const block of blocks.maintenance) {
    applyStateRange(timelineMap, block, range);
  }
  for (const block of blocks.booked) {
    applyStateRange(timelineMap, block, range);
  }

  const timeline = buildTimelineArray(timelineMap, range);
  const summary = buildStateSummary(timeline);
  const isRentable = timeline.every((entry) => entry.state === AVAILABILITY_STATE.AVAILABLE);

  return {
    carId: String(carId),
    from: range.from,
    to: range.to,
    totalDays: range.totalDays,
    isRentable,
    summary,
    timeline,
  };
};

const evaluateDateRangeRentability = async (options = {}) => {
  const timelineResult = await buildAvailabilityTimeline(options);
  const conflictingEntries = timelineResult.timeline.filter(
    (entry) => entry.state !== AVAILABILITY_STATE.AVAILABLE,
  );

  if (conflictingEntries.length === 0) {
    return {
      valid: true,
      conflictReason: '',
      conflictingDates: [],
      timeline: timelineResult.timeline,
      summary: timelineResult.summary,
    };
  }

  const conflictReason = getHighestPriorityConflictState(
    conflictingEntries.map((entry) => entry.state),
  );
  const conflictingDates = conflictingEntries
    .filter((entry) => entry.state === conflictReason)
    .map((entry) => entry.date);

  return {
    valid: false,
    conflictReason,
    conflictingDates,
    timeline: timelineResult.timeline,
    summary: timelineResult.summary,
  };
};

module.exports = {
  AVAILABILITY_STATE,
  AVAILABILITY_PRIORITY,
  MAX_AVAILABILITY_RANGE_DAYS,
  createAvailabilityError,
  parseAvailabilityDateInput,
  normalizeAvailabilityRange,
  buildAvailabilityTimeline,
  evaluateDateRangeRentability,
};
