const express = require('express');
const {
  getNotifications,
  markNotificationAsRead,
} = require('../controllers/notificationController');
const { protect } = require('../middleware/authMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');

const router = express.Router();
const tenantGuard = enforceTenantActive();

router.get('/notifications', protect, tenantGuard, getNotifications);
router.patch('/notifications/read/:id', protect, tenantGuard, markNotificationAsRead);

module.exports = router;
