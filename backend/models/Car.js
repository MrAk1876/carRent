const mongoose = require("mongoose");
const { FLEET_STATUS_VALUES, normalizeFleetStatus, fleetStatusToAvailability } = require("../utils/fleetStatus");
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const carSchema = new mongoose.Schema(
  {
    // Basic info
    name: {
      type: String,
      required: true
    },
    brand: {
      type: String,
      required: true
    },
    model: {
      type: String,
      required: true
    },
    category: {
      type: String, // SUV, Sedan, Hatchback
      required: true
    },

    // Specs
    year: {
      type: Number,
      required: true
    },
    seating_capacity: {
      type: Number,
      required: true
    },
    fuel_type: {
      type: String, // Petrol, Diesel, EV
      required: true
    },
    transmission: {
      type: String, // Manual / Automatic
      required: true
    },

    // Location
    location: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Branch",
      default: null,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },

    // Pricing & availability
    pricePerDay: {
      type: Number,
      required: true
    },
    dynamicPriceEnabled: {
      type: Boolean,
      default: false,
    },
    currentDynamicPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    lastPriceUpdatedAt: {
      type: Date,
      default: null,
    },
    manualOverridePrice: {
      type: Number,
      min: 0,
      default: null,
    },
    priceSource: {
      type: String,
      enum: ["Base", "Dynamic", "Manual"],
      default: "Base",
    },
    priceAdjustmentPercent: {
      type: Number,
      min: -20,
      max: 30,
      default: 0,
    },
    isAvailable: {
      type: Boolean,
      default: true
    },
    fleetStatus: {
      type: String,
      enum: FLEET_STATUS_VALUES,
      default: "Available",
    },

    registrationNumber: {
      type: String,
      trim: true,
      default: "",
    },
    chassisNumber: {
      type: String,
      trim: true,
      default: "",
    },
    engineNumber: {
      type: String,
      trim: true,
      default: "",
    },
    purchaseDate: {
      type: Date,
      default: null,
    },
    insuranceExpiry: {
      type: Date,
      default: null,
    },
    pollutionExpiry: {
      type: Date,
      default: null,
    },
    currentMileage: {
      type: Number,
      min: 0,
      default: 0,
    },
    totalTripsCompleted: {
      type: Number,
      min: 0,
      default: 0,
    },
    lastServiceDate: {
      type: Date,
      default: null,
    },
    totalMaintenanceCost: {
      type: Number,
      min: 0,
      default: 0,
    },

    // Media
    image: {
      type: String,
      required: true
    },
    imagePublicId: {
      type: String,
      default: ''
    },
    features: {
      type: [String],
      required: true,
      validate: [arr => arr.length >= 5, "At least 5 features required"]
    }    
  },
  { timestamps: true }
);

carSchema.pre("validate", function syncFleetAndMetadata() {
  const toValidDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };
  const toNullablePositiveNumber = (value) => {
    if (value === undefined || value === null || value === "") return null;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return null;
    return numericValue;
  };

  if (!this.fleetStatus) {
    this.fleetStatus = this.isAvailable === false ? "Inactive" : "Available";
  }

  const normalizedFleetStatus = normalizeFleetStatus(this.fleetStatus);
  this.fleetStatus = normalizedFleetStatus;
  this.isAvailable = fleetStatusToAvailability(normalizedFleetStatus);

  const currentMileage = Number(this.currentMileage);
  this.currentMileage = Number.isFinite(currentMileage) && currentMileage >= 0 ? currentMileage : 0;

  const totalTripsCompleted = Number(this.totalTripsCompleted);
  this.totalTripsCompleted = Number.isFinite(totalTripsCompleted) && totalTripsCompleted >= 0 ? totalTripsCompleted : 0;

  const totalMaintenanceCost = Number(this.totalMaintenanceCost);
  this.totalMaintenanceCost = Number.isFinite(totalMaintenanceCost) && totalMaintenanceCost >= 0 ? totalMaintenanceCost : 0;

  const basePricePerDay = Number(this.pricePerDay);
  this.pricePerDay = Number.isFinite(basePricePerDay) && basePricePerDay > 0 ? basePricePerDay : 0;

  this.manualOverridePrice = toNullablePositiveNumber(this.manualOverridePrice);
  const dynamicPriceValue = Number(this.currentDynamicPrice);
  this.currentDynamicPrice =
    Number.isFinite(dynamicPriceValue) && dynamicPriceValue > 0
      ? dynamicPriceValue
      : Math.max(this.pricePerDay, 0);

  const normalizedAdjustment = Number(this.priceAdjustmentPercent);
  if (!Number.isFinite(normalizedAdjustment)) {
    this.priceAdjustmentPercent = 0;
  } else {
    this.priceAdjustmentPercent = Math.max(-20, Math.min(30, Number(normalizedAdjustment.toFixed(2))));
  }

  if (this.manualOverridePrice && this.manualOverridePrice > 0) {
    this.priceSource = "Manual";
  } else if (!this.dynamicPriceEnabled) {
    this.priceSource = "Base";
  } else if (!["Base", "Dynamic", "Manual"].includes(String(this.priceSource || ""))) {
    this.priceSource = "Dynamic";
  }

  this.lastPriceUpdatedAt = toValidDate(this.lastPriceUpdatedAt);

  this.purchaseDate = toValidDate(this.purchaseDate);
  this.insuranceExpiry = toValidDate(this.insuranceExpiry);
  this.pollutionExpiry = toValidDate(this.pollutionExpiry);
  this.lastServiceDate = toValidDate(this.lastServiceDate);

  this.registrationNumber = String(this.registrationNumber || "").trim();
  this.chassisNumber = String(this.chassisNumber || "").trim();
  this.engineNumber = String(this.engineNumber || "").trim();
});

carSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model("Car", carSchema);
