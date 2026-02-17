const express = require('express');
const router = express.Router();
const { getCurrentTenantContext } = require('../controllers/tenantController');

router.get('/context', getCurrentTenantContext);

module.exports = router;

