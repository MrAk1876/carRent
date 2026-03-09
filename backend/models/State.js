const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const stateSchema = new mongoose.Schema(
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
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

stateSchema.pre('validate', function normalizeStateFields() {
  this.name = String(this.name || '').replace(/\s+/g, ' ').trim();
  this.nameKey = String(this.name || '').toLowerCase();
});

stateSchema.index({ tenantId: 1, nameKey: 1 }, { unique: true });
stateSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('State', stateSchema);

