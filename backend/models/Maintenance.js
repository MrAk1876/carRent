const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const SERVICE_TYPES = [
  'Regular Service',
  'Oil Change',
  'Engine Work',
  'Tire Change',
  'Insurance Renewal',
  'Other',
];

const MAINTENANCE_STATUS = ['Scheduled', 'Completed'];

const maintenanceSchema = new mongoose.Schema(
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
    serviceType: {
      type: String,
      enum: SERVICE_TYPES,
      default: 'Regular Service',
      required: true,
      trim: true,
    },
    serviceDescription: {
      type: String,
      trim: true,
      default: '',
      maxlength: 1600,
    },
    serviceDate: {
      type: Date,
      required: true,
      index: true,
    },
    nextServiceDueDate: {
      type: Date,
      default: null,
      index: true,
    },
    serviceMileage: {
      type: Number,
      min: 0,
      default: null,
    },
    serviceCost: {
      type: Number,
      min: 0,
      default: 0,
    },
    serviceProvider: {
      type: String,
      trim: true,
      default: '',
      maxlength: 240,
    },
    invoiceReference: {
      type: String,
      trim: true,
      default: '',
      maxlength: 500,
    },
    maintenanceStatus: {
      type: String,
      enum: MAINTENANCE_STATUS,
      default: 'Scheduled',
      index: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true },
);

maintenanceSchema.pre('validate', function normalizeMaintenanceFields() {
  const toValidDate = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  };

  this.serviceDate = toValidDate(this.serviceDate);
  this.nextServiceDueDate = toValidDate(this.nextServiceDueDate);

  const parsedMileage = Number(this.serviceMileage);
  this.serviceMileage = Number.isFinite(parsedMileage) && parsedMileage >= 0 ? parsedMileage : null;

  const parsedCost = Number(this.serviceCost);
  this.serviceCost = Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : 0;

  this.serviceDescription = String(this.serviceDescription || '').trim();
  this.serviceProvider = String(this.serviceProvider || '').trim();
  this.invoiceReference = String(this.invoiceReference || '').trim();
});

maintenanceSchema.index({ carId: 1, serviceDate: -1 });
maintenanceSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Maintenance', maintenanceSchema);
module.exports.SERVICE_TYPES = SERVICE_TYPES;
module.exports.MAINTENANCE_STATUS = MAINTENANCE_STATUS;
