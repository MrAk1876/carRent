const path = require('path');
const fsp = require('fs/promises');
const mongoose = require('mongoose');

const SubscriptionPlan = require('../models/SubscriptionPlan');
const UserSubscription = require('../models/UserSubscription');
const { getRentalDurationHours } = require('../utils/rentalDateUtils');
const { resolveFinalAmount } = require('../utils/paymentUtils');
const { sendEmail } = require('./emailService');
const { subscriptionActivatedTemplate } = require('../templates/emailTemplates');
const {
  ensureSubscriptionInvoiceGenerated,
  resolveSubscriptionInvoiceAbsolutePath,
} = require('./subscriptionInvoiceService');

const DAY_MS = 24 * 60 * 60 * 1000;
const RENTAL_TYPES = Object.freeze({
  ONE_TIME: 'OneTime',
  SUBSCRIPTION: 'Subscription',
});
const SUBSCRIPTION_PAYMENT_METHODS = new Set(
  Array.isArray(UserSubscription.SUBSCRIPTION_PAYMENT_METHODS)
    ? UserSubscription.SUBSCRIPTION_PAYMENT_METHODS
    : ['NONE', 'CARD', 'UPI', 'NETBANKING', 'CASH'],
);

const toSafeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return numericValue;
};

const toValidDate = (value, fallback = null) => {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed;
};

const roundCurrency = (value) => Number(Math.max(toSafeNumber(value, 0), 0).toFixed(2));

const clampPercent = (value) => {
  const numericValue = toSafeNumber(value, 0);
  if (numericValue <= 0) return 0;
  if (numericValue >= 100) return 100;
  return Number(numericValue.toFixed(2));
};

const normalizeRentalType = (value, fallback = RENTAL_TYPES.ONE_TIME) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'subscription') return RENTAL_TYPES.SUBSCRIPTION;
  if (normalized === 'onetime' || normalized === 'one-time' || normalized === 'one_time') {
    return RENTAL_TYPES.ONE_TIME;
  }
  return fallback;
};

const normalizePaymentMethod = (value, fallback = 'CARD') => {
  const normalized = String(value || fallback).trim().toUpperCase();
  if (SUBSCRIPTION_PAYMENT_METHODS.has(normalized)) {
    return normalized;
  }
  return fallback;
};

const normalizeBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (mongoose.isValidObjectId(value)) return String(value);
  if (value?._id && mongoose.isValidObjectId(value._id)) return String(value._id);
  return '';
};

const isSameObjectId = (left, right) => {
  const leftId = toObjectIdString(left);
  const rightId = toObjectIdString(right);
  return Boolean(leftId && rightId && leftId === rightId);
};

const resolvePlanDurationInDays = (plan = {}) => {
  const configured = Math.round(toSafeNumber(plan?.durationInDays, 0));
  if (configured > 0) return configured;

  const durationType = String(plan?.durationType || '').trim();
  const defaults = SubscriptionPlan.DEFAULT_DURATION_DAYS || {};
  return Math.max(Math.round(toSafeNumber(defaults[durationType], 30)), 1);
};

const buildPlanSnapshot = (plan = {}) => ({
  planName: String(plan?.planName || '').trim(),
  durationType: String(plan?.durationType || '').trim(),
  durationInDays: resolvePlanDurationInDays(plan),
  price: roundCurrency(plan?.price || 0),
  includedRentalHours: Math.max(toSafeNumber(plan?.includedRentalHours, 0), 0),
  lateFeeDiscountPercentage: clampPercent(plan?.lateFeeDiscountPercentage || 0),
  damageFeeDiscountPercentage: clampPercent(plan?.damageFeeDiscountPercentage || 0),
});

const isPlanAllowedForBranch = (planOrSubscription, branchId) => {
  const planBranchId =
    planOrSubscription?.planId?.branchId ||
    planOrSubscription?.branchId ||
    planOrSubscription?.planSnapshot?.branchId ||
    null;

  if (!planBranchId) return true;
  if (!branchId) return false;
  return isSameObjectId(planBranchId, branchId);
};

