const Booking = require('../models/Booking');
const Car = require('../models/Car');
const {
  calculateAdvanceBreakdown,
  isConfirmedBookingStatus,
  isPendingPaymentBookingStatus,
  normalizeStatusKey,
} = require('../utils/paymentUtils');
const { normalizeFleetStatus, isFleetBookable, FLEET_STATUS } = require('../utils/fleetStatus');
const { isStaffRole } = require('../utils/rbac');
const { tryReserveCar, releaseCarIfUnblocked } = require('../services/fleetService');
const { syncCarFleetStatusFromMaintenance } = require('../services/maintenanceService');
const { assertCarInScope, assertBranchInScope } = require('../services/adminScopeService');
const { assertCarBranchActive } = require('../services/branchService');
const { resolveSmartPriceForCar, buildPricingAmounts } = require('../services/smartPricingService');
const { syncRentalStagesForBookings } = require('../services/rentalStageService');
const { runPendingPaymentTimeoutSweep } = require('../services/bookingPaymentTimeoutService');
const { queuePendingPaymentEmailForBooking } = require('../services/bookingEmailNotificationService');
const { releaseDriverForBooking } = require('../services/driverAllocationService');

const assertBookingInScope = async (user, booking, message) => {
  if (booking?.branchId) {
    assertBranchInScope(user, String(booking.branchId), message);
    return;
  }

  await assertCarInScope(user, booking?.car, message);
};

