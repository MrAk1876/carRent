const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
      maxlength: 4096,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
        trim: true,
      },
      auth: {
        type: String,
        required: true,
        trim: true,
      },
    },
  },
  { timestamps: true },
);

pushSubscriptionSchema.pre('validate', function normalizePushSubscriptionFields() {
  this.endpoint = String(this.endpoint || '').trim();
  this.keys = this.keys || {};
  this.keys.p256dh = String(this.keys.p256dh || '').trim();
  this.keys.auth = String(this.keys.auth || '').trim();

  if (!this.endpoint) {
    this.invalidate('endpoint', 'Push subscription endpoint is required');
  }
  if (!this.keys.p256dh || !this.keys.auth) {
    this.invalidate('keys', 'Push subscription keys are required');
  }
});

pushSubscriptionSchema.index({ tenantId: 1, userId: 1, createdAt: -1 });

pushSubscriptionSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
