const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Booking = require('../models/Booking');
const Branch = require('../models/Branch');
const Car = require('../models/Car');
const User = require('../models/User');
const Driver = require('../models/Driver');

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const toPositiveInt = (value, fallback) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return fallback;
  return Math.max(Math.floor(numericValue), 1);
};

const toSafeDate = (value) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const clampPercent = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return Number(numericValue.toFixed(2));
};

const normalizeStatusExpression = (fieldExpression) => ({
  $let: {
    vars: {
      raw: {
        $toUpper: {
          $trim: {
            input: { $ifNull: [fieldExpression, ''] },
          },
        },
      },
    },
    in: {
      $replaceAll: {
        input: {
          $replaceAll: {
            input: {
              $replaceAll: {
                input: '$$raw',
                find: ' ',
                replacement: '',
              },
            },
            find: '_',
            replacement: '',
          },
        },
        find: '-',
        replacement: '',
      },
    },
  },
});

const normalizeTenantPayload = (tenant, usage = {}) => ({
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
  usage: {
    branches: Number(usage?.branches || 0),
    vehicles: Number(usage?.vehicles || 0),
    users: Number(usage?.users || 0),
    drivers: Number(usage?.drivers || 0),
  },
  createdAt: tenant?.createdAt || null,
  updatedAt: tenant?.updatedAt || null,
});

const parseTenantBody = (body = {}) => {
  const subscriptionPlan = String(body.subscriptionPlan || '').trim();
  const tenantStatus = String(body.tenantStatus || '').trim();
  const payload = {
    companyName: String(body.companyName || '').trim(),
    companyCode: Tenant.toTenantCode(body.companyCode || body.companyName || ''),
    contactEmail: String(body.contactEmail || '').trim().toLowerCase(),
    subscriptionPlan: Tenant.SUBSCRIPTION_PLANS.includes(subscriptionPlan) ? subscriptionPlan : 'Basic',
    subscriptionStartDate: toSafeDate(body.subscriptionStartDate || new Date()),
    subscriptionEndDate: toSafeDate(body.subscriptionEndDate),
    tenantStatus: Tenant.TENANT_STATUS.includes(tenantStatus) ? tenantStatus : 'Active',
    maxBranches: toPositiveInt(body.maxBranches, 5),
    maxVehicles: toPositiveInt(body.maxVehicles, 100),
    maxUsers: toPositiveInt(body.maxUsers, 1000),
    maxDrivers: toPositiveInt(body.maxDrivers, 200),
    logoUrl: String(body.logoUrl || '').trim(),
    primaryColor: String(body.primaryColor || '#2563EB').trim(),
    secondaryColor: String(body.secondaryColor || '#0F172A').trim(),
  };
  return payload;
};

const toObjectId = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const buildCountMap = (rows = []) =>
  rows.reduce((acc, row) => {
    const id = String(row?._id || '');
    if (!id) return acc;
    acc[id] = Number(row?.count || 0);
    return acc;
  }, {});

const resolveUsageByTenant = async (tenantIds = []) => {
  const objectIds = tenantIds.map(toObjectId).filter(Boolean);
  if (objectIds.length === 0) {
    return {};
  }

  const [branchRows, vehicleRows, userRows, driverRows] = await Promise.all([
    Branch.aggregate([{ $match: { tenantId: { $in: objectIds } } }, { $group: { _id: '$tenantId', count: { $sum: 1 } } }]),
    Car.aggregate([{ $match: { tenantId: { $in: objectIds } } }, { $group: { _id: '$tenantId', count: { $sum: 1 } } }]),
    User.aggregate([{ $match: { tenantId: { $in: objectIds } } }, { $group: { _id: '$tenantId', count: { $sum: 1 } } }]),
    Driver.aggregate([{ $match: { tenantId: { $in: objectIds } } }, { $group: { _id: '$tenantId', count: { $sum: 1 } } }]),
  ]);

  const branchesMap = buildCountMap(branchRows);
  const vehiclesMap = buildCountMap(vehicleRows);
  const usersMap = buildCountMap(userRows);
  const driversMap = buildCountMap(driverRows);

  return tenantIds.reduce((acc, tenantId) => {
    const normalizedId = String(tenantId || '');
    acc[normalizedId] = {
      branches: branchesMap[normalizedId] || 0,
      vehicles: vehiclesMap[normalizedId] || 0,
      users: usersMap[normalizedId] || 0,
      drivers: driversMap[normalizedId] || 0,
    };
    return acc;
  }, {});
};

