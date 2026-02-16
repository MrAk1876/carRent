const mongoose = require('mongoose');
const Request = require('../models/Request');
const Booking = require('../models/Booking');
const Car = require('../models/Car');
const {
  calculateAdvanceBreakdown,
  resolveFinalAmount,
  isAdvancePaidStatus,
} = require('../utils/paymentUtils');
const {
  parseDateTimeInput,
  validateRentalWindow,
  calculateTimeBasedRentalAmount,
} = require('../utils/rentalDateUtils');

const ALLOWED_PAYMENT_METHODS = new Set(['CARD', 'UPI', 'NETBANKING', 'CASH']);
const MIN_RENTAL_DURATION_HOURS = 1;

exports.createRequest = async (req, res) => {
  try {
    if (req.user?.role === 'admin') {
      return res.status(403).json({ message: 'Admin can view cars but cannot create rental bookings' });
    }

    const {
      carId,
      fromDate,
      toDate,
      pickupDateTime,
      dropDateTime,
      gracePeriodHours,
      bargainPrice,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(carId)) {
      return res.status(400).json({ message: 'Invalid car ID' });
    }

    const pickupInput = pickupDateTime || fromDate;
    const dropInput = dropDateTime || toDate;
    const normalizedPickupDateTime = parseDateTimeInput(pickupInput);
    const normalizedDropDateTime = parseDateTimeInput(dropInput, { treatDateOnlyAsDropBoundary: true });

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

    if (!car.isAvailable) {
      return res.status(400).json({ message: 'This car is already booked' });
    }

    const { days, amount: baseAmount } = calculateTimeBasedRentalAmount(
      normalizedPickupDateTime,
      normalizedDropDateTime,
      car.pricePerDay,
    );

    if (!Number.isFinite(days) || days <= 0) {
      return res.status(400).json({ message: 'Invalid booking duration' });
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
      fromDate: normalizedPickupDateTime,
      toDate: normalizedDropDateTime,
      pickupDateTime: normalizedPickupDateTime,
      dropDateTime: normalizedDropDateTime,
      gracePeriodHours: normalizedGracePeriodHours,
      days,
      totalAmount: baseAmount,
      finalAmount: baseAmount,
      advanceAmount: 0,
      advanceRequired: 0,
      advancePaid: 0,
      remainingAmount: 0,
      paymentStatus: 'UNPAID',
      paymentMethod: 'NONE',
      status: 'pending',
    };

    if (bargainPrice !== undefined && bargainPrice !== null && bargainPrice !== '') {
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
    requestData.totalAmount = breakdown.finalAmount;
    requestData.finalAmount = breakdown.finalAmount;
    requestData.advanceAmount = breakdown.advanceRequired;
    requestData.advanceRequired = breakdown.advanceRequired;
    requestData.advancePaid = 0;
    requestData.remainingAmount = breakdown.remainingAmount;

    const request = await Request.create(requestData);
    return res.status(201).json({
      message: 'Booking request created. Pay advance to confirm your booking.',
      request,
    });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ message: err.message });
  }
};

exports.payAdvance = async (req, res) => {
  try {
    if (req.user?.role === 'admin') {
      return res.status(403).json({ message: 'Admin cannot pay advance for rental bookings' });
    }

    const { id } = req.params;
    const paymentMethod = String(req.body.paymentMethod || '').trim().toUpperCase();

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: 'Invalid request id' });
    }

    if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
      return res.status(422).json({ message: 'paymentMethod must be CARD, UPI, NETBANKING, or CASH' });
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

    if (!request.car || !request.car.isAvailable) {
      return res.status(422).json({ message: 'Car is no longer available' });
    }

    const finalAmount = resolveFinalAmount(request);
    const breakdown = calculateAdvanceBreakdown(finalAmount);

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
      fromDate: request.fromDate,
      toDate: request.toDate,
      pickupDateTime: request.pickupDateTime || request.fromDate,
      dropDateTime: request.dropDateTime || request.toDate,
      actualPickupTime: null,
      actualReturnTime: null,
      gracePeriodHours: Number.isFinite(Number(request.gracePeriodHours))
        ? Math.max(Number(request.gracePeriodHours), 0)
        : 1,
      rentalStage: 'Scheduled',
      totalAmount: breakdown.finalAmount,
      finalAmount: breakdown.finalAmount,
      advanceAmount: breakdown.advanceRequired,
      advanceRequired: breakdown.advanceRequired,
      advancePaid: breakdown.advanceRequired,
      remainingAmount: breakdown.remainingAmount,
      paymentMethod,
      paymentStatus: 'Partially Paid',
      fullPaymentAmount: breakdown.remainingAmount,
      fullPaymentMethod: 'NONE',
      fullPaymentReceivedAt: null,
      bookingStatus: 'Confirmed',
      tripStatus: 'upcoming',
      bargain: finalBargain,
    });

    await Car.findByIdAndUpdate(request.car._id, { isAvailable: false });
    await Request.findByIdAndDelete(request._id);

    return res.json({
      message: 'Advance payment successful. Booking confirmed.',
      booking,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to record advance payment' });
  }
};
