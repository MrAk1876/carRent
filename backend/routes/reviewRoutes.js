const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  createReview,
  updateMyReview,
  deleteMyReview,
  getMyReviews,
  getPublicReviews,
  getCarReviews,
} = require('../controllers/reviewController');

router.get('/public', getPublicReviews);
router.get('/car/:carId', getCarReviews);
router.get('/my', protect, getMyReviews);
router.post('/', protect, createReview);
router.put('/:id', protect, updateMyReview);
router.delete('/:id', protect, deleteMyReview);

module.exports = router;
