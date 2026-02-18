const express = require('express');

const {
  getPlans,
  getAdminPlans,
  getAdminSubscriptionOverview,
  createPlan,
  updatePlan,
  getMySubscription,
  purchaseSubscription,
  renewMySubscription,
  downloadMySubscriptionInvoice,
} = require('../controllers/subscriptionController');
const { protect, userOnly } = require('../middleware/authMiddleware');
const { requirePermission, requireAnyPermission } = require('../middleware/rbacMiddleware');
const { PERMISSIONS } = require('../utils/rbac');

const router = express.Router();

router.get('/plans', getPlans);

router.get(
  '/admin/overview',
  protect,
  requireAnyPermission(PERMISSIONS.VIEW_FINANCIALS, PERMISSIONS.MANAGE_ROLES),
  getAdminSubscriptionOverview,
);
router.get('/admin/plans', protect, requirePermission(PERMISSIONS.MANAGE_ROLES), getAdminPlans);
router.post('/admin/plans', protect, requirePermission(PERMISSIONS.MANAGE_ROLES), createPlan);
router.put('/admin/plans/:id', protect, requirePermission(PERMISSIONS.MANAGE_ROLES), updatePlan);

router.get('/my', protect, userOnly, getMySubscription);
router.post('/purchase', protect, userOnly, purchaseSubscription);
router.post('/renew', protect, userOnly, renewMySubscription);
router.get('/my/:subscriptionId/invoice', protect, downloadMySubscriptionInvoice);

module.exports = router;
