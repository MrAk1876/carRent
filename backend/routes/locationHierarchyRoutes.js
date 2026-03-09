const express = require('express');
const {
  getStates,
  createState,
  updateState,
  deleteState,
  getCities,
  createCity,
  updateCity,
  deleteCity,
} = require('../controllers/locationHierarchyController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/rbacMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
const { PERMISSIONS } = require('../utils/rbac');

const router = express.Router();
const bookingTenantGuard = enforceTenantActive({ bookingOnly: true });

router.get(
  '/states',
  protect,
  bookingTenantGuard,
  requireAnyPermission(PERMISSIONS.MANAGE_FLEET, PERMISSIONS.MANAGE_ROLES, PERMISSIONS.VIEW_ANALYTICS),
  getStates,
);
router.post('/states', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_ROLES), createState);
router.put('/states/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_ROLES), updateState);
router.delete('/states/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_ROLES), deleteState);

router.get(
  '/cities',
  protect,
  bookingTenantGuard,
  requireAnyPermission(PERMISSIONS.MANAGE_FLEET, PERMISSIONS.MANAGE_ROLES, PERMISSIONS.VIEW_ANALYTICS),
  getCities,
);
router.post('/cities', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_ROLES), createCity);
router.put('/cities/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_ROLES), updateCity);
router.delete('/cities/:id', protect, bookingTenantGuard, requirePermission(PERMISSIONS.MANAGE_ROLES), deleteCity);

module.exports = router;

