const Booking = require('../models/Booking');
const Request = require('../models/Request');
const User = require('../models/User');
const { uploadImageFromBuffer, deleteImageByPublicId } = require('../utils/cloudinaryImage');
const { syncRentalStagesForBookings } = require('../services/rentalStageService');
const { finalizeBookingSettlement } = require('../services/bookingSettlementService');
const { runPendingPaymentTimeoutSweep } = require('../services/bookingPaymentTimeoutService');
const { releaseCarIfUnblocked } = require('../services/fleetService');
const { releaseDriverForBooking } = require('../services/driverAllocationService');
const { isStaffRole } = require('../utils/rbac');

const MIN_PASSWORD_LENGTH = 8;

exports.getMyBookings = async (req, res) => {
  try {
    try {
      await runPendingPaymentTimeoutSweep();
    } catch (sweepError) {
      console.error('payment timeout sweep failed (user getMyBookings):', sweepError);
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

exports.getUserDashboard = async (req, res) => {
  try {
    try {
      await runPendingPaymentTimeoutSweep();
    } catch (sweepError) {
      console.error('payment timeout sweep failed (user dashboard):', sweepError);
    }

    const requests = await Request.find({ user: req.user._id })
      .populate('car')
      .populate('subscriptionPlanId', 'planName durationType durationInDays')
      .sort({ createdAt: -1 });

    const bookings = await Booking.find({ user: req.user._id })
      .populate('car')
      .populate('subscriptionPlanId', 'planName durationType durationInDays')
      .populate('assignedDriver', 'driverName phoneNumber licenseNumber')
      .populate('pickupInspection.inspectedBy', 'firstName lastName email')
      .populate('returnInspection.inspectedBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    await syncRentalStagesForBookings(bookings, { persist: true });
    res.json({ requests, bookings });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Failed to load dashboard' });
  }
};

exports.cancelBooking = async (req, res) => {
  try {
    const booking = await Booking.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const carId = booking.car;
    try {
      await releaseDriverForBooking(booking, { incrementTripCount: false });
    } catch (driverReleaseError) {
      console.error('driver release failed on user booking delete:', driverReleaseError);
    }
    await booking.deleteOne();
    await releaseCarIfUnblocked(carId);

    res.json({ message: 'Booking deleted' });
  } catch (error) {
    console.error('cancelBooking error:', error);
    res.status(500).json({ message: 'Cancel failed' });
  }
};

exports.cancelRequest = async (req, res) => {
  try {
    const request = await Request.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ message: 'Only pending requests can be cancelled' });
    }

    const carId = request.car;
    await request.deleteOne();
    await releaseCarIfUnblocked(carId);
    res.json({ message: 'Request cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Cancel failed' });
  }
};

exports.returnBookingAndPayRemaining = async (req, res) => {
  try {
    if (isStaffRole(req.user?.role)) {
      return res.status(403).json({ message: 'Staff cannot use user return flow' });
    }

    const booking = await Booking.findOne({
      _id: req.params.id,
      user: req.user._id,
    }).populate('car', 'pricePerDay');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const stage = String(booking.rentalStage || '').trim().toLowerCase();
    if (!['active', 'overdue'].includes(stage)) {
      return res.status(422).json({ message: 'Return is allowed only for active or overdue rentals' });
    }

    const { booking: completedBooking, collectedAmount } = await finalizeBookingSettlement(booking, {
      paymentMethod: req.body.paymentMethod || 'UPI',
      now: new Date(),
      finalizedAt: new Date(),
    });

    return res.json({
      message: 'Return recorded and remaining payment completed',
      collectedAmount,
      booking: completedBooking,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to complete return' : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, address, dob } = req.body;
    const age = req.calculatedAge;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (normalizedEmail && normalizedEmail !== user.email) {
      const existing = await User.findOne({ email: normalizedEmail });
      if (existing) {
        return res.status(400).json({ message: 'Email already registered' });
      }
    }

    user.firstName = firstName || user.firstName;
    user.lastName = lastName || user.lastName;
    user.email = normalizedEmail || user.email;
    user.phone = phone;
    user.address = address;
    user.dob = dob;
    user.age = age;

    await user.save();

    res.json({
      message: 'Profile updated',
      user,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Update failed' });
  }
};

exports.changePassword = async (req, res) => {
  try {
    const { password } = req.body;

    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = password;
    await user.save({ validateModifiedOnly: true });

    res.json({ message: 'Password updated' });
  } catch (error) {
    res.status(500).json({ message: 'Password change failed' });
  }
};

exports.updateProfileImage = async (req, res) => {
  let uploadedImage = null;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Image file is required' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    uploadedImage = await uploadImageFromBuffer(req.file, { folder: 'car-rental/users' });
    const previousImagePublicId = user.imagePublicId || '';

    const updatedUser = await User.findByIdAndUpdate(
      req.user._id,
      {
        image: uploadedImage.url,
        imagePublicId: uploadedImage.publicId,
      },
      { new: true, runValidators: false }
    );

    if (!updatedUser) {
      if (uploadedImage?.publicId) {
        await deleteImageByPublicId(uploadedImage.publicId);
      }
      return res.status(404).json({ message: 'User not found' });
    }

    if (previousImagePublicId && previousImagePublicId !== uploadedImage.publicId) {
      try {
        await deleteImageByPublicId(previousImagePublicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup previous user image:', cleanupError);
      }
    }

    res.json({
      image: updatedUser.image,
      imagePublicId: updatedUser.imagePublicId || '',
    });
  } catch (error) {
    console.error(error);
    if (uploadedImage?.publicId) {
      try {
        await deleteImageByPublicId(uploadedImage.publicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup new user image after error:', cleanupError);
      }
    }
    const statusCode = Number(error?.statusCode || 500);
    res.status(statusCode).json({ message: error?.message || 'Image upload failed' });
  }
};

exports.completeProfile = async (req, res) => {
  let uploadedImage = null;

  try {
    const { phone, address, dob } = req.body;
    const age = req.calculatedAge;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.phone = phone;
    user.address = address;
    user.dob = dob;
    user.age = age;
    user.isProfileComplete = true;

    const previousImagePublicId = user.imagePublicId || '';

    if (req.file) {
      uploadedImage = await uploadImageFromBuffer(req.file, { folder: 'car-rental/users' });
      user.image = uploadedImage.url;
      user.imagePublicId = uploadedImage.publicId;
    }

    await user.save();

    if (uploadedImage?.publicId && previousImagePublicId && previousImagePublicId !== uploadedImage.publicId) {
      try {
        await deleteImageByPublicId(previousImagePublicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup previous user image:', cleanupError);
      }
    }

    res.json({
      message: 'Profile completed',
      user,
    });
  } catch (error) {
    console.error(error);
    if (uploadedImage?.publicId) {
      try {
        await deleteImageByPublicId(uploadedImage.publicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup new user image after error:', cleanupError);
      }
    }
    const statusCode = Number(error?.statusCode || 500);
    res.status(statusCode).json({ message: error?.message || 'Profile update failed' });
  }
};