exports.createRequest = async (req, res) => {
  try {
    if (isStaffRole(req.user?.role)) {
      return res.status(403).json({ message: 'Staff can view cars but cannot create rental bookings' });
    }

    const { carId, fromDate, toDate } = req.body;

    // 1️⃣ Validate car
    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const syncResult = await syncCarFleetStatusFromMaintenance(car._id, { now: new Date() });
    const carForBooking = syncResult?.car || car;
    const fleetStatus = normalizeFleetStatus(
      carForBooking.fleetStatus,
      carForBooking.isAvailable === false ? FLEET_STATUS.INACTIVE : FLEET_STATUS.AVAILABLE,
    );
    const { branch } = await assertCarBranchActive(carForBooking, 'Vehicle temporarily unavailable');

    if (!isFleetBookable(fleetStatus)) {
      return res.status(422).json({
        message: fleetStatus === FLEET_STATUS.MAINTENANCE ? 'Vehicle under maintenance' : 'Vehicle temporarily unavailable',
      });
    }

    const reservedCar = await tryReserveCar(carId);
    if (!reservedCar) {
      return res.status(409).json({ message: 'Vehicle just became unavailable. Please try another car.' });
    }

    // 2️⃣ Date handling
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const today = new Date();

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);

    if (start < today) {
      return res.status(400).json({ message: 'Pickup date cannot be in the past' });
    }

    if (end < start) {
      return res.status(400).json({ message: 'Return date cannot be before pickup date' });
    }

    // 3️⃣ Calculate days
    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

    if (days <= 0) {
      return res.status(400).json({ message: 'Invalid booking duration' });
    }

    // 4️⃣ Price calculation
    const pricingSnapshot = await resolveSmartPriceForCar(carForBooking, {
      now: new Date(),
      persist: true,
      branchId: branch?._id || carForBooking?.branchId,
    });
    const lockedPerDayPrice = Number(pricingSnapshot?.effectivePricePerDay || carForBooking?.pricePerDay || 0);
    const basePerDayPrice = Number(pricingSnapshot?.basePricePerDay || carForBooking?.pricePerDay || 0);
    const totalAmount = days * lockedPerDayPrice;
    const pricingAmounts = buildPricingAmounts({
      basePerDayPrice,
      lockedPerDayPrice,
      billingDays: days,
    });
    const breakdown = calculateAdvanceBreakdown(totalAmount);

    // 5️⃣ Create booking
    let booking;
    try {
      booking = await Booking.create({
        user: req.user._id,
        car: carId,
        branchId: branch?._id || null,
        fromDate,
        toDate,
        pickupDateTime: fromDate,
        dropDateTime: toDate,
        actualPickupTime: null,
        actualReturnTime: null,
        gracePeriodHours: 1,
        rentalStage: 'Scheduled',
        totalAmount: breakdown.finalAmount,
        lockedPerDayPrice: pricingAmounts.lockedPerDayPrice,
        basePerDayPrice: pricingAmounts.basePerDayPrice,
        pricingBaseAmount: pricingAmounts.pricingBaseAmount,
        pricingLockedAmount: pricingAmounts.pricingLockedAmount,
        priceSource: pricingSnapshot?.priceSource || 'Base',
        priceAdjustmentPercent: Number(pricingSnapshot?.priceAdjustmentPercent || 0),
        finalAmount: breakdown.finalAmount,
        advanceAmount: breakdown.advanceRequired,
        advanceRequired: breakdown.advanceRequired,
        advancePaid: 0,
        remainingAmount: breakdown.remainingAmount,

        paymentStatus: 'Unpaid',
        bookingStatus: 'PendingPayment',

        bargain: {
          userAttempts: 0,
          status: 'NONE',
        },
      });
    } catch (creationError) {
      await releaseCarIfUnblocked(carId);
      throw creationError;
    }
    queuePendingPaymentEmailForBooking(booking);

    res.status(201).json({
      message: 'Booking request created with advance payment',
      booking,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get logged-in user's bookings
exports.getMyBookings = async (req, res) => {
  try {
    try {
      await runPendingPaymentTimeoutSweep();
    } catch (sweepError) {
      console.error('payment timeout sweep failed (legacy booking getMyBookings):', sweepError);
    }

    const bookings = await Booking.find({ user: req.user._id })
      .populate('car')
      .populate('subscriptionPlanId', 'planName durationType durationInDays')
      .populate('assignedDriver', 'driverName phoneNumber licenseNumber')
      .populate('pickupInspection.inspectedBy', 'firstName lastName email')
      .populate('returnInspection.inspectedBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    await syncRentalStagesForBookings(bookings, { persist: true });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load bookings' });
  }
};

// Cancel booking (User)
// Cancel booking (USER)
exports.cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Only owner can cancel
    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    // Cannot cancel after confirmation
    if (isConfirmedBookingStatus(booking.bookingStatus) || normalizeStatusKey(booking.bookingStatus) === 'COMPLETED') {
      return res.status(400).json({
        message: 'Confirmed bookings cannot be cancelled',
      });
    }

    // 🔴 USER cancellation → NO refund
    booking.bookingStatus = 'Cancelled';
    booking.cancellationReason = 'Cancelled by user';
    booking.cancelledAt = new Date();
    booking.rentalStage = null;

    // Keep recorded payment status; no refund on user cancellation.
    await booking.save();
    try {
      await releaseDriverForBooking(booking, { incrementTripCount: true });
    } catch (driverReleaseError) {
      console.error('driver release failed on user cancellation:', driverReleaseError);
    }

    await releaseCarIfUnblocked(booking.car);

    res.json({
      message: 'Booking cancelled. Advance amount is not refundable.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Cancel failed' });
  }
};
// Reject booking (ADMIN)
exports.adminRejectBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingInScope(req.user, booking, 'Booking does not belong to your branch scope');

    if (!isPendingPaymentBookingStatus(booking.bookingStatus)) {
      return res.status(400).json({
        message: 'Only pending bookings can be rejected',
      });
    }

    booking.bookingStatus = 'REJECTED';
    booking.cancellationReason = 'Rejected by admin';
    booking.rentalStage = null;

    // 🔥 ADMIN rejection → REFUND advance
    booking.paymentStatus = 'REFUNDED';

    await booking.save();
    try {
      await releaseDriverForBooking(booking, { incrementTripCount: false });
    } catch (driverReleaseError) {
      console.error('driver release failed on admin rejection:', driverReleaseError);
    }

    await releaseCarIfUnblocked(booking.car);

    res.json({
      message: 'Booking rejected. Advance amount refunded.',
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Reject failed' : error.message;
    res.status(status).json({ message });
  }
};
// User bargain price (max 3 attempts)
exports.userBargainPrice = async (req, res) => {
  try {
    const { offeredPrice } = req.body;
    const normalizedOfferedPrice = Number(offeredPrice);
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    // Only booking owner can bargain
    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    // Bargaining is allowed on upcoming, active booking records in negotiable states
    const bookingStatusKey = normalizeStatusKey(booking.bookingStatus);
    if (!['PENDING', 'PENDINGPAYMENT', 'CONFIRMED'].includes(bookingStatusKey)) {
      return res.status(400).json({
        message: 'Bargaining is not allowed for this booking status',
      });
    }

    if (booking.tripStatus === 'completed') {
      return res.status(400).json({
        message: 'Cannot bargain on completed trips',
      });
    }

    // Bargain locked check
    if (booking.bargain.status === 'LOCKED') {
      return res.status(400).json({
        message: 'Bargaining limit exceeded. You must accept original price.',
      });
    }

    if (booking.bargain.status === 'ADMIN_COUNTERED') {
      return res.status(400).json({
        message: 'Please respond to the admin counter offer first',
      });
    }

    if (booking.bargain.status === 'ACCEPTED') {
      return res.status(400).json({
        message: 'Negotiation is already accepted for this booking',
      });
    }

    // Attempt limit check
    if (booking.bargain.userAttempts >= 3) {
      booking.bargain.status = 'LOCKED';
      await booking.save();

      return res.status(400).json({
        message: 'Maximum bargain attempts reached',
      });
    }

    if (!Number.isFinite(normalizedOfferedPrice) || normalizedOfferedPrice <= 0) {
      return res.status(400).json({ message: 'Invalid offered price' });
    }

    // Save user bargain
    booking.bargain.userAttempts += 1;
    booking.bargain.userPrice = normalizedOfferedPrice;
    booking.bargain.status = 'USER_OFFERED';
    booking.totalAmount = normalizedOfferedPrice;
    booking.finalAmount = normalizedOfferedPrice;
    const userBreakdown = calculateAdvanceBreakdown(normalizedOfferedPrice);
    booking.advanceRequired = userBreakdown.advanceRequired;
    booking.advanceAmount = userBreakdown.advanceRequired;
    booking.remainingAmount = Math.max(
      userBreakdown.finalAmount - Number(booking.advancePaid || userBreakdown.advanceRequired),
      0
    );

    await booking.save();

    res.json({
      message: 'Bargain request submitted',
      attemptsUsed: booking.bargain.userAttempts,
      maxAttempts: 3,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Admin bargain decision failed' : error.message;
    res.status(status).json({ message });
  }
};
// Admin bargain decision
exports.adminBargainDecision = async (req, res) => {
  try {
    const { action, counterPrice } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingInScope(req.user, booking, 'Booking does not belong to your branch scope');

    if (!isPendingPaymentBookingStatus(booking.bookingStatus)) {
      return res.status(400).json({
        message: 'Bargain allowed only for pending bookings',
      });
    }

    if (booking.bargain.status !== 'USER_OFFERED') {
      return res.status(400).json({
        message: 'No user bargain to respond to',
      });
    }

    // 1️⃣ Admin ACCEPT
    if (action === 'accept') {
      booking.totalAmount = booking.bargain.userPrice;
      booking.finalAmount = booking.bargain.userPrice;
      booking.bargain.status = 'ACCEPTED';

      const acceptedBreakdown = calculateAdvanceBreakdown(booking.finalAmount);
      booking.advanceRequired = acceptedBreakdown.advanceRequired;
      booking.advanceAmount = acceptedBreakdown.advanceRequired;
      booking.remainingAmount = Math.max(
        acceptedBreakdown.finalAmount - Number(booking.advancePaid || acceptedBreakdown.advanceRequired),
        0
      );
    }

    // 2️⃣ Admin COUNTER
    else if (action === 'counter') {
      const normalizedCounterPrice = Number(counterPrice);
      if (!Number.isFinite(normalizedCounterPrice) || normalizedCounterPrice <= 0) {
        return res.status(400).json({
          message: 'Valid counter price is required',
        });
      }

      booking.bargain.adminCounterPrice = normalizedCounterPrice;
      booking.bargain.status = 'ADMIN_COUNTERED';
    }

    // 3️⃣ Admin REJECT bargain
    else if (action === 'reject') {
      booking.bargain.status = 'REJECTED';
    } else {
      return res.status(400).json({ message: 'Invalid action' });
    }

    await booking.save();

    res.json({
      message: 'Admin bargain decision saved',
      bargainStatus: booking.bargain.status,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
// User response to admin counter
exports.userRespondToCounter = async (req, res) => {
  try {
    const { action } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: "Booking not found" });
    }

    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not allowed" });
    }

    if (booking.bargain.status !== "ADMIN_COUNTERED") {
      return res.status(400).json({
        message: "No admin counter to respond to"
      });
    }

    // ACCEPT admin price
    if (action === "accept") {
      booking.totalAmount = booking.bargain.adminCounterPrice;
      booking.finalAmount = booking.bargain.adminCounterPrice;
      booking.bargain.status = "ACCEPTED";

      const counterAcceptedBreakdown = calculateAdvanceBreakdown(booking.finalAmount);
      booking.advanceRequired = counterAcceptedBreakdown.advanceRequired;
      booking.advanceAmount = counterAcceptedBreakdown.advanceRequired;
      booking.remainingAmount = Math.max(
        counterAcceptedBreakdown.finalAmount - Number(booking.advancePaid || counterAcceptedBreakdown.advanceRequired),
        0
      );
    }

    // REJECT admin price
    else if (action === "reject") {
      booking.bargain.status = "REJECTED";
    }

    else {
      return res.status(400).json({ message: "Invalid action" });
    }

    await booking.save();

    res.json({
      message: "Response saved",
      finalPrice: booking.totalAmount
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// Delete booking (ADMIN)
exports.adminDeleteBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingInScope(req.user, booking, 'Booking does not belong to your branch scope');

    const carId = booking.car;
    try {
      await releaseDriverForBooking(booking, { incrementTripCount: false });
    } catch (driverReleaseError) {
      console.error('driver release failed on admin delete:', driverReleaseError);
    }
    await booking.deleteOne();
    await releaseCarIfUnblocked(carId);

    res.json({ message: 'Booking deleted by admin' });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Admin delete failed' : error.message;
    res.status(status).json({ message });
  }
};
