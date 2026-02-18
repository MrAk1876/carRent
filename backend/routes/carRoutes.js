const express = require("express");
const router = express.Router();
const Car = require("../models/Car");
const Branch = require("../models/Branch");
const { FLEET_STATUS } = require("../utils/fleetStatus");
const { syncCarFleetStatusFromMaintenance } = require("../services/maintenanceService");
const { ensureMainBranch, ensureCarBranch } = require("../services/branchService");
const { applySmartPricingToCars, resolveSmartPriceForCar } = require("../services/smartPricingService");

const toText = (value) => String(value || "").trim();
const toLower = (value) => toText(value).toLowerCase();
const toUniqueSortedList = (values = []) =>
  [...new Set((values || []).map((entry) => toText(entry)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
const getBranchServiceCities = (branch) =>
  toUniqueSortedList([branch?.city, ...(Array.isArray(branch?.serviceCities) ? branch.serviceCities : [])]);
const getCarState = (car) => toText(car?.branchId?.state || car?.state);
const getCarCity = (car) => toText(car?.location || car?.city);
const isGenericState = (stateValue) => {
  const normalized = toLower(stateValue);
  return !normalized || normalized === "main state" || normalized === "main";
};

const buildCityStateLookup = (branches = []) => {
  const lookup = new Map();
  for (const branch of branches) {
    if (toLower(branch?.branchCode) === "main") continue;
    const state = toText(branch?.state);
    if (!state) continue;
    const cities = getBranchServiceCities(branch);
    cities.forEach((city) => {
      const normalizedCity = toLower(city);
      if (!lookup.has(normalizedCity)) {
        lookup.set(normalizedCity, state);
      }
    });
  }
  return lookup;
};

const resolveCarState = (car, cityStateLookup = new Map()) => {
  const directState = getCarState(car);
  if (!isGenericState(directState)) return directState;
  const city = getCarCity(car);
  return cityStateLookup.get(toLower(city)) || directState;
};

const buildPublicCarQuery = (activeBranchIds = []) => ({
  $and: [
    {
      $or: [
        { fleetStatus: FLEET_STATUS.AVAILABLE },
        { fleetStatus: { $exists: false }, isAvailable: true },
        { fleetStatus: { $exists: false }, isAvailable: { $exists: false } },
      ],
    },
    {
      $or: [
        { branchId: { $in: activeBranchIds } },
        { branchId: { $exists: false } },
        { branchId: null },
      ],
    },
  ],
});

const filterCarsByStateAndCity = (cars = [], { state = "", city = "" } = {}, cityStateLookup = new Map()) => {
  const requestedState = toLower(state);
  const requestedCity = toLower(city);
  if (!requestedState && !requestedCity) return cars;

  return cars.filter((car) => {
    const carState = toLower(resolveCarState(car, cityStateLookup));
    const carCity = toLower(getCarCity(car));
    if (requestedState && carState !== requestedState) return false;
    if (requestedCity && carCity !== requestedCity) return false;
    return true;
  });
};

const buildCarFilterOptions = (activeBranches = [], cars = []) => {
  const cityStateLookup = buildCityStateLookup(activeBranches);
  const stateToCities = new Map();
  const globalCities = new Set();

  for (const branch of activeBranches) {
    const state = toText(branch?.state);
    if (toLower(branch?.branchCode) === "main" || isGenericState(state)) {
      continue;
    }
    const cities = getBranchServiceCities(branch);
    cities.forEach((city) => globalCities.add(city));
    if (!state) continue;
    if (!stateToCities.has(state)) stateToCities.set(state, new Set());
    cities.forEach((city) => stateToCities.get(state).add(city));
  }

  for (const car of cars) {
    const state = resolveCarState(car, cityStateLookup);
    const city = getCarCity(car);
    if (city) globalCities.add(city);
    if (isGenericState(state)) continue;
    if (!stateToCities.has(state)) stateToCities.set(state, new Set());
    if (city) stateToCities.get(state).add(city);
  }

  const states = [...stateToCities.keys()].sort((a, b) => a.localeCompare(b));
  const citiesByState = states.reduce((acc, state) => {
    const citySet = stateToCities.get(state) || new Set();
    acc[state] = [...citySet].sort((a, b) => a.localeCompare(b));
    return acc;
  }, {});

  return {
    states,
    cities: [...globalCities].sort((a, b) => a.localeCompare(b)),
    citiesByState,
  };
};

router.get("/", async (req, res) => {
  try {
    await ensureMainBranch();
    const activeBranches = await Branch.find({ isActive: true })
      .select("_id branchName branchCode city state serviceCities isActive")
      .lean();
    const activeBranchIds = activeBranches.map((branch) => branch._id);
    const cityStateLookup = buildCityStateLookup(activeBranches);
    const requestedState = toText(req.query?.state || "");
    const requestedCity = toText(req.query?.city || req.query?.location || "");

    let cars = await Car.find(buildPublicCarQuery(activeBranchIds)).populate(
      "branchId",
      "branchName branchCode city state serviceCities isActive",
    );

    if (cars.length > 0) {
      const now = new Date();
      await Promise.allSettled(cars.map((car) => syncCarFleetStatusFromMaintenance(car._id, { now })));
      cars = await Car.find(buildPublicCarQuery(activeBranchIds)).populate(
        "branchId",
        "branchName branchCode city state serviceCities isActive",
      );
    }

    const pricedCars = await applySmartPricingToCars(cars, {
      now: new Date(),
      persist: true,
    });
    const filteredCars = filterCarsByStateAndCity(pricedCars, {
      state: requestedState,
      city: requestedCity,
    }, cityStateLookup);

    res.json(filteredCars);
  } catch (error) {
    res.status(500).json({ message: "Failed to load cars" });
  }
});

router.get("/locations", async (req, res) => {
  try {
    await ensureMainBranch();
    const activeBranches = await Branch.find({ isActive: true }).select("_id city serviceCities").lean();
    const activeBranchIds = activeBranches.map((branch) => branch._id);
    const query = buildPublicCarQuery(activeBranchIds);

    const locations = await Car.distinct("location", query);
    const branchCities = activeBranches.flatMap((branch) => getBranchServiceCities(branch));
    const normalizedLocations = toUniqueSortedList([...(locations || []), ...branchCities]);

    return res.json(normalizedLocations);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load locations" });
  }
});

router.get("/filter-options", async (req, res) => {
  try {
    await ensureMainBranch();
    const activeBranches = await Branch.find({ isActive: true })
      .select("_id branchName branchCode city state serviceCities isActive")
      .lean();
    const activeBranchIds = activeBranches.map((branch) => branch._id);
    const query = buildPublicCarQuery(activeBranchIds);

    const cars = await Car.find(query)
      .select("_id location branchId")
      .populate("branchId", "branchName branchCode city state serviceCities isActive")
      .lean();

    const options = buildCarFilterOptions(activeBranches, cars);
    return res.json(options);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load car filter options" });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: "Car not found" });
    }
    const syncResult = await syncCarFleetStatusFromMaintenance(car._id, { now: new Date() });
    const { car: carDoc, branch } = await ensureCarBranch(syncResult?.car || car);

    if (branch && !branch.isActive) {
      return res.status(404).json({ message: "Car not found" });
    }

    const activeCar = carDoc || car;
    const pricing = await resolveSmartPriceForCar(activeCar, {
      now: new Date(),
      persist: true,
    });

    const plainCar = typeof activeCar?.toObject === "function" ? activeCar.toObject() : activeCar;
    res.json({
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
    });
  } catch (error) {
    res.status(404).json({ message: "Car not found" });
  }
});

module.exports = router;
