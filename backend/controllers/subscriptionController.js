const fsp = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');

const Branch = require('../models/Branch');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const UserSubscription = require('../models/UserSubscription');
const { ROLE, normalizeRole, isStaffRole } = require('../utils/rbac');
const { getScopedBranchIds, assertBranchInScope } = require('../services/adminScopeService');
const {
  getAvailableSubscriptionPlans,
  getUserActiveSubscription,
  syncUserSubscriptionLifecycle,
  createUserSubscriptionPurchase,
  normalizeBoolean,
} = require('../services/subscriptionService');
const {
  ensureSubscriptionInvoiceGenerated,
  hydrateSubscriptionForInvoice,
  resolveSubscriptionInvoiceAbsolutePath,
  sanitizeFileName,
} = require('../services/subscriptionInvoiceService');

const normalizePlanPayload = (payload = {}) => ({
  planName: String(payload.planName || '').trim(),
  description: String(payload.description || '').trim(),
  durationType: String(payload.durationType || '').trim() || 'Monthly',
  durationInDays: Number(payload.durationInDays),
  price: Number(payload.price),
  includedRentalHours: Number(payload.includedRentalHours),
  lateFeeDiscountPercentage: Number(payload.lateFeeDiscountPercentage),
  damageFeeDiscountPercentage: Number(payload.damageFeeDiscountPercentage),
  branchId: payload.branchId || null,
  isActive: payload.isActive,
});

const serializePlan = (plan) => ({
  _id: String(plan?._id || ''),
  planName: String(plan?.planName || ''),
  description: String(plan?.description || ''),
  durationType: String(plan?.durationType || ''),
  durationInDays: Number(plan?.durationInDays || 0),
  price: Number(plan?.price || 0),
  includedRentalHours: Number(plan?.includedRentalHours || 0),
  lateFeeDiscountPercentage: Number(plan?.lateFeeDiscountPercentage || 0),
  damageFeeDiscountPercentage: Number(plan?.damageFeeDiscountPercentage || 0),
  branchId: plan?.branchId || null,
  isActive: Boolean(plan?.isActive),
  createdAt: plan?.createdAt,
  updatedAt: plan?.updatedAt,
});

const serializeSubscription = (subscription) => ({
  _id: String(subscription?._id || ''),
  userId: subscription?.userId || null,
  planId: subscription?.planId || null,
  branchId: subscription?.branchId || null,
  startDate: subscription?.startDate || null,
  endDate: subscription?.endDate || null,
  subscriptionStatus: String(subscription?.subscriptionStatus || ''),
  remainingRentalHours: Number(subscription?.remainingRentalHours || 0),
  totalUsedHours: Number(subscription?.totalUsedHours || 0),
  autoRenew: Boolean(subscription?.autoRenew),
  paymentStatus: String(subscription?.paymentStatus || ''),
  paymentMethod: String(subscription?.paymentMethod || 'NONE'),
  amountPaid: Number(subscription?.amountPaid || 0),
  planSnapshot: subscription?.planSnapshot || null,
  usageHistory: Array.isArray(subscription?.usageHistory) ? subscription.usageHistory : [],
  invoiceNumber: String(subscription?.invoiceNumber || ''),
  invoiceGeneratedAt: subscription?.invoiceGeneratedAt || null,
  invoicePdfPath: String(subscription?.invoicePdfPath || ''),
  createdAt: subscription?.createdAt || null,
  updatedAt: subscription?.updatedAt || null,
});

const ensureSuperAdmin = (user) => {
  if (normalizeRole(user?.role, ROLE.USER) !== ROLE.SUPER_ADMIN) {
    const error = new Error('SuperAdmin access required');
    error.status = 403;
    throw error;
  }
};

const toPositiveInt = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
};

