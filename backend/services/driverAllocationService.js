const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Car = require('../models/Car');
const Driver = require('../models/Driver');
const { normalizeStatusKey } = require('../utils/paymentUtils');

const DRIVER_AVAILABILITY = Object.freeze({
  AVAILABLE: 'Available',
  ASSIGNED: 'Assigned',
  INACTIVE: 'Inactive',
});

const DRIVER_AVAILABILITY_KEY_MAP = Object.freeze({
  AVAILABLE: DRIVER_AVAILABILITY.AVAILABLE,
  ASSIGNED: DRIVER_AVAILABILITY.ASSIGNED,
  INACTIVE: DRIVER_AVAILABILITY.INACTIVE,
});

const ASSIGNABLE_STAGE_KEYS = new Set(['SCHEDULED', 'ACTIVE', 'OVERDUE']);
const CLOSED_STATUS_KEYS = new Set([
  'COMPLETED',
  'CANCELLED',
  'CANCELLEDBYUSER',
  'REJECTED',
]);

const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (mongoose.isValidObjectId(value)) return String(value);
  if (value?._id && mongoose.isValidObjectId(value._id)) return String(value._id);
  return '';
};

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const normalizeAvailabilityStatus = (value, fallback = DRIVER_AVAILABILITY.AVAILABLE) => {
  const key = normalizeStatusKey(value);
  if (!key) return fallback;
  return DRIVER_AVAILABILITY_KEY_MAP[key] || fallback;
};

const isBookingClosed = (booking) => {
  const bookingStatusKey = normalizeStatusKey(booking?.bookingStatus);
  const stageKey = normalizeStatusKey(booking?.rentalStage);
  const tripStatusKey = normalizeStatusKey(booking?.tripStatus);
  if (CLOSED_STATUS_KEYS.has(bookingStatusKey)) return true;
  if (stageKey === 'COMPLETED') return true;
  if (tripStatusKey === 'COMPLETED') return true;
  return false;
};

const ensureAssignableBooking = (booking) => {
  if (!booking) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }

  if (isBookingClosed(booking)) {
    const error = new Error('Cannot assign driver to completed or cancelled booking');
    error.status = 422;
    throw error;
  }

  const bookingStatusKey = normalizeStatusKey(booking.bookingStatus);
  if (bookingStatusKey !== 'CONFIRMED') {
    const error = new Error('Driver can be assigned only on confirmed bookings');
    error.status = 422;
    throw error;
  }

  const stageKey = normalizeStatusKey(booking.rentalStage);
  if (stageKey && !ASSIGNABLE_STAGE_KEYS.has(stageKey)) {
    const error = new Error('Driver can be assigned only for scheduled or active rentals');
    error.status = 422;
    throw error;
  }
};

const ensureDriverAssignable = (driver) => {
  if (!driver) {
    const error = new Error('Driver not found');
    error.status = 404;
    throw error;
  }

  if (!driver.isActive) {
    const error = new Error('Cannot assign an inactive driver');
    error.status = 422;
    throw error;
  }

  const availability = normalizeAvailabilityStatus(driver.availabilityStatus);
  if (availability === DRIVER_AVAILABILITY.INACTIVE) {
    const error = new Error('Cannot assign an inactive driver');
    error.status = 422;
    throw error;
  }
};

const resolveBookingDocument = async (bookingOrId) => {
  if (bookingOrId && typeof bookingOrId === 'object' && bookingOrId._id) return bookingOrId;
  if (!bookingOrId) return null;
  return Booking.findById(bookingOrId);
};

const resolveBookingBranchId = async (booking) => {
  const explicitBranchId = toObjectIdString(booking?.branchId);
  if (explicitBranchId) return explicitBranchId;

  const carId = toObjectIdString(booking?.car?._id || booking?.car);
  if (!carId) return '';

  const car = await Car.findById(carId).select('branchId').lean();
  return toObjectIdString(car?.branchId);
};

const findConflictingDriverBooking = async (driverId, bookingId) => {
  const rows = await Booking.find({
    assignedDriver: driverId,
    _id: { $ne: bookingId },
  })
    .select('_id bookingStatus rentalStage tripStatus')
    .lean();

  return rows.find((row) => !isBookingClosed(row)) || null;
};