const calculateSubscriptionCoverage = ({ baseAmount, rentalHours, availableHours }) => {
  const normalizedBaseAmount = roundCurrency(baseAmount);
  const normalizedRentalHours = Math.max(toSafeNumber(rentalHours, 0), 0);
  const normalizedAvailableHours = Math.max(toSafeNumber(availableHours, 0), 0);

  if (normalizedBaseAmount <= 0 || normalizedRentalHours <= 0) {
    return {
      rentalHours: normalizedRentalHours,
      availableHours: normalizedAvailableHours,
      coveredHours: 0,
      extraHours: normalizedRentalHours,
      coverageRatio: 0,
      coverageAmount: 0,
      extraAmount: normalizedBaseAmount,
    };
  }

  const coveredHours = Math.min(normalizedAvailableHours, normalizedRentalHours);
  const extraHours = Math.max(normalizedRentalHours - coveredHours, 0);
  const coverageRatio = normalizedRentalHours > 0 ? coveredHours / normalizedRentalHours : 0;
  const coverageAmount = roundCurrency(normalizedBaseAmount * coverageRatio);
  const extraAmount = roundCurrency(Math.max(normalizedBaseAmount - coverageAmount, 0));

  return {
    rentalHours: Number(normalizedRentalHours.toFixed(2)),
    availableHours: Number(normalizedAvailableHours.toFixed(2)),
    coveredHours: Number(coveredHours.toFixed(2)),
    extraHours: Number(extraHours.toFixed(2)),
    coverageRatio: Number(coverageRatio.toFixed(6)),
    coverageAmount,
    extraAmount,
  };
};

const expireElapsedSubscriptions = async (userId = null, now = new Date()) => {
  const filter = {
    subscriptionStatus: 'Active',
    endDate: { $lte: now },
  };
  if (userId) {
    filter.userId = userId;
  }
  await UserSubscription.updateMany(filter, {
    $set: {
      subscriptionStatus: 'Expired',
    },
  });
};

const getActiveSubscriptionQuery = (userId, now) => ({
  userId,
  subscriptionStatus: 'Active',
  paymentStatus: 'Paid',
  startDate: { $lte: now },
  endDate: { $gt: now },
});

const loadActiveSubscription = async (userId, now = new Date()) =>
  UserSubscription.findOne(getActiveSubscriptionQuery(userId, now))
    .populate('planId')
    .sort({ endDate: -1, createdAt: -1 });

const getLatestAutoRenewCandidate = async (userId, now = new Date()) =>
  UserSubscription.findOne({
    userId,
    subscriptionStatus: 'Expired',
    autoRenew: true,
    paymentStatus: 'Paid',
    endDate: { $lte: now },
  })
    .populate('planId')
    .sort({ endDate: -1, createdAt: -1 });

const createAutoRenewSubscription = async (sourceSubscription, options = {}) => {
  const now = toValidDate(options.now, new Date());
  const plan = sourceSubscription?.planId;
  if (!plan?._id || !plan.isActive) {
    return null;
  }

  const durationInDays = resolvePlanDurationInDays(plan);
  const startDate = new Date(now);
  const endDate = new Date(startDate.getTime() + durationInDays * DAY_MS);
  const planSnapshot = buildPlanSnapshot(plan);

  try {
    const created = await UserSubscription.create({
      userId: sourceSubscription.userId,
      planId: plan._id,
      branchId: plan.branchId || null,
      startDate,
      endDate,
      subscriptionStatus: 'Active',
      remainingRentalHours: Math.max(toSafeNumber(plan.includedRentalHours, 0), 0),
      totalUsedHours: 0,
      autoRenew: true,
      paymentStatus: 'Paid',
      paymentMethod: sourceSubscription.paymentMethod || 'CARD',
      amountPaid: roundCurrency(plan.price || 0),
      planSnapshot,
      renewalOf: sourceSubscription._id,
    });

    let invoiceResult = null;
    try {
      invoiceResult = await ensureSubscriptionInvoiceGenerated(created, { generatedAt: now });
    } catch (invoiceError) {
      console.error('Auto-renew subscription invoice generation failed:', {
        subscriptionId: String(created?._id || ''),
        error: invoiceError?.message || invoiceError,
      });
    }

    queueSubscriptionActivationEmail(invoiceResult?.subscription || created, {
      subjectPrefix: 'Auto-Renewed',
    });

    return invoiceResult?.subscription || created;
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return loadActiveSubscription(sourceSubscription.userId, now);
    }
    throw error;
  }
};

