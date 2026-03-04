const express = require('express');

const {
  getCarAvailability,
  getAdminCarAvailability,
  createCarBlackout,
} = require('../controllers/availabilityController');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/rbacMiddleware');
const { PERMISSIONS } = require('../utils/rbac');

const router = express.Router();

router.get('/cars/:id/availability', getCarAvailability);

router.get(
  '/admin/cars/:id/availability',
  protect,
  requireAnyPermission(PERMISSIONS.MANAGE_FLEET, PERMISSIONS.VIEW_ALL_BOOKINGS, PERMISSIONS.VIEW_ANALYTICS),
  getAdminCarAvailability,
);

router.post(
  '/admin/cars/:id/blackout',
  protect,
  requireAnyPermission(PERMISSIONS.MANAGE_FLEET, PERMISSIONS.MANAGE_MAINTENANCE),
  createCarBlackout,
);

module.exports = router;
