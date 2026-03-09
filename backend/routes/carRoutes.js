const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Car = require('../models/Car');
const Branch = require('../models/Branch');
const State = require('../models/State');
const City = require('../models/City');
const Location = require('../models/Location');
const { FLEET_STATUS } = require('../utils/fleetStatus');
const { syncCarFleetStatusFromMaintenance } = require('../services/maintenanceService');
const { ensureMainBranch, ensureCarBranch } = require('../services/branchService');
const { applySmartPricingToCars, resolveSmartPriceForCar } = require('../services/smartPricingService');
const { resolveDepositForCar } = require('../services/depositRuleService');

const BRANCH_LOCATION_SELECT =
  'branchName branchCode address city state cityId stateId latitude longitude serviceCities isActive';
const BRANCH_LOCATION_POPULATE = {
  path: 'branchId',
  select: BRANCH_LOCATION_SELECT,
  populate: [
    { path: 'stateId', select: 'name' },
    { path: 'cityId', select: 'name stateId' },
  ],
};
const CAR_LOCATION_POPULATE = {
  path: 'locationId',
  select: 'name branchAddress cityId stateId branchId isPrimary',
  populate: [
    { path: 'stateId', select: 'name' },
    { path: 'cityId', select: 'name stateId' },
    { path: 'branchId', select: 'branchName branchCode address' },
  ],
};

