const Request = require('../models/Request');
const Booking = require('../models/Booking');
const Car = require('../models/Car');
const User = require('../models/User');
const { uploadImageFromBuffer, deleteImageByPublicId } = require('../utils/cloudinaryImage');

const MIN_PASSWORD_LENGTH = 8;
const ALLOWED_PAYMENT_METHODS = new Set(['CARD', 'UPI', 'NETBANKING', 'CASH']);
const CAR_EDITABLE_FIELDS = [
  'name',
  'brand',
  'model',
  'category',
  'year',
  'seating_capacity',
  'fuel_type',
  'transmission',
  'location',
  'pricePerDay',
  'features',
];

const parseFeatures = (value) => {
  if (!value) return value;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return [];

    if (normalized.startsWith('[')) {
      try {
        const parsed = JSON.parse(normalized);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Fallback to comma-separated parsing below.
      }
    }

    return normalized
      .replace(/[\[\]"]/g, '')
      .split(',')
      .map((feature) => feature.trim())
      .filter(Boolean);
  }
  return value;
};

const pickCarPayload = (body = {}) => {
  const data = {};

  CAR_EDITABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  });

  if (data.features !== undefined) {
    data.features = parseFeatures(data.features);
  }

  return data;
};

exports.getAllRequests = async (req, res) => {
  try {
    const requests = await Request.find()
      .populate('car')
      .populate('user', 'firstName lastName email role isBlocked image')
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch {
    res.status(500).json({ message: 'Failed to load requests' });
  }
};

exports.approveRequest = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id)
      .populate('car')
      .populate('user', 'firstName lastName email');

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!request.car || !request.car.isAvailable) {
      return res.status(400).json({ message: 'Car already rented' });
    }

    if (request.status !== 'pending') {
      return res.status(422).json({ message: 'Only pending requests can be approved' });
    }

    if (request.paymentStatus !== 'PAID') {
      return res.status(422).json({ message: 'Advance payment is required before approval' });
    }

    const advanceAmount = Number(request.advanceAmount || Math.round(request.totalAmount * 0.3));
    const fullPaymentAmount = Math.max(Number(request.totalAmount || 0) - advanceAmount, 0);

    let finalBargain;
    if (request.bargain && request.bargain.status !== 'NONE') {
      finalBargain = {
        ...request.bargain.toObject(),
        status: 'LOCKED',
      };
    }

    const booking = await Booking.create({
      user: request.user._id,
      car: request.car._id,
      fromDate: request.fromDate,
      toDate: request.toDate,
      totalAmount: request.totalAmount,
      advanceAmount,
      paymentMethod: request.paymentMethod || 'NONE',
      paymentStatus: 'ADVANCE_PAID',
      fullPaymentAmount,
      fullPaymentMethod: 'NONE',
      fullPaymentReceivedAt: null,
      bookingStatus: 'CONFIRMED',
      tripStatus: 'upcoming',
      bargain: finalBargain,
    });

    await Car.findByIdAndUpdate(request.car._id, { isAvailable: false });
    await Request.findByIdAndDelete(req.params.id);

    res.json({
      message: 'Request approved successfully',
      booking,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Approval failed' });
  }
};

exports.completeBooking = async (req, res) => {
  try {
    const paymentMethod = String(req.body.paymentMethod || 'CASH').trim().toUpperCase();
    if (!ALLOWED_PAYMENT_METHODS.has(paymentMethod)) {
      return res.status(422).json({ message: 'paymentMethod must be CARD, UPI, NETBANKING, or CASH' });
    }

    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ message: 'Booking not found' });

    if (booking.tripStatus === 'completed') {
      return res.status(422).json({ message: 'Booking is already completed' });
    }

    if (booking.bookingStatus !== 'CONFIRMED') {
      return res.status(422).json({ message: 'Only confirmed bookings can be completed' });
    }

    const advanceAmount = Number(booking.advanceAmount || 0);
    const totalAmount = Number(booking.totalAmount || 0);
    const remainingAmount = Math.max(totalAmount - advanceAmount, 0);

    booking.tripStatus = 'completed';
    booking.fullPaymentAmount = remainingAmount;
    booking.fullPaymentMethod = paymentMethod;
    booking.fullPaymentReceivedAt = new Date();
    booking.paymentStatus = 'FULLY_PAID';
    await booking.save();

    await Car.findByIdAndUpdate(booking.car, { isAvailable: true });

    res.json({
      message: 'Car returned, full payment received, and booking completed',
      booking,
    });
  } catch (error) {
    res.status(500).json({ message: 'Failed to complete booking' });
  }
};

