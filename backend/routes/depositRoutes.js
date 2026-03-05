const express = require('express');
const {
  getAdminDepositRules,
  createAdminDepositRule,
  updateAdminDepositRule,
  deleteAdminDepositRule,
} = require('../controllers/depositController');
const { protect } = require('../middleware/authMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
const { PERMISSIONS } = require('../utils/rbac');

const router = express.Router();
const bookingTenantGuard = enforceTenantActive({ bookingOnly: true });

router.get(
  '/deposit-rules',
  protect,
  bookingTenantGuard,
  requirePermission(PERMISSIONS.MANAGE_FLEET),
  getAdminDepositRules,
);
router.post(
  '/deposit-rules',
  protect,
  bookingTenantGuard,
  requirePermission(PERMISSIONS.MANAGE_FLEET),
  createAdminDepositRule,
);
router.put(
  '/deposit-rules/:id',
  protect,
  bookingTenantGuard,
  requirePermission(PERMISSIONS.MANAGE_FLEET),
  updateAdminDepositRule,
);
router.delete(
  '/deposit-rules/:id',
  protect,
  bookingTenantGuard,
  requirePermission(PERMISSIONS.MANAGE_FLEET),
  deleteAdminDepositRule,
);

module.exports = router;
