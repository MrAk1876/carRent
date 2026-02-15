const Booking = require('../models/Booking');
const Car = require('../models/Car');

exports.createRequest = async (req, res) => {
  try {
    const { carId, fromDate, toDate } = req.body;

    // 1️⃣ Validate car
    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    if (!car.isAvailable) {
      return res.status(400).json({ message: 'Car is not available' });
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
    const totalAmount = days * car.pricePerDay;
    const advanceAmount = Math.round(totalAmount * 0.3); // 30% advance

    // 5️⃣ Create booking
    const booking = await Booking.create({
      user: req.user._id,
      car: carId,
      fromDate,
      toDate,
      totalAmount,
      advanceAmount,

      paymentStatus: 'ADVANCE_PAID',
      bookingStatus: 'PENDING',

      bargain: {
        userAttempts: 0,
        status: 'NONE',
      },
    });

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
    const bookings = await Booking.find({ user: req.user._id }).populate('car').sort({ createdAt: -1 });

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
    if (booking.bookingStatus === 'CONFIRMED') {
      return res.status(400).json({
        message: 'Confirmed bookings cannot be cancelled',
      });
    }

    // 🔴 USER cancellation → NO refund
    booking.bookingStatus = 'CANCELLED_BY_USER';

    // Payment stays ADVANCE_PAID (no refund)
    await booking.save();

    // Make car available again
    await Car.findByIdAndUpdate(booking.car, { isAvailable: true });

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

    if (booking.bookingStatus !== 'PENDING') {
      return res.status(400).json({
        message: 'Only pending bookings can be rejected',
      });
    }

    booking.bookingStatus = 'REJECTED';

    // 🔥 ADMIN rejection → REFUND advance
    booking.paymentStatus = 'REFUNDED';

    await booking.save();

    // Make car available again
    await Car.findByIdAndUpdate(booking.car, { isAvailable: true });

    res.json({
      message: 'Booking rejected. Advance amount refunded.',
    });
  } catch (error) {
    res.status(500).json({ message: 'Reject failed' });
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
    if (!['PENDING', 'CONFIRMED'].includes(booking.bookingStatus)) {
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

    await booking.save();

    res.json({
      message: 'Bargain request submitted',
      attemptsUsed: booking.bargain.userAttempts,
      maxAttempts: 3,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
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

    if (booking.bookingStatus !== 'PENDING') {
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
      booking.bargain.status = 'ACCEPTED';
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
      booking.bargain.status = "ACCEPTED";
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

    // Free car when deleting non-completed booking records
    if (booking.tripStatus !== 'completed') {
      await Car.findByIdAndUpdate(booking.car, { isAvailable: true });
    }

    await booking.deleteOne();

    res.json({ message: 'Booking deleted by admin' });
  } catch (error) {
    res.status(500).json({ message: 'Admin delete failed' });
  }
};
