const { normalizeRole, ROLE } = require('../utils/rbac');
const {
  runWithTenantContext,
  setTenantContext,
} = require('../services/tenantContextService');
const {
  ensureTenantById,
  resolveTenantFromRequest,
  isTenantSuspended,
} = require('../services/tenantService');

const isPlatformSuperAdmin = (roleValue) => normalizeRole(roleValue, ROLE.USER) === ROLE.PLATFORM_SUPER_ADMIN;

const initializeTenantContext = async (req, res, next) => {
  runWithTenantContext({}, async () => {
    try {
      const requestTenant = await resolveTenantFromRequest(req);
      req.tenant = requestTenant || null;
      req.tenantId = requestTenant?._id ? String(requestTenant._id) : '';
      req.tenantCode = String(requestTenant?.companyCode || '');

      setTenantContext({
        tenantId: req.tenantId,
        tenantCode: req.tenantCode,
      });

      next();
    } catch (error) {
      const status = Number(error?.status || 500);
      const message = status >= 500 ? 'Failed to resolve tenant context' : error.message;
      res.status(status).json({ message });
    }
  });
};

const syncTenantContextFromUser = async (req, user) => {
  const role = normalizeRole(user?.role, ROLE.USER);
  const platformAdmin = isPlatformSuperAdmin(role);
  const tenantId = String(user?.tenantId || '').trim();
  let tenant = req.tenant || null;

  if (tenantId) {
    tenant = await ensureTenantById(tenantId);
  }

  req.tenant = tenant || null;
  req.tenantId = tenant?._id ? String(tenant._id) : tenantId;
  req.tenantCode = String(tenant?.companyCode || req.tenantCode || '');

  setTenantContext({
    tenantId: platformAdmin ? '' : req.tenantId,
    tenantCode: req.tenantCode,
    role,
    isPlatformSuperAdmin: platformAdmin,
  });
};

const enforceTenantActive = (options = {}) => async (req, res, next) => {
  try {
    const { bookingOnly = false } = options;
    const role = normalizeRole(req.user?.role, ROLE.USER);
    if (isPlatformSuperAdmin(role)) {
      return next();
    }

    const tenant = req.tenant || (req.tenantId ? await ensureTenantById(req.tenantId) : null);
    if (!tenant) {
      return res.status(403).json({ message: 'Tenant is not configured for this account' });
    }

    if (isTenantSuspended(tenant)) {
      return res.status(403).json({
        message: bookingOnly
          ? 'Booking operations are disabled because this tenant is suspended'
          : 'Tenant account is suspended',
      });
    }

    return next();
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to validate tenant status' : error.message;
    return res.status(status).json({ message });
  }
};

const requirePlatformSuperAdmin = (req, res, next) => {
  const role = normalizeRole(req.user?.role, ROLE.USER);
  if (role !== ROLE.PLATFORM_SUPER_ADMIN) {
    return res.status(403).json({ message: 'PlatformSuperAdmin access required' });
  }
  return next();
};

module.exports = {
  initializeTenantContext,
  syncTenantContextFromUser,
  enforceTenantActive,
  requirePlatformSuperAdmin,
};

