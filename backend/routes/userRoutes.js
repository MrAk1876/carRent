const express = require('express');
const router = express.Router();
const { protect, userOnly } = require('../middleware/authMiddleware');
const { validateProfileData } = require('../middleware/profileValidation');
const upload = require('../config/upload');

const {
  getMyBookings,
  getUserDashboard,
  cancelBooking,
  cancelRequest,
  returnBookingAndPayRemaining,
  updateProfile,
  changePassword,
  updateProfileImage,
  completeProfile,
} = require('../controllers/userController');

router.get('/my-bookings', protect, userOnly, getMyBookings);
router.get('/dashboard', protect, userOnly, getUserDashboard);
router.delete('/bookings/:id', protect, userOnly, cancelBooking);
router.put('/bookings/:id/return', protect, userOnly, returnBookingAndPayRemaining);
router.delete('/requests/:id', protect, userOnly, cancelRequest);
router.put('/profile', protect, validateProfileData, updateProfile);
router.put('/complete-profile', protect, upload.single('image'), validateProfileData, completeProfile);
router.put('/password', protect, changePassword);
router.put('/profile-image', protect, upload.single('image'), updateProfileImage);

module.exports = router;
