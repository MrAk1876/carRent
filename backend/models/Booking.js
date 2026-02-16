const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
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

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
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
      enum: ['NONE', 'CARD', 'UPI', 'NETBANKING', 'CASH'],
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

    fullPaymentAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    fullPaymentMethod: {
      type: String,
      enum: ['NONE', 'CARD', 'UPI', 'NETBANKING', 'CASH'],
      default: 'NONE',
    },

    fullPaymentReceivedAt: {
      type: Date,
      default: null,
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

bookingSchema.pre('validate', function syncPaymentFields() {
  const normalizeKey = (value) => String(value || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
  const bookingStatusKey = normalizeKey(this.bookingStatus);

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

  const totalAmount = Number(this.totalAmount || 0);
  const finalAmount = Number(this.finalAmount || 0);
  const advanceAmount = Number(this.advanceAmount || 0);
  const advanceRequired = Number(this.advanceRequired || 0);
  const advancePaid = Number(this.advancePaid || 0);
  const remainingAmount = Number(this.remainingAmount || 0);
  const lateHours = Number(this.lateHours || 0);
  const lateFee = Number(this.lateFee || 0);
  const hourlyLateRate = Number(this.hourlyLateRate || 0);

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
    this.remainingAmount = Math.max(resolvedFinal - resolvedAdvancePaid, 0) + resolvedLateFee;
  }

});

module.exports = mongoose.model('Booking', bookingSchema);
