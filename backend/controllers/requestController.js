const mongoose = require('mongoose');
const Request = require('../models/Request');
const Car = require('../models/Car');

const ALLOWED_PAYMENT_METHODS = new Set(['CARD', 'UPI', 'NETBANKING', 'CASH']);

const toDateOnly = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

exports.createRequest = async (req, res) => {
  try {
    const { carId, fromDate, toDate, bargainPrice } = req.body;

    if (!mongoose.Types.ObjectId.isValid(carId)) {
      return res.status(400).json({ message: 'Invalid car ID' });
    }

    const start = toDateOnly(fromDate);
    const end = toDateOnly(toDate);
    const today = toDateOnly(new Date());

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid booking date range' });
    }

    if (start < today) {
      return res.status(400).json({ message: 'Pickup date cannot be in the past' });
    }

    if (end < start) {
      return res.status(400).json({ message: 'Return date cannot be before pickup date' });
    }

    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    if (!car.isAvailable) {
      return res.status(400).json({ message: 'This car is already booked' });
    }

    const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    const totalAmount = days * car.pricePerDay;
    const advanceAmount = Math.round(totalAmount * 0.3);

    const requestData = {
      user: req.user._id,
      car: carId,
      fromDate: start,
      toDate: end,
      days,
      totalAmount,
      advanceAmount,
      paymentStatus: 'UNPAID',
      paymentMethod: 'NONE',
      status: 'pending',
    };

    if (bargainPrice !== undefined && bargainPrice !== null && bargainPrice !== '') {
      const normalizedPrice = Number(bargainPrice);
      if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
        return res.status(400).json({ message: 'Invalid bargain price' });
      }
      requestData.bargain = {
        userPrice: normalizedPrice,
        userAttempts: 1,
        status: 'USER_OFFERED',
      };
    }

    const request = await Request.create(requestData);
    return res.status(201).json({
      message: 'Request created. Please pay advance to complete admin approval.',
      request,
    });
  } catch (err) {
    console.error(err);
    return res.status(400).json({ message: err.message });
  }
};

exports.payAdvance = async (req, res) => {
  try {
    const { id } = req.params;
    const paymentMethod = String(req.body.paymentMethod || '').trim().toUpperCase();
    const paymentReference = String(req.body.paymentReference || '').trim();

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

    if (request.paymentStatus === 'PAID') {
      return res.status(422).json({ message: 'Advance is already paid for this request' });
    }

    if (!request.car || !request.car.isAvailable) {
      return res.status(422).json({ message: 'Car is no longer available' });
    }

    const totalAmount = Number(request.totalAmount || 0);
    const computedAdvance = Math.round(totalAmount * 0.3);
    request.advanceAmount = computedAdvance > 0 ? computedAdvance : Number(request.advanceAmount || 0);
    request.paymentStatus = 'PAID';
    request.paymentMethod = paymentMethod;
    request.paymentReference = paymentReference;
    request.advancePaidAt = new Date();

    await request.save();

    return res.json({
      message: 'Advance payment recorded. Admin can now approve this request.',
      request,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to record advance payment' });
  }
};