const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') {
    return mongoose.Types.ObjectId.isValid(value) ? String(value) : '';
  }
  if (value instanceof mongoose.Types.ObjectId) {
    return String(value);
  }
  if (typeof value === 'object' && value?._id) {
    return mongoose.Types.ObjectId.isValid(String(value._id)) ? String(value._id) : '';
  }
  return '';
};

const buildScopedBranchFilter = (selectedBranchId, scopedBranchIds) => {
  if (selectedBranchId) return { branchId: new mongoose.Types.ObjectId(selectedBranchId) };
  if (Array.isArray(scopedBranchIds)) {
    if (scopedBranchIds.length === 0) return { branchId: { $in: [] } };
    return { branchId: { $in: scopedBranchIds.map((id) => new mongoose.Types.ObjectId(id)) } };
  }
  return {};
};

const buildScopedPlanQuery = (selectedBranchId, scopedBranchIds) => {
  if (selectedBranchId) {
    return {
      $or: [{ branchId: null }, { branchId: new mongoose.Types.ObjectId(selectedBranchId) }],
    };
  }

  if (Array.isArray(scopedBranchIds)) {
    if (scopedBranchIds.length === 0) {
      return { branchId: null };
    }
    return {
      $or: [{ branchId: null }, { branchId: { $in: scopedBranchIds } }],
    };
  }

  return {};
};

const resolveBranchReference = async (rawBranchId) => {
  if (!rawBranchId) return null;
  if (!mongoose.Types.ObjectId.isValid(String(rawBranchId))) {
    const error = new Error('Invalid branch id');
    error.status = 422;
    throw error;
  }

  const branch = await Branch.findById(rawBranchId).select('_id branchName branchCode isActive');
  if (!branch) {
    const error = new Error('Branch not found');
    error.status = 404;
    throw error;
  }
  return branch;
};

