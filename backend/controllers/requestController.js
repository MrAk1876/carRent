const mongoose = require('mongoose');
const Request = require('../models/Request');
const Booking = require('../models/Booking');
const Car = require('../models/Car');
const {
  calculateAdvanceBreakdown,
  resolveFinalAmount,
  isAdvancePaidStatus,
} = require('../utils/paymentUtils');
const { resolveAvailabilityConflict } = require('../services/conflictResolver');
const {
  parseDateTimeInput,
  validateRentalWindow,
  calculateTimeBasedRentalAmount,
  calculateRentalDaysByCalendar,
  normalizeRentalDaysValue,
  calculateFixedDropDateTime,
  resolveRentalDaysForFixedDrop,
  MIN_RENTAL_DAYS,
  MAX_RENTAL_DAYS,
} = require('../utils/rentalDateUtils');
const { resolveSmartPriceForCar, buildPricingAmounts } = require('../services/smartPricingService');
const { normalizeFleetStatus, isFleetBookable, FLEET_STATUS } = require('../utils/fleetStatus');
const { isStaffRole } = require('../utils/rbac');
const { syncCarFleetStatusFromMaintenance } = require('../services/maintenanceService');
const { assertCarBranchActive } = require('../services/branchService');
const {
  buildSubscriptionPricingForRequest,
  reserveSubscriptionUsageForRequest,
  rollbackSubscriptionUsageReservation,
  appendSubscriptionUsageHistory,
  normalizeRentalType,
  normalizeBoolean,
} = require('../services/subscriptionService');
const {
  queuePendingPaymentEmailForRequest,
  queueAdvancePaidConfirmationEmail,
} = require('../services/bookingEmailNotificationService');
const { resolveDepositForCar } = require('../services/depositRuleService');

const ALLOWED_PAYMENT_METHODS = new Set(['CARD', 'UPI', 'NETBANKING', 'CASH']);
const MIN_RENTAL_DURATION_HOURS = 1;

