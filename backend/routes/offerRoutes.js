const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  validateCreateOffer,
  validateOfferIdParam,
  validateUserRespondOffer,
} = require('../middleware/offerValidation');
const {
  createOffer,
  getMyOffers,
  respondToCounterOffer,
} = require('../controllers/offerController');

router.post('/', protect, validateCreateOffer, createOffer);
router.get('/my', protect, getMyOffers);
router.put('/:id/respond', protect, validateOfferIdParam, validateUserRespondOffer, respondToCounterOffer);

module.exports = router;
