const Offer = require('../models/Offer');
const Car = require('../models/Car');
const Request = require('../models/Request');
const { calculateAdvanceBreakdown, isAdvancePaidStatus } = require('../utils/paymentUtils');
const { normalizeFleetStatus, isFleetBookable, FLEET_STATUS } = require('../utils/fleetStatus');
const { tryReserveCar, updateCarFleetStatus, releaseCarIfUnblocked } = require('../services/fleetService');
const { syncCarFleetStatusFromMaintenance } = require('../services/maintenanceService');
const { assertCarBranchActive } = require('../services/branchService');
const { applyCarScopeToQuery, assertCarInScope } = require('../services/adminScopeService');
const mongoose = require('mongoose');
const { queuePendingPaymentEmailForRequest } = require('../services/bookingEmailNotificationService');
const { resolveSmartPriceForCar, buildPricingAmounts } = require('../services/smartPricingService');
const {
  normalizeStoredDateTime,
  validateRentalWindow,
  calculateTimeBasedRentalAmount,
  getTimeBasedBillingDays,
} = require('../utils/rentalDateUtils');
const { isStaffRole } = require('../utils/rbac');

const MAX_OFFER_ATTEMPTS = 3;
const TERMINAL_STATUSES = new Set(['accepted', 'rejected', 'expired']);

const isTerminalStatus = (status) => TERMINAL_STATUSES.has(status);

const roundCurrency = (value) => {
  const numericValue = Number(value || 0);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(2));
};

const resolveObjectId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (mongoose.isValidObjectId(value)) return String(value);
  if (value._id && mongoose.isValidObjectId(value._id)) return String(value._id);
  return '';
};

const normalizeUserOfferHistory = (offer) => {
  const history = Array.isArray(offer.userOfferHistory) ? [...offer.userOfferHistory] : [];
  const cleaned = history.filter((value) => Number.isFinite(Number(value)) && Number(value) > 0).map(Number);

  if (cleaned.length === 0) {
    const initial = Number(offer.offeredPrice);
    if (Number.isFinite(initial) && initial > 0) {
      cleaned.push(initial);
    }
  }

  return cleaned.slice(0, MAX_OFFER_ATTEMPTS);
};

