const Car = require('../models/Car');
const { isAdvancePaidStatus, isConfirmedBookingStatus, resolveFinalAmount } = require('../utils/paymentUtils');
const { FLEET_STATUS } = require('../utils/fleetStatus');
const { syncRentalStagesForBookings } = require('./rentalStageService');
const { ensureBookingInvoiceGenerated } = require('./invoiceService');
const { queueCompletedInvoiceEmail } = require('./bookingEmailNotificationService');
const { updateCarFleetStatus } = require('./fleetService');
const { releaseDriverForBooking } = require('./driverAllocationService');

const ALLOWED_PAYMENT_METHODS = new Set(['CARD', 'UPI', 'NETBANKING', 'CASH']);

const toPositiveAmount = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return fallback;
  return numericValue;
};

const resolveDamageCost = (booking) => {
  const damageDetected = Boolean(booking?.returnInspection?.damageDetected);
  if (!damageDetected) return 0;
  return toPositiveAmount(booking?.returnInspection?.damageCost, 0);
};

const resolveReturnMileage = (booking) => {
  const mileage = Number(booking?.returnInspection?.currentMileage);
  if (!Number.isFinite(mileage) || mileage < 0) return null;
  return mileage;
};

const resolveAdvancePaidAmount = (booking) => {
  const advancePaid = toPositiveAmount(booking?.advancePaid, 0);
  if (advancePaid > 0) return advancePaid;

  if (isAdvancePaidStatus(booking?.paymentStatus)) {
    return Math.max(
      toPositiveAmount(booking?.advanceRequired, 0),
      toPositiveAmount(booking?.advanceAmount, 0),
    );
  }

  return 0;
};

const normalizePaymentMethod = (value) => String(value || 'CASH').trim().toUpperCase();

const ensureSettlementAllowed = (booking) => {
  if (!booking) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }

  const rentalStage = String(booking.rentalStage || '').toLowerCase();
  const bookingStatus = String(booking.bookingStatus || '');

  if (booking.tripStatus === 'completed' || rentalStage === 'completed' || String(bookingStatus).toLowerCase() === 'completed') {
    const error = new Error('Booking is already completed');
    error.status = 422;
    throw error;
  }

  if (!isConfirmedBookingStatus(booking.bookingStatus)) {
    const error = new Error('Only confirmed bookings can be completed');
    error.status = 422;
    throw error;
  }

  const hasLockedReturnInspection = Boolean(
    booking?.returnInspection?.isLocked && booking?.returnInspection?.inspectedAt,
  );
  if (!hasLockedReturnInspection) {
    const error = new Error('Return inspection must be submitted before completion');
    error.status = 422;
    throw error;
  }
};

const finalizeBookingSettlement = async (booking, options = {}) => {
  ensureSettlementAllowed(booking);

  const paymentMethod = normalizePaymentMethod(options.paymentMethod);
  if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
    const error = new Error('paymentMethod must be CARD, UPI, NETBANKING, or CASH');
    error.status = 422;
    throw error;
  }

  await syncRentalStagesForBookings([booking], { persist: true, now: options.now || new Date() });

  const finalizedAt = options.finalizedAt instanceof Date ? options.finalizedAt : new Date();
  const finalAmount = resolveFinalAmount(booking);
  const advancePaid = resolveAdvancePaidAmount(booking);
  const lateFee = toPositiveAmount(booking.lateFee, 0);
  const damageCost = resolveDamageCost(booking);
  const fallbackRemainingAmount = Math.max(finalAmount - advancePaid, 0) + lateFee + damageCost;
  const existingRemainingAmount = toPositiveAmount(booking.remainingAmount, fallbackRemainingAmount);
  const collectedAmount = Number(Math.max(existingRemainingAmount, fallbackRemainingAmount).toFixed(2));

  booking.tripStatus = 'completed';
  booking.fullPaymentAmount = collectedAmount;
  booking.fullPaymentMethod = paymentMethod;
  booking.fullPaymentReceivedAt = finalizedAt;
  booking.actualReturnTime = finalizedAt;
  booking.rentalStage = 'Completed';
  booking.paymentStatus = 'Fully Paid';
  booking.bookingStatus = 'Completed';
  booking.remainingAmount = 0;
  booking.finalAmount = finalAmount;

  await booking.save();

  try {
    await releaseDriverForBooking(booking, { incrementTripCount: true });
  } catch (driverReleaseError) {
    console.error('Driver release failed after booking completion:', {
      bookingId: String(booking?._id || ''),
      error: driverReleaseError?.message || driverReleaseError,
    });
  }

  const carId = booking.car?._id || booking.car;
  if (carId) {
    const returnMileage = resolveReturnMileage(booking);
    const carUpdate = {
      $inc: { totalTripsCompleted: 1 },
    };
    if (returnMileage !== null) {
      carUpdate.$set = { currentMileage: returnMileage };
    }
    await Car.findByIdAndUpdate(carId, carUpdate, { runValidators: false });
    await updateCarFleetStatus(carId, FLEET_STATUS.AVAILABLE);
  }

  let invoiceResult = null;
  try {
    invoiceResult = await ensureBookingInvoiceGenerated(booking, {
      generatedAt: finalizedAt,
    });
  } catch (invoiceError) {
    console.error('Invoice generation failed after settlement:', {
      bookingId: String(booking?._id || ''),
      error: invoiceError?.message || invoiceError,
    });
  }

  queueCompletedInvoiceEmail(invoiceResult?.booking || booking);

  return {
    booking: invoiceResult?.booking || booking,
    collectedAmount,
    invoice: invoiceResult,
  };
};

module.exports = {
  finalizeBookingSettlement,
  ALLOWED_PAYMENT_METHODS,
};
