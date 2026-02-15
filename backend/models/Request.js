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

    days: {
      type: Number,
      required: true,
    },

    totalAmount: {
      type: Number,
      required: true,
    },
    advanceAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PAID', 'REFUNDED'],
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

module.exports = mongoose.model('Request', requestSchema);
