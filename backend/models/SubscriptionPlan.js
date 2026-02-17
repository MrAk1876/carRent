const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const DURATION_TYPES = Object.freeze(['Monthly', 'Quarterly', 'Yearly']);

const DEFAULT_DURATION_DAYS = Object.freeze({
  Monthly: 30,
  Quarterly: 90,
  Yearly: 365,
});

const subscriptionPlanSchema = new mongoose.Schema(
  {
    planName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    description: {
      type: String,
      default: '',
      trim: true,
      maxlength: 1000,
    },
    durationType: {
      type: String,
      enum: DURATION_TYPES,
      required: true,
      default: 'Monthly',
    },
    durationInDays: {
      type: Number,
      required: true,
      min: 1,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    includedRentalHours: {
      type: Number,
      required: true,
      min: 0,
    },
    lateFeeDiscountPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    damageFeeDiscountPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true },
);

const toFiniteNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return numericValue;
};

const clampPercent = (value) => {
  const numericValue = toFiniteNumber(value, 0);
  if (numericValue <= 0) return 0;
  if (numericValue >= 100) return 100;
  return Number(numericValue.toFixed(2));
};

subscriptionPlanSchema.pre('validate', function normalizePlanFields() {
  this.planName = String(this.planName || '').trim();
  this.description = String(this.description || '').trim();

  if (!DURATION_TYPES.includes(this.durationType)) {
    this.durationType = 'Monthly';
  }

  const fallbackDuration = DEFAULT_DURATION_DAYS[this.durationType] || DEFAULT_DURATION_DAYS.Monthly;
  const durationInDays = toFiniteNumber(this.durationInDays, fallbackDuration);
  this.durationInDays = Math.max(Math.round(durationInDays), 1);

  this.price = Math.max(toFiniteNumber(this.price, 0), 0);
  this.includedRentalHours = Math.max(toFiniteNumber(this.includedRentalHours, 0), 0);
  this.lateFeeDiscountPercentage = clampPercent(this.lateFeeDiscountPercentage);
  this.damageFeeDiscountPercentage = clampPercent(this.damageFeeDiscountPercentage);
});

subscriptionPlanSchema.index(
  { planName: 1, branchId: 1 },
  {
    unique: true,
    partialFilterExpression: { planName: { $exists: true, $type: 'string' } },
  },
);
subscriptionPlanSchema.plugin(tenantScopedPlugin);

const SubscriptionPlan = mongoose.model('SubscriptionPlan', subscriptionPlanSchema);

SubscriptionPlan.DURATION_TYPES = DURATION_TYPES;
SubscriptionPlan.DEFAULT_DURATION_DAYS = DEFAULT_DURATION_DAYS;

module.exports = SubscriptionPlan;
