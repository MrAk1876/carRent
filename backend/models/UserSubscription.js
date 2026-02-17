const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const SUBSCRIPTION_STATUSES = Object.freeze(['Active', 'Expired', 'Cancelled']);
const SUBSCRIPTION_PAYMENT_STATUSES = Object.freeze(['Unpaid', 'Paid', 'Failed', 'Refunded']);
const SUBSCRIPTION_PAYMENT_METHODS = Object.freeze(['NONE', 'CARD', 'UPI', 'NETBANKING', 'CASH']);

const usageEntrySchema = new mongoose.Schema(
  {
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
    },
    hoursUsed: {
      type: Number,
      min: 0,
      default: 0,
    },
    amountCovered: {
      type: Number,
      min: 0,
      default: 0,
    },
    amountCharged: {
      type: Number,
      min: 0,
      default: 0,
    },
    usedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const planSnapshotSchema = new mongoose.Schema(
  {
    planName: {
      type: String,
      default: '',
      trim: true,
    },
    durationType: {
      type: String,
      default: '',
      trim: true,
    },
    durationInDays: {
      type: Number,
      min: 1,
      default: 30,
    },
    price: {
      type: Number,
      min: 0,
      default: 0,
    },
    includedRentalHours: {
      type: Number,
      min: 0,
      default: 0,
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
  },
  { _id: false },
);

const userSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SubscriptionPlan',
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    subscriptionStatus: {
      type: String,
      enum: SUBSCRIPTION_STATUSES,
      default: 'Active',
      index: true,
    },
    remainingRentalHours: {
      type: Number,
      min: 0,
      default: 0,
    },
    totalUsedHours: {
      type: Number,
      min: 0,
      default: 0,
    },
    autoRenew: {
      type: Boolean,
      default: false,
    },
    paymentStatus: {
      type: String,
      enum: SUBSCRIPTION_PAYMENT_STATUSES,
      default: 'Unpaid',
    },
    paymentMethod: {
      type: String,
      enum: SUBSCRIPTION_PAYMENT_METHODS,
      default: 'NONE',
    },
    amountPaid: {
      type: Number,
      min: 0,
      default: 0,
    },
    planSnapshot: {
      type: planSnapshotSchema,
      default: undefined,
    },
    usageHistory: {
      type: [usageEntrySchema],
      default: [],
    },
    renewalOf: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserSubscription',
      default: null,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },
    invoiceNumber: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
      default: undefined,
    },
    invoiceGeneratedAt: {
      type: Date,
      default: null,
    },
    invoicePdfPath: {
      type: String,
      trim: true,
      default: '',
    },
    emailNotifications: {
      activationSent: {
        type: Boolean,
        default: false,
      },
      activationSentAt: {
        type: Date,
        default: null,
      },
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

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toSnapshotValue = (value) => {
  if (!value || typeof value !== 'object') return undefined;
  return {
    planName: String(value.planName || '').trim(),
    durationType: String(value.durationType || '').trim(),
    durationInDays: Math.max(Math.round(toFiniteNumber(value.durationInDays, 30)), 1),
    price: Math.max(toFiniteNumber(value.price, 0), 0),
    includedRentalHours: Math.max(toFiniteNumber(value.includedRentalHours, 0), 0),
    lateFeeDiscountPercentage: clampPercent(value.lateFeeDiscountPercentage),
    damageFeeDiscountPercentage: clampPercent(value.damageFeeDiscountPercentage),
  };
};

userSubscriptionSchema.pre('validate', function normalizeSubscriptionFields() {
  if (!SUBSCRIPTION_STATUSES.includes(this.subscriptionStatus)) {
    this.subscriptionStatus = 'Active';
  }

  if (!SUBSCRIPTION_PAYMENT_STATUSES.includes(this.paymentStatus)) {
    this.paymentStatus = 'Unpaid';
  }

  if (!SUBSCRIPTION_PAYMENT_METHODS.includes(this.paymentMethod)) {
    this.paymentMethod = 'NONE';
  }

  const startDate = toValidDate(this.startDate) || new Date();
  const endDate = toValidDate(this.endDate);
  this.startDate = startDate;
  this.endDate = endDate && endDate.getTime() > startDate.getTime()
    ? endDate
    : new Date(startDate.getTime() + 30 * 24 * 60 * 60 * 1000);

  if (this.subscriptionStatus === 'Active' && this.endDate.getTime() <= Date.now()) {
    this.subscriptionStatus = 'Expired';
  }

  if (this.subscriptionStatus !== 'Cancelled') {
    this.cancelledAt = null;
  } else if (!toValidDate(this.cancelledAt)) {
    this.cancelledAt = new Date();
  } else {
    this.cancelledAt = toValidDate(this.cancelledAt);
  }

  this.remainingRentalHours = Math.max(toFiniteNumber(this.remainingRentalHours, 0), 0);
  this.totalUsedHours = Math.max(toFiniteNumber(this.totalUsedHours, 0), 0);
  this.amountPaid = Math.max(toFiniteNumber(this.amountPaid, 0), 0);

  this.planSnapshot = toSnapshotValue(this.planSnapshot);

  if (!Array.isArray(this.usageHistory)) {
    this.usageHistory = [];
  } else {
    this.usageHistory = this.usageHistory
      .map((entry) => ({
        bookingId: entry?.bookingId || null,
        hoursUsed: Math.max(toFiniteNumber(entry?.hoursUsed, 0), 0),
        amountCovered: Math.max(toFiniteNumber(entry?.amountCovered, 0), 0),
        amountCharged: Math.max(toFiniteNumber(entry?.amountCharged, 0), 0),
        usedAt: toValidDate(entry?.usedAt) || new Date(),
      }))
      .slice(-300);
  }
});

userSubscriptionSchema.index(
  { userId: 1, subscriptionStatus: 1 },
  {
    unique: true,
    partialFilterExpression: { subscriptionStatus: 'Active' },
  },
);
userSubscriptionSchema.index({ endDate: 1, subscriptionStatus: 1 });
userSubscriptionSchema.plugin(tenantScopedPlugin);

const UserSubscription = mongoose.model('UserSubscription', userSubscriptionSchema);

UserSubscription.SUBSCRIPTION_STATUSES = SUBSCRIPTION_STATUSES;
UserSubscription.SUBSCRIPTION_PAYMENT_STATUSES = SUBSCRIPTION_PAYMENT_STATUSES;
UserSubscription.SUBSCRIPTION_PAYMENT_METHODS = SUBSCRIPTION_PAYMENT_METHODS;

module.exports = UserSubscription;