exports.getPlans = async (req, res) => {
  try {
    const branchId = String(req.query?.branchId || '').trim();
    const includeInactive = isStaffRole(req.user?.role)
      ? normalizeBoolean(req.query?.includeInactive, false)
      : false;

    const plans = await getAvailableSubscriptionPlans({
      branchId,
      includeInactive,
    });

    return res.json({
      plans: plans.map(serializePlan),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load subscription plans' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getAdminPlans = async (req, res) => {
  try {
    ensureSuperAdmin(req.user);

    const plans = await SubscriptionPlan.find({})
      .populate('branchId', 'branchName branchCode isActive')
      .sort({ createdAt: -1 });

    return res.json({
      plans: plans.map(serializePlan),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load subscription plans' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createPlan = async (req, res) => {
  try {
    ensureSuperAdmin(req.user);
    const payload = normalizePlanPayload(req.body);

    if (!payload.planName) {
      return res.status(422).json({ message: 'planName is required' });
    }

    const branch = await resolveBranchReference(payload.branchId);
    const createdPlan = await SubscriptionPlan.create({
      ...payload,
      branchId: branch?._id || null,
      createdBy: req.user?._id || null,
    });

    return res.status(201).json({
      message: 'Subscription plan created',
      plan: serializePlan(createdPlan),
    });
  } catch (error) {
    const duplicate = Number(error?.code) === 11000;
    const status = duplicate ? 409 : Number(error?.status || 500);
    const message = duplicate
      ? 'A plan with this name already exists for the selected branch'
      : status >= 500
      ? 'Failed to create subscription plan'
      : error.message;

    return res.status(status).json({ message });
  }
};

exports.updatePlan = async (req, res) => {
  try {
    ensureSuperAdmin(req.user);

    if (!mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
      return res.status(422).json({ message: 'Invalid plan id' });
    }

    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) {
      return res.status(404).json({ message: 'Subscription plan not found' });
    }

    const payload = normalizePlanPayload(req.body);
    const branch = await resolveBranchReference(payload.branchId);

    if (payload.planName) plan.planName = payload.planName;
    if (payload.description !== undefined) plan.description = payload.description;
    if (payload.durationType) plan.durationType = payload.durationType;
    if (Number.isFinite(payload.durationInDays) && payload.durationInDays > 0) {
      plan.durationInDays = payload.durationInDays;
    }
    if (Number.isFinite(payload.price) && payload.price >= 0) {
      plan.price = payload.price;
    }
    if (Number.isFinite(payload.includedRentalHours) && payload.includedRentalHours >= 0) {
      plan.includedRentalHours = payload.includedRentalHours;
    }
    if (Number.isFinite(payload.lateFeeDiscountPercentage)) {
      plan.lateFeeDiscountPercentage = payload.lateFeeDiscountPercentage;
    }
    if (Number.isFinite(payload.damageFeeDiscountPercentage)) {
      plan.damageFeeDiscountPercentage = payload.damageFeeDiscountPercentage;
    }
    if (req.body?.branchId !== undefined) {
      plan.branchId = branch?._id || null;
    }
    if (req.body?.isActive !== undefined) {
      plan.isActive = Boolean(payload.isActive);
    }

    await plan.save();

    return res.json({
      message: 'Subscription plan updated',
      plan: serializePlan(plan),
    });
  } catch (error) {
    const duplicate = Number(error?.code) === 11000;
    const status = duplicate ? 409 : Number(error?.status || 500);
    const message = duplicate
      ? 'A plan with this name already exists for the selected branch'
      : status >= 500
      ? 'Failed to update subscription plan'
      : error.message;
    return res.status(status).json({ message });
  }
};

exports.getAdminSubscriptionOverview = async (req, res) => {
  try {
    const scopedBranchIds = getScopedBranchIds(req.user);
    const requestedBranchId = String(req.query?.branchId || '').trim();
    const statusFilter = String(req.query?.status || '').trim();
    const page = toPositiveInt(req.query?.page, 1, 1, 100000);
    const pageSize = toPositiveInt(req.query?.pageSize, 20, 1, 100);

    if (requestedBranchId && !mongoose.Types.ObjectId.isValid(requestedBranchId)) {
      return res.status(422).json({ message: 'Invalid branchId' });
    }

    if (requestedBranchId && Array.isArray(scopedBranchIds)) {
      assertBranchInScope(req.user, requestedBranchId, 'Not allowed for this branch scope');
    }

    const allowedStatuses = new Set(UserSubscription.SUBSCRIPTION_STATUSES || []);
    const normalizedStatus = statusFilter && statusFilter !== 'all' ? statusFilter : '';
    if (normalizedStatus && !allowedStatuses.has(normalizedStatus)) {
      return res.status(422).json({ message: 'Invalid subscription status filter' });
    }

    const selectedBranchId = requestedBranchId || '';
    const subscriptionScopeFilter = buildScopedBranchFilter(selectedBranchId, scopedBranchIds);
    const subscriptionQuery = {
      ...subscriptionScopeFilter,
      ...(normalizedStatus ? { subscriptionStatus: normalizedStatus } : {}),
    };

    const [totalItems, rows] = await Promise.all([
      UserSubscription.countDocuments(subscriptionQuery),
      UserSubscription.find(subscriptionQuery)
        .populate('userId', 'firstName lastName email')
        .populate('planId', 'planName durationType durationInDays price includedRentalHours branchId')
        .populate('branchId', 'branchName branchCode city state')
        .sort({ createdAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize),
    ]);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const summaryFilter = { ...subscriptionScopeFilter };
    const [activeCount, paidCount, revenueRows, monthRevenueRows] = await Promise.all([
      UserSubscription.countDocuments({ ...summaryFilter, subscriptionStatus: 'Active' }),
      UserSubscription.countDocuments({ ...summaryFilter, paymentStatus: 'Paid' }),
      UserSubscription.aggregate([
        { $match: { ...summaryFilter, paymentStatus: 'Paid' } },
        { $group: { _id: null, totalRevenue: { $sum: '$amountPaid' } } },
      ]),
      UserSubscription.aggregate([
        { $match: { ...summaryFilter, paymentStatus: 'Paid', createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, monthlyRevenue: { $sum: '$amountPaid' } } },
      ]),
    ]);

    const totalRevenue = Number(revenueRows?.[0]?.totalRevenue || 0);
    const monthlyRevenue = Number(monthRevenueRows?.[0]?.monthlyRevenue || 0);
    const avgRevenuePerSubscription = paidCount > 0 ? Number((totalRevenue / paidCount).toFixed(2)) : 0;

    const topPlanRows = await UserSubscription.aggregate([
      { $match: { ...summaryFilter, paymentStatus: 'Paid' } },
      {
        $group: {
          _id: '$planId',
          revenue: { $sum: '$amountPaid' },
          purchases: { $sum: 1 },
        },
      },
      { $sort: { revenue: -1, purchases: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'subscriptionplans',
          localField: '_id',
          foreignField: '_id',
          as: 'plan',
        },
      },
      { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          planId: '$_id',
          planName: { $ifNull: ['$plan.planName', 'Unknown Plan'] },
          revenue: 1,
          purchases: 1,
        },
      },
    ]);

    const canManagePlans = normalizeRole(req.user?.role, ROLE.USER) === ROLE.SUPER_ADMIN;

    const branchQuery = Array.isArray(scopedBranchIds)
      ? (scopedBranchIds.length > 0 ? { _id: { $in: scopedBranchIds } } : { _id: { $in: [] } })
      : {};
    const [branchOptions, planRows] = await Promise.all([
      Branch.find(branchQuery).select('_id branchName branchCode city state isActive').sort({ branchName: 1 }),
      SubscriptionPlan.find(buildScopedPlanQuery(selectedBranchId, scopedBranchIds))
        .populate('branchId', 'branchName branchCode city state isActive')
        .sort({ createdAt: -1 }),
    ]);

    return res.json({
      summary: {
        totalSubscriptions: Number(totalItems || 0),
        activeSubscriptions: Number(activeCount || 0),
        paidSubscriptions: Number(paidCount || 0),
        totalRevenue,
        monthlyRevenue,
        avgRevenuePerSubscription,
      },
      topPlans: Array.isArray(topPlanRows)
        ? topPlanRows.map((row) => ({
            planId: toObjectIdString(row?.planId),
            planName: String(row?.planName || 'Unknown Plan'),
            purchases: Number(row?.purchases || 0),
            revenue: Number(row?.revenue || 0),
          }))
        : [],
      subscriptions: rows.map(serializeSubscription),
      plans: planRows.map(serializePlan),
      branchOptions: branchOptions.map((branch) => ({
        _id: String(branch?._id || ''),
        branchName: String(branch?.branchName || ''),
        branchCode: String(branch?.branchCode || ''),
        city: String(branch?.city || ''),
        state: String(branch?.state || ''),
        isActive: Boolean(branch?.isActive),
      })),
      canManagePlans,
      pagination: {
        page,
        pageSize,
        totalItems: Number(totalItems || 0),
        totalPages: totalItems > 0 ? Math.ceil(totalItems / pageSize) : 1,
      },
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load admin subscription overview' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getMySubscription = async (req, res) => {
  try {
    const now = new Date();
    const branchId = String(req.query?.branchId || '').trim();

    const activeSubscription = await getUserActiveSubscription(req.user?._id, {
      now,
      branchId: branchId || null,
      allowAutoRenew: true,
    });

    if (!activeSubscription) {
      await syncUserSubscriptionLifecycle(req.user?._id, {
        now,
        allowAutoRenew: true,
      });
    }

    const history = await UserSubscription.find({ userId: req.user?._id })
      .populate('planId')
      .sort({ createdAt: -1 })
      .limit(20);

    const latest = history[0] || null;

    return res.json({
      activeSubscription: activeSubscription ? serializeSubscription(activeSubscription) : null,
      latestSubscription: latest ? serializeSubscription(latest) : null,
      subscriptions: history.map(serializeSubscription),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load subscription details' : error.message;
    return res.status(status).json({ message });
  }
};

exports.purchaseSubscription = async (req, res) => {
  try {
    const purchaseResult = await createUserSubscriptionPurchase({
      userId: req.user?._id,
      planId: req.body?.planId,
      autoRenew: req.body?.autoRenew,
      paymentMethod: req.body?.paymentMethod,
      now: new Date(),
    });

    return res.status(201).json({
      message: 'Subscription activated successfully',
      subscription: serializeSubscription(purchaseResult.subscription),
      invoice: purchaseResult.invoice
        ? {
            generated: Boolean(purchaseResult.invoice.generated),
            invoiceNumber: String(purchaseResult.subscription?.invoiceNumber || ''),
            invoiceGeneratedAt: purchaseResult.subscription?.invoiceGeneratedAt || null,
          }
        : null,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to purchase subscription' : error.message;
    return res.status(status).json({ message });
  }
};

exports.renewMySubscription = async (req, res) => {
  try {
    const existingActive = await getUserActiveSubscription(req.user?._id, {
      now: new Date(),
      allowAutoRenew: false,
    });
    if (existingActive) {
      return res.status(409).json({ message: 'You already have an active subscription' });
    }

    const latest = await UserSubscription.findOne({ userId: req.user?._id })
      .populate('planId')
      .sort({ createdAt: -1, endDate: -1 });

    if (!latest?.planId?._id) {
      return res.status(404).json({ message: 'No previous subscription found to renew' });
    }

    const purchaseResult = await createUserSubscriptionPurchase({
      userId: req.user?._id,
      planId: latest.planId._id,
      autoRenew: req.body?.autoRenew ?? latest.autoRenew,
      paymentMethod: req.body?.paymentMethod || latest.paymentMethod || 'CARD',
      now: new Date(),
    });

    return res.status(201).json({
      message: 'Subscription renewed successfully',
      subscription: serializeSubscription(purchaseResult.subscription),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to renew subscription' : error.message;
    return res.status(status).json({ message });
  }
};

exports.downloadMySubscriptionInvoice = async (req, res) => {
  try {
    const subscriptionId = req.params.subscriptionId;
    if (!mongoose.Types.ObjectId.isValid(subscriptionId)) {
      return res.status(422).json({ message: 'Invalid subscription id' });
    }

    const subscription = await hydrateSubscriptionForInvoice(subscriptionId);
    if (!subscription) {
      return res.status(404).json({ message: 'Subscription not found' });
    }

    const isOwner = String(subscription?.userId?._id || subscription?.userId || '') === String(req.user?._id || '');
    if (!isOwner && !isStaffRole(req.user?.role)) {
      return res.status(403).json({ message: 'You are not allowed to download this invoice' });
    }

    if (!subscription.invoicePdfPath) {
      try {
        await ensureSubscriptionInvoiceGenerated(subscription, { generatedAt: new Date() });
      } catch (error) {
        console.error('Failed to generate subscription invoice on download:', error);
        return res.status(500).json({ message: 'Failed to generate subscription invoice' });
      }
    }

    const absolutePath = resolveSubscriptionInvoiceAbsolutePath(subscription.invoicePdfPath);
    if (!absolutePath) {
      return res.status(404).json({ message: 'Subscription invoice file path is invalid' });
    }

    try {
      await fsp.access(absolutePath);
    } catch {
      return res.status(404).json({ message: 'Subscription invoice file is missing' });
    }

    const baseName = subscription.invoiceNumber || `subscription-invoice-${subscription._id}`;
    const fileName = `${sanitizeFileName(baseName)}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.sendFile(path.resolve(absolutePath));
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to download subscription invoice' : error.message;
    return res.status(status).json({ message });
  }
};