const syncUserSubscriptionLifecycle = async (userId, options = {}) => {
  if (!userId) return null;
  const now = toValidDate(options.now, new Date());
  const branchId = options.branchId || null;
  const allowAutoRenew = normalizeBoolean(options.allowAutoRenew, true);

  await expireElapsedSubscriptions(userId, now);

  let activeSubscription = await loadActiveSubscription(userId, now);
  if (activeSubscription && isPlanAllowedForBranch(activeSubscription, branchId)) {
    return activeSubscription;
  }
  if (activeSubscription && !isPlanAllowedForBranch(activeSubscription, branchId)) {
    return null;
  }

  if (!allowAutoRenew) return null;

  const renewalSource = await getLatestAutoRenewCandidate(userId, now);
  if (!renewalSource || !isPlanAllowedForBranch(renewalSource, branchId)) {
    return null;
  }

  return createAutoRenewSubscription(renewalSource, { now });
};

const getUserActiveSubscription = async (userId, options = {}) => {
  if (!userId) return null;
  const activeSubscription = await syncUserSubscriptionLifecycle(userId, options);
  if (!activeSubscription) return null;

  const branchId = options.branchId || null;
  if (!isPlanAllowedForBranch(activeSubscription, branchId)) {
    return null;
  }

  return activeSubscription;
};

const getAvailableSubscriptionPlans = async (options = {}) => {
  const branchId = options.branchId ? toObjectIdString(options.branchId) : '';
  const includeInactive = normalizeBoolean(options.includeInactive, false);
  const query = {};
  if (!includeInactive) {
    query.isActive = true;
  }

  if (branchId && mongoose.isValidObjectId(branchId)) {
    query.$or = [{ branchId: null }, { branchId: new mongoose.Types.ObjectId(branchId) }];
  }

  return SubscriptionPlan.find(query).sort({ price: 1, durationInDays: 1, planName: 1 });
};

const createUserSubscriptionPurchase = async (payload = {}) => {
  const userId = payload.userId;
  const planId = toObjectIdString(payload.planId);
  const now = toValidDate(payload.now, new Date());

  if (!userId || !mongoose.isValidObjectId(String(userId))) {
    const error = new Error('Invalid user');
    error.status = 422;
    throw error;
  }

  if (!planId || !mongoose.isValidObjectId(planId)) {
    const error = new Error('Invalid subscription plan');
    error.status = 422;
    throw error;
  }

  const plan = await SubscriptionPlan.findById(planId);
  if (!plan) {
    const error = new Error('Subscription plan not found');
    error.status = 404;
    throw error;
  }

  if (!plan.isActive) {
    const error = new Error('Subscription plan is inactive');
    error.status = 422;
    throw error;
  }

  await expireElapsedSubscriptions(userId, now);

  const existingActive = await loadActiveSubscription(userId, now);
  if (existingActive) {
    const error = new Error('You already have an active subscription');
    error.status = 409;
    throw error;
  }

  const durationInDays = resolvePlanDurationInDays(plan);
  const startDate = new Date(now);
  const endDate = new Date(startDate.getTime() + durationInDays * DAY_MS);
  const paymentMethod = normalizePaymentMethod(payload.paymentMethod, 'CARD');
  const autoRenew = normalizeBoolean(payload.autoRenew, false);

  const subscription = await UserSubscription.create({
    userId,
    planId: plan._id,
    branchId: plan.branchId || null,
    startDate,
    endDate,
    subscriptionStatus: 'Active',
    remainingRentalHours: Math.max(toSafeNumber(plan.includedRentalHours, 0), 0),
    totalUsedHours: 0,
    autoRenew,
    paymentStatus: 'Paid',
    paymentMethod,
    amountPaid: roundCurrency(plan.price || 0),
    planSnapshot: buildPlanSnapshot(plan),
  });

  let invoiceResult = null;
  try {
    invoiceResult = await ensureSubscriptionInvoiceGenerated(subscription, { generatedAt: now });
  } catch (invoiceError) {
    console.error('Subscription invoice generation failed:', {
      subscriptionId: String(subscription?._id || ''),
      error: invoiceError?.message || invoiceError,
    });
  }

  queueSubscriptionActivationEmail(invoiceResult?.subscription || subscription);

  return {
    subscription: invoiceResult?.subscription || subscription,
    invoice: invoiceResult,
    plan,
  };
};

