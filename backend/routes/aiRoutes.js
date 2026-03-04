const express = require('express');
const {
  getReplySuggestion,
  sendSuggestedReply,
  getAutoReplyMode,
  updateAutoReplyMode,
} = require('../controllers/aiController');
const { protect } = require('../middleware/authMiddleware');
const { enforceTenantActive } = require('../middleware/tenantMiddleware');
const { requireStaff } = require('../middleware/rbacMiddleware');

const router = express.Router();
const tenantGuard = enforceTenantActive();

router.get('/ai/messages/:messageId/suggestion', protect, tenantGuard, requireStaff, getReplySuggestion);
router.post('/ai/messages/:messageId/suggestion', protect, tenantGuard, requireStaff, getReplySuggestion);
router.post('/ai/messages/:messageId/send', protect, tenantGuard, requireStaff, sendSuggestedReply);
router.get('/ai/auto-reply', protect, tenantGuard, requireStaff, getAutoReplyMode);
router.patch('/ai/auto-reply', protect, tenantGuard, requireStaff, updateAutoReplyMode);

module.exports = router;
