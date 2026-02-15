const express = require('express');
const router = express.Router();

const { getMyBookings, cancelBooking, adminDeleteBooking, adminRejectBooking, userBargainPrice, adminBargainDecision, userRespondToCounter } = require('../controllers/bookingController');

const { protect, adminOnly } = require('../middleware/authMiddleware');

// USER routes
router.get('/my', protect, getMyBookings);
router.put('/:id/bargain', protect, userBargainPrice);
router.delete('/:id/cancel', protect, cancelBooking);
router.put('/:id/counter-response', protect, userRespondToCounter);

// Backward-compatible aliases
router.put('/bookings/:id/bargain', protect, userBargainPrice);
router.delete('/bookings/:id/cancel', protect, cancelBooking);
router.put('/bookings/:id/counter-response', protect, userRespondToCounter);

// ADMIN routes
router.put('/admin/bookings/:id/reject', protect, adminOnly, adminRejectBooking);
router.put('/admin/bookings/:id/bargain', protect, adminOnly, adminBargainDecision);
router.delete('/admin/bookings/:id', protect, adminOnly, adminDeleteBooking);

module.exports = router;