const buildSubscriptionPricingForRequest = async (payload = {}) => {
  const useSubscription = normalizeBoolean(payload.useSubscription, false);
  const baseAmount = roundCurrency(payload.baseAmount || 0);
  const pickupDateTime = payload.pickupDateTime;
  const dropDateTime = payload.dropDateTime;

  const defaultPricing = {
    rentalType: RENTAL_TYPES.ONE_TIME,
    finalAmount: baseAmount,
    subscriptionBaseAmount: baseAmount,
    userSubscriptionId: null,
    subscriptionPlanId: null,
    subscriptionHoursUsed: 0,
    subscriptionCoverageAmount: 0,
    subscriptionExtraAmount: baseAmount,
    subscriptionLateFeeDiscountPercentage: 0,
    subscriptionDamageFeeDiscountPercentage: 0,
    activeSubscription: null,
  };

  if (!useSubscription) {
    return defaultPricing;
  }

  const activeSubscription = await getUserActiveSubscription(payload.userId, {
    now: payload.now,
    branchId: payload.branchId || null,
    allowAutoRenew: true,
  });

  if (!activeSubscription) {
    const error = new Error('No active subscription found for this booking');
    error.status = 422;
    throw error;
  }

  const plan = activeSubscription.planId || {};
  if (!isPlanAllowedForBranch(activeSubscription, payload.branchId || null)) {
    const error = new Error('Active subscription is not valid for this branch');
    error.status = 422;
    throw error;
  }

  const rentalHours = getRentalDurationHours(pickupDateTime, dropDateTime);
  const coverage = calculateSubscriptionCoverage({
    baseAmount,
    rentalHours,
    availableHours: activeSubscription.remainingRentalHours,
  });

  return {
    rentalType: RENTAL_TYPES.SUBSCRIPTION,
    finalAmount: coverage.extraAmount,
    subscriptionBaseAmount: baseAmount,
    userSubscriptionId: activeSubscription._id,
    subscriptionPlanId: plan?._id || activeSubscription.planId || null,
    subscriptionHoursUsed: coverage.coveredHours,
    subscriptionCoverageAmount: coverage.coverageAmount,
    subscriptionExtraAmount: coverage.extraAmount,
    subscriptionLateFeeDiscountPercentage: clampPercent(
      plan?.lateFeeDiscountPercentage || activeSubscription?.planSnapshot?.lateFeeDiscountPercentage || 0,
    ),
    subscriptionDamageFeeDiscountPercentage: clampPercent(
      plan?.damageFeeDiscountPercentage || activeSubscription?.planSnapshot?.damageFeeDiscountPercentage || 0,
    ),
    activeSubscription,
  };
};