exports.createRequest = async (req, res) => {
  try {
    if (isStaffRole(req.user?.role)) {
      return res.status(403).json({ message: 'Staff can view cars but cannot create rental bookings' });
    }

    const {
      carId,
      fromDate,
      toDate,
      pickupDateTime,
      dropDateTime,
      rentalDays,
      gracePeriodHours,
      bargainPrice,
      useSubscription,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(carId)) {
      return res.status(400).json({ message: 'Invalid car ID' });
    }

    const pickupInput = pickupDateTime || fromDate;
    const normalizedPickupDateTime = parseDateTimeInput(pickupInput);
    const dropInput = dropDateTime || toDate;
    const legacyDropDateTime = parseDateTimeInput(dropInput, { treatDateOnlyAsDropBoundary: true });
    const normalizedRentalDays = resolveRentalDaysForFixedDrop({
      rentalDays,
      pickupDateTime: normalizedPickupDateTime,
      dropDateTime: legacyDropDateTime,
      min: MIN_RENTAL_DAYS,
      max: MAX_RENTAL_DAYS,
    });

    if (!normalizedRentalDays) {
      return res.status(400).json({
        message: `rentalDays must be between ${MIN_RENTAL_DAYS} and ${MAX_RENTAL_DAYS}`,
      });
    }

    const normalizedDropDateTime = calculateFixedDropDateTime(normalizedPickupDateTime, normalizedRentalDays);

    const rentalWindowError = validateRentalWindow(normalizedPickupDateTime, normalizedDropDateTime, {
      minDurationHours: MIN_RENTAL_DURATION_HOURS,
      now: new Date(),
    });
    if (rentalWindowError) {
      return res.status(400).json({ message: rentalWindowError });
    }

    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const syncResult = await syncCarFleetStatusFromMaintenance(car._id, { now: new Date() });
    const activeCar = syncResult?.car || car;
    const currentFleetStatus = normalizeFleetStatus(
      activeCar.fleetStatus,
      activeCar.isAvailable === false ? FLEET_STATUS.INACTIVE : FLEET_STATUS.AVAILABLE,
    );
    const { branch } = await assertCarBranchActive(activeCar, 'Vehicle temporarily unavailable');
    if (!isFleetBookable(currentFleetStatus)) {
      return res.status(422).json({
        message:
          currentFleetStatus === FLEET_STATUS.MAINTENANCE
            ? 'Vehicle under maintenance'
            : 'Vehicle temporarily unavailable',
      });
    }

    const existingPendingRequest = await Request.findOne({
      user: req.user._id,
      car: carId,
      status: 'pending',
    })
      .select('_id')
      .lean();
    if (existingPendingRequest?._id) {
      return res.status(422).json({ message: 'You already have a pending request for this vehicle' });
    }

    const availabilityConflict = await resolveAvailabilityConflict({
      carId,
      startDate: normalizedPickupDateTime,
      endDate: normalizedDropDateTime,
    });
    if (!availabilityConflict.valid) {
      return res.status(422).json({
        message: 'Selected dates are already booked or blocked.',
        conflictReason: availabilityConflict.conflictReason || '',
        conflictingDates: availabilityConflict.primaryConflictDates || availabilityConflict.conflictingDates || [],
      });
    }

    const pricingSnapshot = await resolveSmartPriceForCar(activeCar, {
      now: new Date(),
      persist: true,
      branchId: branch?._id || activeCar?.branchId,
    });
    const lockedPerDayPrice = Number(pricingSnapshot?.effectivePricePerDay || activeCar?.pricePerDay || 0);
    const basePerDayPrice = Number(pricingSnapshot?.basePricePerDay || activeCar?.pricePerDay || 0);
    const depositInfo = await resolveDepositForCar({
      car: activeCar,
      perDayPrice: lockedPerDayPrice,
    });

    const { days, amount: baseAmount } = calculateTimeBasedRentalAmount(
      normalizedPickupDateTime,
      normalizedDropDateTime,
      lockedPerDayPrice,
    );
    const pricingAmounts = buildPricingAmounts({
      basePerDayPrice,
      lockedPerDayPrice,
      billingDays: days,
    });

    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json({ message: 'Invalid booking duration' });
    }

    const wantsSubscription = normalizeBoolean(useSubscription, false);
    if (wantsSubscription && bargainPrice !== undefined && bargainPrice !== null && bargainPrice !== '') {
      return res.status(422).json({ message: 'Negotiation and subscription mode cannot be used together' });
    }

    let computedFinalAmount = baseAmount;
    const normalizedGracePeriodHoursInput = Number(gracePeriodHours);
    const normalizedGracePeriodHours =
      Number.isFinite(normalizedGracePeriodHoursInput) && normalizedGracePeriodHoursInput >= 0
        ? normalizedGracePeriodHoursInput
        : 1;

    const requestData = {
      user: req.user._id,
      car: carId,
      branchId: branch?._id || null,
      fromDate: normalizedPickupDateTime,
      toDate: normalizedDropDateTime,
      pickupDateTime: normalizedPickupDateTime,
      dropDateTime: normalizedDropDateTime,
      rentalDays: normalizedRentalDays,
      gracePeriodHours: normalizedGracePeriodHours,
      days,
      priceRangeType: depositInfo.rangeType,
      depositAmount: depositInfo.depositAmount,
      depositRuleId: depositInfo.ruleId || null,
      totalAmount: baseAmount,
      lockedPerDayPrice: pricingAmounts.lockedPerDayPrice,
      basePerDayPrice: pricingAmounts.basePerDayPrice,
      pricingBaseAmount: pricingAmounts.pricingBaseAmount,
      pricingLockedAmount: pricingAmounts.pricingLockedAmount,
      priceSource: pricingSnapshot?.priceSource || 'Base',
      priceAdjustmentPercent: Number(pricingSnapshot?.priceAdjustmentPercent || 0),
      finalAmount: baseAmount,
      advanceAmount: 0,
      advanceRequired: 0,
      advancePaid: 0,
      remainingAmount: 0,
      paymentStatus: 'UNPAID',
      paymentMethod: 'NONE',
      status: 'pending',
      rentalType: 'OneTime',
      subscriptionPlanId: null,
      userSubscriptionId: null,
      subscriptionBaseAmount: baseAmount,
      subscriptionHoursUsed: 0,
      subscriptionCoverageAmount: 0,
      subscriptionExtraAmount: baseAmount,
      subscriptionLateFeeDiscountPercentage: 0,
      subscriptionDamageFeeDiscountPercentage: 0,
    };

    if (wantsSubscription) {
      const subscriptionPricing = await buildSubscriptionPricingForRequest({
        userId: req.user?._id,
        branchId: branch?._id || null,
        pickupDateTime: normalizedPickupDateTime,
        dropDateTime: normalizedDropDateTime,
        baseAmount,
        useSubscription: true,
        now: new Date(),
      });

      computedFinalAmount = subscriptionPricing.finalAmount;
      requestData.rentalType = normalizeRentalType(subscriptionPricing.rentalType, 'Subscription');
      requestData.subscriptionPlanId = subscriptionPricing.subscriptionPlanId || null;
      requestData.userSubscriptionId = subscriptionPricing.userSubscriptionId || null;
      requestData.subscriptionBaseAmount = subscriptionPricing.subscriptionBaseAmount || baseAmount;
      requestData.subscriptionHoursUsed = subscriptionPricing.subscriptionHoursUsed || 0;
      requestData.subscriptionCoverageAmount = subscriptionPricing.subscriptionCoverageAmount || 0;
      requestData.subscriptionExtraAmount = subscriptionPricing.subscriptionExtraAmount || computedFinalAmount;
      requestData.subscriptionLateFeeDiscountPercentage =
        subscriptionPricing.subscriptionLateFeeDiscountPercentage || 0;
      requestData.subscriptionDamageFeeDiscountPercentage =
        subscriptionPricing.subscriptionDamageFeeDiscountPercentage || 0;
    } else if (bargainPrice !== undefined && bargainPrice !== null && bargainPrice !== '') {
      const normalizedPrice = Number(bargainPrice);
      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        return res.status(400).json({ message: 'Invalid bargain price' });
      }
      computedFinalAmount = normalizedPrice;
      requestData.bargain = {
        userPrice: normalizedPrice,
        userAttempts: 1,
        status: 'USER_OFFERED',
      };
    }

    const breakdown = calculateAdvanceBreakdown(computedFinalAmount);
    const resolvedDepositAmount = Number.isFinite(Number(requestData.depositAmount))
      ? Math.max(Number(requestData.depositAmount), 0)
      : 0;
    const effectiveAdvanceRequired = Math.max(Number(breakdown.advanceRequired || 0), resolvedDepositAmount);
    const effectiveRemainingAmount = Math.max(Number(breakdown.finalAmount || 0) - effectiveAdvanceRequired, 0);
    requestData.totalAmount = breakdown.finalAmount;
    requestData.finalAmount = breakdown.finalAmount;
    requestData.advanceAmount = effectiveAdvanceRequired;
    requestData.advanceRequired = effectiveAdvanceRequired;
    requestData.advancePaid = 0;
    requestData.remainingAmount = effectiveRemainingAmount;

    const request = await Request.create(requestData);

    queuePendingPaymentEmailForRequest(request);

    return res.status(201).json({
      message: 'Booking request created. Pay advance to confirm your booking.',
      request,
    });
  } catch (err) {
    console.error(err);
    const status = Number(err?.status || 400);
    return res.status(status).json({ message: err.message });
  }
};

