const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const toValidDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const carBlackoutSchema = new mongoose.Schema(
  {
    carId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Car',
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    startDate: {
      type: Date,
      required: true,
      index: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      trim: true,
      default: '',
      maxlength: 600,
    },
  },
  { timestamps: true },
);

carBlackoutSchema.pre('validate', function normalizeBlackoutDates() {
  this.startDate = toValidDate(this.startDate);
  this.endDate = toValidDate(this.endDate);
  this.reason = String(this.reason || '').trim();

  if (this.startDate && this.endDate && this.endDate.getTime() < this.startDate.getTime()) {
    this.invalidate('endDate', 'endDate cannot be earlier than startDate');
  }
});

carBlackoutSchema.index({ carId: 1, startDate: 1, endDate: 1 });
carBlackoutSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('CarBlackout', carBlackoutSchema);
