const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const citySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    nameKey: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 120,
    },
    stateId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'State',
      required: true,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

citySchema.pre('validate', function normalizeCityFields() {
  this.name = String(this.name || '').replace(/\s+/g, ' ').trim();
  this.nameKey = String(this.name || '').toLowerCase();
});

citySchema.index({ tenantId: 1, stateId: 1, nameKey: 1 }, { unique: true });
citySchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('City', citySchema);

