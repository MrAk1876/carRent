const mongoose = require('mongoose');
const Request = require('../models/Request');
const Booking = require('../models/Booking');
const {
  calculateAdvanceBreakdown,
  resolveFinalAmount,
  isAdvancePaidStatus,
} = require('../utils/paymentUtils');
const { normalizeRentalDaysValue, calculateRentalDaysByCalendar } = require('../utils/rentalDateUtils');
const { normalizeFleetStatus, FLEET_STATUS } = require('../utils/fleetStatus');
const { syncCarFleetStatusFromMaintenance } = require('./maintenanceService');
const { assertCarBranchActive } = require('./branchService');
const { syncBookingLocationHierarchy } = require('./locationHierarchyService');
const {
  reserveSubscriptionUsageForRequest,
  rollbackSubscriptionUsageReservation,
  appendSubscriptionUsageHistory,
  normalizeRentalType,
} = require('./subscriptionService');
const { queueAdvancePaidConfirmationEmail } = require('./bookingEmailNotificationService');

const SUPPORTED_PAYMENT_METHODS = new Set(['CARD', 'UPI', 'NETBANKING', 'CASH', 'WALLET']);
const PAYMENT_OPTION_VALUES = new Set(['ADVANCE_POLICY', 'FULL', 'DEPOSIT_ONLY']);

const createHttpError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const normalizePaymentMethod = (value) => String(value || '').trim().toUpperCase();

const normalizePaymentOption = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return PAYMENT_OPTION_VALUES.has(normalized) ? normalized : 'ADVANCE_POLICY';
};

const resolveRequestPaymentPreview = (request, options = {}) => {
  const paymentOption = normalizePaymentOption(options.paymentOption);
  const finalAmount = Number(options.finalAmount ?? resolveFinalAmount(request) ?? 0);
  const breakdown = calculateAdvanceBreakdown(finalAmount);
  const depositAmount = Number.isFinite(Number(request?.depositAmount))
    ? Math.max(Number(request.depositAmount), 0)
    : 0;
  const totalRentalAmount = Math.max(Number(breakdown.finalAmount || 0), 0);
  const totalPayableNow = Number((totalRentalAmount + depositAmount).toFixed(2));

  let advanceRequired = Math.max(Number(breakdown.advanceRequired || 0), depositAmount);
  let remainingAmount = Math.max(totalRentalAmount - advanceRequired, 0);
  let paymentStatus = 'Partially Paid';
  let fullPaymentAmount = remainingAmount;
  let amountPaid = advanceRequired;
  let amountRemaining = remainingAmount;

  if (paymentOption === 'DEPOSIT_ONLY') {
    advanceRequired = depositAmount;
    remainingAmount = totalRentalAmount;
    fullPaymentAmount = totalRentalAmount;
    amountPaid = depositAmount;
    amountRemaining = totalRentalAmount;
  } else if (paymentOption === 'FULL') {
    advanceRequired = depositAmount;
    remainingAmount = 0;
    paymentStatus = 'Fully Paid';
    fullPaymentAmount = totalRentalAmount;
    amountPaid = totalPayableNow;
    amountRemaining = 0;
  }

  return {
    paymentOption,
    finalAmount,
    breakdown,
    depositAmount,
    totalRentalAmount,
    totalPayableNow,
    advanceRequired: Number(advanceRequired.toFixed(2)),
    remainingAmount: Number(remainingAmount.toFixed(2)),
    paymentStatus,
    fullPaymentAmount: Number(fullPaymentAmount.toFixed(2)),
    amountPaid: Number(amountPaid.toFixed(2)),
    amountRemaining: Number(amountRemaining.toFixed(2)),
  };
};

