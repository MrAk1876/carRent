const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const locationSchema = new mongoose.Schema(
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
    cityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'City',
      required: true,
      index: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      default: null,
      index: true,
    },
    branchAddress: {
      type: String,
      trim: true,
      default: '',
      maxlength: 240,
    },
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
    isPrimary: {
      type: Boolean,
      default: false,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true },
);

locationSchema.pre('validate', function normalizeLocationFields() {
  this.name = String(this.name || '').replace(/\s+/g, ' ').trim();
  this.nameKey = String(this.name || '').toLowerCase();
  this.branchAddress = String(this.branchAddress || '').replace(/\s+/g, ' ').trim();
});

locationSchema.index({ tenantId: 1, branchId: 1, cityId: 1, nameKey: 1 }, { unique: true });
locationSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Location', locationSchema);
