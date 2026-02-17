const Booking = require('../models/Booking');
const Car = require('../models/Car');
const Request = require('../models/Request');
const {
  FLEET_STATUS,
  FLEET_STATUS_VALUES,
  normalizeFleetStatus,
  isFleetBookable,
  fleetStatusToAvailability,
} = require('../utils/fleetStatus');

const resolveFleetStatus = (car) => {
  if (!car) return FLEET_STATUS.AVAILABLE;
  const normalized = normalizeFleetStatus(car.fleetStatus, '');
  if (normalized) return normalized;
  return car.isAvailable === false ? FLEET_STATUS.INACTIVE : FLEET_STATUS.AVAILABLE;
};

const shouldAutoReleaseToAvailable = (car) => {
  if (!car) return false;

  const explicitStatus = normalizeFleetStatus(car.fleetStatus, '');
  if (!explicitStatus) {
    // Legacy records without fleetStatus should still be releasable.
    return true;
  }

  return [FLEET_STATUS.AVAILABLE, FLEET_STATUS.RESERVED, FLEET_STATUS.RENTED].includes(explicitStatus);
};

const applyFleetStatusToCarDoc = (car, fleetStatus) => {
  if (!car) return car;
  const normalizedStatus = normalizeFleetStatus(fleetStatus);
  car.fleetStatus = normalizedStatus;
  car.isAvailable = fleetStatusToAvailability(normalizedStatus);
  return car;
};

const updateCarFleetStatus = async (carId, nextFleetStatus) => {
  if (!carId) return null;
  const normalizedStatus = normalizeFleetStatus(nextFleetStatus);
  return Car.findByIdAndUpdate(
    carId,
    {
      $set: {
        fleetStatus: normalizedStatus,
        isAvailable: fleetStatusToAvailability(normalizedStatus),
      },
    },
    { new: true },
  );
};

const tryReserveCar = async (carId) => {
  if (!carId) return null;

  return Car.findOneAndUpdate(
    {
      _id: carId,
      $or: [
        { fleetStatus: FLEET_STATUS.AVAILABLE },
        { fleetStatus: { $exists: false }, isAvailable: true },
        { fleetStatus: { $exists: false }, isAvailable: { $exists: false } },
      ],
    },
    {
      $set: {
        fleetStatus: FLEET_STATUS.RESERVED,
        isAvailable: false,
      },
    },
    { new: true },
  );
};

const hasBlockingBookingsForCar = async (carId) => {
  if (!carId) return false;

  const blockingBooking = await Booking.findOne({
    car: carId,
    $or: [
      { bookingStatus: { $in: ['PendingPayment', 'PENDINGPAYMENT', 'PENDING', 'Pending', 'Confirmed', 'CONFIRMED'] } },
      { rentalStage: { $in: ['Scheduled', 'Active', 'Overdue'] } },
      { tripStatus: { $in: ['upcoming', 'active'] } },
    ],
  })
    .select('_id')
    .lean();

  return Boolean(blockingBooking?._id);
};

const hasBlockingRequestsForCar = async (carId) => {
  if (!carId) return false;
  const pendingRequest = await Request.findOne({ car: carId, status: 'pending' }).select('_id').lean();
  return Boolean(pendingRequest?._id);
};

const releaseCarIfUnblocked = async (carId) => {
  if (!carId) return { released: false, car: null };

  const [hasBookingBlock, hasRequestBlock] = await Promise.all([
    hasBlockingBookingsForCar(carId),
    hasBlockingRequestsForCar(carId),
  ]);

  if (hasBookingBlock || hasRequestBlock) {
    return { released: false, car: null };
  }

  const car = await Car.findById(carId).select('_id fleetStatus isAvailable');
  if (!car) {
    return { released: false, car: null };
  }

  if (!shouldAutoReleaseToAvailable(car)) {
    return { released: false, car };
  }

  const updatedCar = await updateCarFleetStatus(carId, FLEET_STATUS.AVAILABLE);
  return { released: Boolean(updatedCar), car: updatedCar };
};

const releaseManyCarsIfUnblocked = async (carIds) => {
  if (!Array.isArray(carIds) || carIds.length === 0) return { releasedCount: 0 };

  const uniqueCarIds = [...new Set(carIds.map((value) => String(value || '')).filter(Boolean))];
  let releasedCount = 0;

  for (const carId of uniqueCarIds) {
    const { released } = await releaseCarIfUnblocked(carId);
    if (released) releasedCount += 1;
  }

  return { releasedCount };
};

module.exports = {
  FLEET_STATUS,
  FLEET_STATUS_VALUES,
  normalizeFleetStatus,
  resolveFleetStatus,
  isFleetBookable,
  fleetStatusToAvailability,
  applyFleetStatusToCarDoc,
  updateCarFleetStatus,
  tryReserveCar,
  hasBlockingBookingsForCar,
  hasBlockingRequestsForCar,
  releaseCarIfUnblocked,
  releaseManyCarsIfUnblocked,
};
