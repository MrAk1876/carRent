const express = require('express');
const router = express.Router();
const { protect, userOnly } = require('../middleware/authMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
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

const bookingTenantGuard = enforceTenantActive({ bookingOnly: true });

router.get('/my-bookings', protect, bookingTenantGuard, userOnly, getMyBookings);
router.get('/dashboard', protect, bookingTenantGuard, userOnly, getUserDashboard);
router.delete('/bookings/:id', protect, bookingTenantGuard, userOnly, cancelBooking);
router.put('/bookings/:id/return', protect, bookingTenantGuard, userOnly, returnBookingAndPayRemaining);
router.delete('/requests/:id', protect, bookingTenantGuard, userOnly, cancelRequest);
router.put('/profile', protect, validateProfileData, updateProfile);
router.put('/complete-profile', protect, upload.single('image'), validateProfileData, completeProfile);
router.put('/password', protect, changePassword);
router.put('/profile-image', protect, upload.single('image'), updateProfileImage);

module.exports = router;
