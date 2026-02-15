const Offer = require('../models/Offer');
const Car = require('../models/Car');
const Request = require('../models/Request');

const MAX_OFFER_ATTEMPTS = 3;
const TERMINAL_STATUSES = new Set(['accepted', 'rejected', 'expired']);

const calculateDays = (fromDate, toDate) => {
  return Math.ceil((new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24)) + 1;
};

const isTerminalStatus = (status) => TERMINAL_STATUSES.has(status);

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

  const car = await Car.findById(offer.car);
  if (!car) {
    return { error: { status: 404, message: 'Car not found' } };
  }

  if (!car.isAvailable) {
    return { error: { status: 422, message: 'Car is no longer available' } };
  }

  const days = calculateDays(offer.fromDate, offer.toDate);
  if (!Number.isFinite(days) || days <= 0) {
    return { error: { status: 422, message: 'Invalid booking duration' } };
  }
  const advanceAmount = Math.round(finalAmount * 0.3);

  const lockedBargain = {
    userAttempts: offer.offerCount,
    userPrice: finalAmount,
    adminCounterPrice: offer.counterPrice,
    status: 'LOCKED',
  };

  const existingPendingRequest = await Request.findOne({
    user: offer.user,
    car: offer.car,
    fromDate: offer.fromDate,
    toDate: offer.toDate,
    status: 'pending',
  });

  if (existingPendingRequest) {
    const previousTotal = Number(existingPendingRequest.totalAmount || 0);
    const previousAdvance = Number(existingPendingRequest.advanceAmount || 0);
    const shouldKeepPaidState =
      existingPendingRequest.paymentStatus === 'PAID' &&
      previousTotal === finalAmount &&
      previousAdvance === advanceAmount;

    existingPendingRequest.days = days;
    existingPendingRequest.totalAmount = finalAmount;
    existingPendingRequest.advanceAmount = advanceAmount;
    existingPendingRequest.bargain = lockedBargain;
    if (!shouldKeepPaidState) {
      existingPendingRequest.paymentStatus = 'UNPAID';
      existingPendingRequest.paymentMethod = 'NONE';
      existingPendingRequest.paymentReference = '';
      existingPendingRequest.advancePaidAt = null;
    }
    await existingPendingRequest.save();

    return { request: existingPendingRequest, finalAmount };
  }

  const request = await Request.create({
    user: offer.user,
    car: offer.car,
    fromDate: offer.fromDate,
    toDate: offer.toDate,
    days,
    totalAmount: finalAmount,
    advanceAmount,
    paymentStatus: 'UNPAID',
    paymentMethod: 'NONE',
    bargain: lockedBargain,
    status: 'pending',
  });

  return { request, finalAmount };
};

exports.createOffer = async (req, res) => {
  try {
    const { carId, offeredPrice, message, fromDate, toDate } = req.body;
    const car = await Car.findById(carId);

    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    if (!car.isAvailable) {
      return res.status(422).json({ message: 'Car is currently unavailable' });
    }

    const days = calculateDays(fromDate, toDate);
    const originalPrice = days * car.pricePerDay;

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
    const offer = await Offer.findById(req.params.id).populate('car');

    if (!offer) {
      return res.status(404).json({ message: 'Offer not found' });
    }

    if (offer.user.toString() !== req.user._id.toString()) {
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

    const history = normalizeUserOfferHistory(offer);
    if (history.length >= MAX_OFFER_ATTEMPTS) {
      return res.status(422).json({
        message: 'Maximum of 3 user offers reached. You can only accept or reject this final counter price.',
      });
    }

    offer.offeredPrice = offeredPrice;
    history.push(offeredPrice);
    offer.userOfferHistory = history;
    offer.message = message || offer.message;
    offer.status = 'pending';
    offer.offerCount = history.length;
    await offer.save();

    return res.json({ message: 'Counter offer submitted', offer });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to respond to offer' });
  }
};

exports.getAllOffers = async (req, res) => {
  try {
    const offers = await Offer.find()
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
    const deleted = await Offer.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ message: 'Offer not found' });
    }

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
