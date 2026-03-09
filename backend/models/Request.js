const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');
const {
  normalizeRentalDaysValue,
  calculateRentalDaysByCalendar,
  calculateFixedDropDateTime,
} = require('../utils/rentalDateUtils');
const { RANGE_TYPE_VALUES, normalizeRangeType } = require('../utils/depositRangeUtils');

const requestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },

    car: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Car',
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'State',
      default: null,
      index: true,
    },
    cityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'City',
      default: null,
      index: true,
    },
    locationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
      index: true,
    },
    locationName: {
      type: String,
      trim: true,
      default: '',
    },
    customerStateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'State',
      default: null,
      index: true,
    },
    customerCityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'City',
      default: null,
      index: true,
    },
    customerLocationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Location',
      default: null,
      index: true,
    },
    customerStateName: {
      type: String,
      trim: true,
      default: '',
    },
    customerCityName: {
      type: String,
      trim: true,
      default: '',
    },
    customerLocationName: {
      type: String,
      trim: true,
      default: '',
    },
    locationMismatchType: {
      type: String,
      enum: ['NONE', 'OTHER_LOCATION', 'OTHER_CITY', 'OTHER_STATE'],
      default: 'NONE',
      index: true,
    },
    locationMismatchMessage: {
      type: String,
      trim: true,
      default: '',
    },

    fromDate: {
      type: Date,
      required: true,
    },

    toDate: {
      type: Date,
      required: true,
    },
    pickupDateTime: {
      type: Date,
      default: null,
    },
    dropDateTime: {
      type: Date,
      default: null,
    },
    rentalDays: {
      type: Number,
      min: 1,
      default: 1,
    },
    gracePeriodHours: {
      type: Number,
      min: 0,
      default: 1,
    },

    days: {
      type: Number,
      required: true,
    },
    priceRangeType: {
      type: String,
      enum: RANGE_TYPE_VALUES,
      default: 'LOW_RANGE',
    },
    depositAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    depositRuleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DepositRule',
      default: null,
      index: true,
    },

    totalAmount: {
      type: Number,
      required: true,
    },
    lockedPerDayPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    basePerDayPrice: {
      type: Number,
      default: 0,
      min: 0,
    },
    pricingBaseAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    pricingLockedAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    priceSource: {
      type: String,
      enum: ['Base', 'Dynamic', 'Manual'],
      default: 'Base',
    },
    priceAdjustmentPercent: {
      type: Number,
      default: 0,
      min: -20,
      max: 30,
    },
    finalAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    advanceAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    advanceRequired: {
      type: Number,
      default: 0,
      min: 0,
    },
    advancePaid: {
      type: Number,
      default: 0,
      min: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    rentalType: {
      type: String,
      enum: ['OneTime', 'Subscription'],
      default: 'OneTime',
    },
    subscriptionPlanId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SubscriptionPlan',
      default: null,
      index: true,
    },
    userSubscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserSubscription',
      default: null,
      index: true,
    },
    subscriptionBaseAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    subscriptionHoursUsed: {
      type: Number,
      default: 0,
      min: 0,
    },
    subscriptionCoverageAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    subscriptionExtraAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    subscriptionLateFeeDiscountPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    subscriptionDamageFeeDiscountPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    paymentStatus: {
      type: String,
      enum: [
        'UNPAID',
        'PAID',
        'REFUNDED',
        'PARTIALLY_PAID',
        'FULLY_PAID',
        'Unpaid',
        'Partially Paid',
        'Fully Paid',
      ],
      default: 'UNPAID',
    },
    paymentMethod: {
      type: String,
      enum: ['NONE', 'CARD', 'UPI', 'NETBANKING', 'CASH', 'WALLET'],
      default: 'NONE',
    },
    paymentReference: {
      type: String,
      trim: true,
      maxlength: 120,
      default: '',
    },
    advancePaidAt: {
      type: Date,
      default: null,
    },
    bargain: {
      userAttempts: {
        type: Number,
        default: 1,
      },
      userPrice: Number,
      adminCounterPrice: Number,
      status: {
        type: String,
        enum: ['NONE', 'USER_OFFERED', 'ADMIN_COUNTERED', 'ACCEPTED', 'REJECTED', 'LOCKED'],
        default: 'NONE',
      },
    },

    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'cancelled'],
      default: 'pending',
    },
  },
  { timestamps: true },
);

