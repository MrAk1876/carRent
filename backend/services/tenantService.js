const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const { normalizeRole, ROLE } = require('../utils/rbac');

const DEFAULT_TENANT_CODE = 'DEFAULT';
const DEFAULT_TENANT_NAME = 'DefaultTenant';

let tenantBootstrapPromise = null;

const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (mongoose.Types.ObjectId.isValid(value)) return String(value);
  if (value?._id && mongoose.Types.ObjectId.isValid(value._id)) return String(value._id);
  return '';
};

const ensureDefaultTenant = async () => {
  let tenant = await Tenant.findOne({ companyCode: DEFAULT_TENANT_CODE });
  if (tenant) return tenant;

  try {
    tenant = await Tenant.create({
      companyName: DEFAULT_TENANT_NAME,
      companyCode: DEFAULT_TENANT_CODE,
      contactEmail: '',
      subscriptionPlan: 'Enterprise',
      subscriptionStartDate: new Date(),
      tenantStatus: 'Active',
      maxBranches: 9999,
      maxVehicles: 999999,
      maxUsers: 999999,
      maxDrivers: 999999,
      logoUrl: '',
      primaryColor: '#2563EB',
      secondaryColor: '#0F172A',
    });
    return tenant;
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return Tenant.findOne({ companyCode: DEFAULT_TENANT_CODE });
    }
    throw error;
  }
};

const ensureTenantById = async (tenantId) => {
  const normalizedTenantId = toObjectIdString(tenantId);
  if (!normalizedTenantId || !mongoose.Types.ObjectId.isValid(normalizedTenantId)) {
    return null;
  }
  return Tenant.findById(normalizedTenantId);
};

const ensureTenantByCode = async (companyCode) => {
  const normalizedCode = Tenant.toTenantCode(companyCode);
  if (!normalizedCode) return null;
  return Tenant.findOne({ companyCode: normalizedCode });
};

const resolveTenantFromRequest = async (req) => {
  const fromHeader = String(req.headers?.['x-tenant-code'] || '').trim();
  const fromQuery = String(req.query?.tenantCode || '').trim();
  const fromBody = String(req.body?.tenantCode || '').trim();
  const tenantCode = fromHeader || fromQuery || fromBody;

  if (tenantCode) {
    const found = await ensureTenantByCode(tenantCode);
    if (found) return found;
  }

  return ensureDefaultTenant();
};

const isTenantSuspended = (tenant) => String(tenant?.tenantStatus || '').trim().toLowerCase() === 'suspended';

const bootstrapTenantSystem = async () => {
  if (!tenantBootstrapPromise) {
    tenantBootstrapPromise = (async () => {
      const defaultTenant = await ensureDefaultTenant();
      const defaultTenantId = defaultTenant._id;

      const User = require('../models/User');
      const Branch = require('../models/Branch');
      const Car = require('../models/Car');
      const Booking = require('../models/Booking');
      const Driver = require('../models/Driver');
      const Maintenance = require('../models/Maintenance');
      const SubscriptionPlan = require('../models/SubscriptionPlan');
      const Request = require('../models/Request');
      const Offer = require('../models/Offer');
      const UserSubscription = require('../models/UserSubscription');
      const AuditLog = require('../models/AuditLog');

      const models = [
        User,
        Branch,
        Car,
        Booking,
        Driver,
        Maintenance,
        SubscriptionPlan,
        Request,
        Offer,
        UserSubscription,
        AuditLog,
      ];
      await Promise.all(
        models.map((model) =>
          model.updateMany(
            {
              $or: [{ tenantId: { $exists: false } }, { tenantId: null }],
            },
            { $set: { tenantId: defaultTenantId } },
            { skipTenantFilter: true },
          ),
        ),
      );

      await User.updateMany(
        { role: { $in: ['admin', 'Admin'] } },
        { $set: { role: ROLE.SUPER_ADMIN } },
        { skipTenantFilter: true },
      );

      const roleNormalizationCursor = User.find({})
        .select('_id role')
        .setOptions({ skipTenantFilter: true })
        .cursor();
      for await (const user of roleNormalizationCursor) {
        const normalizedRole = normalizeRole(user.role, ROLE.USER);
        if (normalizedRole !== user.role) {
          await User.updateOne(
            { _id: user._id },
            { $set: { role: normalizedRole } },
            { skipTenantFilter: true },
          );
        }
      }

      return defaultTenant;
    })().catch((error) => {
      tenantBootstrapPromise = null;
      throw error;
    });
  }

  return tenantBootstrapPromise;
};

module.exports = {
  DEFAULT_TENANT_CODE,
  DEFAULT_TENANT_NAME,
  toObjectIdString,
  ensureDefaultTenant,
  ensureTenantById,
  ensureTenantByCode,
  resolveTenantFromRequest,
  isTenantSuspended,
  bootstrapTenantSystem,
};