exports.payAdvance = async (req, res) => {
  let subscriptionReservation = null;
  try {
    if (isStaffRole(req.user?.role)) {
      return res.status(403).json({ message: 'Staff cannot pay advance for rental bookings' });
    }

    const { id } = req.params;
    const paymentMethod = String(req.body.paymentMethod || '').trim().toUpperCase();
    const paymentOptionInput = String(req.body?.paymentOption || '').trim().toUpperCase();
    const paymentOption = paymentOptionInput === 'FULL'
      ? 'FULL'
      : paymentOptionInput === 'DEPOSIT_ONLY'
        ? 'DEPOSIT_ONLY'
        : 'ADVANCE_POLICY';

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    const request = await Request.findById(id).populate('car');
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    if (request.status !== 'pending') {
      return res.status(422).json({ message: 'Only pending requests can be paid' });
    }

    if (isAdvancePaidStatus(request.paymentStatus)) {
      return res.status(422).json({ message: 'Advance is already paid for this request' });
    }

    if (!request.car) {
      return res.status(422).json({ message: 'Car is no longer available' });
    }

    const syncResult = await syncCarFleetStatusFromMaintenance(request.car._id || request.car, { now: new Date() });
    const activeCar = syncResult?.car || request.car;
    const fleetStatus = normalizeFleetStatus(
      activeCar.fleetStatus,
      activeCar.isAvailable === false ? FLEET_STATUS.INACTIVE : FLEET_STATUS.AVAILABLE,
    );
    const { branch } = await assertCarBranchActive(activeCar, 'Vehicle temporarily unavailable');
    if (![FLEET_STATUS.AVAILABLE, FLEET_STATUS.RESERVED].includes(fleetStatus)) {
      return res.status(422).json({
        message: fleetStatus === FLEET_STATUS.MAINTENANCE ? 'Vehicle under maintenance' : 'Vehicle temporarily unavailable',
      });
    }

    const { pricing: confirmedPricing, reservation } = await reserveSubscriptionUsageForRequest(request, {
      now: new Date(),
    });
    subscriptionReservation = reservation;
    const finalAmount = Number(confirmedPricing?.finalAmount || resolveFinalAmount(request) || 0);
    const breakdown = calculateAdvanceBreakdown(finalAmount);
    const resolvedDepositAmount = Number.isFinite(Number(request.depositAmount))
      ? Math.max(Number(request.depositAmount), 0)
      : 0;
    const totalRentalAmount = Math.max(Number(breakdown.finalAmount || 0), 0);
    const totalPayableNow = Number((totalRentalAmount + resolvedDepositAmount).toFixed(2));

    let effectiveAdvanceRequired = Math.max(Number(breakdown.advanceRequired || 0), resolvedDepositAmount);
    let effectiveRemainingAmount = Math.max(totalRentalAmount - effectiveAdvanceRequired, 0);
    let effectivePaymentStatus = 'Partially Paid';
    let fullPaymentAmount = effectiveRemainingAmount;
    let fullPaymentMethod = 'NONE';
    let fullPaymentReceivedAt = null;
    let amountPaid = effectiveAdvanceRequired;
    let amountRemaining = effectiveRemainingAmount;

    if (paymentOption === 'DEPOSIT_ONLY') {
      effectiveAdvanceRequired = resolvedDepositAmount;
      effectiveRemainingAmount = totalRentalAmount;
      fullPaymentAmount = totalRentalAmount;
      amountPaid = resolvedDepositAmount;
      amountRemaining = totalRentalAmount;
    } else if (paymentOption === 'FULL') {
      effectiveAdvanceRequired = resolvedDepositAmount;
      effectiveRemainingAmount = 0;
      effectivePaymentStatus = 'Fully Paid';
      fullPaymentAmount = totalRentalAmount;
      fullPaymentMethod = paymentMethod;
      fullPaymentReceivedAt = new Date();
      amountPaid = totalPayableNow;
      amountRemaining = 0;
    }

    const requiresPaymentMethod = (paymentOption === 'FULL' ? totalPayableNow : effectiveAdvanceRequired) > 0;
    if (requiresPaymentMethod && !ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
      if (subscriptionReservation?.coveredHours > 0) {
        await rollbackSubscriptionUsageReservation(subscriptionReservation);
        subscriptionReservation = null;
      }
      return res.status(422).json({ message: 'paymentMethod must be CARD, UPI, NETBANKING, or CASH' });
    }

    const normalizedPaymentMethod =
      requiresPaymentMethod
        ? paymentMethod
        : ALLOWED_PAYMENT_METHODS.has(paymentMethod)
          ? paymentMethod
          : 'NONE';

    let finalBargain;
    if (request.bargain && request.bargain.status && request.bargain.status !== 'NONE') {
      finalBargain = {
        ...request.bargain.toObject(),
        status: 'LOCKED',
      };
    }

    const booking = await Booking.create({
      user: request.user,
      car: request.car._id,
      branchId: request.branchId || branch?._id || null,
      fromDate: request.fromDate,
      toDate: request.toDate,
      pickupDateTime: request.pickupDateTime || request.fromDate,
      dropDateTime: request.dropDateTime || request.toDate,
      rentalDays:
        normalizeRentalDaysValue(request.rentalDays, { min: 1, max: 3650, allowNull: true }) ||
        normalizeRentalDaysValue(
          calculateRentalDaysByCalendar(request.pickupDateTime || request.fromDate, request.dropDateTime || request.toDate),
          { min: 1, max: 3650, allowNull: true },
        ) ||
        1,
      priceRangeType: String(request.priceRangeType || '').trim() || 'LOW_RANGE',
      depositAmount: Number.isFinite(Number(request.depositAmount))
        ? Math.max(Number(request.depositAmount), 0)
        : 0,
      depositPaid: Number.isFinite(Number(request.depositAmount))
        ? Math.max(Number(request.depositAmount), 0)
        : 0,
      depositRefunded: 0,
      depositDeducted: 0,
      depositStatus: Number.isFinite(Number(request.depositAmount)) && Number(request.depositAmount) > 0
        ? 'HELD'
        : 'NOT_APPLICABLE',
      actualPickupTime: null,
      actualReturnTime: null,
      gracePeriodHours: Number.isFinite(Number(request.gracePeriodHours))
        ? Math.max(Number(request.gracePeriodHours), 0)
        : 1,
      rentalStage: 'Scheduled',
      totalAmount: breakdown.finalAmount,
      lockedPerDayPrice: Number(request?.lockedPerDayPrice || 0),
      basePerDayPrice: Number(request?.basePerDayPrice || 0),
      pricingBaseAmount: Number(request?.pricingBaseAmount || 0),
      pricingLockedAmount: Number(request?.pricingLockedAmount || 0),
      priceSource: request?.priceSource || 'Base',
      priceAdjustmentPercent: Number(request?.priceAdjustmentPercent || 0),
      finalAmount: breakdown.finalAmount,
      totalRentalAmount,
      advanceAmount: effectiveAdvanceRequired,
      advanceRequired: effectiveAdvanceRequired,
      advancePaid: effectiveAdvanceRequired,
      remainingAmount: effectiveRemainingAmount,
      amountPaid,
      amountRemaining,
      rentalType: confirmedPricing?.rentalType || normalizeRentalType(request?.rentalType, 'OneTime'),
      subscriptionPlanId: confirmedPricing?.subscriptionPlanId || request?.subscriptionPlanId || null,
      userSubscriptionId: confirmedPricing?.userSubscriptionId || request?.userSubscriptionId || null,
      subscriptionBaseAmount: confirmedPricing?.subscriptionBaseAmount || request?.subscriptionBaseAmount || breakdown.finalAmount,
      subscriptionHoursUsed: confirmedPricing?.subscriptionHoursUsed || 0,
      subscriptionCoverageAmount: confirmedPricing?.subscriptionCoverageAmount || 0,
      subscriptionExtraAmount: confirmedPricing?.subscriptionExtraAmount || breakdown.finalAmount,
      subscriptionLateFeeDiscountPercentage: confirmedPricing?.subscriptionLateFeeDiscountPercentage || 0,
      subscriptionDamageFeeDiscountPercentage: confirmedPricing?.subscriptionDamageFeeDiscountPercentage || 0,
      paymentMethod: normalizedPaymentMethod,
      paymentStatus: effectivePaymentStatus,
      fullPaymentAmount,
      fullPaymentMethod,
      fullPaymentReceivedAt,
      bookingStatus: 'Confirmed',
      tripStatus: 'upcoming',
      bargain: finalBargain,
    });

    if (subscriptionReservation) {
      const settledReservation = subscriptionReservation;
      subscriptionReservation = null;
      try {
        await appendSubscriptionUsageHistory(settledReservation, booking?._id || null);
      } catch (usageHistoryError) {
        console.error('Failed to append subscription usage history:', usageHistoryError);
      }
    }

    await Request.findByIdAndDelete(request._id);
    queueAdvancePaidConfirmationEmail(booking);

    return res.json({
      message: 'Advance payment successful. Booking confirmed.',
      booking,
    });
  } catch (error) {
    console.error(error);
    if (subscriptionReservation?.coveredHours > 0) {
      await rollbackSubscriptionUsageReservation(subscriptionReservation);
    }
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to record advance payment' : error.message;
    return res.status(status).json({ message });
  }
};
