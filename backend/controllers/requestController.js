const mongoose = require('mongoose');
const Request = require('../models/Request');
const Car = require('../models/Car');
const {
  calculateAdvanceBreakdown,
} = require('../utils/paymentUtils');
const { resolveAvailabilityConflict } = require('../services/conflictResolver');
const {
  parseDateTimeInput,
  validateRentalWindow,
  calculateTimeBasedRentalAmount,
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
  syncRequestLocationHierarchy,
} = require('../services/locationHierarchyService');
const { buildUserLocationPayload } = require('../services/userLocationService');
const { buildLocationAlertSnapshot } = require('../services/locationAlertService');
const {
  buildSubscriptionPricingForRequest,
  normalizeRentalType,
  normalizeBoolean,
} = require('../services/subscriptionService');
const {
  queuePendingPaymentEmailForRequest,
} = require('../services/bookingEmailNotificationService');
const { resolveDepositForCar } = require('../services/depositRuleService');
const { completeAdvancePaymentForRequest } = require('../services/requestAdvancePaymentService');
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
      branchId,
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
    if (branchId && String(branchId) !== String(branch?._id || '')) {
      return res.status(422).json({ message: 'Selected pickup branch is not valid for this vehicle' });
    }
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
    const userLocation = await buildUserLocationPayload(req.user);
    const locationAlertSnapshot = buildLocationAlertSnapshot({
      userLocation,
      pickupLocation: {
        stateId: activeCar?.stateId || branch?.stateId || null,
        cityId: activeCar?.cityId || branch?.cityId || null,
        locationId: activeCar?.locationId || null,
        stateName:
          activeCar?.locationId?.stateId?.name ||
          activeCar?.stateId?.name ||
          branch?.stateId?.name ||
          branch?.state ||
          '',
        cityName:
          activeCar?.locationId?.cityId?.name ||
          activeCar?.cityId?.name ||
          branch?.cityId?.name ||
          activeCar?.city ||
          branch?.city ||
          '',
        locationName: activeCar?.location || '',
      },
    });

    const requestData = {
      user: req.user._id,
      car: carId,
      branchId: branch?._id || null,
      stateId: activeCar?.stateId || branch?.stateId || null,
      cityId: activeCar?.cityId || branch?.cityId || null,
      locationId: activeCar?.locationId || null,
      locationName: String(activeCar?.location || '').trim(),
      customerStateId: locationAlertSnapshot.customerStateId,
      customerCityId: locationAlertSnapshot.customerCityId,
      customerLocationId: locationAlertSnapshot.customerLocationId,
      customerStateName: locationAlertSnapshot.customerStateName,
      customerCityName: locationAlertSnapshot.customerCityName,
      customerLocationName: locationAlertSnapshot.customerLocationName,
      locationMismatchType: locationAlertSnapshot.locationMismatchType,
      locationMismatchMessage: locationAlertSnapshot.locationMismatchMessage,
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
    const syncedRequestResult = await syncRequestLocationHierarchy(request, {
      branch,
      carId,
    });
    const syncedRequest = syncedRequestResult.request || request;

    queuePendingPaymentEmailForRequest(syncedRequest);

    return res.status(201).json({
      message: 'Booking request created. Pay advance to confirm your booking.',
      request: syncedRequest,
    });
  } catch (err) {
    console.error(err);
    const status = Number(err?.status || 400);
    return res.status(status).json({ message: err.message });
  }
};

exports.payAdvance = async (req, res) => {
  try {
    if (isStaffRole(req.user?.role)) {
      return res.status(403).json({ message: 'Staff cannot pay advance for rental bookings' });
    }

    const { id } = req.params;
    const paymentMethod = String(req.body.paymentMethod || '').trim().toUpperCase();
    const paymentOption = String(req.body?.paymentOption || '').trim().toUpperCase();
    const { booking: syncedBooking } = await completeAdvancePaymentForRequest({
      requestId: id,
      userId: req.user._id,
      paymentMethod,
      paymentOption,
      paymentReference: req.body?.paymentReference || '',
      now: new Date(),
    });

    return res.json({
      message: 'Advance payment successful. Booking confirmed.',
      booking: syncedBooking,
    });
  } catch (error) {
    console.error(error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to record advance payment' : error.message;
    return res.status(status).json({ message });
  }
};
