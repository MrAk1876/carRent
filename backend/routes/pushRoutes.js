const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
const {
  subscribePushNotifications,
} = require('../services/pushNotificationService');

const router = express.Router();
const tenantGuard = enforceTenantActive();

router.post('/notifications/subscribe', protect, tenantGuard, async (req, res) => {
  try {
    const userId = req.user?._id;
    const subscription = req.body?.subscription;

    const savedSubscription = await subscribePushNotifications(userId, subscription, {
      tenantId: req.tenantId,
    });

    return res.status(201).json({
      message: 'Push subscription saved',
      data: {
        id: String(savedSubscription?._id || ''),
        endpoint: String(savedSubscription?.endpoint || ''),
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message =
      status >= 500 ? 'Failed to subscribe for push notifications' : error.message;
    return res.status(status).json({ message });
  }
});

module.exports = router;
