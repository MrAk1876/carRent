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

    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },

    advanceAmount: {
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
      enum: ['PENDING', 'ADVANCE_PAID', 'FULLY_PAID', 'REFUNDED'],
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
      enum: ['PENDING', 'CONFIRMED', 'REJECTED', 'CANCELLED_BY_USER'],
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

module.exports = mongoose.model('Booking', bookingSchema);
