const express = require('express');
const {
  getAutoMessages,
  createAutoMessage,
  updateAutoMessage,
  deleteAutoMessage,
} = require('../controllers/autoMessageTemplateController');
const { protect } = require('../middleware/authMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
const { requirePermission } = require('../middleware/rbacMiddleware');
const { PERMISSIONS } = require('../utils/rbac');

const router = express.Router();
const tenantGuard = enforceTenantActive();

router.get('/auto-messages', protect, tenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), getAutoMessages);
router.post('/auto-messages', protect, tenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), createAutoMessage);
router.put('/auto-messages/:id', protect, tenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), updateAutoMessage);
router.delete('/auto-messages/:id', protect, tenantGuard, requirePermission(PERMISSIONS.MANAGE_BOOKINGS), deleteAutoMessage);

module.exports = router;
