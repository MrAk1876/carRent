const mongoose = require('mongoose');

const newsletterSubscriberSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 160,
    },
    tenantCode: {
      type: String,
      trim: true,
      uppercase: true,
      default: '',
      maxlength: 64,
    },
    status: {
      type: String,
      enum: ['active', 'unsubscribed'],
      default: 'active',
    },
    source: {
      type: String,
      trim: true,
      default: 'website',
      maxlength: 80,
    },
  },
  { timestamps: true },
);

newsletterSubscriberSchema.index({ email: 1, tenantCode: 1 }, { unique: true });

module.exports = mongoose.model('NewsletterSubscriber', newsletterSubscriberSchema);
