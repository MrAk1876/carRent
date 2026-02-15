const express = require("express");
const router = express.Router();
const { createRequest, payAdvance } = require("../controllers/requestController");
const { protect } = require("../middleware/authMiddleware");

router.post("/", protect, createRequest);
router.put("/:id/pay-advance", protect, payAdvance);

module.exports = router;
