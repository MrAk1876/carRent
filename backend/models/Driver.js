const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const DRIVER_AVAILABILITY_VALUES = ['Available', 'Assigned', 'Inactive'];

const driverSchema = new mongoose.Schema(
  {
    driverName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: 20,
    },
    licenseNumber: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      maxlength: 40,
    },
    licenseExpiry: {
      type: Date,
      required: true,
    },
    branchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Branch',
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },
    availabilityStatus: {
      type: String,
      enum: DRIVER_AVAILABILITY_VALUES,
      default: 'Available',
      index: true,
    },
    currentAssignedBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    totalTripsCompleted: {
      type: Number,
      min: 0,
      default: 0,
    },
    rating: {
      type: Number,
      min: 0,
      max: 5,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

driverSchema.pre('validate', function normalizeDriverFields() {
  this.driverName = String(this.driverName || '').trim();
  this.phoneNumber = String(this.phoneNumber || '').trim();
  this.licenseNumber = String(this.licenseNumber || '').trim().toUpperCase();

  if (!this.isActive) {
    this.availabilityStatus = 'Inactive';
  } else if (!this.availabilityStatus || this.availabilityStatus === 'Inactive') {
    this.availabilityStatus = this.currentAssignedBooking ? 'Assigned' : 'Available';
  }

  if (this.availabilityStatus !== 'Assigned') {
    this.currentAssignedBooking = null;
  }

  const totalTripsCompleted = Number(this.totalTripsCompleted);
  this.totalTripsCompleted = Number.isFinite(totalTripsCompleted) && totalTripsCompleted >= 0
    ? totalTripsCompleted
    : 0;

  if (this.rating !== null && this.rating !== undefined) {
    const rating = Number(this.rating);
    this.rating = Number.isFinite(rating) && rating >= 0 && rating <= 5 ? rating : null;
  } else {
    this.rating = null;
  }
});

driverSchema.index({ branchId: 1, availabilityStatus: 1, isActive: 1 });
driverSchema.index({ tenantId: 1, licenseNumber: 1 }, { unique: true });
driverSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Driver', driverSchema);
