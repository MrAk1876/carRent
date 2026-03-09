const express = require('express');
const { getPublicStates, getPublicCities, getPublicLocations } = require('../controllers/publicLocationController');

const router = express.Router();

router.get('/states', getPublicStates);
router.get('/cities', getPublicCities);
router.get('/locations', getPublicLocations);

module.exports = router;
