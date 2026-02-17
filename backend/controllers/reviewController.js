const mongoose = require('mongoose');
const Review = require('../models/Review');
const Booking = require('../models/Booking');
const Car = require('../models/Car');
const { isConfirmedBookingStatus, normalizeStatusKey } = require('../utils/paymentUtils');
const { applyCarScopeToQuery, assertCarInScope } = require('../services/adminScopeService');

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const parseReviewPayload = (payload, requireAll = true) => {
  const result = {};

  if (payload.rating !== undefined || requireAll) {
    const normalizedRating = Number(payload.rating);
    if (!Number.isInteger(normalizedRating) || normalizedRating < 1 || normalizedRating > 5) {
      return { error: 'rating must be an integer between 1 and 5' };
    }
    result.rating = normalizedRating;
  }

  if (payload.comment !== undefined || requireAll) {
    const normalizedComment = String(payload.comment || '').trim();
    if (normalizedComment.length < 3) {
      return { error: 'comment must be at least 3 characters' };
    }
    if (normalizedComment.length > 500) {
      return { error: 'comment cannot exceed 500 characters' };
    }
    result.comment = normalizedComment;
  }

  if (!requireAll && Object.keys(result).length === 0) {
    return { error: 'Provide rating or comment to update review' };
  }

  return { data: result };
};

exports.createReview = async (req, res) => {
  try {
    const { bookingId, rating, comment } = req.body;

    if (!isValidObjectId(bookingId)) {
      return res.status(400).json({ message: 'Valid bookingId is required' });
    }

    const parsedPayload = parseReviewPayload({ rating, comment }, true);
    if (parsedPayload.error) {
      return res.status(422).json({ message: parsedPayload.error });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (booking.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'You can only review your own rented cars' });
    }

    const bookingStatusKey = normalizeStatusKey(booking.bookingStatus);
    if (!isConfirmedBookingStatus(booking.bookingStatus) && bookingStatusKey !== 'COMPLETED') {
      return res.status(422).json({ message: 'Review is allowed only for confirmed rentals' });
    }

    const existingReview = await Review.findOne({ booking: booking._id, user: req.user._id });
    if (existingReview) {
      return res.status(422).json({ message: 'You already reviewed this booking' });
    }

    const review = await Review.create({
      user: req.user._id,
      car: booking.car,
      booking: booking._id,
      rating: parsedPayload.data.rating,
      comment: parsedPayload.data.comment,
    });

    return res.status(201).json({ message: 'Review submitted', review });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to submit review' });
  }
};

exports.updateMyReview = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid review id' });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (review.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not allowed to update this review' });
    }

    const parsedPayload = parseReviewPayload(req.body, false);
    if (parsedPayload.error) {
      return res.status(422).json({ message: parsedPayload.error });
    }

    if (parsedPayload.data.rating !== undefined) {
      review.rating = parsedPayload.data.rating;
    }
    if (parsedPayload.data.comment !== undefined) {
      review.comment = parsedPayload.data.comment;
    }

    await review.save();
    return res.json({ message: 'Review updated', review });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update review' });
  }
};

exports.deleteMyReview = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid review id' });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }

    if (review.user.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not allowed to delete this review' });
    }

    await review.deleteOne();
    return res.json({ message: 'Review deleted' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete review' });
  }
};

exports.getMyReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ user: req.user._id })
      .populate('car')
      .populate('booking')
      .sort({ createdAt: -1 });

    return res.json(reviews);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load reviews' });
  }
};

exports.getPublicReviews = async (req, res) => {
  try {
    const requestedLimit = Number(req.query.limit);
    const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 12) : 3;

    const reviews = await Review.aggregate([
      { $sample: { size: limit } },
      {
        $lookup: {
          from: 'users',
          localField: 'user',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: '$user' },
      {
        $lookup: {
          from: 'cars',
          localField: 'car',
          foreignField: '_id',
          as: 'car',
        },
      },
      { $unwind: '$car' },
      {
        $project: {
          _id: 1,
          rating: 1,
          comment: 1,
          createdAt: 1,
          user: {
            _id: '$user._id',
            firstName: '$user.firstName',
            lastName: '$user.lastName',
            address: '$user.address',
            image: '$user.image',
          },
          car: {
            _id: '$car._id',
            brand: '$car.brand',
            model: '$car.model',
            location: '$car.location',
          },
        },
      },
    ]);

    return res.json(reviews);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load public reviews' });
  }
};

exports.getCarReviews = async (req, res) => {
  try {
    const { carId } = req.params;
    if (!isValidObjectId(carId)) {
      return res.status(400).json({ message: 'Invalid car id' });
    }

    const carExists = await Car.exists({ _id: carId });
    if (!carExists) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const reviews = await Review.find({ car: carId })
      .populate('user', 'firstName lastName image address')
      .sort({ createdAt: -1 });

    return res.json(reviews);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load car reviews' });
  }
};

exports.getAllReviews = async (req, res) => {
  try {
    const query = await applyCarScopeToQuery(req.user, {});
    const reviews = await Review.find(query)
      .populate('user', 'firstName lastName email image')
      .populate('car', 'brand model image location')
      .populate('booking', 'fromDate toDate bookingStatus tripStatus totalAmount')
      .sort({ createdAt: -1 });

    return res.json(reviews);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load reviews' });
  }
};

exports.updateReviewByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid review id' });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }
    await assertCarInScope(req.user, review.car, 'Review does not belong to your branch scope');

    const parsedPayload = parseReviewPayload(req.body, false);
    if (parsedPayload.error) {
      return res.status(422).json({ message: parsedPayload.error });
    }

    if (parsedPayload.data.rating !== undefined) {
      review.rating = parsedPayload.data.rating;
    }
    if (parsedPayload.data.comment !== undefined) {
      review.comment = parsedPayload.data.comment;
    }

    await review.save();
    return res.json({ message: 'Review updated by admin', review });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to update review' });
  }
};

exports.deleteReviewByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidObjectId(id)) {
      return res.status(400).json({ message: 'Invalid review id' });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({ message: 'Review not found' });
    }
    await assertCarInScope(req.user, review.car, 'Review does not belong to your branch scope');
    await review.deleteOne();

    return res.json({ message: 'Review deleted by admin' });
  } catch (error) {
    return res.status(500).json({ message: 'Failed to delete review' });
  }
};