const releaseDriverForBooking = async (bookingOrId, options = {}) => {
  const booking = await resolveBookingDocument(bookingOrId);
  if (!booking?._id) {
    return {
      released: false,
      incrementedTrips: false,
      booking: null,
      driver: null,
    };
  }

  const assignedDriverId = toObjectIdString(booking.assignedDriver);
  if (!assignedDriverId) {
    return {
      released: false,
      incrementedTrips: false,
      booking,
      driver: null,
    };
  }

  const driver = await Driver.findById(assignedDriverId);
  if (!driver) {
    return {
      released: false,
      incrementedTrips: false,
      booking,
      driver: null,
    };
  }

  const bookingId = toObjectIdString(booking._id);
  const driverBookingId = toObjectIdString(driver.currentAssignedBooking);
  const canReleaseByBinding = driverBookingId === bookingId;
  const canReleaseStaleState = !driverBookingId;

  if (!canReleaseByBinding && !canReleaseStaleState) {
    return {
      released: false,
      incrementedTrips: false,
      booking,
      driver,
    };
  }

  let incrementedTrips = false;
  if (Boolean(options.incrementTripCount) && canReleaseByBinding) {
    const currentTrips = Number(driver.totalTripsCompleted || 0);
    const safeTrips = Number.isFinite(currentTrips) && currentTrips >= 0 ? currentTrips : 0;
    driver.totalTripsCompleted = safeTrips + 1;
    incrementedTrips = true;
  }

  driver.currentAssignedBooking = null;
  driver.availabilityStatus = driver.isActive ? DRIVER_AVAILABILITY.AVAILABLE : DRIVER_AVAILABILITY.INACTIVE;
  await driver.save();

  return {
    released: true,
    incrementedTrips,
    booking,
    driver,
  };
};

const assignDriverToBooking = async (bookingOrId, driverId, options = {}) => {
  const booking = await resolveBookingDocument(bookingOrId);
  ensureAssignableBooking(booking);

  const normalizedDriverId = toObjectIdString(driverId);
  if (!normalizedDriverId || !mongoose.isValidObjectId(normalizedDriverId)) {
    const error = new Error('Valid driverId is required');
    error.status = 422;
    throw error;
  }

  const bookingBranchId = await resolveBookingBranchId(booking);
  if (!bookingBranchId) {
    const error = new Error('Booking branch is missing. Cannot assign driver.');
    error.status = 422;
    throw error;
  }

  const driver = await Driver.findById(normalizedDriverId);
  ensureDriverAssignable(driver);

  const driverBranchId = toObjectIdString(driver.branchId);
  if (!driverBranchId || driverBranchId !== bookingBranchId) {
    const error = new Error('Driver must belong to the same branch as the booking');
    error.status = 422;
    throw error;
  }

  const bookingId = toObjectIdString(booking._id);
  const currentAssignedBookingId = toObjectIdString(driver.currentAssignedBooking);
  const isSameBookingAssignment = currentAssignedBookingId && currentAssignedBookingId === bookingId;
  const driverAvailability = normalizeAvailabilityStatus(driver.availabilityStatus);

  if (!isSameBookingAssignment && driverAvailability === DRIVER_AVAILABILITY.ASSIGNED) {
    const error = new Error('Driver is already assigned to another booking');
    error.status = 409;
    throw error;
  }

  const conflictBooking = await findConflictingDriverBooking(driver._id, booking._id);
  if (conflictBooking?._id) {
    const error = new Error('Driver is already assigned to an active booking');
    error.status = 409;
    throw error;
  }

  const previousDriverId = toObjectIdString(booking.assignedDriver);
  const now = toValidDate(options.now) || new Date();
  const shouldSetAssignedAt = previousDriverId !== normalizedDriverId || !toValidDate(booking.driverAssignedAt);

  if (previousDriverId && previousDriverId !== normalizedDriverId) {
    await releaseDriverForBooking(booking, { incrementTripCount: false });
  }

  if (!toObjectIdString(booking.branchId) && bookingBranchId) {
    booking.branchId = bookingBranchId;
  }
  booking.assignedDriver = driver._id;
  if (shouldSetAssignedAt) {
    booking.driverAssignedAt = now;
  }
  await booking.save();

  driver.currentAssignedBooking = booking._id;
  driver.availabilityStatus = DRIVER_AVAILABILITY.ASSIGNED;
  await driver.save();

  return {
    booking,
    driver,
    previousDriverId: previousDriverId || null,
  };
};