exports.getPlatformOverview = async (req, res) => {
  try {
    const now = new Date();
    const windowMs = 30 * 24 * 60 * 60 * 1000;
    const currentFrom = new Date(now.getTime() - windowMs);
    const previousFrom = new Date(currentFrom.getTime() - windowMs);
    const previousTo = new Date(currentFrom.getTime() - 1);

    const [
      totalTenants,
      activeSubscriptions,
      currentGrowthCount,
      previousGrowthCount,
      revenueRows,
      fleetSummary,
      totalBranches,
      totalUsers,
      totalDrivers,
    ] = await Promise.all([
      Tenant.countDocuments({}),
      Tenant.countDocuments({
        tenantStatus: 'Active',
        $or: [{ subscriptionEndDate: null }, { subscriptionEndDate: { $gte: now } }],
      }),
      Tenant.countDocuments({ createdAt: { $gte: currentFrom, $lte: now } }),
      Tenant.countDocuments({ createdAt: { $gte: previousFrom, $lte: previousTo } }),
      Booking.aggregate([
        {
          $addFields: {
            paymentStatusKey: normalizeStatusExpression('$paymentStatus'),
          },
        },
        {
          $match: {
            paymentStatusKey: { $in: ['FULLYPAID', 'PAID'] },
          },
        },
        {
          $group: {
            _id: '$tenantId',
            totalRevenue: {
              $sum: {
                $max: [
                  { $ifNull: ['$totalPaid', '$finalAmount'] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      Car.aggregate([
        {
          $group: {
            _id: null,
            totalVehicles: { $sum: 1 },
            activeVehicles: {
              $sum: {
                $cond: [{ $ne: [{ $ifNull: ['$fleetStatus', 'Available'] }, 'Inactive'] }, 1, 0],
              },
            },
            rentedVehicles: {
              $sum: {
                $cond: [{ $eq: [{ $ifNull: ['$fleetStatus', 'Available'] }, 'Rented'] }, 1, 0],
              },
            },
          },
        },
      ]),
      Branch.countDocuments({}),
      User.countDocuments({}),
      Driver.countDocuments({}),
    ]);

    const revenueByTenantId = revenueRows
      .filter((row) => row?._id)
      .map((row) => ({
        tenantId: String(row._id),
        totalRevenue: Number(row.totalRevenue || 0),
      }))
      .sort((left, right) => right.totalRevenue - left.totalRevenue);

    const totalRevenue = revenueByTenantId.reduce((sum, row) => sum + row.totalRevenue, 0);
    const mostProfitableRow = revenueByTenantId[0] || null;
    const mostProfitableTenant = mostProfitableRow
      ? await Tenant.findById(mostProfitableRow.tenantId).select('companyName companyCode').lean()
      : null;

    const previousBase = Number(previousGrowthCount || 0);
    const currentBase = Number(currentGrowthCount || 0);
    const tenantGrowthRate =
      previousBase <= 0
        ? (currentBase > 0 ? 100 : 0)
        : ((currentBase - previousBase) / previousBase) * 100;

    const fleet = fleetSummary[0] || { totalVehicles: 0, activeVehicles: 0, rentedVehicles: 0 };
    const activeVehicles = Number(fleet.activeVehicles || 0);
    const rentedVehicles = Number(fleet.rentedVehicles || 0);
    const utilizationPercent = activeVehicles > 0 ? clampPercent((rentedVehicles / activeVehicles) * 100) : 0;

    return res.json({
      summary: {
        totalTenants: Number(totalTenants || 0),
        totalRevenue: Number(totalRevenue.toFixed(2)),
        activeSubscriptions: Number(activeSubscriptions || 0),
        tenantGrowthRate: clampPercent(tenantGrowthRate),
        mostProfitableTenant: mostProfitableTenant
          ? {
              tenantId: String(mostProfitableRow?.tenantId || ''),
              companyName: String(mostProfitableTenant.companyName || ''),
              companyCode: String(mostProfitableTenant.companyCode || ''),
              totalRevenue: Number((mostProfitableRow?.totalRevenue || 0).toFixed(2)),
            }
          : null,
        platformUtilizationMetrics: {
          totalBranches: Number(totalBranches || 0),
          totalVehicles: Number(fleet.totalVehicles || 0),
          activeVehicles,
          rentedVehicles,
          utilizationPercent,
          totalUsers: Number(totalUsers || 0),
          totalDrivers: Number(totalDrivers || 0),
        },
      },
    });
  } catch (error) {
    console.error('getPlatformOverview error:', error);
    return res.status(500).json({ message: 'Failed to load platform overview' });
  }
};

exports.getTenants = async (req, res) => {
  try {
    const page = toPositiveInt(req.query?.page, 1);
    const pageSize = Math.min(toPositiveInt(req.query?.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    const search = String(req.query?.search || '').trim();
    const statusFilter = String(req.query?.tenantStatus || '').trim();

    const query = {};
    if (statusFilter && Tenant.TENANT_STATUS.includes(statusFilter)) {
      query.tenantStatus = statusFilter;
    }

    if (search) {
      const pattern = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [
        { companyName: pattern },
        { companyCode: pattern },
        { contactEmail: pattern },
      ];
    }

    const [total, rows] = await Promise.all([
      Tenant.countDocuments(query),
      Tenant.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const tenantIds = rows.map((tenant) => String(tenant?._id || '')).filter(Boolean);
    const usageByTenant = await resolveUsageByTenant(tenantIds);

    return res.json({
      tenants: rows.map((tenant) => normalizeTenantPayload(tenant, usageByTenant[String(tenant?._id || '')])),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(Math.ceil(total / pageSize), 1),
      },
    });
  } catch (error) {
    console.error('getTenants error:', error);
    return res.status(500).json({ message: 'Failed to load tenants' });
  }
};

exports.createTenant = async (req, res) => {
  try {
    const payload = parseTenantBody(req.body || {});
    if (!payload.companyName) {
      return res.status(422).json({ message: 'companyName is required' });
    }
    if (!payload.companyCode || payload.companyCode.length < 2) {
      return res.status(422).json({ message: 'Valid companyCode is required' });
    }

    const tenant = await Tenant.create(payload);
    return res.status(201).json({
      message: 'Tenant created successfully',
      tenant: normalizeTenantPayload(tenant),
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return res.status(422).json({ message: 'companyCode already exists' });
    }
    console.error('createTenant error:', error);
    return res.status(500).json({ message: 'Failed to create tenant' });
  }
};

exports.updateTenant = async (req, res) => {
  try {
    const tenantId = String(req.params.id || '').trim();
    if (!tenantId || !mongoose.Types.ObjectId.isValid(tenantId)) {
      return res.status(422).json({ message: 'Invalid tenant id' });
    }

    const tenant = await Tenant.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: 'Tenant not found' });
    }

    const body = req.body || {};
    if (body.companyName !== undefined) {
      const nextName = String(body.companyName || '').trim();
      if (!nextName) return res.status(422).json({ message: 'companyName cannot be empty' });
      tenant.companyName = nextName;
    }
    if (body.companyCode !== undefined) {
      const nextCode = Tenant.toTenantCode(body.companyCode);
      if (!nextCode || nextCode.length < 2) return res.status(422).json({ message: 'Valid companyCode is required' });
      tenant.companyCode = nextCode;
    }
    if (body.contactEmail !== undefined) {
      tenant.contactEmail = String(body.contactEmail || '').trim().toLowerCase();
    }
    if (body.subscriptionPlan !== undefined) {
      const nextPlan = String(body.subscriptionPlan || '').trim();
      if (!Tenant.SUBSCRIPTION_PLANS.includes(nextPlan)) {
        return res.status(422).json({ message: 'Invalid subscriptionPlan' });
      }
      tenant.subscriptionPlan = nextPlan;
    }
    if (body.subscriptionStartDate !== undefined) {
      const nextStartDate = toSafeDate(body.subscriptionStartDate);
      if (!nextStartDate) return res.status(422).json({ message: 'Invalid subscriptionStartDate' });
      tenant.subscriptionStartDate = nextStartDate;
    }
    if (body.subscriptionEndDate !== undefined) {
      const nextEndDate = body.subscriptionEndDate ? toSafeDate(body.subscriptionEndDate) : null;
      if (body.subscriptionEndDate && !nextEndDate) {
        return res.status(422).json({ message: 'Invalid subscriptionEndDate' });
      }
      tenant.subscriptionEndDate = nextEndDate;
    }
    if (body.tenantStatus !== undefined) {
      const nextStatus = String(body.tenantStatus || '').trim();
      if (!Tenant.TENANT_STATUS.includes(nextStatus)) {
        return res.status(422).json({ message: 'Invalid tenantStatus' });
      }
      tenant.tenantStatus = nextStatus;
    }
    if (body.maxBranches !== undefined) tenant.maxBranches = toPositiveInt(body.maxBranches, tenant.maxBranches || 5);
    if (body.maxVehicles !== undefined) tenant.maxVehicles = toPositiveInt(body.maxVehicles, tenant.maxVehicles || 100);
    if (body.maxUsers !== undefined) tenant.maxUsers = toPositiveInt(body.maxUsers, tenant.maxUsers || 1000);
    if (body.maxDrivers !== undefined) tenant.maxDrivers = toPositiveInt(body.maxDrivers, tenant.maxDrivers || 200);
    if (body.logoUrl !== undefined) tenant.logoUrl = String(body.logoUrl || '').trim();
    if (body.primaryColor !== undefined) tenant.primaryColor = String(body.primaryColor || '#2563EB').trim();
    if (body.secondaryColor !== undefined) tenant.secondaryColor = String(body.secondaryColor || '#0F172A').trim();

    await tenant.save();

    return res.json({
      message: 'Tenant updated successfully',
      tenant: normalizeTenantPayload(tenant),
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return res.status(422).json({ message: 'companyCode already exists' });
    }
    console.error('updateTenant error:', error);
    return res.status(500).json({ message: 'Failed to update tenant' });
  }
};

