const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { ROLES, ROLE, normalizeRole, normalizeBranches } = require('../utils/rbac');
const tenantScopedPlugin = require('../plugins/tenantScopedPlugin');

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const parseDobParts = (input) => {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const datePart = raw.includes('T') ? raw.split('T')[0] : raw;
  const match = DATE_ONLY_PATTERN.exec(datePart);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(year, month - 1, day);

  if (
    Number.isNaN(candidate.getTime()) ||
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
};

const isFutureDob = (dobParts, referenceDate = new Date()) => {
  if (!dobParts) return true;

  const referenceYear = referenceDate.getFullYear();
  const referenceMonth = referenceDate.getMonth() + 1;
  const referenceDay = referenceDate.getDate();

  if (dobParts.year > referenceYear) return true;
  if (dobParts.year < referenceYear) return false;
  if (dobParts.month > referenceMonth) return true;
  if (dobParts.month < referenceMonth) return false;
  return dobParts.day > referenceDay;
};

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
          const dobParts = parseDobParts(v);
          if (!dobParts) return false;
          return !isFutureDob(dobParts);
        },
        message: 'Date of birth must be a valid past date',
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

userSchema.pre('validate', async function enforceSingleSuperAdmin() {
  if (this.role !== ROLE.SUPER_ADMIN) return;

  const tenantFilter = this.tenantId
    ? { tenantId: this.tenantId }
    : {
        $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
      };

  const existingSuperAdmin = await this.constructor.exists({
    ...tenantFilter,
    role: ROLE.SUPER_ADMIN,
    _id: { $ne: this._id },
  });

  if (existingSuperAdmin) {
    this.invalidate('role', 'Only one SuperAdmin is allowed for this tenant');
  }
});

userSchema.plugin(tenantScopedPlugin);

module.exports = mongoose.model('User', userSchema);
