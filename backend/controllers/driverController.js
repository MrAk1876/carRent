const Driver = require('../models/Driver');
const Booking = require('../models/Booking');
const Branch = require('../models/Branch');
const { queueAuditLog } = require('../services/auditLogService');
const { ensureBranchById, ensureMainBranch } = require('../services/branchService');
const {
  assertBranchInScope,
  assertCarInScope,
  getScopedBranchIds,
} = require('../services/adminScopeService');
const {
  DRIVER_AVAILABILITY,
  normalizeAvailabilityStatus,
  resolveBookingBranchId,
  assignDriverToBooking,
  buildDriverSummary,
  suggestDriversForBooking,
} = require('../services/driverAllocationService');
const { assertTenantEntityLimit } = require('../services/tenantLimitService');

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000;
const DRIVER_STATUS_LIST = Object.values(DRIVER_AVAILABILITY);

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const parseBooleanInput = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizeDriverForClient = (driver, now = new Date()) => {
  if (!driver) return null;
  const nowDate = now instanceof Date ? now : new Date();
  const expiryDate = toValidDate(driver.licenseExpiry);
  const expiryMs = expiryDate ? expiryDate.getTime() : NaN;
  const deltaMs = Number.isFinite(expiryMs) ? expiryMs - nowDate.getTime() : Number.NaN;

  const licenseExpired = Number.isFinite(deltaMs) && deltaMs < 0;
  const licenseExpiringIn30Days = Number.isFinite(deltaMs) && deltaMs >= 0 && deltaMs <= DAYS_30_MS;

  return {
    ...driver,
    availabilityStatus: normalizeAvailabilityStatus(driver.availabilityStatus),
    licenseExpired,
    licenseExpiringIn30Days,
  };
};

const assertBookingScope = async (user, booking, message = 'Booking does not belong to your branch scope') => {
  if (booking?.branchId) {
    assertBranchInScope(user, String(booking.branchId), message);
    return;
  }

  const carId = booking?.car?._id || booking?.car;
  await assertCarInScope(user, carId, message);
};

const resolveRequestedBranchScope = async (req, rawBranchId = '') => {
  const scopedBranchIds = getScopedBranchIds(req.user);
  const requestedBranchId = String(rawBranchId || req.query?.branchId || req.body?.branchId || '').trim();

  if (requestedBranchId) {
    const branch = await ensureBranchById(requestedBranchId);
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
      branchFilter: { branchId: String(branch._id) },
      resolvedBranchId: String(branch._id),
      scopedBranchIds,
    };
  }

  if (Array.isArray(scopedBranchIds)) {
    if (scopedBranchIds.length === 0) {
      const error = new Error('No branch assigned for this staff account');
      error.status = 403;
      throw error;
    }

    return {
      branchFilter: { branchId: { $in: scopedBranchIds } },
      resolvedBranchId: '',
      scopedBranchIds,
    };
  }

  return {
    branchFilter: {},
    resolvedBranchId: '',
    scopedBranchIds: null,
  };
};

const resolveWriteBranch = async (req, rawBranchId) => {
  const requestedBranchId = String(rawBranchId || '').trim();
  const scopedBranchIds = getScopedBranchIds(req.user);

  if (requestedBranchId) {
    const branch = await ensureBranchById(requestedBranchId);
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

    return branch;
  }

  if (Array.isArray(scopedBranchIds)) {
    if (scopedBranchIds.length === 0) {
      const error = new Error('No branch assigned for this staff account');
      error.status = 403;
      throw error;
    }

    const defaultBranch = await ensureBranchById(scopedBranchIds[0]);
    if (!defaultBranch) {
      const error = new Error('Assigned branch not found');
      error.status = 404;
      throw error;
    }

    return defaultBranch;
  }

  return ensureMainBranch();
};

