const mongoose = require('mongoose');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const MESSAGE_TYPE = Object.freeze({
  GENERAL: 'general',
  BOOKING: 'booking',
  SYSTEM: 'system',
});

const MESSAGE_TYPE_VALUES = Object.values(MESSAGE_TYPE);

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
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
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      default: null,
      index: true,
    },
    type: {
      type: String,
      enum: MESSAGE_TYPE_VALUES,
      default: MESSAGE_TYPE.GENERAL,
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      maxlength: 4000,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    isDeletedForAll: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    deletedFor: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
  },
  { timestamps: true },
);

messageSchema.pre('validate', function normalizeMessageFields() {
  this.type = String(this.type || MESSAGE_TYPE.GENERAL).trim().toLowerCase();
  this.content = String(this.content || '').trim();

  const uniqueDeletedFor = [
    ...new Set((Array.isArray(this.deletedFor) ? this.deletedFor : []).map((entry) => String(entry || '').trim()).filter(Boolean)),
  ];
  this.deletedFor = uniqueDeletedFor
    .filter((entry) => mongoose.Types.ObjectId.isValid(entry))
    .map((entry) => new mongoose.Types.ObjectId(entry));

  if (this.isDeleted) {
    if (!this.content) {
      this.content = 'This message was deleted';
    }
    this.isDeletedForAll = Boolean(this.isDeletedForAll);
  } else if (!this.content) {
    this.invalidate('content', 'Message content is required');
  } else {
    this.isDeletedForAll = false;
  }
});

messageSchema.index({ tenantId: 1, senderId: 1, receiverId: 1, createdAt: -1 });
messageSchema.index({ tenantId: 1, receiverId: 1, isRead: 1, createdAt: -1 });

messageSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('Message', messageSchema);
module.exports.MESSAGE_TYPE = MESSAGE_TYPE;
module.exports.MESSAGE_TYPE_VALUES = MESSAGE_TYPE_VALUES;
