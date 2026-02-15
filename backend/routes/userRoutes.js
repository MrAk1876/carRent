const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { validateProfileData } = require('../middleware/profileValidation');
const upload = require('../config/upload');

const { getMyBookings, getUserDashboard, cancelBooking, cancelRequest, updateProfile, changePassword, updateProfileImage, completeProfile } = require('../controllers/userController');

router.get('/my-bookings', protect, getMyBookings);
router.get('/dashboard', protect, getUserDashboard);
router.delete('/bookings/:id', protect, cancelBooking);
router.delete('/requests/:id', protect, cancelRequest);
router.put('/profile', protect, validateProfileData, updateProfile);
router.put('/complete-profile', protect, upload.single('image'), validateProfileData, completeProfile);
router.put('/password', protect, changePassword);
router.put('/profile-image', protect, upload.single('image'), updateProfileImage);

module.exports = router;