const createFinalApprovalRequestFromOffer = async (offer) => {
  const finalAmount = Number(offer.counterPrice ?? offer.offeredPrice);
  if (!Number.isFinite(finalAmount) || finalAmount <= 0) {
    return { error: { status: 422, message: 'Final offer amount is invalid' } };
  }

  const carId = resolveObjectId(offer.car);
  const userId = resolveObjectId(offer.user);
  if (!mongoose.isValidObjectId(carId) || !mongoose.isValidObjectId(userId)) {
    return { error: { status: 422, message: 'Offer references are invalid' } };
  }

  const normalizedPickupDateTime = normalizeStoredDateTime(offer.fromDate);
  const normalizedDropDateTime = normalizeStoredDateTime(offer.toDate, {
    treatMidnightAsDropBoundary: true,
  });
  const rentalWindowError = validateRentalWindow(normalizedPickupDateTime, normalizedDropDateTime, {
    minDurationHours: 1,
    now: new Date(),
  });
  if (rentalWindowError) {
    return { error: { status: 422, message: rentalWindowError } };
  }

  const existingPendingRequest = await Request.findOne({
    user: userId,
    car: carId,
    fromDate: normalizedPickupDateTime,
    toDate: normalizedDropDateTime,
    status: 'pending',
  });

  const car = await Car.findById(carId);
  if (!car) {
    return { error: { status: 404, message: 'Car not found' } };
  }

  const syncResult = await syncCarFleetStatusFromMaintenance(car._id, { now: new Date() });
  const activeCar = syncResult?.car || car;

  const fleetStatus = normalizeFleetStatus(
    activeCar.fleetStatus,
    activeCar.isAvailable === false ? FLEET_STATUS.INACTIVE : FLEET_STATUS.AVAILABLE,
  );
  const { branch } = await assertCarBranchActive(activeCar, 'Vehicle temporarily unavailable');
  const isHardUnavailable = [FLEET_STATUS.MAINTENANCE, FLEET_STATUS.INACTIVE, FLEET_STATUS.RENTED].includes(fleetStatus);
  if (isHardUnavailable) {
    return {
      error: {
        status: 422,
        message: fleetStatus === FLEET_STATUS.MAINTENANCE ? 'Vehicle under maintenance' : 'Vehicle temporarily unavailable',
      },
    };
  }

  if (!existingPendingRequest && !isFleetBookable(fleetStatus)) {
    return { error: { status: 422, message: 'Car is no longer available' } };
  }

  const days = getTimeBasedBillingDays(normalizedPickupDateTime, normalizedDropDateTime);
  if (!Number.isFinite(days) || days <= 0) {
    return { error: { status: 422, message: 'Invalid booking duration' } };
  }
  const pricingSnapshot = await resolveSmartPriceForCar(activeCar, {
    now: new Date(),
    persist: true,
    branchId: branch?._id || activeCar?.branchId,
  });
  const dynamicLockedPerDayPrice = Number(pricingSnapshot?.effectivePricePerDay || activeCar?.pricePerDay || 0);
  const basePerDayPrice = Number(pricingSnapshot?.basePricePerDay || activeCar?.pricePerDay || 0);
  const lockedPerDayFromOffer = days > 0 ? roundCurrency(finalAmount / days) : dynamicLockedPerDayPrice;
  const pricingAmounts = buildPricingAmounts({
    basePerDayPrice,
    lockedPerDayPrice: lockedPerDayFromOffer,
    billingDays: days,
  });
  const breakdown = calculateAdvanceBreakdown(finalAmount);

  const lockedBargain = {
    userAttempts: offer.offerCount,
    userPrice: finalAmount,
    adminCounterPrice: offer.counterPrice,
    status: 'LOCKED',
  };

  if (existingPendingRequest) {
    const previousTotal = Number(existingPendingRequest.finalAmount || existingPendingRequest.totalAmount || 0);
    const previousAdvance = Number(
      existingPendingRequest.advanceRequired || existingPendingRequest.advanceAmount || 0,
    );
    const shouldKeepPaidState =
      isAdvancePaidStatus(existingPendingRequest.paymentStatus) &&
      previousTotal === finalAmount &&
      previousAdvance === breakdown.advanceRequired;

    existingPendingRequest.days = days;
    existingPendingRequest.fromDate = normalizedPickupDateTime;
    existingPendingRequest.toDate = normalizedDropDateTime;
    existingPendingRequest.pickupDateTime = normalizedPickupDateTime;
    existingPendingRequest.dropDateTime = normalizedDropDateTime;
    existingPendingRequest.gracePeriodHours = 1;
    existingPendingRequest.branchId = existingPendingRequest.branchId || branch?._id || null;
    existingPendingRequest.totalAmount = breakdown.finalAmount;
    existingPendingRequest.lockedPerDayPrice = pricingAmounts.lockedPerDayPrice;
    existingPendingRequest.basePerDayPrice = pricingAmounts.basePerDayPrice;
    existingPendingRequest.pricingBaseAmount = pricingAmounts.pricingBaseAmount;
    existingPendingRequest.pricingLockedAmount = roundCurrency(finalAmount);
    existingPendingRequest.priceSource = pricingSnapshot?.priceSource || 'Base';
    existingPendingRequest.priceAdjustmentPercent = Number(pricingSnapshot?.priceAdjustmentPercent || 0);
    existingPendingRequest.finalAmount = breakdown.finalAmount;
    existingPendingRequest.advanceAmount = breakdown.advanceRequired;
    existingPendingRequest.advanceRequired = breakdown.advanceRequired;
    existingPendingRequest.bargain = lockedBargain;
    if (!shouldKeepPaidState) {
      existingPendingRequest.paymentStatus = 'UNPAID';
      existingPendingRequest.paymentMethod = 'NONE';
      existingPendingRequest.paymentReference = '';
      existingPendingRequest.advancePaidAt = null;
      existingPendingRequest.advancePaid = 0;
      existingPendingRequest.remainingAmount = breakdown.remainingAmount;
    } else {
      existingPendingRequest.advancePaid = breakdown.advanceRequired;
      existingPendingRequest.remainingAmount = breakdown.remainingAmount;
    }
    await existingPendingRequest.save();
    await updateCarFleetStatus(carId, FLEET_STATUS.RESERVED);
    if (!shouldKeepPaidState) {
      queuePendingPaymentEmailForRequest(existingPendingRequest);
    }

    return { request: existingPendingRequest, finalAmount };
  }

  const reservedCar = await tryReserveCar(carId);
  if (!reservedCar) {
    return { error: { status: 409, message: 'Vehicle just became unavailable. Please try again.' } };
  }

  let request;
  try {
    request = await Request.create({
      user: userId,
      car: carId,
      branchId: branch?._id || null,
      fromDate: normalizedPickupDateTime,
      toDate: normalizedDropDateTime,
      pickupDateTime: normalizedPickupDateTime,
      dropDateTime: normalizedDropDateTime,
      gracePeriodHours: 1,
      days,
      totalAmount: breakdown.finalAmount,
      lockedPerDayPrice: pricingAmounts.lockedPerDayPrice,
      basePerDayPrice: pricingAmounts.basePerDayPrice,
      pricingBaseAmount: pricingAmounts.pricingBaseAmount,
      pricingLockedAmount: roundCurrency(finalAmount),
      priceSource: pricingSnapshot?.priceSource || 'Base',
      priceAdjustmentPercent: Number(pricingSnapshot?.priceAdjustmentPercent || 0),
      finalAmount: breakdown.finalAmount,
      advanceAmount: breakdown.advanceRequired,
      advanceRequired: breakdown.advanceRequired,
      advancePaid: 0,
      remainingAmount: breakdown.remainingAmount,
      paymentStatus: 'UNPAID',
      paymentMethod: 'NONE',
      bargain: lockedBargain,
      status: 'pending',
    });
  } catch (requestCreationError) {
    await releaseCarIfUnblocked(carId);
    throw requestCreationError;
  }
  queuePendingPaymentEmailForRequest(request);

  return { request, finalAmount };
};

