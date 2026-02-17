const mongoose = require('mongoose');
const Car = require('../models/Car');
const { ROLE, normalizeRole, normalizeBranches } = require('../utils/rbac');
const { ensureCarBranch } = require('./branchService');

const SCOPED_STAFF_ROLES = new Set([
  ROLE.BRANCH_ADMIN,
  ROLE.FLEET_MANAGER,
  ROLE.FINANCE_MANAGER,
  ROLE.SUPPORT_STAFF,
]);

const isSuperAdmin = (user) => normalizeRole(user?.role) === ROLE.SUPER_ADMIN;
const isBranchAdmin = (user) => normalizeRole(user?.role) === ROLE.BRANCH_ADMIN;
const isScopedStaff = (user) => SCOPED_STAFF_ROLES.has(normalizeRole(user?.role));
const getAssignedBranches = (user) => normalizeBranches(user?.assignedBranches);

const splitAssignedBranches = (assignedBranches = []) => {
  const branchIds = [];
  const legacyLocations = [];

  for (const entry of assignedBranches) {
    const normalized = String(entry || '').trim();
    if (!normalized) continue;

    if (mongoose.isValidObjectId(normalized)) {
      branchIds.push(normalized);
      continue;
    }

    legacyLocations.push(normalized);
  }

  return {
    branchIds: [...new Set(branchIds)],
    legacyLocations: [...new Set(legacyLocations)],
  };
};

const mergeQueryWithScope = (query = {}, scopeFilter = null) => {
  if (!scopeFilter) return query;
  if (!query || Object.keys(query).length === 0) return scopeFilter;
  return { $and: [query, scopeFilter] };
};

const getScopedCarFilter = async (user) => {
  if (!isScopedStaff(user)) return null;

  const assignedBranches = getAssignedBranches(user);
  if (assignedBranches.length === 0) {
    return { _id: { $in: [] } };
  }

  const { branchIds, legacyLocations } = splitAssignedBranches(assignedBranches);
  const filters = [];

  if (branchIds.length > 0) {
    filters.push({ branchId: { $in: branchIds } });
  }

  if (legacyLocations.length > 0) {
    filters.push({ location: { $in: legacyLocations } });
  }

  if (filters.length === 0) {
    return { _id: { $in: [] } };
  }

  if (filters.length === 1) return filters[0];
  return { $or: filters };
};

const getScopedCarIds = async (user) => {
  const carFilter = await getScopedCarFilter(user);
  if (carFilter === null) return null;

  const cars = await Car.find(carFilter).select('_id').lean();
  return cars.map((car) => car._id);
};

const applyCarScopeToQuery = async (user, query = {}, carField = 'car') => {
  const scopedCarIds = await getScopedCarIds(user);
  if (scopedCarIds === null) return query;

  return mergeQueryWithScope(query, { [carField]: { $in: scopedCarIds } });
};

const getScopedBookingFilter = async (user) => {
  if (!isScopedStaff(user)) return null;

  const assignedBranches = getAssignedBranches(user);
  if (assignedBranches.length === 0) {
    return { _id: { $in: [] } };
  }

  const { branchIds } = splitAssignedBranches(assignedBranches);
  const filters = [];

  if (branchIds.length > 0) {
    filters.push({ branchId: { $in: branchIds } });
  }

  const scopedCarIds = await getScopedCarIds(user);
  if (Array.isArray(scopedCarIds)) {
    filters.push({ car: { $in: scopedCarIds } });
  }

  if (filters.length === 0) {
    return { _id: { $in: [] } };
  }

  if (filters.length === 1) return filters[0];
  return { $or: filters };
};

const applyBookingScopeToQuery = async (user, query = {}) => {
  const bookingScope = await getScopedBookingFilter(user);
  if (bookingScope === null) return query;
  return mergeQueryWithScope(query, bookingScope);
};

const assertCarInScope = async (user, carId, message = 'Not allowed for this branch scope') => {
  if (!isScopedStaff(user)) return;

  const assignedBranches = getAssignedBranches(user);
  if (assignedBranches.length === 0) {
    const error = new Error(message);
    error.status = 403;
    throw error;
  }

  const { car } = await ensureCarBranch(carId);
  const { branchIds, legacyLocations } = splitAssignedBranches(assignedBranches);
  const carBranchId = String(car?.branchId || '').trim();
  const carLocation = String(car?.location || '').trim();

  const inBranchScope = branchIds.length > 0 && branchIds.includes(carBranchId);
  const inLegacyLocationScope = legacyLocations.length > 0 && legacyLocations.includes(carLocation);

  if (!car || (!inBranchScope && !inLegacyLocationScope)) {
    const error = new Error(message);
    error.status = 403;
    throw error;
  }
};

const assertBranchInScope = (user, branchId, message = 'Not allowed for this branch scope') => {
  if (!isScopedStaff(user)) return;

  const assignedBranches = getAssignedBranches(user);
  const { branchIds } = splitAssignedBranches(assignedBranches);
  if (branchIds.length === 0) {
    const error = new Error(message);
    error.status = 403;
    throw error;
  }

  const normalizedBranchId = String(branchId || '').trim();
  if (!normalizedBranchId || !branchIds.includes(normalizedBranchId)) {
    const error = new Error(message);
    error.status = 403;
    throw error;
  }
};

const getScopedBranchIds = (user) => {
  if (isSuperAdmin(user)) return null;
  if (!isScopedStaff(user)) return null;

  const assignedBranches = getAssignedBranches(user);
  const { branchIds } = splitAssignedBranches(assignedBranches);
  return branchIds;
};

module.exports = {
  isSuperAdmin,
  isBranchAdmin,
  isScopedStaff,
  getAssignedBranches,
  splitAssignedBranches,
  getScopedBranchIds,
  getScopedCarIds,
  applyCarScopeToQuery,
  applyBookingScopeToQuery,
  assertCarInScope,
  assertBranchInScope,
};
