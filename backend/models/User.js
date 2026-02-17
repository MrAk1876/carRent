const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ROLE, normalizeRole, normalizeBranches } = require('../utils/rbac');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const userSchema = new mongoose.Schema(
  {
    // Login fields
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Invalid email format'],
    },

    password: {
      type: String,
      required: true,
      minlength: 8,
    },

    // Profile fields
    firstName: {
      type: String,
      default: '',
      trim: true,
    },

    lastName: {
      type: String,
      default: '',
      trim: true,
    },

    age: {
      type: Number,
      validate: {
        validator: function (v) {
          // allow empty age during registration
          if (v === undefined || v === null) return true;

          // enforce age only when profile is completed
          return v >= 18;
        },
        message: 'User must be at least 18 years old',
      },
    },

    dob: {
      type: String,
      validate: {
        validator: function (v) {
          if (!v) return true; // allow empty for old users
          return new Date(v) <= new Date();
        },
        message: 'Date of birth cannot be in the future',
      },
    },

    phone: {
      type: String,
      validate: {
        validator: function (v) {
          if (!v) return true; // allow empty for old users
          return /^[0-9]{10}$/.test(v);
        },
        message: 'Phone number must be exactly 10 digits',
      },
    },

    address: {
      type: String,
      default: '',
      trim: true,
    },

    image: {
      type: String,
      default: '',
    },

    imagePublicId: {
      type: String,
      default: '',
    },

    role: {
      type: String,
      enum: ROLES,
      default: ROLE.USER,
    },

    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tenant',
      default: null,
      index: true,
    },

    assignedBranches: {
      type: [String],
      default: [],
    },

    isBlocked: {
      type: Boolean,
      default: false,
    },

    isProfileComplete: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 10);
});

userSchema.pre('validate', function normalizeRoleFields() {
  this.role = normalizeRole(this.role, ROLE.USER);
  this.assignedBranches = normalizeBranches(this.assignedBranches);
});

userSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('User', userSchema);
