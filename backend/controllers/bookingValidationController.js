const {
  MIN_RENTAL_DAYS,
  MAX_RENTAL_DAYS,
  resolveDateInput,
  validateBookingDates,
} = require('../services/bookingDateValidationService');

const BOOKING_VALIDATION_ERROR_MESSAGE = 'Failed to validate booking dates';

exports.validateBookingDateSelection = async (req, res) => {
  try {
    const { pickupDate, dropDate, rentalDays } = resolveDateInput(req.body || {});
    const result = await validateBookingDates({
      carId: req.params.id,
      pickupDate,
      dropDate,
      rentalDays,
      minRentalDays: MIN_RENTAL_DAYS,
      maxRentalDays: MAX_RENTAL_DAYS,
    });

    return res.json(result);
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? BOOKING_VALIDATION_ERROR_MESSAGE : error.message;
    return res.status(status).json({ message });
  }
};
