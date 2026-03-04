const express = require('express');
const { validateBookingDateSelection } = require('../controllers/bookingValidationController');

const router = express.Router();

router.post('/cars/:id/validate-booking-dates', validateBookingDateSelection);

module.exports = router;