exports.handleBookingBargain = async (req, res) => {
  try {
    const { action, counterPrice } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking || !booking.bargain) {
      return res.status(404).json({ message: 'Booking or bargain not found' });
    }

    if (booking.bargain.status === 'LOCKED') {
      return res.status(400).json({ message: 'Bargain already locked' });
    }

    if (action === 'accept') {
      booking.bargain.status = 'ACCEPTED';
      booking.totalAmount = booking.bargain.userPrice;
    } else if (action === 'counter') {
      const normalizedCounterPrice = Number(counterPrice);
      if (!Number.isFinite(normalizedCounterPrice) || normalizedCounterPrice <= 0) {
        return res.status(400).json({ message: 'Valid counter price required' });
      }
      booking.bargain.adminCounterPrice = normalizedCounterPrice;
      booking.bargain.status = 'ADMIN_COUNTERED';
    } else if (action === 'reject') {
      booking.bargain.status = 'REJECTED';
    } else {
      return res.status(400).json({ message: 'Invalid bargain action' });
    }

    await booking.save();
    res.json({ message: 'Bargain updated', booking });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Bargain update failed' });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    await Request.findByIdAndDelete(req.params.id);
    res.json({ message: 'Request rejected and removed' });
  } catch (error) {
    res.status(500).json({ message: 'Reject failed' });
  }
};

exports.deleteRequest = async (req, res) => {
  try {
    await Request.findByIdAndDelete(req.params.id);
    res.json({ message: 'Request deleted' });
  } catch {
    res.status(500).json({ message: 'Delete failed' });
  }
};

exports.getAllCars = async (req, res) => {
  try {
    const cars = await Car.find().sort({ createdAt: -1 });
    res.status(200).json(cars);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch cars' });
  }
};

exports.addCar = async (req, res) => {
  let uploadedImage = null;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Car image is required' });
    }

    const data = pickCarPayload(req.body);
    uploadedImage = await uploadImageFromBuffer(req.file, { folder: 'car-rental/cars' });

    const car = await Car.create({
      ...data,
      image: uploadedImage.url,
      imagePublicId: uploadedImage.publicId,
    });

    res.status(201).json(car);
  } catch (error) {
    console.error('Add car error:', error);
    if (uploadedImage?.publicId) {
      try {
        await deleteImageByPublicId(uploadedImage.publicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup new car image after error:', cleanupError);
      }
    }
    const statusCode = Number(
      error?.statusCode ||
      (String(error.message || '').toLowerCase().includes('cloudinary') ? 500 : 400)
    );
    res.status(statusCode).json({ message: error.message || 'Failed to add car' });
  }
};

exports.toggleCar = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    await Car.findByIdAndUpdate(
      req.params.id,
      { isAvailable: !car.isAvailable },
      { runValidators: false }
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Toggle failed' });
  }
};

exports.deleteCar = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const imagePublicIdToDelete = car.imagePublicId || '';
    await car.deleteOne();

    if (imagePublicIdToDelete) {
      try {
        await deleteImageByPublicId(imagePublicIdToDelete);
      } catch (cleanupError) {
        console.error('Failed to cleanup deleted car image:', cleanupError);
      }
    }

    res.json({ message: 'Car deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: 'Delete failed' });
  }
};

exports.updateCar = async (req, res) => {
  let uploadedImage = null;

  try {
    const existingCar = await Car.findById(req.params.id);
    if (!existingCar) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const data = pickCarPayload(req.body);
    const previousImagePublicId = existingCar.imagePublicId || '';

    if (req.file) {
      uploadedImage = await uploadImageFromBuffer(req.file, { folder: 'car-rental/cars' });
      data.image = uploadedImage.url;
      data.imagePublicId = uploadedImage.publicId;
    }

    if (Object.keys(data).length === 0) {
      if (uploadedImage?.publicId) {
        await deleteImageByPublicId(uploadedImage.publicId);
      }
      return res.status(400).json({ message: 'No valid car fields provided for update' });
    }

    Object.assign(existingCar, data);
    const updatedCar = await existingCar.save();

    if (uploadedImage?.publicId && previousImagePublicId && previousImagePublicId !== uploadedImage.publicId) {
      try {
        await deleteImageByPublicId(previousImagePublicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup previous car image:', cleanupError);
      }
    }

    res.json(updatedCar);
  } catch (error) {
    console.error('Update error:', error);
    if (uploadedImage?.publicId) {
      try {
        await deleteImageByPublicId(uploadedImage.publicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup new car image after error:', cleanupError);
      }
    }
    const statusCode = Number(
      error?.statusCode ||
      (String(error.message || '').toLowerCase().includes('cloudinary') ? 500 : 400)
    );
    res.status(statusCode).json({ message: error.message || 'Update failed' });
  }
};

exports.getAllBookings = async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('car')
      .populate('user', 'firstName lastName email')
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load bookings' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({ role: 'user' }).select('-password');
    res.json(users);
  } catch {
    res.status(500).json({ message: 'Failed to load users' });
  }
};

exports.toggleBlockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isBlocked = !user.isBlocked;
    await user.save();

    res.json({ message: 'User status updated', isBlocked: user.isBlocked });
  } catch {
    res.status(500).json({ message: 'Update failed' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch {
    res.status(500).json({ message: 'Delete failed' });
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = password;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch {
    res.status(500).json({ message: 'Password reset failed' });
  }
};