exports.getDrivers = async (req, res) => {
  try {
    const { branchFilter, resolvedBranchId, scopedBranchIds } = await resolveRequestedBranchScope(req);

    const search = String(req.query?.search || '').trim();
    const requestedStatus = String(req.query?.status || 'all').trim();
    const normalizedStatus = normalizeAvailabilityStatus(requestedStatus, '');
    const applyStatusFilter = Boolean(normalizedStatus && DRIVER_STATUS_LIST.includes(normalizedStatus));

    const summaryDocs = await Driver.find(branchFilter)
      .select('availabilityStatus')
      .lean();
    const summary = buildDriverSummary(summaryDocs);

    const driverQuery = { ...branchFilter };
    if (search) {
      const pattern = new RegExp(escapeRegex(search), 'i');
      driverQuery.$or = [
        { driverName: pattern },
        { phoneNumber: pattern },
        { licenseNumber: pattern },
      ];
    }
    if (applyStatusFilter) {
      driverQuery.availabilityStatus = normalizedStatus;
    }

    const now = new Date();
    const drivers = await Driver.find(driverQuery)
      .populate('branchId', 'branchName branchCode city state isActive')
      .populate({
        path: 'currentAssignedBooking',
        select: '_id bookingStatus rentalStage pickupDateTime dropDateTime user car',
        populate: [
          { path: 'user', select: 'firstName lastName email' },
          { path: 'car', select: 'name brand model image location' },
        ],
      })
      .sort({ availabilityStatus: 1, driverName: 1, createdAt: -1 })
      .lean();

    const branchQuery =
      Array.isArray(scopedBranchIds)
        ? (scopedBranchIds.length > 0 ? { _id: { $in: scopedBranchIds } } : { _id: { $in: [] } })
        : {};
    const branches = await Branch.find(branchQuery)
      .select('_id branchName branchCode city state isActive')
      .sort({ branchName: 1 })
      .lean();

    return res.json({
      drivers: drivers.map((driver) => normalizeDriverForClient(driver, now)),
      summary,
      statusOptions: DRIVER_STATUS_LIST,
      selectedBranchId: resolvedBranchId,
      branches,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load drivers' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createDriver = async (req, res) => {
  try {
    const driverName = String(req.body?.driverName || '').trim();
    const phoneNumber = String(req.body?.phoneNumber || '').trim();
    const licenseNumber = String(req.body?.licenseNumber || '').trim().toUpperCase();
    const licenseExpiry = toValidDate(req.body?.licenseExpiry);
    const ratingInput =
      req.body?.rating !== undefined && req.body?.rating !== null && String(req.body?.rating).trim() !== ''
        ? Number(req.body.rating)
        : null;

    if (!driverName || !phoneNumber || !licenseNumber || !licenseExpiry) {
      return res.status(422).json({
        message: 'driverName, phoneNumber, licenseNumber, and licenseExpiry are required',
      });
    }

    if (ratingInput !== null && (!Number.isFinite(ratingInput) || ratingInput < 0 || ratingInput > 5)) {
      return res.status(422).json({ message: 'rating must be between 0 and 5' });
    }

    const branch = await resolveWriteBranch(req, req.body?.branchId);
    await assertTenantEntityLimit(req, {
      model: Driver,
      limitField: 'maxDrivers',
      label: 'drivers',
    });

    const driver = await Driver.create({
      driverName,
      phoneNumber,
      licenseNumber,
      licenseExpiry,
      branchId: branch._id,
      availabilityStatus: DRIVER_AVAILABILITY.AVAILABLE,
      currentAssignedBooking: null,
      totalTripsCompleted: 0,
      rating: ratingInput,
      isActive: req.body?.isActive !== undefined ? parseBooleanInput(req.body.isActive, true) : true,
    });

    queueAuditLog({
      userId: req.user?._id,
      actionType: 'DRIVER_CREATED',
      targetEntity: 'Driver',
      targetId: String(driver._id),
      meta: {
        branchId: String(branch._id),
      },
    });

    const fresh = await Driver.findById(driver._id)
      .populate('branchId', 'branchName branchCode city state isActive')
      .lean();

    return res.status(201).json({
      message: 'Driver created successfully',
      driver: normalizeDriverForClient(fresh),
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return res.status(422).json({ message: 'licenseNumber already exists' });
    }

    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to create driver' : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateDriver = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    assertBranchInScope(req.user, String(driver.branchId), 'Driver does not belong to your branch scope');

    if (req.body?.driverName !== undefined) {
      driver.driverName = String(req.body.driverName || '').trim();
    }
    if (req.body?.phoneNumber !== undefined) {
      driver.phoneNumber = String(req.body.phoneNumber || '').trim();
    }
    if (req.body?.licenseNumber !== undefined) {
      driver.licenseNumber = String(req.body.licenseNumber || '').trim().toUpperCase();
    }
    if (req.body?.licenseExpiry !== undefined) {
      const parsedExpiry = toValidDate(req.body.licenseExpiry);
      if (!parsedExpiry) {
        return res.status(422).json({ message: 'licenseExpiry must be a valid date' });
      }
      driver.licenseExpiry = parsedExpiry;
    }
    if (req.body?.rating !== undefined) {
      const rawRating = String(req.body.rating || '').trim();
      if (!rawRating) {
        driver.rating = null;
      } else {
        const rating = Number(rawRating);
        if (!Number.isFinite(rating) || rating < 0 || rating > 5) {
          return res.status(422).json({ message: 'rating must be between 0 and 5' });
        }
        driver.rating = rating;
      }
    }

    if (req.body?.branchId !== undefined) {
      const nextBranch = await resolveWriteBranch(req, req.body.branchId);
      const nextBranchId = String(nextBranch._id);
      const currentBranchId = String(driver.branchId || '');

      if (currentBranchId !== nextBranchId) {
        if (normalizeAvailabilityStatus(driver.availabilityStatus) === DRIVER_AVAILABILITY.ASSIGNED) {
          return res.status(422).json({
            message: 'Cannot transfer branch while driver is assigned to an active booking',
          });
        }
        driver.branchId = nextBranch._id;
      }
    }

    await driver.save();

    queueAuditLog({
      userId: req.user?._id,
      actionType: 'DRIVER_UPDATED',
      targetEntity: 'Driver',
      targetId: String(driver._id),
      meta: {
        branchId: String(driver.branchId || ''),
      },
    });

    const fresh = await Driver.findById(driver._id)
      .populate('branchId', 'branchName branchCode city state isActive')
      .populate({
        path: 'currentAssignedBooking',
        select: '_id bookingStatus rentalStage pickupDateTime dropDateTime',
      })
      .lean();

    return res.json({
      message: 'Driver updated successfully',
      driver: normalizeDriverForClient(fresh),
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return res.status(422).json({ message: 'licenseNumber already exists' });
    }

    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update driver' : error.message;
    return res.status(status).json({ message });
  }
};

exports.toggleDriverActive = async (req, res) => {
  try {
    const driver = await Driver.findById(req.params.id);
    if (!driver) {
      return res.status(404).json({ message: 'Driver not found' });
    }

    assertBranchInScope(req.user, String(driver.branchId), 'Driver does not belong to your branch scope');

    const requestedValue = req.body?.isActive;
    const nextActiveState =
      requestedValue === undefined ? !Boolean(driver.isActive) : parseBooleanInput(requestedValue, Boolean(driver.isActive));

    if (!nextActiveState && normalizeAvailabilityStatus(driver.availabilityStatus) === DRIVER_AVAILABILITY.ASSIGNED) {
      return res.status(422).json({ message: 'Cannot deactivate driver while assigned to a booking' });
    }

    driver.isActive = nextActiveState;
    if (!nextActiveState) {
      driver.currentAssignedBooking = null;
      driver.availabilityStatus = DRIVER_AVAILABILITY.INACTIVE;
    } else {
      driver.availabilityStatus = driver.currentAssignedBooking
        ? DRIVER_AVAILABILITY.ASSIGNED
        : DRIVER_AVAILABILITY.AVAILABLE;
    }

    await driver.save();

    queueAuditLog({
      userId: req.user?._id,
      actionType: 'DRIVER_TOGGLED_ACTIVE',
      targetEntity: 'Driver',
      targetId: String(driver._id),
      meta: {
        isActive: Boolean(driver.isActive),
        availabilityStatus: driver.availabilityStatus,
      },
    });

    return res.json({
      message: driver.isActive ? 'Driver activated' : 'Driver deactivated',
      driver: normalizeDriverForClient(driver.toObject()),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update driver status' : error.message;
    return res.status(status).json({ message });
  }
};

exports.assignDriver = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId).select(
      '_id user car branchId bookingStatus rentalStage tripStatus assignedDriver driverAssignedAt',
    );
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingScope(req.user, booking, 'Booking does not belong to your branch scope');

    const driverId = String(req.body?.driverId || '').trim();
    if (!driverId) {
      return res.status(422).json({ message: 'driverId is required' });
    }

    const assignment = await assignDriverToBooking(booking, driverId, { now: new Date() });

    queueAuditLog({
      userId: req.user?._id,
      actionType: 'DRIVER_ASSIGNED',
      targetEntity: 'Booking',
      targetId: String(booking._id),
      meta: {
        driverId: String(assignment?.driver?._id || driverId),
        previousDriverId: String(assignment?.previousDriverId || ''),
      },
    });

    const freshBooking = await Booking.findById(booking._id)
      .populate('branchId', 'branchName branchCode isActive')
      .populate('car', 'name brand model image location')
      .populate('user', 'firstName lastName email')
      .populate('assignedDriver', 'driverName phoneNumber licenseNumber licenseExpiry availabilityStatus isActive branchId')
      .lean();

    return res.json({
      message: assignment?.previousDriverId ? 'Driver changed successfully' : 'Driver assigned successfully',
      booking: freshBooking,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to assign driver' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getDriverSuggestions = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId).select(
      '_id user car branchId bookingStatus rentalStage tripStatus assignedDriver',
    );
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingScope(req.user, booking, 'Booking does not belong to your branch scope');

    const resolvedBranchId = await resolveBookingBranchId(booking);
    if (resolvedBranchId) {
      assertBranchInScope(req.user, resolvedBranchId, 'Booking does not belong to your branch scope');
    }

    const { suggestions } = await suggestDriversForBooking(booking);
    const now = new Date();

    return res.json({
      bookingId: String(booking._id),
      branchId: resolvedBranchId || '',
      suggestions: suggestions.map((driver) => normalizeDriverForClient(driver, now)),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load driver suggestions' : error.message;
    return res.status(status).json({ message });
  }
};
