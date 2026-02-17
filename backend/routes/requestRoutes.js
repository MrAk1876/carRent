const express = require("express");
const router = express.Router();
const { createRequest, payAdvance } = require("../controllers/requestController");
const { protect } = require("../middleware/authMiddleware");
const { enforceTenantActive } = require('../middleware/tenantMiddleware');

const bookingTenantGuard = enforceTenantActive({ bookingOnly: true });

router.post("/", protect, bookingTenantGuard, createRequest);
router.put("/:id/pay-advance", protect, bookingTenantGuard, payAdvance);

module.exports = router;
