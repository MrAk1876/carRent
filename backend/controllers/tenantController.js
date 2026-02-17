const { ensureDefaultTenant } = require('../services/tenantService');

const normalizeTenantPayload = (tenant) => ({
  _id: String(tenant?._id || ''),
  companyName: String(tenant?.companyName || ''),
  companyCode: String(tenant?.companyCode || ''),
  contactEmail: String(tenant?.contactEmail || ''),
  subscriptionPlan: String(tenant?.subscriptionPlan || 'Basic'),
  subscriptionStartDate: tenant?.subscriptionStartDate || null,
  subscriptionEndDate: tenant?.subscriptionEndDate || null,
  tenantStatus: String(tenant?.tenantStatus || 'Active'),
  maxBranches: Number(tenant?.maxBranches || 0),
  maxVehicles: Number(tenant?.maxVehicles || 0),
  maxUsers: Number(tenant?.maxUsers || 0),
  maxDrivers: Number(tenant?.maxDrivers || 0),
  logoUrl: String(tenant?.logoUrl || ''),
  primaryColor: String(tenant?.primaryColor || '#2563EB'),
  secondaryColor: String(tenant?.secondaryColor || '#0F172A'),
  createdAt: tenant?.createdAt || null,
  updatedAt: tenant?.updatedAt || null,
});

exports.getCurrentTenantContext = async (req, res) => {
  try {
    const tenant = req.tenant || await ensureDefaultTenant();
    return res.json({
      tenant: normalizeTenantPayload(tenant),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load tenant context' : error.message;
    return res.status(status).json({ message });
  }
};

