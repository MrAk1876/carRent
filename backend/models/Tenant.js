const mongoose = require('mongoose');

const SUBSCRIPTION_PLANS = ['Basic', 'Pro', 'Enterprise'];
const TENANT_STATUS = ['Active', 'Suspended'];

const toTenantCode = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_-]/g, '');

const tenantSchema = new mongoose.Schema(
  {
    companyName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 140,
    },
    companyCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      maxlength: 40,
      index: true,
    },
    contactEmail: {
      type: String,
      default: '',
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    subscriptionPlan: {
      type: String,
      enum: SUBSCRIPTION_PLANS,
      default: 'Basic',
    },
    subscriptionStartDate: {
      type: Date,
      default: null,
    },
    subscriptionEndDate: {
      type: Date,
      default: null,
    },
    tenantStatus: {
      type: String,
      enum: TENANT_STATUS,
      default: 'Active',
      index: true,
    },
    maxBranches: {
      type: Number,
      min: 1,
      default: 5,
    },
    maxVehicles: {
      type: Number,
      min: 1,
      default: 100,
    },
    maxUsers: {
      type: Number,
      min: 1,
      default: 1000,
    },
    maxDrivers: {
      type: Number,
      min: 1,
      default: 200,
    },
    logoUrl: {
      type: String,
      default: '',
      trim: true,
      maxlength: 500,
    },
    primaryColor: {
      type: String,
      default: '#2563EB',
      trim: true,
      maxlength: 20,
    },
    secondaryColor: {
      type: String,
      default: '#0F172A',
      trim: true,
      maxlength: 20,
    },
  },
  { timestamps: true },
);

tenantSchema.pre('validate', function normalizeTenantFields() {
  const toValidDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };
  const clampPositiveInt = (value, fallback) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
    return Math.max(Math.floor(numericValue), 1);
  };

  this.companyName = String(this.companyName || '').trim();
  this.companyCode = toTenantCode(this.companyCode || this.companyName || 'TENANT');
  this.contactEmail = String(this.contactEmail || '').trim().toLowerCase();
  this.subscriptionStartDate = toValidDate(this.subscriptionStartDate);
  this.subscriptionEndDate = toValidDate(this.subscriptionEndDate);
  this.logoUrl = String(this.logoUrl || '').trim();
  this.primaryColor = String(this.primaryColor || '#2563EB').trim();
  this.secondaryColor = String(this.secondaryColor || '#0F172A').trim();

  if (!SUBSCRIPTION_PLANS.includes(this.subscriptionPlan)) {
    this.subscriptionPlan = 'Basic';
  }
  if (!TENANT_STATUS.includes(this.tenantStatus)) {
    this.tenantStatus = 'Active';
  }

  this.maxBranches = clampPositiveInt(this.maxBranches, 5);
  this.maxVehicles = clampPositiveInt(this.maxVehicles, 100);
  this.maxUsers = clampPositiveInt(this.maxUsers, 1000);
  this.maxDrivers = clampPositiveInt(this.maxDrivers, 200);
});

tenantSchema.index({ tenantStatus: 1, createdAt: -1 });

const Tenant = mongoose.model('Tenant', tenantSchema);
Tenant.SUBSCRIPTION_PLANS = SUBSCRIPTION_PLANS;
Tenant.TENANT_STATUS = TENANT_STATUS;
Tenant.toTenantCode = toTenantCode;

module.exports = Tenant;