const buildDriverSummary = (drivers = []) => {
  const summary = {
    totalDrivers: 0,
    availableDrivers: 0,
    assignedDrivers: 0,
    inactiveDrivers: 0,
    utilizationPercent: 0,
  };

  for (const driver of drivers) {
    summary.totalDrivers += 1;
    const availability = normalizeAvailabilityStatus(driver?.availabilityStatus);
    if (availability === DRIVER_AVAILABILITY.AVAILABLE) summary.availableDrivers += 1;
    if (availability === DRIVER_AVAILABILITY.ASSIGNED) summary.assignedDrivers += 1;
    if (availability === DRIVER_AVAILABILITY.INACTIVE) summary.inactiveDrivers += 1;
  }

  if (summary.totalDrivers > 0) {
    summary.utilizationPercent = Number(
      ((summary.assignedDrivers / summary.totalDrivers) * 100).toFixed(2),
    );
  }

  return summary;
};

const suggestDriversForBooking = async (bookingOrId) => {
  const booking = await resolveBookingDocument(bookingOrId);
  ensureAssignableBooking(booking);

  const branchId = await resolveBookingBranchId(booking);
  if (!branchId) {
    const error = new Error('Booking branch is missing. Cannot suggest drivers.');
    error.status = 422;
    throw error;
  }

  const currentDriverId = toObjectIdString(booking.assignedDriver);
  const baseFilter = {
    branchId,
    isActive: true,
    $or: [{ availabilityStatus: DRIVER_AVAILABILITY.AVAILABLE }],
  };

  if (currentDriverId && mongoose.isValidObjectId(currentDriverId)) {
    baseFilter.$or.push({ _id: currentDriverId });
  }

  const drivers = await Driver.find(baseFilter)
    .select('driverName phoneNumber licenseNumber licenseExpiry branchId availabilityStatus totalTripsCompleted rating currentAssignedBooking isActive')
    .sort({ totalTripsCompleted: 1, updatedAt: 1, driverName: 1 })
    .lean();

  const bookingId = toObjectIdString(booking._id);

  const suggestions = drivers.map((driver) => {
    const assignedBookingId = toObjectIdString(driver.currentAssignedBooking);
    const isAssignedToThisBooking = assignedBookingId && assignedBookingId === bookingId;
    const isAvailable = normalizeAvailabilityStatus(driver.availabilityStatus) === DRIVER_AVAILABILITY.AVAILABLE;

    return {
      ...driver,
      isAvailable: isAvailable || isAssignedToThisBooking,
      isAssignedToThisBooking,
      suggestionMeta: {
        sameBranch: true,
        availabilityWeight: isAvailable ? 0 : 1,
        tripLoad: Number(driver.totalTripsCompleted || 0),
      },
    };
  });

  suggestions.sort((left, right) => {
    const leftWeight = Number(left?.suggestionMeta?.availabilityWeight || 0);
    const rightWeight = Number(right?.suggestionMeta?.availabilityWeight || 0);
    if (leftWeight !== rightWeight) return leftWeight - rightWeight;

    const leftTrips = Number(left?.suggestionMeta?.tripLoad || 0);
    const rightTrips = Number(right?.suggestionMeta?.tripLoad || 0);
    if (leftTrips !== rightTrips) return leftTrips - rightTrips;

    return String(left.driverName || '').localeCompare(String(right.driverName || ''));
  });

  return {
    booking,
    branchId,
    suggestions,
  };
};

module.exports = {
  DRIVER_AVAILABILITY,
  normalizeAvailabilityStatus,
  resolveBookingBranchId,
  assignDriverToBooking,
  releaseDriverForBooking,
  buildDriverSummary,
  suggestDriversForBooking,
};
