const express = require('express');

const { downloadBookingInvoice } = require('../controllers/invoiceController');
const { protect } = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/:bookingId', protect, downloadBookingInvoice);

module.exports = router;
