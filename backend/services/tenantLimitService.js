const mongoose = require('mongoose');
const { ensureTenantById, ensureDefaultTenant } = require('./tenantService');

const toObjectId = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const toPositiveInt = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
  return Math.max(Math.floor(numericValue), 1);
};

const resolveTenantFromRequestContext = async (req, options = {}) => {
  const { allowUserFallback = true } = options;
  if (req?.tenant?._id) return req.tenant;

  const userTenantId = allowUserFallback ? String(req?.user?.tenantId || '').trim() : '';
  if (userTenantId) {
    const tenantFromUser = await ensureTenantById(userTenantId);
    if (tenantFromUser) return tenantFromUser;
  }

  const defaultTenant = await ensureDefaultTenant();
  if (req) {
    req.tenant = defaultTenant;
    req.tenantId = String(defaultTenant?._id || '');
    req.tenantCode = String(defaultTenant?.companyCode || '');
  }
  return defaultTenant;
};

const assertTenantEntityLimit = async (req, options = {}) => {
  const {
    model,
    limitField,
    label = 'records',
    query = {},
    statusCode = 422,
  } = options;

  if (!model || !limitField) return;

  const tenant = await resolveTenantFromRequestContext(req);
  const tenantId = toObjectId(tenant?._id);
  if (!tenantId) return;

  const allowedLimit = toPositiveInt(tenant?.[limitField], 0);
  if (allowedLimit <= 0) return;

  const countQuery = { ...query, tenantId };
  const currentCount = await model.countDocuments(countQuery).setOptions({ skipTenantFilter: true });

  if (currentCount >= allowedLimit) {
    const error = new Error(`Tenant ${label} limit reached. Please upgrade your plan.`);
    error.status = statusCode;
    error.code = 'TENANT_LIMIT_EXCEEDED';
    throw error;
  }
};

module.exports = {
  resolveTenantFromRequestContext,
  assertTenantEntityLimit,
};
