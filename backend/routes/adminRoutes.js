const express = require('express');
const router = express.Router();
const upload = require('../config/upload');

const {
  getAllRequests,
  approveRequest,
  rejectRequest,
  deleteRequest,
  completeBooking,
  submitReturnInspection,
  processBookingRefund,
  startBookingPickup,
  getAllCars,
  getFleetOverview,
  addCarMaintenance,
  completeCarMaintenance,
  addCar,
  toggleCar,
  deleteCar,
  updateCarFleetStatus,
  updateCar,
  updateCarPricing,
  getCarPricingHistory,
  getAllBookings,
  getAllUsers,
  toggleBlockUser,
  deleteUser,
  resetUserPassword,
  getRoleManagementData,
  updateUserRole,
  getBranchOptions,
  getBranches,
  createBranch,
  updateBranch,
  updateBranchDynamicPricing,
  transferCarBranch,
  handleBookingBargain,
} = require('../controllers/adminController');
const {
  getDrivers,
  createDriver,
  updateDriver,
  toggleDriverActive,
  assignDriver,
  getDriverSuggestions,
} = require('../controllers/driverController');
const { getAnalytics } = require('../controllers/analyticsController');
const {
  getAllOffers,
  acceptOffer,
  rejectOffer,
  deleteOffer,
  counterOffer,
} = require('../controllers/offerController');
const {
  validateOfferIdParam,
  validateAdminCounterOffer,
} = require('../middleware/offerValidation');
const {
  getAllReviews,
  updateReviewByAdmin,
  deleteReviewByAdmin,
} = require('../controllers/reviewController');

const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/rbacMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
const { PERMISSIONS } = require('../utils/rbac');
const bookingTenantGuard = enforceTenantActive({ bookingOnly: true });

// Booking requests
router.get('/requests', protect, bookingTenantGuard, requireAnyPermission(PERMISSIONS.MANAGE_BOOKINGS, PERMISSIONS.VIEW_ALL_BOOKINGS), getAllRequests);
router.get('/bookings', protect, bookingTenantGuard, requireAnyPermission(PERMISSIONS.MANAGE_BOOKINGS, PERMISSIONS.VIEW_ALL_BOOKINGS), getAllBookings);
router.put('/bookings/complete/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), completeBooking);
router.put('/bookings/:bookingId/assign-driver', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_DRIVERS), assignDriver);
router.get('/bookings/:bookingId/driver-suggestions', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_DRIVERS), getDriverSuggestions);
router.put('/refund/:bookingId', protect, bookingTenantGuard, requirePermission(PERMISSIONS.PROCESS_REFUNDS), processBookingRefund);
router.put('/bookings/pickup/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_INSPECTIONS), upload.array('images', 8), startBookingPickup);
router.put('/bookings/inspection/return/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_INSPECTIONS), upload.array('images', 8), submitReturnInspection);
router.put('/requests/approve/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), approveRequest);
router.put('/requests/reject/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), rejectRequest);
router.delete('/requests/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), deleteRequest);

// Cars
router.get('/cars', protect, requireAnyPermission(PERMISSIONS.MANAGE_FLEET, PERMISSIONS.VIEW_ANALYTICS), getAllCars);
router.get('/fleet-overview', protect, requireAnyPermission(PERMISSIONS.MANAGE_FLEET, PERMISSIONS.VIEW_ANALYTICS), getFleetOverview);
router.get('/analytics', protect, requirePermission(PERMISSIONS.VIEW_ANALYTICS), getAnalytics);
router.get(
  '/branch-options',
  protect,
  requireAnyPermission(PERMISSIONS.VIEW_ANALYTICS, PERMISSIONS.VIEW_ALL_BOOKINGS, PERMISSIONS.MANAGE_FLEET),
  getBranchOptions,
);
router.get('/branches', protect, requirePermission(PERMISSIONS.MANAGE_ROLES), getBranches);
router.post('/branches', protect, requirePermission(PERMISSIONS.MANAGE_ROLES), createBranch);
router.put('/branches/:id', protect, requirePermission(PERMISSIONS.MANAGE_ROLES), updateBranch);
router.patch('/branches/:id/dynamic-pricing', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), updateBranchDynamicPricing);
router.post('/cars/:id/maintenance', protect, requirePermission(PERMISSIONS.MANAGE_MAINTENANCE), addCarMaintenance);
router.patch('/maintenance/:id/complete', protect, requirePermission(PERMISSIONS.MANAGE_MAINTENANCE), completeCarMaintenance);
router.post('/cars', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), upload.single('image'), addCar);
router.put('/cars/:id', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), upload.single('image'), updateCar);
router.patch('/cars/:id/pricing', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), updateCarPricing);
router.get('/cars/:id/pricing-history', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), getCarPricingHistory);
router.put('/cars/:id/transfer-branch', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), transferCarBranch);
router.put('/cars/:id/fleet-status', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), updateCarFleetStatus);
router.put('/cars/toggle/:id', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), toggleCar);
router.delete('/cars/:id', protect, requirePermission(PERMISSIONS.MANAGE_FLEET), deleteCar);
router.get('/drivers', protect, requireAnyPermission(PERMISSIONS.MANAGE_DRIVERS, PERMISSIONS.VIEW_ANALYTICS), getDrivers);
router.post('/drivers', protect, requirePermission(PERMISSIONS.MANAGE_DRIVERS), createDriver);
router.put('/drivers/:id', protect, requirePermission(PERMISSIONS.MANAGE_DRIVERS), updateDriver);
router.put('/drivers/:id/toggle-active', protect, requirePermission(PERMISSIONS.MANAGE_DRIVERS), toggleDriverActive);
router.get('/users', protect, requirePermission(PERMISSIONS.MANAGE_USERS), getAllUsers);
router.put('/users/block/:id', protect, requirePermission(PERMISSIONS.MANAGE_USERS), toggleBlockUser);
router.delete('/users/:id', protect, requirePermission(PERMISSIONS.MANAGE_USERS), deleteUser);
router.put('/users/password/:id', protect, requirePermission(PERMISSIONS.MANAGE_USERS), resetUserPassword);
router.put('/bookings/:id/bargain', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), handleBookingBargain);
router.get('/roles', protect, requirePermission(PERMISSIONS.MANAGE_ROLES), getRoleManagementData);
router.patch('/roles/:id', protect, requirePermission(PERMISSIONS.MANAGE_ROLES), updateUserRole);

// Offers
router.get('/offers', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_OFFERS), getAllOffers);
router.put('/offers/:id/accept', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_OFFERS), validateOfferIdParam, acceptOffer);
router.put('/offers/:id/reject', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_OFFERS), validateOfferIdParam, rejectOffer);
router.put('/offers/:id/counter', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_OFFERS), validateOfferIdParam, validateAdminCounterOffer, counterOffer);
router.delete('/offers/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_OFFERS), validateOfferIdParam, deleteOffer);

// Reviews
router.get('/reviews', protect, requirePermission(PERMISSIONS.MANAGE_REVIEWS), getAllReviews);
router.put('/reviews/:id', protect, requirePermission(PERMISSIONS.MANAGE_REVIEWS), updateReviewByAdmin);
router.delete('/reviews/:id', protect, requirePermission(PERMISSIONS.MANAGE_REVIEWS), deleteReviewByAdmin);

module.exports = router;
