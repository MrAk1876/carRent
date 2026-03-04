const mongoose = require('mongoose');
const Car = require('../models/Car');
const CarBlackout = require('../models/CarBlackout');
const {
  createAvailabilityError,
  normalizeAvailabilityRange,
  AVAILABILITY_STATE,
  AVAILABILITY_PRIORITY,
  buildAvailabilityTimeline,
} = require('../services/availabilityService');
const { assertCarInScope } = require('../services/adminScopeService');

const resolveTimelineRangeFromQuery = (query = {}) => {
  const fromDate = query.from || query.startDate || query.start;
  const toDate = query.to || query.endDate || query.end;
  return normalizeAvailabilityRange({ fromDate, toDate });
};

const ensureValidCarId = (carId) => {
  if (!mongoose.Types.ObjectId.isValid(String(carId || ''))) {
    throw createAvailabilityError(400, 'Invalid car id');
  }
};

const loadScopedCar = async (carId) => {
  const car = await Car.findById(carId).select('_id branchId').lean();
  if (!car) {
    throw createAvailabilityError(404, 'Car not found');
  }
  return car;
};

exports.getCarAvailability = async (req, res) => {
  try {
    ensureValidCarId(req.params.id);
    const range = resolveTimelineRangeFromQuery(req.query);

    const timeline = await buildAvailabilityTimeline({
      carId: req.params.id,
      fromDate: range.startDate,
      toDate: range.endDate,
    });

    return res.json(timeline);
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load car availability' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getAdminCarAvailability = async (req, res) => {
  try {
    ensureValidCarId(req.params.id);
    const range = resolveTimelineRangeFromQuery(req.query);
    const car = await loadScopedCar(req.params.id);
    await assertCarInScope(req.user, car._id, 'Car does not belong to your branch scope');

    const timeline = await buildAvailabilityTimeline({
      carId: car._id,
      fromDate: range.startDate,
      toDate: range.endDate,
      skipCarValidation: true,
    });
    const conflicts = timeline.timeline.filter((entry) => entry.state !== AVAILABILITY_STATE.AVAILABLE);
    const conflictReason = conflicts.reduce(
      (winner, entry) => {
        if (!winner) return entry.state;
        const winnerPriority = AVAILABILITY_PRIORITY[winner] ?? -1;
        const entryPriority = AVAILABILITY_PRIORITY[entry.state] ?? -1;
        return entryPriority > winnerPriority ? entry.state : winner;
      },
      '',
    );
    const conflictingDates = conflicts
      .filter((entry) => entry.state === conflictReason)
      .map((entry) => entry.date);

    return res.json({
      ...timeline,
      conflict: {
        valid: conflicts.length === 0,
        conflictReason,
        conflictingDates,
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load admin availability timeline' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createCarBlackout = async (req, res) => {
  try {
    ensureValidCarId(req.params.id);
    const car = await loadScopedCar(req.params.id);
    await assertCarInScope(req.user, car._id, 'Car does not belong to your branch scope');

    const startDate = req.body?.startDate || req.body?.fromDate;
    const endDate = req.body?.endDate || req.body?.toDate;
    const reason = String(req.body?.reason || '').trim();

    if (!startDate || !endDate) {
      throw createAvailabilityError(422, 'startDate and endDate are required');
    }

    const range = normalizeAvailabilityRange({
      fromDate: startDate,
      toDate: endDate,
      maxRangeDays: 730,
    });

    const blackout = await CarBlackout.create({
      carId: car._id,
      startDate: range.startDate,
      endDate: range.endDate,
      reason,
    });

    return res.status(201).json({
      message: 'Blackout date range created successfully',
      blackout,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to create blackout date range' : error.message;
    return res.status(status).json({ message });
  }
};
