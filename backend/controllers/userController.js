const Booking = require('../models/Booking');
const Request = require('../models/Request');
const User = require('../models/User');
const Car = require('../models/Car');
const { uploadImageFromBuffer, deleteImageByPublicId } = require('../utils/cloudinaryImage');

const MIN_PASSWORD_LENGTH = 8;

exports.getMyBookings = async (req, res) => {
  try {
    const bookings = await Booking.find({ user: req.user._id })
      .populate('car')
      .sort({ createdAt: -1 });

    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load bookings' });
  }
};

exports.getUserDashboard = async (req, res) => {
  try {
    const requests = await Request.find({ user: req.user._id })
      .populate('car')
      .sort({ createdAt: -1 });

    const bookings = await Booking.find({ user: req.user._id })
      .populate('car')
      .sort({ createdAt: -1 });

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

    if (booking.tripStatus === 'active' || booking.bookingStatus === 'CONFIRMED') {
      await Car.findByIdAndUpdate(booking.car, { isAvailable: true });
    }

    await booking.deleteOne();

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

    await request.deleteOne();
    res.json({ message: 'Request cancelled' });
  } catch (error) {
    res.status(500).json({ message: 'Cancel failed' });
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
