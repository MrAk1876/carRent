const express = require('express');
const {
  sendMessage,
  updateMessage,
  deleteMessage,
  getConversation,
  markMessageAsRead,
  getUnreadCount,
  getAdminContact,
} = require('../controllers/messageController');
const { protect } = require('../middleware/authMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');

const router = express.Router();
const tenantGuard = enforceTenantActive();

router.post('/messages/send', protect, tenantGuard, sendMessage);
router.get('/messages/conversation/:userId', protect, tenantGuard, getConversation);
router.patch('/messages/:id', protect, tenantGuard, updateMessage);
router.delete('/messages/:id', protect, tenantGuard, deleteMessage);
router.patch('/messages/read/:id', protect, tenantGuard, markMessageAsRead);
router.get('/messages/unread-count', protect, tenantGuard, getUnreadCount);
router.get('/messages/admin-contact', protect, tenantGuard, getAdminContact);

module.exports = router;
