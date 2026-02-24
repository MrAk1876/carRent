const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { ROLE, normalizeRole, getPermissionsForRole } = require('../utils/rbac');
const { normalizeStoredImageUrl } = require('../utils/imageUrl');
const { ensureTenantById, isTenantSuspended } = require('../services/tenantService');
const {
  resolveTenantFromRequestContext,
  assertTenantEntityLimit,
} = require('../services/tenantLimitService');

const MIN_PASSWORD_LENGTH = 8;

const buildUserAuthPayload = (user, options = {}) => {
  const resolvedRole = normalizeRole(user?.role);
  const permissions = getPermissionsForRole(resolvedRole);
  const tenant = options.tenant || null;

  return {
    _id: user?._id,
    firstName: user?.firstName,
    lastName: user?.lastName,
    email: user?.email,
    role: resolvedRole,
    permissions,
    isProfileComplete: user?.isProfileComplete,
    image: normalizeStoredImageUrl(user?.image),
    assignedBranches: Array.isArray(user?.assignedBranches) ? user.assignedBranches : [],
    tenantId: String(tenant?._id || user?.tenantId || ''),
    tenantCode: String(tenant?.companyCode || ''),
    tenantStatus: String(tenant?.tenantStatus || ''),
    tenantName: String(tenant?.companyName || ''),
  };
};

// REGISTER
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const safeFirstName = String(firstName || '').trim();
    const safeLastName = String(lastName || '').trim();

    if (!safeFirstName || !safeLastName || !normalizedEmail || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server authentication is not configured" });
    }

    const tenant = await resolveTenantFromRequestContext(req, { allowUserFallback: false });
    if (!tenant?._id) {
      return res.status(403).json({ message: 'Tenant is not configured for this request' });
    }
    if (isTenantSuspended(tenant)) {
      return res.status(403).json({ message: 'Tenant account is suspended. Contact platform support.' });
    }

    const userExists = await User.findOne({ email: normalizedEmail });
    if (userExists) {
      return res.status(400).json({ message: "Email already registered" });
    }
    await assertTenantEntityLimit(req, {
      model: User,
      limitField: 'maxUsers',
      label: 'users',
    });

    const user = await User.create({
      firstName: safeFirstName,
      lastName: safeLastName,
      email: normalizedEmail,
      password,
      role: ROLE.USER,
      tenantId: tenant._id,
    });

    const payload = buildUserAuthPayload(user, { tenant });

    const token = jwt.sign(
      { id: user._id, role: payload.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      token,
      user: payload,
    });
  } catch (error) {
    console.error("Register error:", error);
    if (Number(error?.code) === 11000) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    const status = Number(error?.status || 500);
    const message = status >= 500 ? "Registration failed" : error.message;
    res.status(status).json({ message });
  }
};


// LOGIN
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();

    if (!normalizedEmail || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server authentication is not configured" });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) return res.status(400).json({ message: 'Invalid credentials' });

    if (user.isBlocked) return res.status(403).json({ message: 'Account is blocked' });

    const tenant = await ensureTenantById(user.tenantId || req.tenant?._id || '');
    const normalizedRole = normalizeRole(user.role);
    if (isTenantSuspended(tenant) && normalizedRole !== ROLE.PLATFORM_SUPER_ADMIN) {
      return res.status(403).json({ message: 'Tenant account is suspended. Contact support.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid credentials' });

    const payload = buildUserAuthPayload(user, { tenant });
    const token = jwt.sign({ id: user._id, role: payload.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      user: payload,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Login failed' });
  }
};
