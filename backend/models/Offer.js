const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const OFFER_STATUSES = ['pending', 'countered', 'accepted', 'rejected', 'expired'];

const offerSchema = new mongoose.Schema(
  {
    car: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Car',
      required: true,
    },
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
    originalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    offeredPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    userOfferHistory: {
      type: [
        {
          type: Number,
          min: 0,
        },
      ],
      default: [],
      validate: {
        validator: function validateUserOfferHistory(values) {
          return Array.isArray(values) && values.length <= 3;
        },
        message: 'userOfferHistory cannot contain more than 3 offers',
      },
    },
    counterPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    message: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    status: {
      type: String,
      enum: OFFER_STATUSES,
      default: 'pending',
    },
    offerCount: {
      type: Number,
      min: 1,
      max: 3,
      default: 1,
    },
    fromDate: {
      type: Date,
      required: true,
    },
    toDate: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true }
);

offerSchema.path('toDate').validate(function validateToDate(value) {
  if (!this.fromDate || !value) return true;
  return value >= this.fromDate;
}, 'Return date must be on or after pickup date');

offerSchema.index({ user: 1, createdAt: -1 });
offerSchema.index({ car: 1, status: 1 });
offerSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Offer', offerSchema);
