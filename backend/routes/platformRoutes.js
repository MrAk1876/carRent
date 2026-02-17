const express = require('express');
const router = express.Router();
const {
  getPlatformOverview,
  getTenants,
  createTenant,
  updateTenant,
} = require('../controllers/platformController');
const { protect } = require('../middleware/authMiddleware');
const { requirePlatformSuperAdmin } = require('../middleware/tenantMiddleware');

router.use(protect, requirePlatformSuperAdmin);

router.get('/overview', getPlatformOverview);
router.get('/tenants', getTenants);
router.post('/tenants', createTenant);
router.patch('/tenants/:id', updateTenant);

module.exports = router;

