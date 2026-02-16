const mongoose = require('mongoose');
const { parseDateTimeInput, validateRentalWindow } = require('../utils/rentalDateUtils');

exports.validateCreateOffer = (req, res, next) => {
  const { carId, offeredPrice, fromDate, toDate, message } = req.body;

  if (!carId || !mongoose.Types.ObjectId.isValid(carId)) {
    return res.status(400).json({ message: 'Valid carId is required' });
  }

  const normalizedPrice = Number(offeredPrice);
  if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    return res.status(422).json({ message: 'offeredPrice must be a positive number' });
  }

  const normalizedPickupDateTime = parseDateTimeInput(fromDate);
  const normalizedDropDateTime = parseDateTimeInput(toDate, { treatDateOnlyAsDropBoundary: true });
  const rentalWindowError = validateRentalWindow(normalizedPickupDateTime, normalizedDropDateTime, {
    minDurationHours: 1,
    now: new Date(),
  });

  if (rentalWindowError) {
    return res.status(422).json({ message: rentalWindowError });
  }

  if (message && String(message).length > 500) {
    return res.status(422).json({ message: 'message cannot exceed 500 characters' });
  }

  req.body.offeredPrice = normalizedPrice;
  req.body.fromDate = normalizedPickupDateTime;
  req.body.toDate = normalizedDropDateTime;
  req.body.message = String(message || '').trim();

  return next();
};

exports.validateOfferIdParam = (req, res, next) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ message: 'Invalid offer id' });
  }
  return next();
};

exports.validateUserRespondOffer = (req, res, next) => {
  const { action, offeredPrice, message } = req.body;
  const normalizedAction = String(action || '').trim().toLowerCase();

  if (!['accept', 'reject', 'counter'].includes(normalizedAction)) {
    return res.status(400).json({ message: 'action must be accept, reject, or counter' });
  }

  if (normalizedAction === 'counter') {
    const normalizedPrice = Number(offeredPrice);
    if (!Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
      return res.status(422).json({ message: 'offeredPrice must be a positive number for counter action' });
    }
    req.body.offeredPrice = normalizedPrice;
  }

  if (message && String(message).length > 500) {
    return res.status(422).json({ message: 'message cannot exceed 500 characters' });
  }

  req.body.action = normalizedAction;
  req.body.message = String(message || '').trim();

  return next();
};

exports.validateAdminCounterOffer = (req, res, next) => {
  const { counterPrice, message } = req.body;
  const normalizedCounterPrice = Number(counterPrice);

  if (!Number.isFinite(normalizedCounterPrice) || normalizedCounterPrice <= 0) {
    return res.status(422).json({ message: 'counterPrice must be a positive number' });
  }

  if (message && String(message).length > 500) {
    return res.status(422).json({ message: 'message cannot exceed 500 characters' });
  }

  req.body.counterPrice = normalizedCounterPrice;
  req.body.message = String(message || '').trim();

  return next();
};