const createSubscriptionPricingPayload = (request, coverage, sourceSubscription) => {
  const plan = sourceSubscription?.planId || {};
  return {
    rentalType: RENTAL_TYPES.SUBSCRIPTION,
    finalAmount: coverage.extraAmount,
    subscriptionBaseAmount: roundCurrency(
      request?.subscriptionBaseAmount ||
        (resolveFinalAmount(request) + Math.max(toSafeNumber(request?.subscriptionCoverageAmount, 0), 0)),
    ),
    userSubscriptionId: sourceSubscription?._id || request?.userSubscriptionId || null,
    subscriptionPlanId: plan?._id || request?.subscriptionPlanId || null,
    subscriptionHoursUsed: coverage.coveredHours,
    subscriptionCoverageAmount: coverage.coverageAmount,
    subscriptionExtraAmount: coverage.extraAmount,
    subscriptionLateFeeDiscountPercentage: clampPercent(
      request?.subscriptionLateFeeDiscountPercentage ||
        plan?.lateFeeDiscountPercentage ||
        sourceSubscription?.planSnapshot?.lateFeeDiscountPercentage ||
        0,
    ),
    subscriptionDamageFeeDiscountPercentage: clampPercent(
      request?.subscriptionDamageFeeDiscountPercentage ||
        plan?.damageFeeDiscountPercentage ||
        sourceSubscription?.planSnapshot?.damageFeeDiscountPercentage ||
        0,
    ),
  };
};

const reserveSubscriptionUsageForRequest = async (request, options = {}) => {
  const rentalType = normalizeRentalType(request?.rentalType, RENTAL_TYPES.ONE_TIME);
  if (rentalType !== RENTAL_TYPES.SUBSCRIPTION) {
    return {
      pricing: {
        rentalType: RENTAL_TYPES.ONE_TIME,
        finalAmount: roundCurrency(resolveFinalAmount(request)),
        subscriptionBaseAmount: 0,
        userSubscriptionId: null,
        subscriptionPlanId: null,
        subscriptionHoursUsed: 0,
        subscriptionCoverageAmount: 0,
        subscriptionExtraAmount: roundCurrency(resolveFinalAmount(request)),
        subscriptionLateFeeDiscountPercentage: 0,
        subscriptionDamageFeeDiscountPercentage: 0,
      },
      reservation: null,
    };
  }

  const now = toValidDate(options.now, new Date());
  const requestUserId = request?.user?._id || request?.user;
  const sourceSubscriptionId = request?.userSubscriptionId;
  const requestBranchId = request?.branchId || null;
  const baseAmountFromRecord = roundCurrency(request?.subscriptionBaseAmount || 0);
  const fallbackBase = roundCurrency(
    resolveFinalAmount(request) + Math.max(toSafeNumber(request?.subscriptionCoverageAmount, 0), 0),
  );
  const baseAmount = baseAmountFromRecord > 0 ? baseAmountFromRecord : fallbackBase;
  const rentalHours = getRentalDurationHours(
    request?.pickupDateTime || request?.fromDate,
    request?.dropDateTime || request?.toDate,
  );

  await expireElapsedSubscriptions(requestUserId, now);

  let activeSubscription = null;
  if (sourceSubscriptionId && mongoose.isValidObjectId(String(sourceSubscriptionId))) {
    activeSubscription = await UserSubscription.findOne({
      _id: sourceSubscriptionId,
      userId: requestUserId,
      subscriptionStatus: 'Active',
      paymentStatus: 'Paid',
      startDate: { $lte: now },
      endDate: { $gt: now },
    }).populate('planId');
  }

  if (!activeSubscription) {
    activeSubscription = await getUserActiveSubscription(requestUserId, {
      now,
      branchId: requestBranchId,
      allowAutoRenew: false,
    });
  }

  if (!activeSubscription) {
    const error = new Error('Active subscription is no longer available. Please create booking again.');
    error.status = 422;
    throw error;
  }

  if (!isPlanAllowedForBranch(activeSubscription, requestBranchId)) {
    const error = new Error('Active subscription does not apply to this branch');
    error.status = 422;
    throw error;
  }

  const maxAttempts = 3;
  let attempts = 0;
  let lastSubscriptionDoc = activeSubscription;

  while (attempts < maxAttempts) {
    const coverage = calculateSubscriptionCoverage({
      baseAmount,
      rentalHours,
      availableHours: lastSubscriptionDoc.remainingRentalHours,
    });

    if (coverage.coveredHours <= 0) {
      return {
        pricing: createSubscriptionPricingPayload(request, coverage, lastSubscriptionDoc),
        reservation: {
          subscriptionId: String(lastSubscriptionDoc._id),
          userId: String(requestUserId),
          coveredHours: 0,
          coverageAmount: 0,
          extraAmount: coverage.extraAmount,
          usedAt: now,
          rentalHours: coverage.rentalHours,
        },
      };
    }

    const updatedSubscription = await UserSubscription.findOneAndUpdate(
      {
        _id: lastSubscriptionDoc._id,
        userId: requestUserId,
        subscriptionStatus: 'Active',
        paymentStatus: 'Paid',
        startDate: { $lte: now },
        endDate: { $gt: now },
        remainingRentalHours: { $gte: coverage.coveredHours },
      },
      {
        $inc: {
          remainingRentalHours: -coverage.coveredHours,
          totalUsedHours: coverage.coveredHours,
        },
      },
      { new: true },
    ).populate('planId');

    if (updatedSubscription) {
      return {
        pricing: createSubscriptionPricingPayload(request, coverage, updatedSubscription),
        reservation: {
          subscriptionId: String(updatedSubscription._id),
          userId: String(requestUserId),
          coveredHours: coverage.coveredHours,
          coverageAmount: coverage.coverageAmount,
          extraAmount: coverage.extraAmount,
          usedAt: now,
          rentalHours: coverage.rentalHours,
        },
      };
    }

    const refreshed = await UserSubscription.findOne({
      _id: lastSubscriptionDoc._id,
      userId: requestUserId,
      subscriptionStatus: 'Active',
      paymentStatus: 'Paid',
      startDate: { $lte: now },
      endDate: { $gt: now },
    }).populate('planId');

    if (!refreshed) {
      const error = new Error('Active subscription is no longer available. Please create booking again.');
      error.status = 422;
      throw error;
    }

    lastSubscriptionDoc = refreshed;
    attempts += 1;
  }

  const error = new Error('Failed to reserve subscription hours. Please try again.');
  error.status = 409;
  throw error;
};

