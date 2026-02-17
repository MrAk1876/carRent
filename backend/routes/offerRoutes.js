const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
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

const bookingTenantGuard = enforceTenantActive({ bookingOnly: true });

router.post('/', protect, bookingTenantGuard, validateCreateOffer, createOffer);
router.get('/my', protect, bookingTenantGuard, getMyOffers);
router.put('/:id/respond', protect, bookingTenantGuard, validateOfferIdParam, validateUserRespondOffer, respondToCounterOffer);

module.exports = router;
