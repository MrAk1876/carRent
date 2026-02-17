const {
  isStaffRole,
  isUserRole,
  hasPermission,
  hasAnyPermission,
} = require('../utils/rbac');

const ensureUser = (req) => req && req.user;

const requireStaff = (req, res, next) => {
  if (!ensureUser(req) || !isStaffRole(req.user.role)) {
    return res.status(403).json({ message: 'Staff access only' });
  }
  return next();
};

const requireUserRole = (req, res, next) => {
  if (!ensureUser(req) || !isUserRole(req.user.role)) {
    return res.status(403).json({ message: 'User access only' });
  }
  return next();
};

const requirePermission = (permission) => (req, res, next) => {
  if (!ensureUser(req) || !isStaffRole(req.user.role)) {
    return res.status(403).json({ message: 'Staff access only' });
  }

  if (!hasPermission(req.user, permission)) {
    return res.status(403).json({ message: 'You do not have permission for this action' });
  }

  return next();
};

const requireAnyPermission = (...permissions) => (req, res, next) => {
  if (!ensureUser(req) || !isStaffRole(req.user.role)) {
    return res.status(403).json({ message: 'Staff access only' });
  }

  if (!hasAnyPermission(req.user, permissions)) {
    return res.status(403).json({ message: 'You do not have permission for this action' });
  }

  return next();
};

module.exports = {
  requireStaff,
  requireUserRole,
  requirePermission,
  requireAnyPermission,
};