const rollbackSubscriptionUsageReservation = async (reservation) => {
  const subscriptionId = toObjectIdString(reservation?.subscriptionId);
  const userId = toObjectIdString(reservation?.userId);
  const coveredHours = Math.max(toSafeNumber(reservation?.coveredHours, 0), 0);

  if (!subscriptionId || !userId || coveredHours <= 0) {
    return;
  }

  try {
    await UserSubscription.updateOne(
      {
        _id: subscriptionId,
        userId,
      },
      [
        {
          $set: {
            remainingRentalHours: { $max: [{ $add: ['$remainingRentalHours', coveredHours] }, 0] },
            totalUsedHours: { $max: [{ $subtract: ['$totalUsedHours', coveredHours] }, 0] },
          },
        },
      ],
    );
  } catch (error) {
    console.error('rollbackSubscriptionUsageReservation failed:', {
      subscriptionId,
      userId,
      coveredHours,
      error: error?.message || error,
    });
  }
};

const appendSubscriptionUsageHistory = async (reservation, bookingId) => {
  const subscriptionId = toObjectIdString(reservation?.subscriptionId);
  const coveredHours = Math.max(toSafeNumber(reservation?.coveredHours, 0), 0);
  if (!subscriptionId) return;

  const usageEntry = {
    bookingId: bookingId || null,
    hoursUsed: coveredHours,
    amountCovered: roundCurrency(reservation?.coverageAmount || 0),
    amountCharged: roundCurrency(reservation?.extraAmount || 0),
    usedAt: toValidDate(reservation?.usedAt, new Date()),
  };

  await UserSubscription.updateOne(
    { _id: subscriptionId },
    {
      $push: {
        usageHistory: {
          $each: [usageEntry],
          $slice: -300,
        },
      },
    },
  );
};

const getSubscriptionLateFeeDiscountPercent = (record = {}) =>
  clampPercent(record?.subscriptionLateFeeDiscountPercentage || 0);

const getSubscriptionDamageFeeDiscountPercent = (record = {}) =>
  clampPercent(record?.subscriptionDamageFeeDiscountPercentage || 0);