requestSchema.pre('validate', function syncDynamicPaymentFields() {
  const normalizeRentalType = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'subscription') return 'Subscription';
    return 'OneTime';
  };
  const clampPercent = (value) => {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
    if (numericValue >= 100) return 100;
    return Number(numericValue.toFixed(2));
  };
  if (!this.pickupDateTime && this.fromDate) {
    this.pickupDateTime = this.fromDate;
  }

  if (!this.dropDateTime && this.toDate) {
    this.dropDateTime = this.toDate;
  }

  if (!this.fromDate && this.pickupDateTime) {
    this.fromDate = this.pickupDateTime;
  }

  if (!this.toDate && this.dropDateTime) {
    this.toDate = this.dropDateTime;
  }

  const shouldEnforceFixedDropTime = this.isNew || this.isModified('rentalDays');
  const normalizedRentalDays =
    normalizeRentalDaysValue(this.rentalDays, { min: 1, max: 3650, allowNull: true }) ||
    normalizeRentalDaysValue(
      calculateRentalDaysByCalendar(this.pickupDateTime || this.fromDate, this.dropDateTime || this.toDate),
      { min: 1, max: 3650, allowNull: true },
    ) ||
    1;

  this.rentalDays = normalizedRentalDays;

  const policyRentalDays = normalizeRentalDaysValue(normalizedRentalDays, { allowNull: true });
  if (shouldEnforceFixedDropTime && policyRentalDays) {
    const fixedDropDateTime = calculateFixedDropDateTime(
      this.pickupDateTime || this.fromDate,
      policyRentalDays,
    );
    if (fixedDropDateTime) {
      this.dropDateTime = fixedDropDateTime;
      this.toDate = fixedDropDateTime;
    }
  }

  const normalizedGracePeriodHours = Number(this.gracePeriodHours);
  if (!Number.isFinite(normalizedGracePeriodHours) || normalizedGracePeriodHours < 0) {
    this.gracePeriodHours = 1;
  }

  const normalizedBillingDays = Number(this.days);
  if (!Number.isFinite(normalizedBillingDays) || normalizedBillingDays <= 0) {
    this.days = Number(this.rentalDays || 1);
  }

  this.priceRangeType = normalizeRangeType(this.priceRangeType, 'LOW_RANGE');
  const normalizedDepositAmount = Number(this.depositAmount || 0);
  this.depositAmount =
    Number.isFinite(normalizedDepositAmount) && normalizedDepositAmount >= 0
      ? Number(normalizedDepositAmount.toFixed(2))
      : 0;

  const totalAmount = Number(this.totalAmount || 0);
  const finalAmount = Number(this.finalAmount || 0);
  const advanceAmount = Number(this.advanceAmount || 0);
  const advanceRequired = Number(this.advanceRequired || 0);
  const advancePaid = Number(this.advancePaid || 0);
  const remainingAmount = Number(this.remainingAmount || 0);
  const lockedPerDayPrice = Number(this.lockedPerDayPrice || 0);
  const basePerDayPrice = Number(this.basePerDayPrice || 0);
  const pricingBaseAmount = Number(this.pricingBaseAmount || 0);
  const pricingLockedAmount = Number(this.pricingLockedAmount || 0);
  const subscriptionBaseAmount = Number(this.subscriptionBaseAmount || 0);
  const subscriptionHoursUsed = Number(this.subscriptionHoursUsed || 0);
  const subscriptionCoverageAmount = Number(this.subscriptionCoverageAmount || 0);
  const subscriptionExtraAmount = Number(this.subscriptionExtraAmount || 0);

  this.rentalType = normalizeRentalType(this.rentalType);
  this.subscriptionLateFeeDiscountPercentage = clampPercent(this.subscriptionLateFeeDiscountPercentage);
  this.subscriptionDamageFeeDiscountPercentage = clampPercent(this.subscriptionDamageFeeDiscountPercentage);

  if (!Number.isFinite(finalAmount) || finalAmount < 0) {
    this.finalAmount = Math.max(totalAmount, 0);
  }

  if (!Number.isFinite(this.totalAmount) || this.totalAmount < 0) {
    this.totalAmount = Math.max(Number(this.finalAmount || 0), 0);
  }

  if (!Number.isFinite(lockedPerDayPrice) || lockedPerDayPrice < 0) {
    this.lockedPerDayPrice = 0;
  }

  if (!Number.isFinite(basePerDayPrice) || basePerDayPrice < 0) {
    this.basePerDayPrice = 0;
  }

  if (!Number.isFinite(pricingBaseAmount) || pricingBaseAmount < 0) {
    this.pricingBaseAmount = 0;
  }

  if (!Number.isFinite(pricingLockedAmount) || pricingLockedAmount < 0) {
    this.pricingLockedAmount = 0;
  }

  const normalizedPriceAdjustmentPercent = Number(this.priceAdjustmentPercent || 0);
  if (!Number.isFinite(normalizedPriceAdjustmentPercent)) {
    this.priceAdjustmentPercent = 0;
  } else {
    this.priceAdjustmentPercent = Math.max(
      -20,
      Math.min(30, Number(normalizedPriceAdjustmentPercent.toFixed(2))),
    );
  }

  const normalizedPriceSource = String(this.priceSource || '').trim();
  if (!['Base', 'Dynamic', 'Manual'].includes(normalizedPriceSource)) {
    this.priceSource = 'Base';
  }

  if (this.pricingLockedAmount <= 0) {
    this.pricingLockedAmount = Math.max(Number(this.finalAmount || this.totalAmount || 0), 0);
  }

  if (this.lockedPerDayPrice <= 0 && this.pricingLockedAmount > 0 && this.days > 0) {
    this.lockedPerDayPrice = Number((this.pricingLockedAmount / this.days).toFixed(2));
  }

  if (this.basePerDayPrice <= 0 && this.lockedPerDayPrice > 0 && this.priceSource === 'Base') {
    this.basePerDayPrice = this.lockedPerDayPrice;
  }

  if (
    this.pricingBaseAmount <= 0 &&
    this.basePerDayPrice > 0 &&
    this.lockedPerDayPrice > 0 &&
    this.pricingLockedAmount > 0
  ) {
    this.pricingBaseAmount = Number(
      ((this.pricingLockedAmount * this.basePerDayPrice) / this.lockedPerDayPrice).toFixed(2),
    );
  }

  if (!Number.isFinite(advanceRequired) || advanceRequired < 0) {
    this.advanceRequired = Math.max(advanceAmount, 0);
  }

  if (!Number.isFinite(this.advanceAmount) || this.advanceAmount < 0) {
    this.advanceAmount = Math.max(Number(this.advanceRequired || 0), 0);
  }

  if (!Number.isFinite(advancePaid) || advancePaid < 0) {
    this.advancePaid = 0;
  }

  if (!Number.isFinite(remainingAmount) || remainingAmount < 0) {
    const resolvedFinal = Math.max(Number(this.finalAmount || this.totalAmount || 0), 0);
    const resolvedAdvanceRequired = Math.max(Number(this.advanceRequired || this.advanceAmount || 0), 0);
    this.remainingAmount = Math.max(resolvedFinal - resolvedAdvanceRequired, 0);
  }

  if (!Number.isFinite(subscriptionBaseAmount) || subscriptionBaseAmount < 0) {
    this.subscriptionBaseAmount = Math.max(Number(this.finalAmount || this.totalAmount || 0), 0);
  }

  if (!Number.isFinite(subscriptionHoursUsed) || subscriptionHoursUsed < 0) {
    this.subscriptionHoursUsed = 0;
  }

  if (!Number.isFinite(subscriptionCoverageAmount) || subscriptionCoverageAmount < 0) {
    this.subscriptionCoverageAmount = 0;
  }

  if (!Number.isFinite(subscriptionExtraAmount) || subscriptionExtraAmount < 0) {
    this.subscriptionExtraAmount = Math.max(Number(this.finalAmount || this.totalAmount || 0), 0);
  }

});

requestSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Request', requestSchema);
