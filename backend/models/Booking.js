const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');
const {
  normalizeRentalDaysValue,
  calculateRentalDaysByCalendar,
  calculateFixedDropDateTime,
} = require('../utils/rentalDateUtils');
const { RANGE_TYPE_VALUES, normalizeRangeType } = require('../utils/depositRangeUtils');

const PAYMENT_DEADLINE_WINDOW_MS = 15 * 60 * 1000;
const MAX_INSPECTION_IMAGES = 12;

const pickupInspectionSchema = new mongoose.Schema(
  {
    conditionNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1200,
    },
    damageReported: {
      type: Boolean,
      default: false,
    },
    images: {
      type: [String],
      default: [],
    },
    inspectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    inspectedAt: {
      type: Date,
      default: null,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const returnInspectionSchema = new mongoose.Schema(
  {
    conditionNotes: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1200,
    },
    damageDetected: {
      type: Boolean,
      default: false,
    },
    damageLevel: {
      type: String,
      enum: ['NO_DAMAGE', 'MINOR_DAMAGE', 'MAJOR_DAMAGE'],
      default: 'NO_DAMAGE',
    },
    damageStatus: {
      type: String,
      enum: ['NONE', 'MINOR', 'MAJOR'],
      default: 'NONE',
    },
    damageCost: {
      type: Number,
      min: 0,
      default: 0,
    },
    originalDamageCost: {
      type: Number,
      min: 0,
      default: 0,
    },
    damageDiscountPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    currentMileage: {
      type: Number,
      min: 0,
      default: null,
    },
    images: {
      type: [String],
      default: [],
    },
    inspectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    inspectedAt: {
      type: Date,
      default: null,
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false }
);

const geoLocationSchema = new mongoose.Schema(
  {
    latitude: {
      type: Number,
      min: -90,
      max: 90,
      default: null,
    },
    longitude: {
      type: Number,
      min: -180,
      max: 180,
      default: null,
    },
    address: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
  },
  { _id: false }
);

const bookingSchema = new mongoose.Schema(
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
    assignedDriver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Driver',
      default: null,
      index: true,
    },
    driverAssignedAt: {
      type: Date,
      default: null,
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
    pickupLocation: {
      type: geoLocationSchema,
      default: undefined,
    },
    dropLocation: {
      type: geoLocationSchema,
      default: undefined,
    },
    actualPickupTime: {
      type: Date,
      default: null,
    },
    actualReturnTime: {
      type: Date,
      default: null,
    },
    gracePeriodHours: {
      type: Number,
      min: 0,
      default: 1,
    },
    rentalStage: {
      type: String,
      enum: ['Scheduled', 'Active', 'Overdue', 'Completed'],
      default: undefined,
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
    depositPaid: {
      type: Number,
      min: 0,
      default: 0,
    },
    depositRefunded: {
      type: Number,
      min: 0,
      default: 0,
    },
    depositDeducted: {
      type: Number,
      min: 0,
      default: 0,
    },
    depositStatus: {
      type: String,
      enum: ['NOT_APPLICABLE', 'HELD', 'REFUNDED', 'DEDUCTED', 'PARTIALLY_DEDUCTED'],
      default: 'NOT_APPLICABLE',
      index: true,
    },
    totalRentalAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    amountPaid: {
      type: Number,
      min: 0,
      default: 0,
    },
    amountRemaining: {
      type: Number,
      min: 0,
      default: 0,
    },

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
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
      default: 0,
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
      index: true,
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
    lateHours: {
      type: Number,
      default: 0,
      min: 0,
    },
    lateFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    hourlyLateRate: {
      type: Number,
      default: 0,
      min: 0,
    },

    paymentMethod: {
      type: String,
      enum: ['NONE', 'CARD', 'UPI', 'NETBANKING', 'CASH', 'WALLET'],
      default: 'NONE',
    },

    paymentStatus: {
      type: String,
      enum: [
        'PENDING',
        'UNPAID',
        'ADVANCE_PAID',
        'PARTIALLY_PAID',
        'PARTIALLY PAID',
        'FULLY_PAID',
        'FULLY PAID',
        'REFUNDED',
        'Unpaid',
        'Partially Paid',
        'Fully Paid',
      ],
      default: 'PENDING',
    },
    paymentDeadline: {
      type: Date,
      default: null,
    },

    fullPaymentAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    fullPaymentMethod: {
      type: String,
      enum: ['NONE', 'CARD', 'UPI', 'NETBANKING', 'CASH', 'WALLET'],
      default: 'NONE',
    },

    fullPaymentReceivedAt: {
      type: Date,
      default: null,
    },
    invoiceNumber: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
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
    invoiceStatus: {
      type: String,
      enum: ['NotGenerated', 'Generated'],
      default: 'NotGenerated',
    },
    refundAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    refundStatus: {
      type: String,
      enum: ['None', 'Pending', 'Processed', 'Rejected'],
      default: 'None',
    },
    refundReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 240,
    },
    refundProcessedAt: {
      type: Date,
      default: null,
    },
    pickupInspection: {
      type: pickupInspectionSchema,
      default: undefined,
    },
    returnInspection: {
      type: returnInspectionSchema,
      default: undefined,
    },
    emailNotifications: {
      pendingPaymentSent: {
        type: Boolean,
        default: false,
      },
      pendingPaymentSentAt: {
        type: Date,
        default: null,
      },
      advancePaidConfirmationSent: {
        type: Boolean,
        default: false,
      },
      advancePaidConfirmationSentAt: {
        type: Date,
        default: null,
      },
      autoCancelledSent: {
        type: Boolean,
        default: false,
      },
      autoCancelledSentAt: {
        type: Date,
        default: null,
      },
      overdueAlertSent: {
        type: Boolean,
        default: false,
      },
      overdueAlertSentAt: {
        type: Date,
        default: null,
      },
      completionInvoiceSent: {
        type: Boolean,
        default: false,
      },
      completionInvoiceSentAt: {
        type: Date,
        default: null,
      },
      refundProcessedSent: {
        type: Boolean,
        default: false,
      },
      refundProcessedSentAt: {
        type: Date,
        default: null,
      },
    },
    reminder2hrSent: {
      type: Boolean,
      default: false,
      index: true,
    },
    reminder1hrSent: {
      type: Boolean,
      default: false,
      index: true,
    },
    reminderDropTimeCompleteSent: {
      type: Boolean,
      default: false,
      index: true,
    },
    dropExpiredMessageSent: {
      type: Boolean,
      default: false,
      index: true,
    },

    bookingStatus: {
      type: String,
      enum: [
        'PENDING',
        'CONFIRMED',
        'REJECTED',
        'CANCELLED_BY_USER',
        'PendingPayment',
        'Confirmed',
        'Completed',
        'Cancelled',
      ],
      default: 'PENDING',
    },
    cancellationReason: {
      type: String,
      default: '',
      trim: true,
      maxlength: 160,
    },
    cancelledAt: {
      type: Date,
      default: null,
    },

    bargain: {
      userAttempts: {
        type: Number,
        default: 0,
      },

      userPrice: Number,
      adminCounterPrice: Number,

      status: {
        type: String,
        enum: ['NONE', 'USER_OFFERED', 'ADMIN_COUNTERED', 'ACCEPTED', 'REJECTED', 'LOCKED'],
        default: 'NONE',
      },
    },

    tripStatus: {
      type: String,
      enum: ['upcoming', 'active', 'completed'],
      default: 'upcoming',
    },
  },
  { timestamps: true }
);

bookingSchema.index({ 'pickupLocation.latitude': 1, 'pickupLocation.longitude': 1 });
bookingSchema.index({ 'dropLocation.latitude': 1, 'dropLocation.longitude': 1 });

bookingSchema.pre('validate', function syncPaymentFields() {
  const normalizeKey = (value) => String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const toBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
      if (['false', '0', 'no', 'n'].includes(normalized)) return false;
    }
    return fallback;
  };
  const toValidDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };
  const toCleanImagePaths = (value) => {
    if (!Array.isArray(value)) return [];
    return value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
      .slice(0, MAX_INSPECTION_IMAGES);
  };
  const normalizeCoordinate = (value, min, max) => {
    if (value === undefined || value === null || value === '') return null;
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return null;
    if (numericValue < min || numericValue > max) return null;
    return numericValue;
  };
  const normalizeGeoLocation = (value) => {
    if (!value || typeof value !== 'object') return undefined;

    const latitude = normalizeCoordinate(value.latitude, -90, 90);
    const longitude = normalizeCoordinate(value.longitude, -180, 180);
    const address = String(value.address || '').trim();

    if (latitude === null && longitude === null && !address) {
      return undefined;
    }

    return {
      latitude,
      longitude,
      address,
    };
  };
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
  const bookingStatusKey = normalizeKey(this.bookingStatus);
  const paymentStatusKey = normalizeKey(this.paymentStatus);

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

  this.pickupLocation = normalizeGeoLocation(this.pickupLocation);
  this.dropLocation = normalizeGeoLocation(this.dropLocation);

  const normalizedGracePeriodHours = Number(this.gracePeriodHours);
  if (!Number.isFinite(normalizedGracePeriodHours) || normalizedGracePeriodHours < 0) {
    this.gracePeriodHours = 1;
  }

  this.priceRangeType = normalizeRangeType(this.priceRangeType, 'LOW_RANGE');
  const normalizedDepositAmount = Number(this.depositAmount || 0);
  this.depositAmount =
    Number.isFinite(normalizedDepositAmount) && normalizedDepositAmount >= 0
      ? Number(normalizedDepositAmount.toFixed(2))
      : 0;
  const normalizedDepositPaid = Number(this.depositPaid || 0);
  this.depositPaid =
    Number.isFinite(normalizedDepositPaid) && normalizedDepositPaid >= 0
      ? Number(normalizedDepositPaid.toFixed(2))
      : 0;
  const normalizedDepositRefunded = Number(this.depositRefunded || 0);
  this.depositRefunded =
    Number.isFinite(normalizedDepositRefunded) && normalizedDepositRefunded >= 0
      ? Number(normalizedDepositRefunded.toFixed(2))
      : 0;
  const normalizedDepositDeducted = Number(this.depositDeducted || 0);
  this.depositDeducted =
    Number.isFinite(normalizedDepositDeducted) && normalizedDepositDeducted >= 0
      ? Number(normalizedDepositDeducted.toFixed(2))
      : 0;
  const normalizedTotalRentalAmount = Number(this.totalRentalAmount || 0);
  this.totalRentalAmount =
    Number.isFinite(normalizedTotalRentalAmount) && normalizedTotalRentalAmount >= 0
      ? Number(normalizedTotalRentalAmount.toFixed(2))
      : 0;
  const normalizedAmountPaid = Number(this.amountPaid || 0);
  this.amountPaid =
    Number.isFinite(normalizedAmountPaid) && normalizedAmountPaid >= 0
      ? Number(normalizedAmountPaid.toFixed(2))
      : 0;
  const normalizedAmountRemaining = Number(this.amountRemaining || 0);
  this.amountRemaining =
    Number.isFinite(normalizedAmountRemaining) && normalizedAmountRemaining >= 0
      ? Number(normalizedAmountRemaining.toFixed(2))
      : 0;
  if (!['NOT_APPLICABLE', 'HELD', 'REFUNDED', 'DEDUCTED', 'PARTIALLY_DEDUCTED'].includes(String(this.depositStatus || ''))) {
    this.depositStatus = this.depositAmount > 0 ? 'HELD' : 'NOT_APPLICABLE';
  }

  if (!this.rentalStage) {
    if (this.actualReturnTime || this.tripStatus === 'completed' || bookingStatusKey === 'COMPLETED') {
      this.rentalStage = 'Completed';
    } else if (this.actualPickupTime || this.tripStatus === 'active') {
      this.rentalStage = 'Active';
    } else if (['CONFIRMED', 'PENDING', 'PENDINGPAYMENT'].includes(bookingStatusKey)) {
      this.rentalStage = 'Scheduled';
    }
  }

  if (this.actualReturnTime) {
    this.rentalStage = 'Completed';
  } else if (this.actualPickupTime && this.rentalStage === 'Scheduled') {
    this.rentalStage = 'Active';
  }

  const normalizedPaymentDeadline = toValidDate(this.paymentDeadline);
  const normalizedDriverAssignedAt = toValidDate(this.driverAssignedAt);
  if (bookingStatusKey === 'PENDINGPAYMENT') {
    if (!normalizedPaymentDeadline) {
      const baseCreatedAt = toValidDate(this.createdAt) || new Date();
      this.paymentDeadline = new Date(baseCreatedAt.getTime() + PAYMENT_DEADLINE_WINDOW_MS);
    }
  } else if (this.paymentDeadline && !normalizedPaymentDeadline) {
    this.paymentDeadline = null;
  }

  if (!this.assignedDriver) {
    this.driverAssignedAt = null;
  } else {
    this.driverAssignedAt = normalizedDriverAssignedAt || new Date();
  }

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
  const lateHours = Number(this.lateHours || 0);
  const lateFee = Number(this.lateFee || 0);
  const hourlyLateRate = Number(this.hourlyLateRate || 0);
  const refundAmount = Number(this.refundAmount || 0);

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

  const pickupForPricing = toValidDate(this.pickupDateTime || this.fromDate);
  const dropForPricing = toValidDate(this.dropDateTime || this.toDate);
  let billableDays = 1;
  if (pickupForPricing && dropForPricing && dropForPricing > pickupForPricing) {
    const durationHours = (dropForPricing.getTime() - pickupForPricing.getTime()) / (1000 * 60 * 60);
    const fullDays = Math.floor(durationHours / 24);
    const remainderHours = durationHours - fullDays * 24;
    if (remainderHours <= 0) {
      billableDays = Math.max(fullDays, 1);
    } else if (remainderHours < 12) {
      billableDays = fullDays + 0.5;
    } else {
      billableDays = fullDays + 1;
    }
  }

  if (this.pricingLockedAmount <= 0) {
    this.pricingLockedAmount = Math.max(Number(this.finalAmount || this.totalAmount || 0), 0);
  }

  if (this.lockedPerDayPrice <= 0 && this.pricingLockedAmount > 0) {
    this.lockedPerDayPrice = Number((this.pricingLockedAmount / billableDays).toFixed(2));
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

  if (!Number.isFinite(hourlyLateRate) || hourlyLateRate < 0) {
    this.hourlyLateRate = 0;
  }

  if (!Number.isFinite(lateHours) || lateHours < 0) {
    this.lateHours = 0;
  }

  if (!Number.isFinite(lateFee) || lateFee < 0) {
    this.lateFee = 0;
  }

  if (!Number.isFinite(remainingAmount) || remainingAmount < 0) {
    const resolvedFinal = Math.max(Number(this.finalAmount || this.totalAmount || 0), 0);
    let resolvedAdvancePaid = Math.max(Number(this.advancePaid || 0), 0);
    if (
      resolvedAdvancePaid <= 0 &&
      ['PAID', 'PARTIALLYPAID', 'FULLYPAID', 'ADVANCEPAID'].includes(normalizeKey(this.paymentStatus))
    ) {
      resolvedAdvancePaid = Math.max(Number(this.advanceRequired || this.advanceAmount || 0), 0);
    }
    const resolvedLateFee = Math.max(Number(this.lateFee || 0), 0);
    const resolvedDamageCost = this?.returnInspection?.damageDetected
      ? Math.max(Number(this?.returnInspection?.damageCost || 0), 0)
      : 0;
    this.remainingAmount = Math.max(resolvedFinal - resolvedAdvancePaid, 0) + resolvedLateFee + resolvedDamageCost;
  }

  if (this.totalRentalAmount <= 0) {
    this.totalRentalAmount = Math.max(Number(this.finalAmount || this.totalAmount || 0), 0);
  }

  this.amountRemaining = Math.max(Number(this.remainingAmount || this.amountRemaining || 0), 0);
  this.remainingAmount = this.amountRemaining;

  if (this.amountPaid <= 0) {
    const advancePaidAmount = Math.max(Number(this.advancePaid || 0), 0);
    const fullPaidAmount = Math.max(Number(this.fullPaymentAmount || 0), 0);
    this.amountPaid = Number((advancePaidAmount + fullPaidAmount).toFixed(2));
  }

  if (!Number.isFinite(refundAmount) || refundAmount < 0) {
    this.refundAmount = 0;
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

  const normalizedRefundStatus = normalizeKey(this.refundStatus);
  if (!normalizedRefundStatus) {
    this.refundStatus = 'None';
  }

  if (normalizeKey(this.refundStatus) !== 'PROCESSED' && this.refundProcessedAt) {
    const parsedProcessedAt = toValidDate(this.refundProcessedAt);
    this.refundProcessedAt = parsedProcessedAt || null;
  }

  if (this.pickupInspection) {
    this.pickupInspection.conditionNotes = String(this.pickupInspection.conditionNotes || '').trim();
    this.pickupInspection.damageReported = toBoolean(this.pickupInspection.damageReported, false);
    this.pickupInspection.images = toCleanImagePaths(this.pickupInspection.images);
    this.pickupInspection.isLocked = toBoolean(this.pickupInspection.isLocked, false);
    this.pickupInspection.inspectedAt = toValidDate(this.pickupInspection.inspectedAt);
  }

  if (this.returnInspection) {
    this.returnInspection.conditionNotes = String(this.returnInspection.conditionNotes || '').trim();
    this.returnInspection.damageDetected = toBoolean(this.returnInspection.damageDetected, false);
    const normalizedDamageStatus = String(this.returnInspection.damageStatus || '').trim().toUpperCase();
    if (['NONE', 'MINOR', 'MAJOR'].includes(normalizedDamageStatus)) {
      this.returnInspection.damageStatus = normalizedDamageStatus;
    } else {
      this.returnInspection.damageStatus = this.returnInspection.damageDetected ? 'MINOR' : 'NONE';
    }
    const normalizedDamageLevel = String(this.returnInspection.damageLevel || '').trim().toUpperCase();
    if (normalizedDamageLevel === 'MINOR_DAMAGE' || normalizedDamageLevel === 'MAJOR_DAMAGE') {
      this.returnInspection.damageLevel = normalizedDamageLevel;
    } else {
      this.returnInspection.damageLevel = this.returnInspection.damageStatus === 'MAJOR'
        ? 'MAJOR_DAMAGE'
        : this.returnInspection.damageDetected
          ? 'MINOR_DAMAGE'
          : 'NO_DAMAGE';
    }

    if (this.returnInspection.damageStatus === 'MAJOR') {
      this.returnInspection.damageDetected = true;
      this.returnInspection.damageLevel = 'MAJOR_DAMAGE';
    } else if (this.returnInspection.damageStatus === 'MINOR') {
      this.returnInspection.damageDetected = true;
      this.returnInspection.damageLevel = 'MINOR_DAMAGE';
    }

    const parsedDamageCost = Number(this.returnInspection.damageCost);
    this.returnInspection.damageCost =
      Number.isFinite(parsedDamageCost) && parsedDamageCost >= 0 ? parsedDamageCost : 0;

    const parsedOriginalDamageCost = Number(this.returnInspection.originalDamageCost);
    this.returnInspection.originalDamageCost =
      Number.isFinite(parsedOriginalDamageCost) && parsedOriginalDamageCost >= 0
        ? parsedOriginalDamageCost
        : this.returnInspection.damageCost;

    const parsedDamageDiscount = Number(this.returnInspection.damageDiscountPercentage);
    this.returnInspection.damageDiscountPercentage =
      Number.isFinite(parsedDamageDiscount) && parsedDamageDiscount >= 0
        ? Math.min(Number(parsedDamageDiscount.toFixed(2)), 100)
        : 0;

    if (!this.returnInspection.damageDetected) {
      this.returnInspection.damageCost = 0;
      this.returnInspection.originalDamageCost = 0;
      this.returnInspection.damageDiscountPercentage = 0;
      this.returnInspection.damageLevel = 'NO_DAMAGE';
      this.returnInspection.damageStatus = 'NONE';
    } else if (this.returnInspection.damageStatus === 'NONE') {
      this.returnInspection.damageStatus = this.returnInspection.damageLevel === 'MAJOR_DAMAGE' ? 'MAJOR' : 'MINOR';
    }

    const parsedReturnMileage = Number(this.returnInspection.currentMileage);
    this.returnInspection.currentMileage =
      Number.isFinite(parsedReturnMileage) && parsedReturnMileage >= 0 ? parsedReturnMileage : null;

    this.returnInspection.images = toCleanImagePaths(this.returnInspection.images);
    this.returnInspection.isLocked = toBoolean(this.returnInspection.isLocked, false);
    this.returnInspection.inspectedAt = toValidDate(this.returnInspection.inspectedAt);
  }

  const isInvoiceEligible = bookingStatusKey === 'COMPLETED' && paymentStatusKey === 'FULLYPAID';
  if (!this.invoiceStatus) {
    this.invoiceStatus = 'NotGenerated';
  }

  if (!isInvoiceEligible && normalizeKey(this.invoiceStatus) !== 'GENERATED') {
    this.invoiceStatus = 'NotGenerated';
  }

});

bookingSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Booking', bookingSchema);