const applyPercentageDiscount = (amount, discountPercent) => {
  const safeAmount = roundCurrency(amount);
  const safeDiscount = clampPercent(discountPercent);
  if (safeAmount <= 0 || safeDiscount <= 0) return safeAmount;
  return roundCurrency(safeAmount * (1 - safeDiscount / 100));
};

const queueSubscriptionActivationEmail = (subscriptionDocOrId, options = {}) => {
  const targetId = toObjectIdString(subscriptionDocOrId?._id || subscriptionDocOrId);
  if (!targetId) return;
  setTimeout(() => {
    sendSubscriptionActivationEmail(targetId, options).catch((error) => {
      console.error('Subscription activation email failed:', {
        subscriptionId: targetId,
        error: error?.message || error,
      });
    });
  }, 0);
};

const sendSubscriptionActivationEmail = async (subscriptionId, options = {}) => {
  const subscription = await UserSubscription.findById(subscriptionId).populate([
    { path: 'userId', select: 'firstName lastName email' },
    { path: 'planId', select: 'planName durationType durationInDays price includedRentalHours' },
  ]);

  if (!subscription) {
    return { sent: false, skipped: true, reason: 'subscription-not-found' };
  }

  if (subscription?.emailNotifications?.activationSent) {
    return { sent: false, skipped: true, reason: 'already-sent' };
  }

  const userEmail = String(subscription?.userId?.email || '').trim();
  if (!userEmail) {
    return { sent: false, skipped: true, reason: 'missing-user-email' };
  }

  const planName = String(subscription?.planId?.planName || subscription?.planSnapshot?.planName || 'Subscription');
  const amountPaid = roundCurrency(subscription?.amountPaid || subscription?.planSnapshot?.price || 0);
  const template = subscriptionActivatedTemplate({
    subjectPrefix: String(options?.subjectPrefix || '').trim(),
    customerName:
      `${String(subscription?.userId?.firstName || '').trim()} ${String(subscription?.userId?.lastName || '').trim()}`
        .trim() || 'Customer',
    subscriptionReference: String(subscription?._id || ''),
    planName,
    startDate: toValidDate(subscription?.startDate, null)?.toLocaleString('en-IN') || 'N/A',
    endDate: toValidDate(subscription?.endDate, null)?.toLocaleString('en-IN') || 'N/A',
    includedRentalHours: `${Math.max(toSafeNumber(subscription?.remainingRentalHours, 0), 0)}`,
    amountPaid: `${CURRENCY_SYMBOL}${amountPaid}`,
    autoRenew: subscription?.autoRenew ? 'Enabled' : 'Disabled',
  });

  const attachments = [];
  const invoicePath = resolveSubscriptionInvoiceAbsolutePath(subscription?.invoicePdfPath);
  if (invoicePath) {
    try {
      await fsp.access(invoicePath);
      attachments.push({
        filename: `${path.basename(invoicePath)}`,
        path: invoicePath,
      });
    } catch {
      // Ignore missing invoice attachment.
    }
  }

  const result = await sendEmail({
    to: userEmail,
    subject: template.subject,
    html: template.html,
    text: template.text,
    attachments,
  });

  if (result?.sent) {
    await UserSubscription.updateOne(
      { _id: subscription._id },
      {
        $set: {
          'emailNotifications.activationSent': true,
          'emailNotifications.activationSentAt': new Date(),
        },
      },
    );
  }

  return result;
};

const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '\u20B9';

module.exports = {
  RENTAL_TYPES,
  normalizeRentalType,
  normalizePaymentMethod,
  normalizeBoolean,
  roundCurrency,
  clampPercent,
  calculateSubscriptionCoverage,
  getAvailableSubscriptionPlans,
  getUserActiveSubscription,
  syncUserSubscriptionLifecycle,
  createUserSubscriptionPurchase,
  buildSubscriptionPricingForRequest,
  reserveSubscriptionUsageForRequest,
  rollbackSubscriptionUsageReservation,
  appendSubscriptionUsageHistory,
  getSubscriptionLateFeeDiscountPercent,
  getSubscriptionDamageFeeDiscountPercent,
  applyPercentageDiscount,
  queueSubscriptionActivationEmail,
};
