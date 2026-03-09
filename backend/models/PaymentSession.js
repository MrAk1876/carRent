const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const PAYMENT_METHOD_VALUES = ['NONE', 'UPI', 'CARD', 'NETBANKING', 'WALLET', 'CASH'];
const PAYMENT_SESSION_STATUS_VALUES = ['CREATED', 'OTP_SENT', 'OTP_VERIFIED', 'SUCCESS', 'FAILED', 'EXPIRED'];

const paymentSessionSchema = new mongoose.Schema(
  {
    token: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    referenceModel: {
      type: String,
      enum: ['Request', 'Booking'],
      default: 'Request',
      index: true,
    },
    resolvedBookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    otp: {
      type: String,
      trim: true,
      default: '',
    },
    otpVerified: {
      type: Boolean,
      default: false,
    },
    otpAttempts: {
      type: Number,
      min: 0,
      max: 3,
      default: 0,
    },
    otpSentAt: {
      type: Date,
      default: null,
    },
    otpExpiresAt: {
      type: Date,
      default: null,
    },
    mobileNumber: {
      type: String,
      trim: true,
      default: '',
      maxlength: 20,
    },
    paymentMethod: {
      type: String,
      enum: PAYMENT_METHOD_VALUES,
      default: 'NONE',
    },
    status: {
      type: String,
      enum: PAYMENT_SESSION_STATUS_VALUES,
      default: 'CREATED',
      index: true,
    },
    transactionId: {
      type: String,
      trim: true,
      default: '',
      maxlength: 80,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'payment_sessions',
  },
);

paymentSessionSchema.index({ tenantId: 1, userId: 1, bookingId: 1, createdAt: -1 });
paymentSessionSchema.index({ tenantId: 1, token: 1 });

paymentSessionSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('PaymentSession', paymentSessionSchema);
module.exports.PAYMENT_METHOD_VALUES = PAYMENT_METHOD_VALUES;
module.exports.PAYMENT_SESSION_STATUS_VALUES = PAYMENT_SESSION_STATUS_VALUES;
