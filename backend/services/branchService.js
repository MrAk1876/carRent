const mongoose = require('mongoose');
const Branch = require('../models/Branch');
const Car = require('../models/Car');
const { getTenantIdFromContext, runWithTenantContext } = require('./tenantContextService');
const { ensureDefaultTenant } = require('./tenantService');

const MAIN_BRANCH_CODE = 'MAIN';
const MAIN_BRANCH_NAME = 'Main Branch';

let branchBootstrapPromise = null;

const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (mongoose.isValidObjectId(value)) return String(value);
  if (value?._id && mongoose.isValidObjectId(value._id)) return String(value._id);
  return '';
};

const toValidBranchCode = (value = '') =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_')
    .replace(/[^A-Z0-9_-]/g, '');

const resolveTenantObjectId = async () => {
  const contextTenantId = toObjectIdString(getTenantIdFromContext());
  if (contextTenantId && mongoose.isValidObjectId(contextTenantId)) {
    return new mongoose.Types.ObjectId(contextTenantId);
  }

  const defaultTenant = await ensureDefaultTenant();
  const defaultTenantId = toObjectIdString(defaultTenant?._id);
  if (!defaultTenantId || !mongoose.isValidObjectId(defaultTenantId)) return null;
  return new mongoose.Types.ObjectId(defaultTenantId);
};

const ensureMainBranch = async () => {
  const mainCode = toValidBranchCode(MAIN_BRANCH_CODE) || MAIN_BRANCH_CODE;
  const tenantObjectId = await resolveTenantObjectId();
  if (!tenantObjectId) {
    throw new Error('Failed to resolve tenant for branch bootstrap');
  }

  const existing = await Branch.findOne({ branchCode: mainCode, tenantId: tenantObjectId })
    .setOptions({ skipTenantFilter: true });
  if (existing) return existing;

  try {
    return await Branch.create({
      branchName: MAIN_BRANCH_NAME,
      branchCode: mainCode,
      address: '',
      city: 'Main City',
      state: 'Main State',
      contactNumber: '',
      isActive: true,
      tenantId: tenantObjectId,
    });
  } catch (error) {
    if (Number(error?.code) === 11000) {
      return Branch.findOne({ branchCode: mainCode, tenantId: tenantObjectId })
        .setOptions({ skipTenantFilter: true });
    }
    throw error;
  }
};

const ensureBranchById = async (branchId) => {
  const normalizedBranchId = toObjectIdString(branchId);
  if (!normalizedBranchId || !mongoose.isValidObjectId(normalizedBranchId)) {
    return null;
  }

  return Branch.findById(normalizedBranchId);
};

const ensureCarBranch = async (carOrId) => {
  let carDoc = carOrId;
  if (!carDoc) return { car: null, branch: null };

  const looksLikeDocument = typeof carDoc === 'object' && carDoc !== null;
  if (!looksLikeDocument || !carDoc._id) {
    const carId = toObjectIdString(carOrId);
    if (!carId || !mongoose.isValidObjectId(carId)) {
      return { car: null, branch: null };
    }
    carDoc = await Car.findById(carId);
  }

  if (!carDoc) {
    return { car: null, branch: null };
  }

  let branch = null;
  const carBranchId = toObjectIdString(carDoc.branchId);
  if (carBranchId && mongoose.isValidObjectId(carBranchId)) {
    branch = await Branch.findById(carBranchId);
  }

  if (!branch) {
    const carTenantId = toObjectIdString(carDoc.tenantId);
    const mainBranch = carTenantId
      ? await runWithTenantContext({ tenantId: carTenantId }, () => ensureMainBranch())
      : await ensureMainBranch();
    const mainBranchId = String(mainBranch._id);

    if (String(carDoc.branchId || '') !== mainBranchId) {
      await Car.updateOne(
        {
          _id: carDoc._id,
          ...(carDoc?.tenantId ? { tenantId: carDoc.tenantId } : {}),
          $or: [{ branchId: { $exists: false } }, { branchId: null }, { branchId: carDoc.branchId }],
        },
        { $set: { branchId: mainBranch._id } },
        { skipTenantFilter: true },
      );
      carDoc.branchId = mainBranch._id;
    }

    branch = mainBranch;
  }

  return { car: carDoc, branch };
};

const assertCarBranchActive = async (carOrId, message = 'Vehicle temporarily unavailable') => {
  const { car, branch } = await ensureCarBranch(carOrId);

  if (!car || !branch) {
    const error = new Error('Car not found');
    error.status = 404;
    throw error;
  }

  if (!branch.isActive) {
    const error = new Error(message);
    error.status = 422;
    error.code = 'BRANCH_INACTIVE';
    throw error;
  }

  return { car, branch };
};

const isBranchBookable = async (branchId) => {
  const branch = await ensureBranchById(branchId);
  if (!branch) return false;
  return Boolean(branch.isActive);
};

const bootstrapBranchSystem = async () => {
  if (!branchBootstrapPromise) {
    branchBootstrapPromise = (async () => {
      const mainBranch = await ensureMainBranch();
      const tenantId = mainBranch?.tenantId || null;
      await Car.updateMany(
        {
          ...(tenantId ? { tenantId } : {}),
          $or: [{ branchId: { $exists: false } }, { branchId: null }],
        },
        {
          $set: { branchId: mainBranch._id },
        },
        { skipTenantFilter: true },
      );

      return mainBranch;
    })().catch((error) => {
      branchBootstrapPromise = null;
      throw error;
    });
  }

  return branchBootstrapPromise;
};

const getBranchSummary = async () => {
  const branches = await Branch.find().sort({ branchName: 1 }).lean();
  return branches;
};

module.exports = {
  MAIN_BRANCH_CODE,
  MAIN_BRANCH_NAME,
  toValidBranchCode,
  toObjectIdString,
  ensureMainBranch,
  ensureBranchById,
  ensureCarBranch,
  assertCarBranchActive,
  isBranchBookable,
  bootstrapBranchSystem,
  getBranchSummary,
};