exports.createOffer = async (req, res) => {
  try {
    if (isStaffRole(req.user?.role)) {
      return res.status(403).json({ message: 'Staff can view cars but cannot create rental offers' });
    }

    const { carId, offeredPrice, message, fromDate, toDate } = req.body;
    const car = await Car.findById(carId);

    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const syncResult = await syncCarFleetStatusFromMaintenance(car._id, { now: new Date() });
    const activeCar = syncResult?.car || car;
    const fleetStatus = normalizeFleetStatus(
      activeCar.fleetStatus,
      activeCar.isAvailable === false ? FLEET_STATUS.INACTIVE : FLEET_STATUS.AVAILABLE,
    );
    await assertCarBranchActive(activeCar, 'Vehicle temporarily unavailable');
    if (!isFleetBookable(fleetStatus)) {
      return res.status(422).json({
        message: fleetStatus === FLEET_STATUS.MAINTENANCE ? 'Vehicle under maintenance' : 'Vehicle temporarily unavailable',
      });
    }

    const pricingSnapshot = await resolveSmartPriceForCar(activeCar, {
      now: new Date(),
      persist: true,
      branchId: activeCar?.branchId,
    });
    const effectivePerDayPrice = Number(pricingSnapshot?.effectivePricePerDay || activeCar?.pricePerDay || 0);

    const { days, amount: originalPrice } = calculateTimeBasedRentalAmount(fromDate, toDate, effectivePerDayPrice);
    if (!Number.isFinite(days) || days <= 0) {
      return res.status(422).json({ message: 'Invalid booking duration' });
    }

    const existingOpenOffer = await Offer.findOne({
      car: carId,
      user: req.user._id,
      fromDate,
      toDate,
      status: { $in: ['pending', 'countered'] },
    });

    if (existingOpenOffer) {
      return res.status(422).json({ message: 'An active offer already exists for this booking period' });
    }

    const offer = await Offer.create({
      car: carId,
      user: req.user._id,
      originalPrice,
      offeredPrice,
      userOfferHistory: [offeredPrice],
      message,
      status: 'pending',
      offerCount: 1,
      fromDate,
      toDate,
    });

    return res.status(201).json({ message: 'Offer created', offer });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to create offer' });
  }
};

exports.getMyOffers = async (req, res) => {
  try {
    const offers = await Offer.find({
      user: req.user._id,
      status: { $in: ['pending', 'countered'] },
    })
      .populate('car')
      .sort({ createdAt: -1 });

    return res.json(offers);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load offers' });
  }
};

