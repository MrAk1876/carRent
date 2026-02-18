const express = require('express');

const router = express.Router();
const { createContactMessage, subscribeNewsletter } = require('../controllers/contactController');

router.post('/', createContactMessage);
router.post('/newsletter', subscribeNewsletter);

module.exports = router;
