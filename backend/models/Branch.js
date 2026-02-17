const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const BRANCH_CODE_PATTERN = /^[A-Z0-9_-]{2,24}$/;

const sanitizeBranchCode = (value = '') => {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_-]/g, '');

  return normalized;
};

const branchSchema = new mongoose.Schema(
  {
    branchName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    branchCode: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 24,
      match: BRANCH_CODE_PATTERN,
    },
    address: {
      type: String,
      trim: true,
      default: '',
      maxlength: 240,
    },
    city: {
      type: String,
      trim: true,
      default: '',
      maxlength: 80,
    },
    state: {
      type: String,
      trim: true,
      default: '',
      maxlength: 80,
    },
    contactNumber: {
      type: String,
      trim: true,
      default: '',
      maxlength: 30,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    manager: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    dynamicPricingEnabled: {
      type: Boolean,
      default: false,
    },
    dynamicPricingMultiplier: {
      type: Number,
      min: 0.8,
      max: 1.2,
      default: 1,
    },
  },
  { timestamps: true },
);

branchSchema.pre('validate', function normalizeBranchFields() {
  this.branchName = String(this.branchName || '').trim();
  this.branchCode = sanitizeBranchCode(this.branchCode || this.branchName);
  this.address = String(this.address || '').trim();
  this.city = String(this.city || '').trim();
  this.state = String(this.state || '').trim();
  this.contactNumber = String(this.contactNumber || '').trim();
  const multiplier = Number(this.dynamicPricingMultiplier);
  this.dynamicPricingMultiplier =
    Number.isFinite(multiplier) && multiplier > 0
      ? Math.max(0.8, Math.min(1.2, Number(multiplier.toFixed(3))))
      : 1;

  if (!this.branchCode) {
    this.branchCode = 'BRANCH';
  }
});

branchSchema.index({ isActive: 1 });
branchSchema.index({ tenantId: 1, branchCode: 1 }, { unique: true });
branchSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Branch', branchSchema);
