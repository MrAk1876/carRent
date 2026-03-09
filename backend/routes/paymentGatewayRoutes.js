const express = require('express');
const {
  createPaymentSession,
  getPaymentSession,
  sendPaymentOtp,
  verifyPaymentOtp,
  completePaymentSession,
} = require('../controllers/paymentGatewayController');
const { protect } = require('../middleware/authMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');

const router = express.Router();
const bookingTenantGuard = enforceTenantActive({ bookingOnly: true });

router.post('/sessions', protect, bookingTenantGuard, createPaymentSession);
router.get('/sessions/:token', protect, bookingTenantGuard, getPaymentSession);
router.post('/sessions/:token/send-otp', protect, bookingTenantGuard, sendPaymentOtp);
router.post('/sessions/:token/verify-otp', protect, bookingTenantGuard, verifyPaymentOtp);
router.post('/sessions/:token/pay', protect, bookingTenantGuard, completePaymentSession);

module.exports = router;
