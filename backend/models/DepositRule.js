const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');
const { RANGE_TYPE_VALUES, normalizeRangeType } = require('../utils/depositRangeUtils');

const DEFAULT_PRICE_WINDOWS = Object.freeze({
  LOW_RANGE: { minPrice: 0, maxPrice: 3000 },
  MEDIUM_RANGE: { minPrice: 3001, maxPrice: 7000 },
  HIGH_RANGE: { minPrice: 7001, maxPrice: 999999 },
});

const depositRuleSchema = new mongoose.Schema(
  {
    rangeName: {
      type: String,
      enum: RANGE_TYPE_VALUES,
      required: true,
      index: true,
    },
    rangeType: {
      type: String,
      enum: RANGE_TYPE_VALUES,
      required: true,
      index: true,
    },
    minPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    maxPrice: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    depositAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
  },
  { timestamps: true },
);

depositRuleSchema.index({ tenantId: 1, rangeName: 1 }, { unique: true });
depositRuleSchema.index({ tenantId: 1, rangeType: 1 });
depositRuleSchema.index({ tenantId: 1, minPrice: 1, maxPrice: 1 });

depositRuleSchema.pre('validate', function normalizeRule() {
  const normalizedRangeName = normalizeRangeType(this.rangeName || this.rangeType, 'LOW_RANGE');
  this.rangeName = normalizedRangeName;
  this.rangeType = normalizedRangeName;

  const defaults = DEFAULT_PRICE_WINDOWS[normalizedRangeName] || DEFAULT_PRICE_WINDOWS.LOW_RANGE;

  const minPrice = Number(this.minPrice);
  this.minPrice =
    Number.isFinite(minPrice) && minPrice >= 0
      ? Number(minPrice.toFixed(2))
      : Number(defaults.minPrice.toFixed(2));

  const maxPrice = Number(this.maxPrice);
  this.maxPrice =
    Number.isFinite(maxPrice) && maxPrice >= 0
      ? Number(maxPrice.toFixed(2))
      : Number(defaults.maxPrice.toFixed(2));

  if (this.maxPrice < this.minPrice) {
    this.maxPrice = this.minPrice;
  }

  const amount = Number(this.depositAmount || 0);
  this.depositAmount = Number.isFinite(amount) && amount >= 0 ? Number(amount.toFixed(2)) : 0;
});

depositRuleSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('DepositRule', depositRuleSchema);
