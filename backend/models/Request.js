const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    car: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Car',
      required: true,
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
    gracePeriodHours: {
      type: Number,
      min: 0,
      default: 1,
    },

    days: {
      type: Number,
      required: true,
    },

    totalAmount: {
      type: Number,
      required: true,
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
      enum: ['NONE', 'CARD', 'UPI', 'NETBANKING', 'CASH'],
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

  const normalizedGracePeriodHours = Number(this.gracePeriodHours);
  if (!Number.isFinite(normalizedGracePeriodHours) || normalizedGracePeriodHours < 0) {
    this.gracePeriodHours = 1;
  }

  const totalAmount = Number(this.totalAmount || 0);
  const finalAmount = Number(this.finalAmount || 0);
  const advanceAmount = Number(this.advanceAmount || 0);
  const advanceRequired = Number(this.advanceRequired || 0);
  const advancePaid = Number(this.advancePaid || 0);
  const remainingAmount = Number(this.remainingAmount || 0);

  if (!Number.isFinite(finalAmount) || finalAmount < 0) {
    this.finalAmount = Math.max(totalAmount, 0);
  }

  if (!Number.isFinite(this.totalAmount) || this.totalAmount < 0) {
    this.totalAmount = Math.max(Number(this.finalAmount || 0), 0);
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

});

module.exports = mongoose.model('Request', requestSchema);
