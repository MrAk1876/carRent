const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { getPermissionsForRole, normalizeRole, normalizeBranches } = require('../utils/rbac');
const { requireStaff, requireUserRole } = require('./rbacMiddleware');
const { syncTenantContextFromUser } = require('./tenantMiddleware');

exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Server authentication is not configured" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id)
      .setOptions({ skipTenantFilter: true })
      .select("-password");

    if (!req.user) {
      return res.status(401).json({ message: "User no longer exists" });
    }

    if (req.user.isBlocked) {
      return res.status(403).json({ message: "Account is blocked" });
    }

    const normalizedRole = normalizeRole(req.user.role);
    const normalizedBranches = normalizeBranches(req.user.assignedBranches);
    const roleChanged = normalizedRole !== req.user.role;
    const branchesChanged =
      JSON.stringify(normalizedBranches) !== JSON.stringify(Array.isArray(req.user.assignedBranches) ? req.user.assignedBranches : []);

    req.user.role = normalizedRole;
    req.user.assignedBranches = normalizedBranches;
    req.user.permissions = getPermissionsForRole(normalizedRole);
    await syncTenantContextFromUser(req, req.user);

    if (roleChanged || branchesChanged) {
      User.updateOne(
        { _id: req.user._id },
        { $set: { role: normalizedRole, assignedBranches: normalizedBranches } },
      ).catch((migrationError) => {
        console.error('role normalization sync failed:', migrationError);
      });
    }

    next();
  } catch (error) {
    res.status(401).json({ message: "Invalid token" });
  }
};

exports.adminOnly = (req, res, next) => {
  return requireStaff(req, res, next);
};

exports.userOnly = (req, res, next) => {
  return requireUserRole(req, res, next);
};
