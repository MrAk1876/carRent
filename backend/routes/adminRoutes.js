const express = require('express');
const router = express.Router();
const upload = require('../config/upload');

const { getAllRequests, approveRequest, rejectRequest, deleteRequest, completeBooking, startBookingPickup, getAllCars, addCar, toggleCar, deleteCar, updateCar, getAllBookings, getAllUsers, toggleBlockUser, deleteUser, resetUserPassword, handleBookingBargain } = require('../controllers/adminController');
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

const { protect, adminOnly } = require('../middleware/authMiddleware');

// Booking requests
router.get('/requests', protect, adminOnly, getAllRequests);
router.get('/bookings', protect, adminOnly, getAllBookings);
router.put('/bookings/complete/:id', protect, adminOnly, completeBooking);
router.put('/bookings/pickup/:id', protect, adminOnly, startBookingPickup);
router.put('/requests/approve/:id', protect, adminOnly, approveRequest);
router.put('/requests/reject/:id', protect, adminOnly, rejectRequest);
router.delete('/requests/:id', protect, adminOnly, deleteRequest);

// Cars
router.get('/cars', protect, adminOnly, getAllCars);
router.post('/cars', protect, adminOnly, upload.single('image'), addCar);
router.put('/cars/:id', protect, adminOnly, upload.single('image'), updateCar);
router.put('/cars/toggle/:id', protect, adminOnly, toggleCar);
router.delete('/cars/:id', protect, adminOnly, deleteCar);
router.get('/users', protect, adminOnly, getAllUsers);
router.put('/users/block/:id', protect, adminOnly, toggleBlockUser);
router.delete('/users/:id', protect, adminOnly, deleteUser);
router.put('/users/password/:id', protect, adminOnly, resetUserPassword);
router.put('/bookings/:id/bargain', protect, adminOnly, handleBookingBargain);

// Offers
router.get('/offers', protect, adminOnly, getAllOffers);
router.put('/offers/:id/accept', protect, adminOnly, validateOfferIdParam, acceptOffer);
router.put('/offers/:id/reject', protect, adminOnly, validateOfferIdParam, rejectOffer);
router.put('/offers/:id/counter', protect, adminOnly, validateOfferIdParam, validateAdminCounterOffer, counterOffer);
router.delete('/offers/:id', protect, adminOnly, validateOfferIdParam, deleteOffer);

// Reviews
router.get('/reviews', protect, adminOnly, getAllReviews);
router.put('/reviews/:id', protect, adminOnly, updateReviewByAdmin);
router.delete('/reviews/:id', protect, adminOnly, deleteReviewByAdmin);

module.exports = router;