const toText = (value) => String(value || '').trim();
const toLower = (value) => toText(value).toLowerCase();
const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (mongoose.isValidObjectId(value)) return String(value);
  if (value?._id && mongoose.isValidObjectId(value._id)) return String(value._id);
  return '';
};
const toUniqueSortedList = (values = []) =>
  [...new Set((values || []).map((entry) => toText(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const normalizeStateEntry = (entry = {}) => ({
  _id: toObjectIdString(entry?._id || entry?.stateId || ''),
  name: toText(entry?.name || entry?.state || ''),
});
const normalizeCityEntry = (entry = {}) => ({
  _id: toObjectIdString(entry?._id || entry?.cityId || ''),
  name: toText(entry?.name || entry?.city || ''),
  stateId: toObjectIdString(entry?.stateId || ''),
  stateName: toText(entry?.stateName || entry?.state || ''),
});
const getResolvedBranchState = (branch = {}) => toText(branch?.stateId?.name || branch?.state);
const getResolvedBranchCity = (branch = {}) => toText(branch?.cityId?.name || branch?.city);
const getBranchServiceCities = (branch) =>
  toUniqueSortedList([getResolvedBranchCity(branch), ...(Array.isArray(branch?.serviceCities) ? branch.serviceCities : [])]);
const getCarBranch = (car) => (car?.branchId && typeof car.branchId === 'object' ? car.branchId : null);
const getCarLocationDoc = (car) => (car?.locationId && typeof car.locationId === 'object' ? car.locationId : null);
const getCarState = (car) => {
  const branch = getCarBranch(car);
  const location = getCarLocationDoc(car);
  return toText(location?.stateId?.name || car?.state || branch?.stateId?.name || branch?.state);
};
const getCarCity = (car) => {
  const branch = getCarBranch(car);
  const location = getCarLocationDoc(car);
  return toText(location?.cityId?.name || car?.city || car?.location || branch?.cityId?.name || branch?.city);
};
const getCarLocation = (car) => {
  const location = getCarLocationDoc(car);
  return toText(location?.name || car?.location || getCarCity(car));
};
const getCarStateId = (car) => toObjectIdString(getCarLocationDoc(car)?.stateId || car?.stateId || getCarBranch(car)?.stateId);
const getCarCityId = (car) => toObjectIdString(getCarLocationDoc(car)?.cityId || car?.cityId || getCarBranch(car)?.cityId);
const getCarLocationId = (car) => toObjectIdString(getCarLocationDoc(car)?._id || car?.locationId);
const isGenericState = (stateValue) => {
  const normalized = toLower(stateValue);
  return !normalized || normalized === 'main state' || normalized === 'main';
};

const buildPublicCarQuery = (activeBranchIds = [], { includeUnassigned = true } = {}) => {
  const branchScope = activeBranchIds.length
    ? [{ branchId: { $in: activeBranchIds } }]
    : [];

  if (includeUnassigned) {
    branchScope.push({ branchId: { $exists: false } }, { branchId: null });
  }

  if (branchScope.length === 0) {
    branchScope.push({ _id: { $in: [] } });
  }

  return {
    $and: [
      {
        $or: [
          { fleetStatus: FLEET_STATUS.AVAILABLE },
          { fleetStatus: { $exists: false }, isAvailable: true },
          { fleetStatus: { $exists: false }, isAvailable: { $exists: false } },
        ],
      },
      {
        $or: branchScope,
      },
    ],
  };
};

const filterCarsByStateAndCity = (
  cars = [],
  { state = '', city = '', location = '', stateId = '', cityId = '', locationId = '' } = {},
) => {
  const requestedState = toLower(state);
  const requestedCity = toLower(city);
  const requestedLocation = toLower(location);
  const requestedStateId = toObjectIdString(stateId);
  const requestedCityId = toObjectIdString(cityId);
  const requestedLocationId = toObjectIdString(locationId);
  if (!requestedState && !requestedCity && !requestedLocation && !requestedStateId && !requestedCityId && !requestedLocationId) return cars;

  return cars.filter((car) => {
    const carStateId = getCarStateId(car);
    const carCityId = getCarCityId(car);
    const carLocationId = getCarLocationId(car);
    const carState = toLower(getCarState(car));
    const carCity = toLower(getCarCity(car));
    const carLocation = toLower(getCarLocation(car));

    if (requestedStateId && carStateId !== requestedStateId) return false;
    if (requestedCityId && carCityId !== requestedCityId) return false;
    if (requestedLocationId && carLocationId !== requestedLocationId) return false;
    if (requestedState && carState !== requestedState) return false;
    if (requestedCity && carCity !== requestedCity) return false;
    if (requestedLocation && carLocation !== requestedLocation) return false;
    return true;
  });
};

const buildCarFilterOptions = async () => {
  const [states, cities, locations] = await Promise.all([
    State.find({ isActive: true }).sort({ name: 1 }).lean(),
    City.find({ isActive: true }).populate('stateId', 'name isActive').sort({ name: 1 }).lean(),
    Location.find({ isActive: true })
      .populate('stateId', 'name isActive')
      .populate('cityId', 'name stateId isActive')
      .sort({ isPrimary: -1, name: 1 })
      .lean(),
  ]);

  const stateOptions = states
    .map((state) => normalizeStateEntry(state))
    .filter((state) => state.name && !isGenericState(state.name));
  const activeStateIdSet = new Set(stateOptions.map((state) => state._id).filter(Boolean));
  const cityOptions = cities
    .filter((city) => {
      const stateId = toObjectIdString(city?.stateId?._id || city?.stateId);
      if (!stateId || !activeStateIdSet.has(stateId)) return false;
      if (typeof city?.stateId === 'object' && city.stateId?.isActive === false) return false;
      return true;
    })
    .map((city) =>
      normalizeCityEntry({
        _id: city._id,
        name: city.name,
        stateId: city?.stateId?._id || city?.stateId,
        stateName: city?.stateId?.name || '',
      }),
    );

  const statesByName = new Map();
  const citiesByState = {};
  const citiesByStateId = {};
  const locationsByCityId = {};

  stateOptions.forEach((state) => {
    statesByName.set(state._id, state.name);
    citiesByState[state.name] = [];
    citiesByStateId[state._id] = [];
  });

  cityOptions.forEach((city) => {
    const stateName = statesByName.get(city.stateId) || city.stateName || '';
    if (stateName) {
      citiesByState[stateName] = [...new Set([...(citiesByState[stateName] || []), city.name])].sort((a, b) =>
        a.localeCompare(b),
      );
    }
    if (city.stateId) {
      citiesByStateId[city.stateId] = [...(citiesByStateId[city.stateId] || []), city].sort((a, b) =>
        a.name.localeCompare(b.name),
      );
    }
  });

  const locationOptions = locations
    .filter((location) => {
      const cityId = toObjectIdString(location?.cityId?._id || location?.cityId);
      return Boolean(cityId);
    })
    .map((location) => ({
      _id: toObjectIdString(location?._id),
      name: toText(location?.name),
      cityId: toObjectIdString(location?.cityId?._id || location?.cityId),
      cityName: toText(location?.cityId?.name),
      stateId: toObjectIdString(location?.stateId?._id || location?.stateId || location?.cityId?.stateId),
      stateName: toText(location?.stateId?.name),
      branchId: toObjectIdString(location?.branchId),
      branchAddress: toText(location?.branchAddress),
      isPrimary: Boolean(location?.isPrimary),
    }));

  locationOptions.forEach((location) => {
    if (!location.cityId) return;
    locationsByCityId[location.cityId] = [...(locationsByCityId[location.cityId] || []), location].sort((a, b) =>
      Number(b.isPrimary) - Number(a.isPrimary) || a.name.localeCompare(b.name),
    );
  });

  return {
    states: stateOptions.map((state) => state.name),
    cities: toUniqueSortedList(cityOptions.map((city) => city.name)),
    locations: toUniqueSortedList(locationOptions.map((location) => location.name)),
    citiesByState,
    stateOptions,
    cityOptions,
    citiesByStateId,
    locationOptions,
    locationsByCityId,
  };
};

const loadActiveBranches = async () =>
  Branch.find({ isActive: true })
    .select(`_id ${BRANCH_LOCATION_SELECT}`)
    .populate('stateId', 'name')
    .populate('cityId', 'name stateId')
    .lean();

const filterBranchesBySelection = (branches = [], selection = {}) => {
  const requestedState = toLower(selection.state);
  const requestedCity = toLower(selection.city);
  const requestedStateId = toObjectIdString(selection.stateId);
  const requestedCityId = toObjectIdString(selection.cityId);

  if (!requestedState && !requestedCity && !requestedStateId && !requestedCityId) {
    return branches;
  }

  return branches.filter((branch) => {
    const branchStateId = toObjectIdString(branch?.stateId);
    const branchCityId = toObjectIdString(branch?.cityId);
    const branchState = toLower(getResolvedBranchState(branch));
    const branchCity = toLower(getResolvedBranchCity(branch));

    if (requestedStateId && branchStateId !== requestedStateId) return false;
    if (requestedCityId && branchCityId !== requestedCityId) return false;
    if (requestedState && branchState !== requestedState) return false;
    if (requestedCity && branchCity !== requestedCity) return false;
    return true;
  });
};

router.get('/', async (req, res) => {
  try {
    await ensureMainBranch();
    const requestedState = toText(req.query?.state || '');
    const requestedCity = toText(req.query?.city || req.query?.location || '');
    const requestedLocation = toText(req.query?.pickupLocation || req.query?.locationName || '');
    const requestedStateId = toObjectIdString(req.query?.stateId);
    const requestedCityId = toObjectIdString(req.query?.cityId);
    const requestedLocationId = toObjectIdString(req.query?.locationId);
    const activeBranches = await loadActiveBranches();
    const branchIds = activeBranches.map((branch) => branch._id);

    let cars = await Car.find(
      buildPublicCarQuery(branchIds, {
        includeUnassigned: false,
      }),
    )
      .populate(BRANCH_LOCATION_POPULATE)
      .populate(CAR_LOCATION_POPULATE);

    if (cars.length > 0) {
      const now = new Date();
      await Promise.allSettled(cars.map((car) => syncCarFleetStatusFromMaintenance(car._id, { now })));
      cars = await Car.find(
        buildPublicCarQuery(branchIds, {
          includeUnassigned: false,
        }),
      )
        .populate(BRANCH_LOCATION_POPULATE)
        .populate(CAR_LOCATION_POPULATE);
    }

    const pricedCars = await applySmartPricingToCars(cars, {
      now: new Date(),
      persist: true,
    });
    const filteredCars = filterCarsByStateAndCity(pricedCars, {
      state: requestedState,
      city: requestedCity,
      location: requestedLocation,
      stateId: requestedStateId,
      cityId: requestedCityId,
      locationId: requestedLocationId,
    });

    return res.json(filteredCars);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load cars' });
  }
});

router.get('/locations', async (req, res) => {
  try {
    await ensureMainBranch();
    const activeBranches = await loadActiveBranches();
    const activeBranchIds = activeBranches.map((branch) => branch._id);
    const query = buildPublicCarQuery(activeBranchIds);

    const [locations, locationDocs] = await Promise.all([
      Car.distinct('location', query),
      Location.find({ isActive: true }).select('name').lean(),
    ]);
    const branchCities = activeBranches.flatMap((branch) => getBranchServiceCities(branch));
    const normalizedLocations = toUniqueSortedList([
      ...(locations || []),
      ...branchCities,
      ...locationDocs.map((entry) => entry?.name),
    ]);

    return res.json(normalizedLocations);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load locations' });
  }
});

router.get('/filter-options', async (req, res) => {
  try {
    await ensureMainBranch();
    const options = await buildCarFilterOptions();
    return res.json(options);
  } catch (error) {
    return res.status(500).json({ message: 'Failed to load car filter options' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }
    const syncResult = await syncCarFleetStatusFromMaintenance(car._id, { now: new Date() });
    const { car: carDoc, branch } = await ensureCarBranch(syncResult?.car || car);

    if (branch && !branch.isActive) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const activeCar = carDoc || car;
    const hydratedCar = await Car.findById(activeCar._id)
      .populate(BRANCH_LOCATION_POPULATE)
      .populate(CAR_LOCATION_POPULATE);
    const pricing = await resolveSmartPriceForCar(hydratedCar || activeCar, {
      now: new Date(),
      persist: true,
    });

    const plainCar =
      typeof hydratedCar?.toObject === 'function'
        ? hydratedCar.toObject()
        : typeof activeCar?.toObject === 'function'
          ? activeCar.toObject()
          : activeCar;
    const depositInfo = await resolveDepositForCar({
      car: hydratedCar || activeCar,
      perDayPrice: pricing.effectivePricePerDay,
    });
    return res.json({
      ...plainCar,
      basePricePerDay: pricing.basePricePerDay,
      effectivePricePerDay: pricing.effectivePricePerDay,
      pricePerDay: pricing.effectivePricePerDay,
      priceSource: pricing.priceSource,
      priceAdjustmentPercent: pricing.priceAdjustmentPercent,
      dynamicPriceEnabled: pricing.dynamicPriceEnabled,
      manualOverridePrice: pricing.manualOverridePrice,
      branchDynamicPricingEnabled: pricing.branchDynamicPricingEnabled,
      pricingRuleSummary: pricing.rulesApplied,
      priceRangeType: depositInfo.rangeType,
      depositAmount: depositInfo.depositAmount,
      depositRuleActive: depositInfo.isRuleActive,
    });
  } catch (error) {
    return res.status(404).json({ message: 'Car not found' });
  }
});

module.exports = router;
