const express = require("express");
const router = express.Router();
const Car = require("../models/Car");
const Branch = require("../models/Branch");
const { FLEET_STATUS } = require("../utils/fleetStatus");
const { syncCarFleetStatusFromMaintenance } = require("../services/maintenanceService");
const { ensureMainBranch, ensureCarBranch } = require("../services/branchService");
const { applySmartPricingToCars, resolveSmartPriceForCar } = require("../services/smartPricingService");

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

router.get("/", async (req, res) => {
  try {
    await ensureMainBranch();
    const activeBranches = await Branch.find({ isActive: true }).select("_id").lean();
    const activeBranchIds = activeBranches.map((branch) => branch._id);

    let cars = await Car.find(buildPublicCarQuery(activeBranchIds));

    if (cars.length > 0) {
      const now = new Date();
      await Promise.allSettled(cars.map((car) => syncCarFleetStatusFromMaintenance(car._id, { now })));
      cars = await Car.find(buildPublicCarQuery(activeBranchIds));
    }

    const pricedCars = await applySmartPricingToCars(cars, {
      now: new Date(),
      persist: true,
    });

    res.json(pricedCars);
  } catch (error) {
    res.status(500).json({ message: "Failed to load cars" });
  }
});

router.get("/locations", async (req, res) => {
  try {
    await ensureMainBranch();
    const activeBranches = await Branch.find({ isActive: true }).select("_id").lean();
    const activeBranchIds = activeBranches.map((branch) => branch._id);
    const query = buildPublicCarQuery(activeBranchIds);

    const locations = await Car.distinct("location", query);
    const normalizedLocations = [...new Set((locations || []).map((item) => String(item || "").trim()).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b),
    );

    return res.json(normalizedLocations);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load locations" });
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