const completeAdvancePaymentForRequest = async (options = {}) => {
  const {
    requestId,
    userId,
    paymentMethod,
    paymentOption,
    paymentReference = '',
    now = new Date(),
  } = options;

  if (!mongoose.Types.ObjectId.isValid(String(requestId || ''))) {
    throw createHttpError('Invalid request id', 400);
  }

  let subscriptionReservation = null;

  try {
    const request = await Request.findById(requestId).populate('car');
    if (!request) {
      throw createHttpError('Request not found', 404);
    }

    if (String(request.user || '') !== String(userId || '')) {
      throw createHttpError('Not allowed', 403);
    }

    if (request.status !== 'pending') {
      throw createHttpError('Only pending requests can be paid', 422);
    }

    if (isAdvancePaidStatus(request.paymentStatus)) {
      throw createHttpError('Advance is already paid for this request', 422);
    }

    if (!request.car) {
      throw createHttpError('Car is no longer available', 422);
    }

    const syncResult = await syncCarFleetStatusFromMaintenance(request.car._id || request.car, { now });
    const activeCar = syncResult?.car || request.car;
    const fleetStatus = normalizeFleetStatus(
      activeCar.fleetStatus,
      activeCar.isAvailable === false ? FLEET_STATUS.INACTIVE : FLEET_STATUS.AVAILABLE,
    );
    const { branch } = await assertCarBranchActive(activeCar, 'Vehicle temporarily unavailable');
    if (![FLEET_STATUS.AVAILABLE, FLEET_STATUS.RESERVED].includes(fleetStatus)) {
      throw createHttpError(
        fleetStatus === FLEET_STATUS.MAINTENANCE ? 'Vehicle under maintenance' : 'Vehicle temporarily unavailable',
        422,
      );
    }

    const { pricing: confirmedPricing, reservation } = await reserveSubscriptionUsageForRequest(request, { now });
    subscriptionReservation = reservation;
    const paymentPreview = resolveRequestPaymentPreview(request, {
      paymentOption,
      finalAmount: Number(confirmedPricing?.finalAmount || resolveFinalAmount(request) || 0),
    });

    const normalizedPaymentMethod = normalizePaymentMethod(paymentMethod);
    const requiresPaymentMethod =
      (paymentPreview.paymentOption === 'FULL'
        ? paymentPreview.totalPayableNow
        : paymentPreview.advanceRequired) > 0;

    if (requiresPaymentMethod && !SUPPORTED_PAYMENT_METHODS.has(normalizedPaymentMethod)) {
      throw createHttpError('paymentMethod must be CARD, UPI, NETBANKING, CASH, or WALLET', 422);
    }

    const effectivePaymentMethod =
      requiresPaymentMethod
        ? normalizedPaymentMethod
        : SUPPORTED_PAYMENT_METHODS.has(normalizedPaymentMethod)
          ? normalizedPaymentMethod
          : 'NONE';

    let finalBargain;
    if (request.bargain && request.bargain.status && request.bargain.status !== 'NONE') {
      finalBargain = {
        ...request.bargain.toObject(),
        status: 'LOCKED',
      };
    }

    const isFullPayment = paymentPreview.paymentOption === 'FULL';
    const booking = await Booking.create({
      user: request.user,
      car: request.car._id,
      branchId: request.branchId || branch?._id || null,
      stateId: request.stateId || branch?.stateId || null,
      cityId: request.cityId || branch?.cityId || null,
      locationId: request.locationId || request.car?.locationId || null,
      locationName: String(request.locationName || request.car?.location || '').trim(),
      customerStateId: request.customerStateId || null,
      customerCityId: request.customerCityId || null,
      customerLocationId: request.customerLocationId || null,
      customerStateName: String(request.customerStateName || '').trim(),
      customerCityName: String(request.customerCityName || '').trim(),
      customerLocationName: String(request.customerLocationName || '').trim(),
      locationMismatchType: String(request.locationMismatchType || 'NONE').trim() || 'NONE',
      locationMismatchMessage: String(request.locationMismatchMessage || '').trim(),
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
      depositAmount: paymentPreview.depositAmount,
      depositPaid: paymentPreview.depositAmount,
      depositRefunded: 0,
      depositDeducted: 0,
      depositStatus: paymentPreview.depositAmount > 0 ? 'HELD' : 'NOT_APPLICABLE',
      actualPickupTime: null,
      actualReturnTime: null,
      gracePeriodHours: Number.isFinite(Number(request.gracePeriodHours))
        ? Math.max(Number(request.gracePeriodHours), 0)
        : 1,
      rentalStage: 'Scheduled',
      totalAmount: paymentPreview.breakdown.finalAmount,
      lockedPerDayPrice: Number(request?.lockedPerDayPrice || 0),
      basePerDayPrice: Number(request?.basePerDayPrice || 0),
      pricingBaseAmount: Number(request?.pricingBaseAmount || 0),
      pricingLockedAmount: Number(request?.pricingLockedAmount || 0),
      priceSource: request?.priceSource || 'Base',
      priceAdjustmentPercent: Number(request?.priceAdjustmentPercent || 0),
      finalAmount: paymentPreview.breakdown.finalAmount,
      totalRentalAmount: paymentPreview.totalRentalAmount,
      advanceAmount: paymentPreview.advanceRequired,
      advanceRequired: paymentPreview.advanceRequired,
      advancePaid: paymentPreview.advanceRequired,
      remainingAmount: paymentPreview.remainingAmount,
      amountPaid: paymentPreview.amountPaid,
      amountRemaining: paymentPreview.amountRemaining,
      rentalType: confirmedPricing?.rentalType || normalizeRentalType(request?.rentalType, 'OneTime'),
      subscriptionPlanId: confirmedPricing?.subscriptionPlanId || request?.subscriptionPlanId || null,
      userSubscriptionId: confirmedPricing?.userSubscriptionId || request?.userSubscriptionId || null,
      subscriptionBaseAmount:
        confirmedPricing?.subscriptionBaseAmount || request?.subscriptionBaseAmount || paymentPreview.breakdown.finalAmount,
      subscriptionHoursUsed: confirmedPricing?.subscriptionHoursUsed || 0,
      subscriptionCoverageAmount: confirmedPricing?.subscriptionCoverageAmount || 0,
      subscriptionExtraAmount: confirmedPricing?.subscriptionExtraAmount || paymentPreview.breakdown.finalAmount,
      subscriptionLateFeeDiscountPercentage: confirmedPricing?.subscriptionLateFeeDiscountPercentage || 0,
      subscriptionDamageFeeDiscountPercentage: confirmedPricing?.subscriptionDamageFeeDiscountPercentage || 0,
      paymentMethod: effectivePaymentMethod,
      paymentStatus: paymentPreview.paymentStatus,
      fullPaymentAmount: paymentPreview.fullPaymentAmount,
      fullPaymentMethod: isFullPayment ? effectivePaymentMethod : 'NONE',
      fullPaymentReceivedAt: isFullPayment ? now : null,
      bookingStatus: 'Confirmed',
      tripStatus: 'upcoming',
      bargain: finalBargain,
    });

    const syncedBookingResult = await syncBookingLocationHierarchy(booking, {
      branch,
      carId: request.car?._id || request.car,
    });
    const syncedBooking = syncedBookingResult.booking || booking;

    if (subscriptionReservation) {
      const settledReservation = subscriptionReservation;
      subscriptionReservation = null;
      try {
        await appendSubscriptionUsageHistory(settledReservation, syncedBooking?._id || null);
      } catch (usageHistoryError) {
        console.error('Failed to append subscription usage history:', usageHistoryError);
      }
    }

    await Request.findByIdAndDelete(request._id);
    queueAdvancePaidConfirmationEmail(syncedBooking);

    return {
      booking: syncedBooking,
      request,
      paymentMethod: effectivePaymentMethod,
      paymentOption: paymentPreview.paymentOption,
      paymentReference: String(paymentReference || '').trim(),
      amountPaid: paymentPreview.amountPaid,
      amountRemaining: paymentPreview.amountRemaining,
      totalPayableNow: paymentPreview.totalPayableNow,
      advanceRequired: paymentPreview.advanceRequired,
      totalRentalAmount: paymentPreview.totalRentalAmount,
    };
  } catch (error) {
    if (subscriptionReservation?.coveredHours > 0) {
      await rollbackSubscriptionUsageReservation(subscriptionReservation);
    }
    throw error;
  }
};

module.exports = {
  SUPPORTED_PAYMENT_METHODS,
  normalizePaymentMethod,
  normalizePaymentOption,
  resolveRequestPaymentPreview,
  completeAdvancePaymentForRequest,
};
