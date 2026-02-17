const express = require('express');
const router = express.Router();

const { getMyBookings, cancelBooking, adminDeleteBooking, adminRejectBooking, userBargainPrice, adminBargainDecision, userRespondToCounter } = require('../controllers/bookingController');

const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
const { PERMISSIONS } = require('../utils/rbac');
const bookingTenantGuard = enforceTenantActive({ bookingOnly: true });

// USER routes
router.get('/my', protect, bookingTenantGuard, getMyBookings);
router.put('/:id/bargain', protect, bookingTenantGuard, userBargainPrice);
router.delete('/:id/cancel', protect, bookingTenantGuard, cancelBooking);
router.put('/:id/counter-response', protect, bookingTenantGuard, userRespondToCounter);

// Backward-compatible aliases
router.put('/bookings/:id/bargain', protect, bookingTenantGuard, userBargainPrice);
router.delete('/bookings/:id/cancel', protect, bookingTenantGuard, cancelBooking);
router.put('/bookings/:id/counter-response', protect, bookingTenantGuard, userRespondToCounter);

// ADMIN routes
router.put('/admin/bookings/:id/reject', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), adminRejectBooking);
router.put('/admin/bookings/:id/bargain', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), adminBargainDecision);
router.delete('/admin/bookings/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), adminDeleteBooking);

module.exports = router;
