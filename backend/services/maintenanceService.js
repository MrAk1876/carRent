const mongoose = require('mongoose');
const Car = require('../models/Car');
const Booking = require('../models/Booking');
const Maintenance = require('../models/Maintenance');
const { FLEET_STATUS } = require('../utils/fleetStatus');
const { resolveFleetStatus, updateCarFleetStatus } = require('./fleetService');

const DAYS_7_MS = 7 * 24 * 60 * 60 * 1000;

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
};

const normalizeMaintenanceEntry = (entry) => {
  if (!entry) return null;

  return {
    ...entry,
    serviceDate: toValidDate(entry.serviceDate),
    nextServiceDueDate: toValidDate(entry.nextServiceDueDate),
    serviceCost: toNonNegativeNumber(entry.serviceCost, 0),
    maintenanceStatus: String(entry.maintenanceStatus || 'Scheduled'),
  };
};

const buildMaintenanceReminderFlags = (entries = [], now = new Date()) => {
  const nowDate = now instanceof Date ? now : new Date();
  const nowMs = nowDate.getTime();
  const soonThresholdMs = nowMs + DAYS_7_MS;

  let serviceDueSoon = false;
  let serviceOverdue = false;
  let nearestDueDate = null;

  for (const rawEntry of entries) {
    const entry = normalizeMaintenanceEntry(rawEntry);
    if (!entry || entry.maintenanceStatus !== 'Scheduled') continue;

    const dueDate = toValidDate(entry.nextServiceDueDate);
    if (!dueDate) continue;

    const dueMs = dueDate.getTime();
    if (Number.isNaN(dueMs)) continue;

    if (!nearestDueDate || dueMs < nearestDueDate.getTime()) {
      nearestDueDate = dueDate;
    }

    if (dueMs < nowMs) {
      serviceOverdue = true;
      serviceDueSoon = false;
      continue;
    }

    if (!serviceOverdue && dueMs <= soonThresholdMs) {
      serviceDueSoon = true;
    }
  }

  return {
    serviceDueSoon,
    serviceOverdue,
    nearestServiceDueDate: nearestDueDate,
  };
};

const isCarCurrentlyRented = async (carOrId) => {
  const carId = typeof carOrId === 'object' ? carOrId?._id : carOrId;
  if (!carId) return false;

  const activeBooking = await Booking.findOne({
    car: carId,
    $or: [
      { rentalStage: 'Active' },
      { tripStatus: 'active' },
      { bookingStatus: { $in: ['Confirmed', 'CONFIRMED'] }, rentalStage: { $in: ['Active', 'Overdue'] } },
    ],
  })
    .select('_id')
    .lean();

  return Boolean(activeBooking?._id);
};

const hasActiveBookingForMaintenance = async (carId) => {
  if (!carId) return false;
  const activeBooking = await Booking.findOne({
    car: carId,
    $or: [
      { bookingStatus: { $in: ['Confirmed', 'CONFIRMED'] } },
      { rentalStage: { $in: ['Scheduled', 'Active', 'Overdue'] } },
      { tripStatus: { $in: ['upcoming', 'active'] } },
    ],
  })
    .select('_id')
    .lean();

  return Boolean(activeBooking?._id);
};

const recalculateCarMaintenanceCost = async (carId) => {
  if (!carId || !mongoose.Types.ObjectId.isValid(String(carId))) return 0;

  const aggregateResult = await Maintenance.aggregate([
    {
      $match: {
        carId: new mongoose.Types.ObjectId(String(carId)),
        maintenanceStatus: 'Completed',
      },
    },
    {
      $group: {
        _id: '$carId',
        totalCost: { $sum: { $max: ['$serviceCost', 0] } },
      },
    },
  ]);

  const totalCost = Number(aggregateResult?.[0]?.totalCost || 0);
  const normalizedTotal = Number.isFinite(totalCost) && totalCost >= 0 ? Number(totalCost.toFixed(2)) : 0;

  await Car.findByIdAndUpdate(
    carId,
    { $set: { totalMaintenanceCost: normalizedTotal } },
    { runValidators: false },
  );

  return normalizedTotal;
};

const syncCarFleetStatusFromMaintenance = async (carId, options = {}) => {
  const now = options.now instanceof Date ? options.now : new Date();
  if (!carId || !mongoose.Types.ObjectId.isValid(String(carId))) {
    return { statusChanged: false, car: null };
  }

  const car = await Car.findById(carId);
  if (!car) {
    return { statusChanged: false, car: null };
  }

  const currentStatus = resolveFleetStatus(car);
  const rentedNow = await isCarCurrentlyRented(car._id);
  if (rentedNow || currentStatus === FLEET_STATUS.RENTED) {
    return { statusChanged: false, car };
  }

  const dueScheduledEntry = await Maintenance.findOne({
    carId: car._id,
    maintenanceStatus: 'Scheduled',
    serviceDate: { $lte: now },
  })
    .sort({ serviceDate: 1, createdAt: 1 })
    .select('_id')
    .lean();

  if (dueScheduledEntry?._id) {
    if (currentStatus !== FLEET_STATUS.MAINTENANCE) {
      const updatedCar = await updateCarFleetStatus(car._id, FLEET_STATUS.MAINTENANCE);
      return { statusChanged: true, car: updatedCar };
    }
    return { statusChanged: false, car };
  }

  if (currentStatus === FLEET_STATUS.MAINTENANCE) {
    const hasActiveBooking = await hasActiveBookingForMaintenance(car._id);
    if (!hasActiveBooking) {
      const updatedCar = await updateCarFleetStatus(car._id, FLEET_STATUS.AVAILABLE);
      return { statusChanged: true, car: updatedCar };
    }
  }

  return { statusChanged: false, car };
};

const ensureCanEnterMaintenanceState = async (carId) => {
  if (!carId) {
    const error = new Error('Car not found');
    error.status = 404;
    throw error;
  }

  const car = await Car.findById(carId);
  if (!car) {
    const error = new Error('Car not found');
    error.status = 404;
    throw error;
  }

  const currentStatus = resolveFleetStatus(car);
  const rentedNow = await isCarCurrentlyRented(car._id);
  if (currentStatus === FLEET_STATUS.RENTED || rentedNow) {
    const error = new Error('Cannot move to Maintenance while vehicle is rented');
    error.status = 422;
    throw error;
  }

  return car;
};

module.exports = {
  DAYS_7_MS,
  toValidDate,
  toNonNegativeNumber,
  normalizeMaintenanceEntry,
  buildMaintenanceReminderFlags,
  isCarCurrentlyRented,
  hasActiveBookingForMaintenance,
  recalculateCarMaintenanceCost,
  syncCarFleetStatusFromMaintenance,
  ensureCanEnterMaintenanceState,
};