exports.respondToCounterOffer = async (req, res) => {
  try {
    const { action, offeredPrice, message } = req.body;
    const offer = await Offer.findById(req.params.id);

    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (String(offer.user) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    if (isTerminalStatus(offer.status)) {
      return res.status(422).json({ message: `Offer already ${offer.status}` });
    }

    if (action === 'accept') {
      if (offer.status !== 'countered') {
        return res.status(422).json({ message: 'Offer can be accepted only after admin counter' });
      }

      const { request, finalAmount, error } = await createFinalApprovalRequestFromOffer(offer);
      if (error) {
        return res.status(error.status).json({ message: error.message });
      }

      offer.status = 'accepted';
      offer.offeredPrice = finalAmount;
      await offer.save();

      return res.json({
        message: 'Counter accepted. Please pay advance in your booking requests for final admin approval.',
        offer,
        request,
      });
    }

    if (action === 'reject') {
      offer.status = 'rejected';
      if (message) {
        offer.message = message;
      }
      await offer.save();
      return res.json({ message: 'Offer rejected', offer });
    }

    if (offer.status !== 'countered') {
      return res.status(422).json({ message: 'You can counter only a countered offer' });
    }

    const normalizedOfferedPrice = Number(offeredPrice);
    if (!Number.isFinite(normalizedOfferedPrice) || normalizedOfferedPrice <= 0) {
      return res.status(422).json({ message: 'offeredPrice must be a positive number for counter action' });
    }

    const history = normalizeUserOfferHistory(offer);
    if (history.length >= MAX_OFFER_ATTEMPTS) {
      return res.status(422).json({
        message: 'Maximum of 3 user offers reached. You can only accept or reject this final counter price.',
      });
    }

    offer.offeredPrice = normalizedOfferedPrice;
    history.push(normalizedOfferedPrice);
    offer.userOfferHistory = history;
    offer.message = message || offer.message;
    offer.status = 'pending';
    offer.offerCount = history.length;
    await offer.save();

    return res.json({ message: 'Counter offer submitted', offer });
  } catch (error) {
    console.error('respondToCounterOffer error:', error);
    const status = Number(error?.status || error?.statusCode) || 500;
    const safeMessage = status >= 500 ? 'Failed to respond to offer' : (error?.message || 'Offer response failed');
    return res.status(status).json({ message: safeMessage });
  }
};

exports.getAllOffers = async (req, res) => {
  try {
    const query = await applyCarScopeToQuery(req.user, {});
    const offers = await Offer.find(query)
      .populate('car')
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 });

    return res.json(offers);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load offers' });
  }
};

exports.acceptOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    await assertCarInScope(req.user, offer.car, 'Offer does not belong to your branch scope');

    if (isTerminalStatus(offer.status)) {
      return res.status(422).json({ message: `Offer already ${offer.status}` });
    }

    const { request, finalAmount, error } = await createFinalApprovalRequestFromOffer(offer);
    if (error) {
      return res.status(error.status).json({ message: error.message });
    }

    offer.status = 'accepted';
    offer.offeredPrice = finalAmount;
    await offer.save();

    return res.json({
      message: 'Offer accepted. User must pay advance before final admin approval.',
      offer,
      request,
    });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to accept offer' });
  }
};

exports.rejectOffer = async (req, res) => {
  try {
    const offer = await Offer.findById(req.params.id);
    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    await assertCarInScope(req.user, offer.car, 'Offer does not belong to your branch scope');

    if (isTerminalStatus(offer.status)) {
      return res.status(422).json({ message: `Offer already ${offer.status}` });
    }

    offer.status = 'rejected';
    await offer.save();

    return res.json({ message: 'Offer rejected', offer });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to reject offer' });
  }
};

exports.deleteOffer = async (req, res) => {
  try {
    const existingOffer = await Offer.findById(req.params.id);
    if (!existingOffer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    await assertCarInScope(req.user, existingOffer.car, 'Offer does not belong to your branch scope');
    await existingOffer.deleteOne();

    return res.json({ message: 'Offer deleted successfully' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete offer' });
  }
};

exports.counterOffer = async (req, res) => {
  try {
    const { counterPrice, message } = req.body;
    const offer = await Offer.findById(req.params.id);

    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    await assertCarInScope(req.user, offer.car, 'Offer does not belong to your branch scope');

    if (isTerminalStatus(offer.status)) {
      return res.status(422).json({ message: `Offer already ${offer.status}` });
    }

    if (offer.status !== 'pending') {
      return res.status(422).json({ message: 'Only pending offers can be countered' });
    }

    offer.counterPrice = counterPrice;
    offer.message = message || offer.message;
    offer.status = 'countered';
    await offer.save();

    return res.json({ message: 'Counter offer sent', offer });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to counter offer' });
  }
};
