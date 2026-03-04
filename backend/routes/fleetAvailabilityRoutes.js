const express = require('express');

const { getAdminFleetAvailability } = require('../controllers/fleetAvailabilityController');
const { protect } = require('../middleware/authMiddleware');
const { requireAnyPermission } = require('../middleware/rbacMiddleware');
const { PERMISSIONS } = require('../utils/rbac');

const router = express.Router();

router.get(
  '/fleet/availability',
  protect,
  requireAnyPermission(PERMISSIONS.MANAGE_FLEET, PERMISSIONS.VIEW_ANALYTICS, PERMISSIONS.VIEW_ALL_BOOKINGS),
  getAdminFleetAvailability,
);

module.exports = router;
