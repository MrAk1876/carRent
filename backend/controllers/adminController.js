const Request = require('../models/Request');
const Booking = require('../models/Booking');
const Car = require('../models/Car');
const CarCategory = require('../models/CarCategory');
const Maintenance = require('../models/Maintenance');
const Branch = require('../models/Branch');
const Location = require('../models/Location');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { uploadImageFromBuffer, deleteImageByPublicId } = require('../utils/cloudinaryImage');
const {
  calculateAdvanceBreakdown,
  resolveFinalAmount,
  isAdvancePaidStatus,
  isConfirmedBookingStatus,
} = require('../utils/paymentUtils');
const { syncRentalStagesForBookings } = require('../services/rentalStageService');
const { finalizeBookingSettlement } = require('../services/bookingSettlementService');
const { runPendingPaymentTimeoutSweep } = require('../services/bookingPaymentTimeoutService');
const {
  queueAdvancePaidConfirmationEmail,
  queueRefundProcessedEmail,
} = require('../services/bookingEmailNotificationService');
const { applyRefundToBooking, resolveAdvancePaidAmount } = require('../services/refundService');
const {
  FLEET_STATUS,
  FLEET_STATUS_VALUES,
  normalizeFleetStatus,
} = require('../utils/fleetStatus');
const {
  updateCarFleetStatus,
  releaseCarIfUnblocked,
  resolveFleetStatus,
  hasBlockingBookingsForCar,
} = require('../services/fleetService');
const {
  buildMaintenanceReminderFlags,
  recalculateCarMaintenanceCost,
  syncCarFleetStatusFromMaintenance,
  ensureCanEnterMaintenanceState,
  toValidDate: toValidDateSafe,
} = require('../services/maintenanceService');
const {
  ROLE,
  ROLES,
  normalizeRole,
  normalizeBranches,
  getPermissionsForRole,
} = require('../utils/rbac');
const { queueAuditLog } = require('../services/auditLogService');
const {
  applyCarScopeToQuery,
  applyBookingScopeToQuery,
  assertCarInScope,
  assertBranchInScope,
  getScopedBranchIds,
  getScopedCarIds,
} = require('../services/adminScopeService');
const {
  MAIN_BRANCH_CODE,
  ensureMainBranch,
  ensureBranchById,
  ensureCarBranch,
  assertCarBranchActive,
  toValidBranchCode,
} = require('../services/branchService');
const {
  syncBranchLocationHierarchy,
  syncCarLocationHierarchy,
  syncBookingLocationHierarchy,
  ensureLocationDocument,
} = require('../services/locationHierarchyService');
const {
  reserveSubscriptionUsageForRequest,
  rollbackSubscriptionUsageReservation,
  appendSubscriptionUsageHistory,
  normalizeRentalType,
  getSubscriptionDamageFeeDiscountPercent,
  applyPercentageDiscount,
} = require('../services/subscriptionService');
const { resolveSmartPriceForCar, clearSmartPricingCache } = require('../services/smartPricingService');
const { assertTenantEntityLimit } = require('../services/tenantLimitService');
const { normalizeRentalDaysValue, calculateRentalDaysByCalendar } = require('../utils/rentalDateUtils');
const { resolveDepositSettlementSnapshot } = require('../utils/depositSettlementUtils');

const MIN_PASSWORD_LENGTH = 8;
const LATE_RATE_MULTIPLIER = 1.5;
const MIN_INSPECTION_NOTES_LENGTH = 3;
const MAX_INSPECTION_IMAGES = 8;
const MAINTENANCE_SERVICE_TYPES = Array.isArray(Maintenance.SERVICE_TYPES) ? Maintenance.SERVICE_TYPES : [];
const MAINTENANCE_STATUS_VALUES = Array.isArray(Maintenance.MAINTENANCE_STATUS)
  ? Maintenance.MAINTENANCE_STATUS
  : ['Scheduled', 'Completed'];
const PRICING_AUDIT_ACTION_TYPES = Object.freeze([
  'CAR_DYNAMIC_PRICING_TOGGLED',
  'CAR_MANUAL_PRICE_SET',
  'CAR_MANUAL_PRICE_RESET',
  'CAR_BASE_PRICE_UPDATED',
  'BRANCH_DYNAMIC_PRICING_TOGGLED',
]);
const CAR_EDITABLE_FIELDS = [
  'name',
  'brand',
  'model',
  'category',
  'year',
  'seating_capacity',
  'fuel_type',
  'transmission',
  'location',
  'locationId',
  'pricePerDay',
  'priceRangeType',
  'registrationNumber',
  'chassisNumber',
  'engineNumber',
  'purchaseDate',
  'insuranceExpiry',
  'pollutionExpiry',
  'currentMileage',
  'totalTripsCompleted',
  'lastServiceDate',
  'features',
];
const BRANCH_SCOPED_ROLES = new Set([
  ROLE.BRANCH_ADMIN,
  ROLE.FLEET_MANAGER,
  ROLE.FINANCE_MANAGER,
  ROLE.SUPPORT_STAFF,
]);
const LOCATION_CONTROL_ROLES = new Set([ROLE.SUPER_ADMIN, ROLE.BRANCH_ADMIN]);
const CATEGORY_CONTROL_ROLES = new Set([ROLE.SUPER_ADMIN]);
const DEFAULT_CAR_CATEGORIES = Object.freeze([
  'Sedan',
  'SUV',
  'Luxury Sedan',
  'Luxury SUV',
  'Premium SUV',
  'Premium Sedan',
  'Compact SUV',
  'Hatchback',
  'Economy SUV',
  'MPV',
  'Sports Car',
  'Premium Hatchback',
  'Adventure SUV',
  'Luxury Adventure SUV',
]);

const isBranchScopedRole = (roleValue) => BRANCH_SCOPED_ROLES.has(normalizeRole(roleValue, ROLE.USER));
const canManageBranchLocations = (user) => LOCATION_CONTROL_ROLES.has(normalizeRole(user?.role, ROLE.USER));
const canManageCarCategories = (user) => CATEGORY_CONTROL_ROLES.has(normalizeRole(user?.role, ROLE.USER));

const ensureSuperAdminAccess = (user) => {
  if (normalizeRole(user?.role, ROLE.USER) === ROLE.SUPER_ADMIN) {
    return;
  }

  const error = new Error('SuperAdmin access required');
  error.status = 403;
  throw error;
};

const ensureLocationControlAccess = (user) => {
  if (canManageBranchLocations(user)) return;
  const error = new Error('Location management access denied');
  error.status = 403;
  throw error;
};

const ensureCategoryControlAccess = (user) => {
  if (canManageCarCategories(user)) return;
  const error = new Error('Category management access denied');
  error.status = 403;
  throw error;
};

const normalizeBranchForClient = (branch) => {
  if (!branch) return null;

  const serviceCities = [
    ...new Set(
      [branch.city, ...(Array.isArray(branch.serviceCities) ? branch.serviceCities : [])]
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
    ),
  ];

  return {
    _id: String(branch._id),
    branchName: String(branch.branchName || '').trim(),
    branchCode: String(branch.branchCode || '').trim(),
    address: String(branch.address || '').trim(),
    stateId:
      typeof branch.stateId === 'object'
        ? {
            _id: String(branch.stateId?._id || ''),
            name: String(branch.stateId?.name || '').trim(),
          }
        : String(branch.stateId || ''),
    cityId:
      typeof branch.cityId === 'object'
        ? {
            _id: String(branch.cityId?._id || ''),
            name: String(branch.cityId?.name || '').trim(),
          }
        : String(branch.cityId || ''),
    city: String(branch.city || '').trim(),
    serviceCities,
    state: String(branch.state || '').trim(),
    contactNumber: String(branch.contactNumber || '').trim(),
    latitude: Number.isFinite(Number(branch.latitude)) ? Number(branch.latitude) : null,
    longitude: Number.isFinite(Number(branch.longitude)) ? Number(branch.longitude) : null,
    manager: branch.manager || null,
    isActive: Boolean(branch.isActive),
    dynamicPricingEnabled: Boolean(branch.dynamicPricingEnabled),
    dynamicPricingMultiplier: Number(branch.dynamicPricingMultiplier || 1),
    createdAt: branch.createdAt,
    updatedAt: branch.updatedAt,
  };
};

const normalizeLocationForClient = (location) => ({
  _id: String(location?._id || '').trim(),
  name: String(location?.name || '').trim(),
  cityId:
    typeof location?.cityId === 'object'
      ? {
          _id: String(location?.cityId?._id || '').trim(),
          name: String(location?.cityId?.name || '').trim(),
        }
      : String(location?.cityId || '').trim(),
  stateId:
    typeof location?.stateId === 'object'
      ? {
          _id: String(location?.stateId?._id || '').trim(),
          name: String(location?.stateId?.name || '').trim(),
        }
      : String(location?.stateId || '').trim(),
  branchId:
    typeof location?.branchId === 'object'
      ? {
          _id: String(location?.branchId?._id || '').trim(),
          branchName: String(location?.branchId?.branchName || '').trim(),
        }
      : String(location?.branchId || '').trim(),
  branchAddress: String(location?.branchAddress || '').trim(),
  isPrimary: Boolean(location?.isPrimary),
  isActive: Boolean(location?.isActive !== false),
});

const attachLocationsToBranches = async (branches = []) => {
  const normalizedBranches = branches.map((branch) => normalizeBranchForClient(branch));
  const branchIds = normalizedBranches.map((branch) => String(branch?._id || '')).filter(Boolean);
  if (branchIds.length === 0) {
    return normalizedBranches.map((branch) => ({ ...branch, locations: [] }));
  }

  await Promise.allSettled(branchIds.map((branchId) => syncBranchLocationHierarchy(branchId)));

  const locations = await Location.find({
    branchId: { $in: branchIds },
    isActive: true,
  })
    .populate('cityId', 'name')
    .populate('stateId', 'name')
    .populate('branchId', 'branchName')
    .sort({ isPrimary: -1, name: 1 })
    .lean();

  const locationsByBranchId = new Map();
  locations.forEach((location) => {
    const branchId = String(location?.branchId?._id || location?.branchId || '').trim();
    if (!branchId) return;
    const normalizedLocation = normalizeLocationForClient(location);
    const branchLocations = locationsByBranchId.get(branchId) || [];
    branchLocations.push(normalizedLocation);
    locationsByBranchId.set(branchId, branchLocations);
  });

  return normalizedBranches.map((branch) => ({
    ...branch,
    locations: locationsByBranchId.get(String(branch?._id || '')) || [],
  }));
};

const normalizeBranchInputList = (rawValue) => {
  if (Array.isArray(rawValue)) return normalizeBranches(rawValue);
  if (typeof rawValue === 'string') {
    return normalizeBranches(
      rawValue
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }
  return [];
};

const normalizeCityList = (rawValue) => {
  if (Array.isArray(rawValue)) {
    return [
      ...new Set(
        rawValue
          .map((entry) => String(entry || '').trim())
          .filter(Boolean),
      ),
    ];
  }

  if (typeof rawValue === 'string') {
    return [
      ...new Set(
        rawValue
          .split(/[\n,]/g)
          .map((entry) => String(entry || '').trim())
          .filter(Boolean),
      ),
    ];
  }

  return [];
};

const buildBranchLocationRefPatch = (branch) => ({
  stateId: branch?.stateId || null,
  cityId: branch?.cityId || null,
});

const resolveBranchAssignments = async (rawValue) => {
  const entries = normalizeBranchInputList(rawValue);
  if (entries.length === 0) {
    return [];
  }

  const resolved = [];
  const unresolved = [];

  for (const entry of entries) {
    const branchById = await ensureBranchById(entry);
    if (branchById?._id) {
      resolved.push(String(branchById._id));
      continue;
    }

    const normalizedCode = toValidBranchCode(entry);
    if (normalizedCode) {
      const branchByCode = await Branch.findOne({ branchCode: normalizedCode }).select('_id').lean();
      if (branchByCode?._id) {
        resolved.push(String(branchByCode._id));
        continue;
      }
    }

    unresolved.push(entry);
  }

  if (resolved.length > 0) {
    return [...new Set(resolved)];
  }

  // Legacy fallback (location-based assignments) remains supported.
  return [...new Set(unresolved)];
};

const resolveRequestedBranchId = async (req) => {
  const requestedBranchId = String(req.query?.branchId || req.body?.branchId || '').trim();
  if (!requestedBranchId) {
    return '';
  }

  const branch = await ensureBranchById(requestedBranchId);
  if (!branch) {
    const error = new Error('Branch not found');
    error.status = 404;
    throw error;
  }

  const scopedBranchIds = getScopedBranchIds(req.user);
  if (Array.isArray(scopedBranchIds)) {
    if (scopedBranchIds.length === 0 || !scopedBranchIds.includes(String(branch._id))) {
      const error = new Error('Not allowed for this branch scope');
      error.status = 403;
      throw error;
    }
  }

  return String(branch._id);
};

const resolveBranchForCarWrite = async (user, requestedBranchId) => {
  const scopedBranchIds = getScopedBranchIds(user);

  if (Array.isArray(scopedBranchIds)) {
    if (scopedBranchIds.length === 0) {
      const error = new Error('No branch assigned for this staff account');
      error.status = 403;
      throw error;
    }

    if (requestedBranchId) {
      const normalizedRequestedBranchId = String(requestedBranchId).trim();
      if (!scopedBranchIds.includes(normalizedRequestedBranchId)) {
        const error = new Error('Not allowed for this branch scope');
        error.status = 403;
        throw error;
      }

      const requestedBranch = await ensureBranchById(normalizedRequestedBranchId);
      if (!requestedBranch) {
        const error = new Error('Branch not found');
        error.status = 404;
        throw error;
      }

      return requestedBranch;
    }

    const scopedDefaultBranch = await ensureBranchById(scopedBranchIds[0]);
    if (!scopedDefaultBranch) {
      const error = new Error('Assigned branch not found');
      error.status = 404;
      throw error;
    }

    return scopedDefaultBranch;
  }

  if (requestedBranchId) {
    const requestedBranch = await ensureBranchById(requestedBranchId);
    if (!requestedBranch) {
      const error = new Error('Branch not found');
      error.status = 404;
      throw error;
    }
    return requestedBranch;
  }

  return ensureMainBranch();
};

const calculateHourlyLateRate = (perDayPrice) => {
  const normalizedPerDayPrice = Number(perDayPrice);
  if (!Number.isFinite(normalizedPerDayPrice) || normalizedPerDayPrice <= 0) {
    return 0;
  }

  return Number(((normalizedPerDayPrice / 24) * LATE_RATE_MULTIPLIER).toFixed(2));
};

const parseBooleanInput = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
};

const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '');

const parseOptionalTenDigitPhone = (value, fieldName = 'contactNumber') => {
  const normalized = normalizePhoneDigits(value);
  if (!normalized) return '';
  if (!/^[0-9]{10}$/.test(normalized)) {
    const error = new Error(`${fieldName} must be exactly 10 digits`);
    error.status = 422;
    throw error;
  }
  return normalized;
};

const normalizeCompactText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeLocationName = (value) => normalizeCompactText(value);
const normalizeCategoryName = (value) => normalizeCompactText(value);

const toLowerCaseKey = (value) => normalizeLocationName(value).toLowerCase();
const toCategoryKey = (value) => normalizeCategoryName(value).toLowerCase();

const escapeRegExp = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findLocationMatch = (locations = [], value) => {
  const normalizedTarget = toLowerCaseKey(value);
  if (!normalizedTarget) return '';
  return locations.find((entry) => toLowerCaseKey(entry) === normalizedTarget) || '';
};

const findCategoryMatch = (categories = [], value) => {
  const normalizedTarget = toCategoryKey(value);
  if (!normalizedTarget) return '';
  return categories.find((entry) => toCategoryKey(entry) === normalizedTarget) || '';
};

const resolveBranchForLocationWrite = async (user, branchId) => {
  ensureLocationControlAccess(user);

  const normalizedBranchId = String(branchId || '').trim();
  if (!normalizedBranchId) {
    const error = new Error('branchId is required');
    error.status = 422;
    throw error;
  }

  const branch = await ensureBranchById(normalizedBranchId);
  if (!branch) {
    const error = new Error('Branch not found');
    error.status = 404;
    throw error;
  }

  const scopedBranchIds = getScopedBranchIds(user);
  if (Array.isArray(scopedBranchIds) && !scopedBranchIds.includes(String(branch._id))) {
    const error = new Error('Not allowed for this branch scope');
    error.status = 403;
    throw error;
  }

  return branch;
};

const toLocationUsageMap = (cars = []) => {
  const usageByBranch = new Map();

  cars.forEach((car) => {
    const branchId = String(car?.branchId || '').trim();
    const locationId = String(car?.locationId?._id || car?.locationId || '').trim();
    const location = normalizeLocationName(car?.locationId?.name || car?.location);
    if (!branchId || (!locationId && !location)) return;

    const branchUsage = usageByBranch.get(branchId) || new Map();
    const key = locationId || location.toLowerCase();
    const existingEntry = branchUsage.get(key);
    if (existingEntry) {
      existingEntry.carCount += 1;
    } else {
      branchUsage.set(key, { name: location, carCount: 1, locationId });
    }
    usageByBranch.set(branchId, branchUsage);
  });

  return usageByBranch;
};

const toCategoryUsageMap = (cars = []) => {
  const usageMap = new Map();
  cars.forEach((car) => {
    const categoryName = normalizeCategoryName(car?.category);
    if (!categoryName) return;
    const key = toCategoryKey(categoryName);
    const existing = usageMap.get(key);
    if (existing) {
      existing.carCount += 1;
    } else {
      usageMap.set(key, {
        name: categoryName,
        carCount: 1,
      });
    }
  });
  return usageMap;
};

const mergeCategoryEntries = ({ savedCategories = [], usageMap = new Map(), includeDefaults = false }) => {
  const merged = new Map();
  const defaultKeySet = new Set();

  if (includeDefaults) {
    DEFAULT_CAR_CATEGORIES.forEach((categoryName) => {
      const key = toCategoryKey(categoryName);
      if (!key) return;
      defaultKeySet.add(key);
      if (!merged.has(key)) {
        merged.set(key, {
          name: categoryName,
          carCount: 0,
          legacyOnly: false,
          managed: false,
          isDefault: true,
        });
      }
    });
  }

  savedCategories.forEach((category) => {
    const normalizedName = normalizeCategoryName(category?.name);
    const key = toCategoryKey(normalizedName || category?.nameKey);
    if (!key) return;

    const existingEntry = merged.get(key);
    const usageEntry = usageMap.get(key);
    merged.set(key, {
      name: normalizedName || existingEntry?.name || usageEntry?.name || key,
      carCount: Number(usageEntry?.carCount || existingEntry?.carCount || 0),
      legacyOnly: false,
      managed: true,
      isDefault: defaultKeySet.has(key),
    });
  });

  usageMap.forEach((usageEntry, key) => {
    const existingEntry = merged.get(key);
    merged.set(key, {
      name: existingEntry?.name || usageEntry?.name || key,
      carCount: Number(usageEntry?.carCount || existingEntry?.carCount || 0),
      legacyOnly: !existingEntry?.managed,
      managed: Boolean(existingEntry?.managed),
      isDefault: Boolean(existingEntry?.isDefault || defaultKeySet.has(key)),
    });
  });

  return [...merged.values()].sort((left, right) => left.name.localeCompare(right.name));
};

const findCarLocationMatchForBranch = async (branchId, locationName) => {
  const normalized = normalizeLocationName(locationName);
  if (!branchId || !normalized) return '';

  const locationRegex = new RegExp(`^${escapeRegExp(normalized)}$`, 'i');
  const car = await Car.findOne({
    branchId,
    location: { $regex: locationRegex },
  })
    .select('location')
    .lean();

  return normalizeLocationName(car?.location);
};

const resolveExistingBranchLocationName = async (branch, locationName) => {
  const currentLocations = getBranchServiceCities(branch);
  const branchLocation = findLocationMatch(currentLocations, locationName);
  if (branchLocation) {
    return branchLocation;
  }

  return findCarLocationMatchForBranch(branch?._id, locationName);
};

const toNonNegativeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0) return fallback;
  return numericValue;
};

const parseOptionalPositivePrice = (value) => {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return NaN;
  return Number(numericValue.toFixed(2));
};

const getBranchServiceCities = (branch) =>
  [
    ...new Set(
      [branch?.city, ...(Array.isArray(branch?.serviceCities) ? branch.serviceCities : [])]
        .map((entry) => String(entry || '').trim())
        .filter(Boolean),
    ),
  ];

const normalizeLocationForBranch = (branch, locationValue) => {
  const location = String(locationValue || '').trim();
  if (!location) {
    const error = new Error('Location is required');
    error.status = 422;
    throw error;
  }

  const allowedCities = getBranchServiceCities(branch);
  if (allowedCities.length === 0) return location;

  const normalizedInput = location.toLowerCase();
  const matchedCity = allowedCities.find((city) => city.toLowerCase() === normalizedInput);
  if (!matchedCity) {
    const error = new Error(`Location must belong to selected branch cities: ${allowedCities.join(', ')}`);
    error.status = 422;
    throw error;
  }

  return matchedCity;
};

const resolveLocationDocumentForBranch = async (branch, { locationId, locationName } = {}) => {
  if (!branch?._id) {
    const error = new Error('Branch is required');
    error.status = 422;
    throw error;
  }

  const normalizedLocationId = String(locationId || '').trim();
  if (normalizedLocationId) {
    const locationById = await Location.findOne({
      _id: normalizedLocationId,
      branchId: branch._id,
      isActive: true,
    });
    if (!locationById) {
      const error = new Error('Selected pickup location does not belong to the selected branch');
      error.status = 422;
      throw error;
    }
    return locationById;
  }

  const normalizedLocationName = normalizeLocationName(locationName);
  if (!normalizedLocationName) {
    const error = new Error('Location is required');
    error.status = 422;
    throw error;
  }

  const locationByName = await Location.findOne({
    branchId: branch._id,
    nameKey: normalizedLocationName.toLowerCase(),
    isActive: true,
  });
  if (locationByName) {
    return locationByName;
  }

  const error = new Error('Selected pickup location does not belong to the selected branch');
  error.status = 422;
  throw error;
};

const formatPricingHistoryEntry = (entry) => ({
  _id: String(entry?._id || ''),
  actionType: String(entry?.actionType || '').trim(),
  targetEntity: String(entry?.targetEntity || '').trim(),
  targetId: String(entry?.targetId || '').trim(),
  createdAt: entry?.createdAt || null,
  user: entry?.userId
    ? {
        _id: String(entry.userId?._id || ''),
        firstName: String(entry.userId?.firstName || '').trim(),
        lastName: String(entry.userId?.lastName || '').trim(),
        email: String(entry.userId?.email || '').trim(),
        role: String(entry.userId?.role || '').trim(),
      }
    : null,
  meta: entry?.meta || null,
});

const extractImageFiles = (files) => {
  if (!files) return [];
  if (Array.isArray(files)) return files.filter((file) => file && file.buffer);
  return [];
};

const uploadInspectionImages = async (files, folder) => {
  const uploadedImages = [];
  for (const file of files) {
    const uploadResult = await uploadImageFromBuffer(file, { folder });
    uploadedImages.push(uploadResult);
  }
  return uploadedImages;
};

const cleanupUploadedImages = async (images = []) => {
  for (const image of images) {
    if (!image?.publicId) continue;
    try {
      await deleteImageByPublicId(image.publicId);
    } catch (cleanupError) {
      console.error('Failed to cleanup inspection image:', cleanupError);
    }
  }
};

const parseFeatures = (value) => {
  if (!value) return value;
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return [];

    if (normalized.startsWith('[')) {
      try {
        const parsed = JSON.parse(normalized);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Fallback to comma-separated parsing below.
      }
    }

    return normalized
      .replace(/[\[\]"]/g, '')
      .split(',')
      .map((feature) => feature.trim())
      .filter(Boolean);
  }
  return value;
};

const pickCarPayload = (body = {}) => {
  const data = {};

  CAR_EDITABLE_FIELDS.forEach((field) => {
    if (body[field] !== undefined) {
      data[field] = body[field];
    }
  });

  if (data.features !== undefined) {
    data.features = parseFeatures(data.features);
  }

  return data;
};

const normalizeMaintenancePayload = (body = {}) => {
  const normalizedServiceType = String(body.serviceType || '').trim();
  const normalizedStatus = String(body.maintenanceStatus || 'Scheduled').trim();

  const serviceDate = toValidDateSafe(body.serviceDate);
  const nextServiceDueDate = toValidDateSafe(body.nextServiceDueDate);

  const hasMileageValue = body.serviceMileage !== undefined && body.serviceMileage !== null && String(body.serviceMileage).trim() !== '';
  const parsedMileage = Number(body.serviceMileage);
  const serviceMileage = hasMileageValue
    ? (Number.isFinite(parsedMileage) && parsedMileage >= 0 ? parsedMileage : NaN)
    : null;

  const parsedCost = Number(body.serviceCost);
  const serviceCost = Number.isFinite(parsedCost) && parsedCost >= 0 ? parsedCost : NaN;

  return {
    serviceType: normalizedServiceType,
    serviceDescription: String(body.serviceDescription || '').trim(),
    serviceDate,
    nextServiceDueDate,
    serviceMileage,
    serviceCost,
    serviceProvider: String(body.serviceProvider || '').trim(),
    invoiceReference: String(body.invoiceReference || '').trim(),
    maintenanceStatus: normalizedStatus,
  };
};

const countCarsByFleetStatus = (cars = []) => {
  const summary = {
    totalVehicles: cars.length,
    available: 0,
    reserved: 0,
    rented: 0,
    maintenance: 0,
    inactive: 0,
  };

  for (const car of cars) {
    const fleetStatus = resolveFleetStatus(car);
    if (fleetStatus === FLEET_STATUS.AVAILABLE) summary.available += 1;
    if (fleetStatus === FLEET_STATUS.RESERVED) summary.reserved += 1;
    if (fleetStatus === FLEET_STATUS.RENTED) summary.rented += 1;
    if (fleetStatus === FLEET_STATUS.MAINTENANCE) summary.maintenance += 1;
    if (fleetStatus === FLEET_STATUS.INACTIVE) summary.inactive += 1;
  }

  return summary;
};

const normalizeUserForClient = (user) => {
  if (!user) return user;
  const normalizedRole = normalizeRole(user.role, ROLE.USER);
  const assignedBranches = normalizeBranches(user.assignedBranches);

  return {
    ...user,
    role: normalizedRole,
    assignedBranches,
    permissions: getPermissionsForRole(normalizedRole),
  };
};

const assertBookingBranchScope = async (user, booking, message = 'Booking does not belong to your branch scope') => {
  if (booking?.branchId) {
    assertBranchInScope(user, String(booking.branchId), message);
    return;
  }

  const carId = booking?.car?._id || booking?.car;
  await assertCarInScope(user, carId, message);
};

const assertRequestBranchScope = async (user, request, message = 'Request does not belong to your branch scope') => {
  if (request?.branchId) {
    assertBranchInScope(user, String(request.branchId), message);
    return;
  }

  await assertCarInScope(user, request?.car?._id || request?.car, message);
};

exports.getAllRequests = async (req, res) => {
  try {
    const selectedBranchId = await resolveRequestedBranchId(req);
    let query = selectedBranchId ? { branchId: selectedBranchId } : {};
    query = await applyCarScopeToQuery(req.user, query);
    const requests = await Request.find(query)
      .populate('car')
      .populate('subscriptionPlanId', 'planName durationType durationInDays')
      .populate('branchId', 'branchName branchCode city state serviceCities isActive')
      .populate('user', 'firstName lastName email role isBlocked image')
      .sort({ createdAt: -1 });

    res.json(requests);
  } catch {
    res.status(500).json({ message: 'Failed to load requests' });
  }
};

exports.approveRequest = async (req, res) => {
  let subscriptionReservation = null;
  try {
    const request = await Request.findById(req.params.id)
      .populate('car')
      .populate('user', 'firstName lastName email');

    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    if (!request.car) {
      return res.status(400).json({ message: 'Car already rented' });
    }

    if (request.branchId) {
      assertBranchInScope(req.user, String(request.branchId), 'Request does not belong to your branch scope');
    } else {
      await assertCarInScope(req.user, request.car._id || request.car, 'Request does not belong to your branch scope');
    }

    const { branch } = await assertCarBranchActive(request.car, 'Vehicle temporarily unavailable');
    const resolvedBranchId = request.branchId || branch?._id || null;

    const fleetStatus = normalizeFleetStatus(
      request.car.fleetStatus,
      request.car.isAvailable === false ? FLEET_STATUS.INACTIVE : FLEET_STATUS.AVAILABLE,
    );
    if (![FLEET_STATUS.AVAILABLE, FLEET_STATUS.RESERVED].includes(fleetStatus)) {
      return res.status(422).json({ message: 'Vehicle temporarily unavailable' });
    }

    if (request.status !== 'pending') {
      return res.status(422).json({ message: 'Only pending requests can be approved' });
    }

    if (!isAdvancePaidStatus(request.paymentStatus)) {
      return res.status(422).json({ message: 'Advance payment is required before approval' });
    }

    const { pricing: confirmedPricing, reservation } = await reserveSubscriptionUsageForRequest(request, {
      now: new Date(),
    });
    subscriptionReservation = reservation;
    const finalAmount = Number(confirmedPricing?.finalAmount || resolveFinalAmount(request) || 0);
    const breakdown = calculateAdvanceBreakdown(finalAmount);
    const resolvedDepositAmount = Number.isFinite(Number(request.depositAmount))
      ? Math.max(Number(request.depositAmount), 0)
      : 0;
    const effectiveAdvanceRequired = Math.max(Number(breakdown.advanceRequired || 0), resolvedDepositAmount);
    const effectiveRemainingAmount = Math.max(Number(breakdown.finalAmount || 0) - effectiveAdvanceRequired, 0);

    let finalBargain;
    if (request.bargain && request.bargain.status !== 'NONE') {
      finalBargain = {
        ...request.bargain.toObject(),
        status: 'LOCKED',
      };
    }

    const booking = await Booking.create({
      user: request.user._id,
      car: request.car._id,
      branchId: resolvedBranchId,
      stateId: request.stateId || null,
      cityId: request.cityId || null,
      fromDate: request.fromDate,
      toDate: request.toDate,
      pickupDateTime: request.pickupDateTime || request.fromDate,
      dropDateTime: request.dropDateTime || request.toDate,
      rentalDays:
        normalizeRentalDaysValue(request.rentalDays, { min: 1, max: 3650, allowNull: true }) ||
        normalizeRentalDaysValue(
          calculateRentalDaysByCalendar(request.pickupDateTime || request.fromDate, request.dropDateTime || request.toDate),
          { min: 1, max: 3650, allowNull: true },
        ) ||
        1,
      priceRangeType: String(request.priceRangeType || '').trim() || 'LOW_RANGE',
      depositAmount: Number.isFinite(Number(request.depositAmount))
        ? Math.max(Number(request.depositAmount), 0)
        : 0,
      depositPaid: Number.isFinite(Number(request.depositAmount))
        ? Math.max(Number(request.depositAmount), 0)
        : 0,
      depositRefunded: 0,
      depositDeducted: 0,
      depositStatus: Number.isFinite(Number(request.depositAmount)) && Number(request.depositAmount) > 0
        ? 'HELD'
        : 'NOT_APPLICABLE',
      actualPickupTime: null,
      actualReturnTime: null,
      gracePeriodHours: Number.isFinite(Number(request.gracePeriodHours))
        ? Math.max(Number(request.gracePeriodHours), 0)
        : 1,
      rentalStage: 'Scheduled',
      totalAmount: breakdown.finalAmount,
      lockedPerDayPrice: Number(request?.lockedPerDayPrice || 0),
      basePerDayPrice: Number(request?.basePerDayPrice || 0),
      pricingBaseAmount: Number(request?.pricingBaseAmount || 0),
      pricingLockedAmount: Number(request?.pricingLockedAmount || 0),
      priceSource: request?.priceSource || 'Base',
      priceAdjustmentPercent: Number(request?.priceAdjustmentPercent || 0),
      finalAmount: breakdown.finalAmount,
      totalRentalAmount: breakdown.finalAmount,
      advanceAmount: effectiveAdvanceRequired,
      advanceRequired: effectiveAdvanceRequired,
      advancePaid: effectiveAdvanceRequired,
      remainingAmount: effectiveRemainingAmount,
      amountPaid: effectiveAdvanceRequired,
      amountRemaining: effectiveRemainingAmount,
      rentalType: confirmedPricing?.rentalType || normalizeRentalType(request?.rentalType, 'OneTime'),
      subscriptionPlanId: confirmedPricing?.subscriptionPlanId || request?.subscriptionPlanId || null,
      userSubscriptionId: confirmedPricing?.userSubscriptionId || request?.userSubscriptionId || null,
      subscriptionBaseAmount: confirmedPricing?.subscriptionBaseAmount || request?.subscriptionBaseAmount || breakdown.finalAmount,
      subscriptionHoursUsed: confirmedPricing?.subscriptionHoursUsed || 0,
      subscriptionCoverageAmount: confirmedPricing?.subscriptionCoverageAmount || 0,
      subscriptionExtraAmount: confirmedPricing?.subscriptionExtraAmount || breakdown.finalAmount,
      subscriptionLateFeeDiscountPercentage: confirmedPricing?.subscriptionLateFeeDiscountPercentage || 0,
      subscriptionDamageFeeDiscountPercentage: confirmedPricing?.subscriptionDamageFeeDiscountPercentage || 0,
      paymentMethod: request.paymentMethod || 'NONE',
      paymentStatus: 'Partially Paid',
      fullPaymentAmount: effectiveRemainingAmount,
      fullPaymentMethod: 'NONE',
      fullPaymentReceivedAt: null,
      bookingStatus: 'Confirmed',
      tripStatus: 'upcoming',
      bargain: finalBargain,
    });
    await syncBookingLocationHierarchy(booking, {
      branch: request.branchId ? null : branch || null,
      carId: request.car?._id || request.car,
    });

    if (subscriptionReservation) {
      const settledReservation = subscriptionReservation;
      subscriptionReservation = null;
      try {
        await appendSubscriptionUsageHistory(settledReservation, booking?._id || null);
      } catch (usageHistoryError) {
        console.error('Failed to append subscription usage history on approval:', usageHistoryError);
      }
    }

    await Request.findByIdAndDelete(req.params.id);
    queueAdvancePaidConfirmationEmail(booking);

    res.json({
      message: 'Request approved successfully',
      booking,
    });
  } catch (error) {
    console.error(error);
    if (subscriptionReservation?.coveredHours > 0) {
      await rollbackSubscriptionUsageReservation(subscriptionReservation);
    }
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Approval failed' : error.message;
    res.status(status).json({ message });
  }
};

exports.completeBooking = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).populate('car', 'pricePerDay');
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingBranchScope(req.user, booking, 'Booking does not belong to your branch scope');

    const hasLockedReturnInspection = Boolean(
      booking?.returnInspection?.isLocked && booking?.returnInspection?.inspectedAt,
    );
    if (!hasLockedReturnInspection) {
      return res.status(422).json({
        message: 'Return inspection is required before completing booking',
      });
    }

    const { booking: completedBooking } = await finalizeBookingSettlement(booking, {
      paymentMethod: req.body.paymentMethod,
      now: new Date(),
      finalizedAt: new Date(),
    });

    res.json({
      message: 'Car returned, full payment received, and booking completed',
      booking: completedBooking,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to complete booking' : error.message;
    res.status(status).json({ message });
  }
};

exports.submitReturnInspection = async (req, res) => {
  let uploadedImages = [];

  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingBranchScope(req.user, booking, 'Booking does not belong to your branch scope');

    if (!isConfirmedBookingStatus(booking.bookingStatus)) {
      return res.status(422).json({ message: 'Only confirmed bookings can be inspected' });
    }

    if (booking.tripStatus === 'completed' || String(booking.rentalStage || '').toLowerCase() === 'completed') {
      return res.status(422).json({ message: 'Completed bookings cannot be inspected' });
    }

    if (booking?.returnInspection?.isLocked) {
      return res.status(409).json({ message: 'Return inspection already submitted for this booking' });
    }

    const rentalStage = String(booking.rentalStage || '').trim().toLowerCase();
    if (!['active', 'overdue'].includes(rentalStage)) {
      return res.status(422).json({ message: 'Return inspection is allowed only for active or overdue rentals' });
    }

    const conditionNotes = String(req.body?.conditionNotes || '').trim();
    if (conditionNotes.length < MIN_INSPECTION_NOTES_LENGTH) {
      return res.status(422).json({
        message: `Return inspection notes must be at least ${MIN_INSPECTION_NOTES_LENGTH} characters`,
      });
    }

    const imageFiles = extractImageFiles(req.files);
    if (imageFiles.length === 0) {
      return res.status(422).json({ message: 'At least one return inspection image is required' });
    }

    if (imageFiles.length > MAX_INSPECTION_IMAGES) {
      return res.status(422).json({ message: `You can upload up to ${MAX_INSPECTION_IMAGES} inspection images` });
    }

    const requestedDamageStatus = String(req.body?.damageStatus || '').trim().toUpperCase();
    const requestedDamageLevel = String(req.body?.damageLevel || '').trim().toUpperCase();
    const explicitDamageStatus = ['NONE', 'MINOR', 'MAJOR'].includes(requestedDamageStatus)
      ? requestedDamageStatus
      : '';
    const parsedDamageDetected = parseBooleanInput(
      req.body?.damageDetected,
      explicitDamageStatus ? explicitDamageStatus !== 'NONE' : false,
    );
    const requestedDamageCost = Number(req.body?.damageCost);
    if (parsedDamageDetected && (!Number.isFinite(requestedDamageCost) || requestedDamageCost < 0)) {
      return res.status(422).json({ message: 'damageCost must be a non-negative number when damage is detected' });
    }

    const rawCurrentMileage = req.body?.currentMileage;
    const hasMileageInput =
      rawCurrentMileage !== undefined && rawCurrentMileage !== null && String(rawCurrentMileage).trim() !== '';
    const parsedCurrentMileage = Number(rawCurrentMileage);
    if (hasMileageInput && (!Number.isFinite(parsedCurrentMileage) || parsedCurrentMileage < 0)) {
      return res.status(422).json({ message: 'currentMileage must be a non-negative number' });
    }

    const originalDamageCost = parsedDamageDetected ? toNonNegativeNumber(requestedDamageCost, 0) : 0;
    const subscriptionDamageDiscountPercent = getSubscriptionDamageFeeDiscountPercent(booking);
    const normalizedDamageStatus = explicitDamageStatus
      || (!parsedDamageDetected
        ? 'NONE'
        : requestedDamageLevel === 'MAJOR_DAMAGE'
          ? 'MAJOR'
          : requestedDamageLevel === 'MINOR_DAMAGE'
            ? 'MINOR'
            : originalDamageCost > Math.max(Number(booking?.depositAmount || 0), 0)
              ? 'MAJOR'
              : 'MINOR');
    const damageDetected = normalizedDamageStatus !== 'NONE';
    const damageCost = damageDetected
      ? applyPercentageDiscount(originalDamageCost, subscriptionDamageDiscountPercent)
      : 0;
    const normalizedDamageLevel = normalizedDamageStatus === 'MAJOR'
      ? 'MAJOR_DAMAGE'
      : normalizedDamageStatus === 'MINOR'
        ? 'MINOR_DAMAGE'
        : 'NO_DAMAGE';
    const currentMileage = hasMileageInput ? toNonNegativeNumber(parsedCurrentMileage, 0) : null;
    uploadedImages = await uploadInspectionImages(imageFiles, 'car-rental/inspections/return');

    booking.returnInspection = {
      conditionNotes,
      damageDetected,
      damageStatus: normalizedDamageStatus,
      damageLevel: normalizedDamageLevel,
      originalDamageCost,
      damageDiscountPercentage: subscriptionDamageDiscountPercent,
      damageCost,
      currentMileage,
      images: uploadedImages.map((entry) => entry.url),
      inspectedBy: req.user?._id || null,
      inspectedAt: new Date(),
      isLocked: true,
    };

    const finalAmount = Math.max(toNonNegativeNumber(resolveFinalAmount(booking), 0), 0);
    const advancePaid = Math.max(toNonNegativeNumber(resolveAdvancePaidAmount(booking), 0), 0);
    const lateFee = Math.max(toNonNegativeNumber(booking?.lateFee, 0), 0);
    const depositSnapshot = resolveDepositSettlementSnapshot({ booking, damageCost });
    const baseRemainingWithoutDamage = Math.max(Number((finalAmount - advancePaid).toFixed(2)), 0) + lateFee;
    const existingRemaining = toNonNegativeNumber(booking?.remainingAmount, baseRemainingWithoutDamage);
    const mergedRemainingBase = Math.max(existingRemaining, baseRemainingWithoutDamage);
    booking.remainingAmount = Number((mergedRemainingBase + depositSnapshot.damageOutstanding).toFixed(2));
    booking.amountRemaining = booking.remainingAmount;
    booking.depositPaid = depositSnapshot.heldDeposit;
    booking.depositDeducted = depositSnapshot.depositDeducted;
    booking.depositRefunded = depositSnapshot.depositRefunded;
    booking.depositStatus = depositSnapshot.depositStatus;

    await booking.save();

    return res.json({
      message: 'Return inspection submitted successfully',
      booking,
    });
  } catch (error) {
    console.error('submitReturnInspection error:', error);
    await cleanupUploadedImages(uploadedImages);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to submit return inspection' : error.message;
    return res.status(status).json({ message });
  }
};

exports.processBookingRefund = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId)
      .populate('car')
      .populate('user', 'firstName lastName email');

    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingBranchScope(req.user, booking, 'Booking does not belong to your branch scope');

    const refundSummary = applyRefundToBooking(booking, {
      refundAmount: req.body?.refundAmount,
      refundReason: req.body?.refundReason,
      refundType: req.body?.refundType,
      now: new Date(),
    });

    await booking.save();
    queueRefundProcessedEmail(booking);
    queueAuditLog({
      userId: req.user?._id,
      actionType: 'REFUND_PROCESSED',
      targetEntity: 'Booking',
      targetId: String(booking._id),
      meta: {
        refundAmount: refundSummary?.refundAmount || booking?.refundAmount || 0,
        refundStatus: booking?.refundStatus || 'Processed',
      },
    });

    return res.json({
      message: 'Refund processed successfully',
      booking,
      refund: refundSummary,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to process refund' : error.message;
    return res.status(status).json({ message });
  }
};

exports.startBookingPickup = async (req, res) => {
  let uploadedImages = [];

  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    await assertBookingBranchScope(req.user, booking, 'Booking does not belong to your branch scope');

    if (!isConfirmedBookingStatus(booking.bookingStatus)) {
      return res.status(422).json({ message: 'Only confirmed bookings can start pickup' });
    }

    if (booking.tripStatus === 'completed' || String(booking.rentalStage || '').toLowerCase() === 'completed') {
      return res.status(422).json({ message: 'Completed bookings cannot start pickup' });
    }

    if (booking.actualPickupTime || String(booking.rentalStage || '').toLowerCase() === 'active') {
      return res.status(422).json({ message: 'Pickup is already marked for this booking' });
    }

    if (booking?.pickupInspection?.isLocked) {
      return res.status(409).json({ message: 'Pickup inspection is already submitted for this booking' });
    }

    const conditionNotes = String(req.body?.conditionNotes || '').trim();
    if (conditionNotes.length < MIN_INSPECTION_NOTES_LENGTH) {
      return res.status(422).json({
        message: `Pickup inspection notes must be at least ${MIN_INSPECTION_NOTES_LENGTH} characters`,
      });
    }

    const imageFiles = extractImageFiles(req.files);
    if (imageFiles.length === 0) {
      return res.status(422).json({ message: 'At least one pickup inspection image is required' });
    }

    if (imageFiles.length > MAX_INSPECTION_IMAGES) {
      return res.status(422).json({ message: `You can upload up to ${MAX_INSPECTION_IMAGES} inspection images` });
    }

    uploadedImages = await uploadInspectionImages(imageFiles, 'car-rental/inspections/pickup');
    booking.pickupInspection = {
      conditionNotes,
      damageReported: parseBooleanInput(req.body?.damageReported, false),
      images: uploadedImages.map((entry) => entry.url),
      inspectedBy: req.user?._id || null,
      inspectedAt: new Date(),
      isLocked: true,
    };

    booking.actualPickupTime = new Date();
    booking.rentalStage = 'Active';
    booking.tripStatus = 'active';
    if (!Number.isFinite(Number(booking.hourlyLateRate)) || Number(booking.hourlyLateRate) <= 0) {
      const lockedPerDayPrice = Number(booking?.lockedPerDayPrice || booking?.basePerDayPrice || 0);
      if (Number.isFinite(lockedPerDayPrice) && lockedPerDayPrice > 0) {
        booking.hourlyLateRate = calculateHourlyLateRate(lockedPerDayPrice);
      } else {
        const car = await Car.findById(booking.car).select('pricePerDay');
        booking.hourlyLateRate = calculateHourlyLateRate(car?.pricePerDay);
      }
    }

    await booking.save();
    await updateCarFleetStatus(booking.car, FLEET_STATUS.RENTED);

    return res.json({
      message: 'Pickup handover confirmed and rental is now active',
      booking,
    });
  } catch (error) {
    console.error('startBookingPickup error:', error);
    await cleanupUploadedImages(uploadedImages);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to mark pickup handover' : error.message;
    return res.status(status).json({ message });
  }
};

exports.handleBookingBargain = async (req, res) => {
  try {
    const { action, counterPrice } = req.body;
    const booking = await Booking.findById(req.params.id);

    if (!booking || !booking.bargain) {
      return res.status(404).json({ message: 'Booking or bargain not found' });
    }

    await assertBookingBranchScope(req.user, booking, 'Booking does not belong to your branch scope');

    if (booking.bargain.status !== 'USER_OFFERED') {
      return res.status(400).json({ message: 'No pending user offer to respond to' });
    }

    if (action === 'accept') {
      booking.bargain.status = 'ACCEPTED';
      booking.totalAmount = booking.bargain.userPrice;
      booking.finalAmount = booking.bargain.userPrice;

      const breakdown = calculateAdvanceBreakdown(booking.finalAmount);
      booking.advanceRequired = breakdown.advanceRequired;
      booking.advanceAmount = breakdown.advanceRequired;
      booking.remainingAmount = Math.max(
        breakdown.finalAmount - Number(booking.advancePaid || breakdown.advanceRequired),
        0
      );
    } else if (action === 'counter') {
      const normalizedCounterPrice = Number(counterPrice);
      if (!Number.isFinite(normalizedCounterPrice) || normalizedCounterPrice <= 0) {
        return res.status(400).json({ message: 'Valid counter price required' });
      }
      booking.bargain.adminCounterPrice = normalizedCounterPrice;
      booking.bargain.status = 'ADMIN_COUNTERED';
    } else if (action === 'reject') {
      booking.bargain.status = 'REJECTED';
    } else {
      return res.status(400).json({ message: 'Invalid bargain action' });
    }

    await booking.save();
    res.json({ message: 'Bargain updated', booking });
  } catch (error) {
    console.error(error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Bargain update failed' : error.message;
    res.status(status).json({ message });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) return res.status(404).json({ message: 'Request not found' });

    await assertRequestBranchScope(req.user, request, 'Request does not belong to your branch scope');

    await Request.findByIdAndDelete(req.params.id);
    if (request.car) {
      await releaseCarIfUnblocked(request.car);
    }
    res.json({ message: 'Request rejected and removed' });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Reject failed' : error.message;
    res.status(status).json({ message });
  }
};

exports.deleteRequest = async (req, res) => {
  try {
    const request = await Request.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ message: 'Request not found' });
    }

    await assertRequestBranchScope(req.user, request, 'Request does not belong to your branch scope');

    await request.deleteOne();
    if (request?.car) {
      await releaseCarIfUnblocked(request.car);
    }
    res.json({ message: 'Request deleted' });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Delete failed' : error.message;
    res.status(status).json({ message });
  }
};

exports.addCarMaintenance = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    await assertCarInScope(req.user, car._id, 'Car does not belong to your branch scope');

    const normalizedPayload = normalizeMaintenancePayload(req.body);
    if (!MAINTENANCE_SERVICE_TYPES.includes(normalizedPayload.serviceType)) {
      return res.status(422).json({ message: 'Invalid serviceType' });
    }

    if (!MAINTENANCE_STATUS_VALUES.includes(normalizedPayload.maintenanceStatus)) {
      return res.status(422).json({ message: 'Invalid maintenanceStatus' });
    }

    if (!normalizedPayload.serviceDate) {
      return res.status(422).json({ message: 'Valid serviceDate is required' });
    }

    if (Number.isNaN(normalizedPayload.serviceCost)) {
      return res.status(422).json({ message: 'serviceCost must be a non-negative number' });
    }

    if (normalizedPayload.serviceMileage !== null && Number.isNaN(normalizedPayload.serviceMileage)) {
      return res.status(422).json({ message: 'serviceMileage must be a non-negative number' });
    }

    if (
      normalizedPayload.nextServiceDueDate &&
      normalizedPayload.nextServiceDueDate.getTime() < normalizedPayload.serviceDate.getTime()
    ) {
      return res.status(422).json({ message: 'nextServiceDueDate cannot be earlier than serviceDate' });
    }

    const now = new Date();
    const shouldMoveToMaintenanceNow =
      normalizedPayload.maintenanceStatus === 'Scheduled' &&
      normalizedPayload.serviceDate.getTime() <= now.getTime();

    if (shouldMoveToMaintenanceNow) {
      await ensureCanEnterMaintenanceState(car._id);
    }

    const maintenance = await Maintenance.create({
      ...normalizedPayload,
      carId: car._id,
      createdBy: req.user?._id || null,
    });

    let updatedCar = car;
    if (normalizedPayload.maintenanceStatus === 'Completed') {
      const carUpdate = {
        lastServiceDate: normalizedPayload.serviceDate,
      };
      if (normalizedPayload.serviceMileage !== null && !Number.isNaN(normalizedPayload.serviceMileage)) {
        carUpdate.currentMileage = normalizedPayload.serviceMileage;
      }

      updatedCar = await Car.findByIdAndUpdate(
        car._id,
        { $set: carUpdate },
        { new: true, runValidators: false },
      );

      await recalculateCarMaintenanceCost(car._id);
      const syncResult = await syncCarFleetStatusFromMaintenance(car._id, { now });
      updatedCar = syncResult?.car || updatedCar;
    } else if (shouldMoveToMaintenanceNow) {
      const carBranch = await ensureBranchById(car.branchId);
      if (carBranch && !carBranch.isActive) {
        updatedCar = await updateCarFleetStatus(car._id, FLEET_STATUS.INACTIVE);
      } else {
        updatedCar = await updateCarFleetStatus(car._id, FLEET_STATUS.MAINTENANCE);
        queueAuditLog({
          userId: req.user?._id,
          actionType: 'VEHICLE_MARKED_MAINTENANCE',
          targetEntity: 'Car',
          targetId: String(car._id),
          meta: {
            serviceDate: normalizedPayload.serviceDate,
            maintenanceId: String(maintenance._id),
          },
        });
      }
    }

    queueAuditLog({
      userId: req.user?._id,
      actionType: 'MAINTENANCE_ADDED',
      targetEntity: 'Car',
      targetId: String(car._id),
      meta: {
        maintenanceId: String(maintenance._id),
        serviceType: normalizedPayload.serviceType,
        maintenanceStatus: normalizedPayload.maintenanceStatus,
      },
    });

    const populatedMaintenance = await Maintenance.findById(maintenance._id)
      .populate('createdBy', 'firstName lastName email')
      .lean();

    return res.status(201).json({
      message: 'Maintenance record created successfully',
      maintenance: populatedMaintenance || maintenance,
      car: updatedCar,
    });
  } catch (error) {
    console.error('addCarMaintenance error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to create maintenance record' : error.message;
    return res.status(status).json({ message });
  }
};

exports.completeCarMaintenance = async (req, res) => {
  try {
    const maintenance = await Maintenance.findById(req.params.id);
    if (!maintenance) {
      return res.status(404).json({ message: 'Maintenance record not found' });
    }

    await assertCarInScope(req.user, maintenance.carId, 'Car does not belong to your branch scope');

    const hasAnyUpdateFields = [
      'serviceType',
      'serviceDescription',
      'serviceDate',
      'nextServiceDueDate',
      'serviceMileage',
      'serviceCost',
      'serviceProvider',
      'invoiceReference',
    ].some((key) => req.body?.[key] !== undefined);

    if (hasAnyUpdateFields) {
      const payload = normalizeMaintenancePayload({
        ...maintenance.toObject(),
        ...req.body,
        maintenanceStatus: 'Completed',
      });

      if (!MAINTENANCE_SERVICE_TYPES.includes(payload.serviceType)) {
        return res.status(422).json({ message: 'Invalid serviceType' });
      }

      if (!payload.serviceDate) {
        return res.status(422).json({ message: 'Valid serviceDate is required' });
      }

      if (Number.isNaN(payload.serviceCost)) {
        return res.status(422).json({ message: 'serviceCost must be a non-negative number' });
      }

      if (payload.serviceMileage !== null && Number.isNaN(payload.serviceMileage)) {
        return res.status(422).json({ message: 'serviceMileage must be a non-negative number' });
      }

      if (payload.nextServiceDueDate && payload.nextServiceDueDate.getTime() < payload.serviceDate.getTime()) {
        return res.status(422).json({ message: 'nextServiceDueDate cannot be earlier than serviceDate' });
      }

      maintenance.serviceType = payload.serviceType;
      maintenance.serviceDescription = payload.serviceDescription;
      maintenance.serviceDate = payload.serviceDate;
      maintenance.nextServiceDueDate = payload.nextServiceDueDate;
      maintenance.serviceMileage = payload.serviceMileage;
      maintenance.serviceCost = payload.serviceCost;
      maintenance.serviceProvider = payload.serviceProvider;
      maintenance.invoiceReference = payload.invoiceReference;
    }

    maintenance.maintenanceStatus = 'Completed';
    await maintenance.save();

    const carUpdate = {
      lastServiceDate: maintenance.serviceDate,
    };
    if (
      maintenance.serviceMileage !== null &&
      Number.isFinite(Number(maintenance.serviceMileage)) &&
      Number(maintenance.serviceMileage) >= 0
    ) {
      carUpdate.currentMileage = Number(maintenance.serviceMileage);
    }

    let updatedCar = await Car.findByIdAndUpdate(
      maintenance.carId,
      { $set: carUpdate },
      { new: true, runValidators: false },
    );

    await recalculateCarMaintenanceCost(maintenance.carId);
    const syncResult = await syncCarFleetStatusFromMaintenance(maintenance.carId, { now: new Date() });
    updatedCar = syncResult?.car || updatedCar;

    const populatedMaintenance = await Maintenance.findById(maintenance._id)
      .populate('createdBy', 'firstName lastName email')
      .lean();

    return res.json({
      message: 'Maintenance marked as completed',
      maintenance: populatedMaintenance || maintenance.toObject(),
      car: updatedCar,
    });
  } catch (error) {
    console.error('completeCarMaintenance error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to complete maintenance' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getAllCars = async (req, res) => {
  try {
    const selectedBranchId = await resolveRequestedBranchId(req);
    const scopedCarIds = await getScopedCarIds(req.user);
    const query = scopedCarIds === null ? {} : { _id: { $in: scopedCarIds } };
    if (selectedBranchId) {
      query.branchId = selectedBranchId;
    }

    const cars = await Car.find(query)
      .populate('branchId', 'branchName branchCode address city state cityId stateId latitude longitude serviceCities isActive')
      .populate('locationId', 'name branchAddress cityId stateId branchId isPrimary')
      .sort({ createdAt: -1 });
    res.status(200).json(cars);
  } catch (error) {
    res.status(500).json({ message: 'Failed to fetch cars' });
  }
};

exports.getFleetOverview = async (req, res) => {
  try {
    const selectedBranchId = await resolveRequestedBranchId(req);
    const scopedCarIds = await getScopedCarIds(req.user);
    const carQuery = scopedCarIds === null ? {} : { _id: { $in: scopedCarIds } };
    if (selectedBranchId) {
      carQuery.branchId = selectedBranchId;
    }

    const scopedBranchIds = getScopedBranchIds(req.user);
    const branchQuery =
      Array.isArray(scopedBranchIds)
        ? (scopedBranchIds.length > 0 ? { _id: { $in: scopedBranchIds } } : { _id: { $in: [] } })
        : {};
    const branches = await Branch.find(branchQuery)
      .select('_id branchName branchCode address city state cityId stateId latitude longitude serviceCities isActive manager dynamicPricingEnabled dynamicPricingMultiplier')
      .sort({ branchName: 1 })
      .lean();

    let cars = await Car.find(carQuery).sort({ createdAt: -1 });
    const now = new Date();
    if (cars.length > 0) {
      await Promise.allSettled(
        cars.map((car) => syncCarFleetStatusFromMaintenance(car._id, { now })),
      );
      cars = await Car.find(carQuery).sort({ createdAt: -1 });
    }

    const carIds = cars.map((car) => car._id);

    const bookingRows = await Booking.find({
      car: { $in: carIds },
      $and: [
        {
          $or: [{ bookingStatus: 'Confirmed' }, { bookingStatus: 'CONFIRMED' }],
        },
        {
          $or: [
            { rentalStage: { $in: ['Scheduled', 'Active', 'Overdue'] } },
            { tripStatus: { $in: ['upcoming', 'active'] } },
          ],
        },
      ],
    })
      .populate('user', 'firstName lastName email')
      .select('car bookingStatus rentalStage pickupDateTime dropDateTime user')
      .sort({ createdAt: -1 })
      .lean();

    const requestRows = await Request.find({
      car: { $in: carIds },
      status: 'pending',
    })
      .populate('user', 'firstName lastName email')
      .select('car status pickupDateTime dropDateTime fromDate toDate user')
      .sort({ createdAt: -1 })
      .lean();

    const maintenanceRows = await Maintenance.find({
      carId: { $in: carIds },
    })
      .populate('createdBy', 'firstName lastName email')
      .sort({ serviceDate: -1, createdAt: -1 })
      .lean();

    const currentBookingByCarId = new Map();
    for (const booking of bookingRows) {
      const carId = String(booking?.car || '');
      if (!carId || currentBookingByCarId.has(carId)) continue;
      currentBookingByCarId.set(carId, booking);
    }

    const pendingRequestByCarId = new Map();
    for (const request of requestRows) {
      const carId = String(request?.car || '');
      if (!carId || pendingRequestByCarId.has(carId)) continue;
      pendingRequestByCarId.set(carId, request);
    }

    const maintenanceByCarId = new Map();
    for (const maintenance of maintenanceRows) {
      const carId = String(maintenance?.carId || '');
      if (!carId) continue;
      if (!maintenanceByCarId.has(carId)) {
        maintenanceByCarId.set(carId, []);
      }
      maintenanceByCarId.get(carId).push(maintenance);
    }

    const pricingByCarId = new Map();
    await Promise.allSettled(
      cars.map(async (car) => {
        const carId = String(car?._id || '');
        if (!carId) return;
        const pricing = await resolveSmartPriceForCar(car, {
          now,
          persist: true,
          branchId: car?.branchId,
        });
        pricingByCarId.set(carId, pricing);
      }),
    );

    const branchConfigById = new Map(
      branches.map((branch) => [
        String(branch?._id || ''),
        {
          dynamicPricingEnabled: Boolean(branch?.dynamicPricingEnabled),
        },
      ]),
    );

    const nowMs = now.getTime();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const fleetCars = cars.map((car) => {
      const carId = String(car?._id || '');
      const currentBooking = currentBookingByCarId.get(carId) || null;
      const currentRequest = currentBooking ? null : pendingRequestByCarId.get(carId) || null;
      const maintenanceHistory = maintenanceByCarId.get(carId) || [];
      const maintenanceReminder = buildMaintenanceReminderFlags(maintenanceHistory, now);
      const insuranceExpiryMs = car?.insuranceExpiry ? new Date(car.insuranceExpiry).getTime() : NaN;
      const insuranceExpiringIn30Days =
        Number.isFinite(insuranceExpiryMs) && insuranceExpiryMs >= nowMs && insuranceExpiryMs - nowMs <= THIRTY_DAYS_MS;
      const pricing = pricingByCarId.get(carId) || null;
      const branchId = String(car?.branchId || '');
      const branchConfig = branchConfigById.get(branchId) || { dynamicPricingEnabled: false };

      return {
        ...car.toObject(),
        fleetStatus: resolveFleetStatus(car),
        branchId: car.branchId || null,
        basePricePerDay: Number(pricing?.basePricePerDay || car?.pricePerDay || 0),
        effectivePricePerDay: Number(pricing?.effectivePricePerDay || car?.pricePerDay || 0),
        currentDynamicPrice: Number(pricing?.currentDynamicPrice || car?.currentDynamicPrice || car?.pricePerDay || 0),
        dynamicPriceEnabled: Boolean(pricing?.dynamicPriceEnabled ?? car?.dynamicPriceEnabled),
        manualOverridePrice:
          pricing?.manualOverridePrice !== undefined ? pricing.manualOverridePrice : car?.manualOverridePrice,
        priceSource: pricing?.priceSource || car?.priceSource || 'Base',
        priceAdjustmentPercent: Number(pricing?.priceAdjustmentPercent || car?.priceAdjustmentPercent || 0),
        branchDynamicPricingEnabled: Boolean(pricing?.branchDynamicPricingEnabled ?? branchConfig.dynamicPricingEnabled),
        insuranceExpiringIn30Days,
        currentBooking,
        currentRequest,
        currentAllocation: currentBooking || currentRequest,
        maintenanceHistory,
        serviceDueSoon: maintenanceReminder.serviceDueSoon,
        serviceOverdue: maintenanceReminder.serviceOverdue,
        nearestServiceDueDate: maintenanceReminder.nearestServiceDueDate,
      };
    });

    const summary = countCarsByFleetStatus(fleetCars);
    let serviceDueSoon = 0;
    let serviceOverdue = 0;
    let totalMaintenanceCost = 0;
    for (const car of fleetCars) {
      if (car.serviceOverdue) {
        serviceOverdue += 1;
      } else if (car.serviceDueSoon) {
        serviceDueSoon += 1;
      }
      totalMaintenanceCost += Number(car.totalMaintenanceCost || 0);
    }
    summary.vehiclesInMaintenance = summary.maintenance;
    summary.serviceDueSoon = serviceDueSoon;
    summary.serviceOverdue = serviceOverdue;
    summary.totalMaintenanceCost = Number(totalMaintenanceCost.toFixed(2));

    return res.json({
      summary,
      cars: fleetCars,
      selectedBranchId,
      branches: branches.map(normalizeBranchForClient),
      maintenanceMeta: {
        serviceTypes: MAINTENANCE_SERVICE_TYPES,
        statuses: MAINTENANCE_STATUS_VALUES,
      },
    });
  } catch (error) {
    console.error('getFleetOverview error:', error);
    return res.status(500).json({ message: 'Failed to load fleet overview' });
  }
};

exports.updateCarFleetStatus = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    await assertCarInScope(req.user, car._id, 'Car does not belong to your branch scope');

    const requestedStatus = normalizeFleetStatus(req.body?.fleetStatus, '');
    if (!requestedStatus || !FLEET_STATUS_VALUES.includes(requestedStatus)) {
      return res.status(422).json({ message: 'Invalid fleet status' });
    }

    const { branch } = await ensureCarBranch(car);
    if (branch && !branch.isActive && requestedStatus !== FLEET_STATUS.INACTIVE) {
      return res.status(422).json({
        message: 'Cannot set active fleet status while branch is inactive',
      });
    }

    const allowedManualTargets = [FLEET_STATUS.AVAILABLE, FLEET_STATUS.MAINTENANCE, FLEET_STATUS.INACTIVE];
    if (!allowedManualTargets.includes(requestedStatus)) {
      return res.status(422).json({ message: 'Manual update supports only Available, Maintenance, or Inactive' });
    }

    const currentStatus = resolveFleetStatus(car);
    if (currentStatus === requestedStatus) {
      return res.json({ message: 'Fleet status is already up to date', car });
    }

    const hasBlockingBooking = await hasBlockingBookingsForCar(car._id);
    const hasPendingRequest = Boolean(
      await Request.findOne({ car: car._id, status: 'pending' }).select('_id').lean(),
    );

    if (requestedStatus === FLEET_STATUS.AVAILABLE && (hasBlockingBooking || hasPendingRequest)) {
      return res.status(422).json({
        message: 'Cannot mark as Available while rental stage is not completed',
      });
    }

    if (requestedStatus === FLEET_STATUS.MAINTENANCE && currentStatus === FLEET_STATUS.RENTED) {
      return res.status(422).json({ message: 'Cannot move to Maintenance while vehicle is rented' });
    }

    if (requestedStatus === FLEET_STATUS.MAINTENANCE && (hasBlockingBooking || hasPendingRequest)) {
      return res.status(422).json({ message: 'Cannot move to Maintenance while reservation or booking is active' });
    }

    if (requestedStatus === FLEET_STATUS.INACTIVE && (hasBlockingBooking || hasPendingRequest)) {
      return res.status(422).json({ message: 'Cannot move to Inactive while reservation or booking is active' });
    }

    const updatedCar = await updateCarFleetStatus(car._id, requestedStatus);
    clearSmartPricingCache();
    if (requestedStatus === FLEET_STATUS.MAINTENANCE) {
      queueAuditLog({
        userId: req.user?._id,
        actionType: 'VEHICLE_MARKED_MAINTENANCE',
        targetEntity: 'Car',
        targetId: String(car._id),
        meta: {
          previousStatus: currentStatus,
          nextStatus: requestedStatus,
        },
      });
    }
    return res.json({
      message: 'Fleet status updated successfully',
      car: updatedCar,
    });
  } catch (error) {
    console.error('updateCarFleetStatus error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update fleet status' : error.message;
    return res.status(status).json({ message });
  }
};

exports.addCar = async (req, res) => {
  let uploadedImage = null;

  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Car image is required' });
    }

    const data = pickCarPayload(req.body);
    const targetBranch = await resolveBranchForCarWrite(req.user, req.body?.branchId);
    data.branchId = targetBranch?._id || null;
    const targetLocation = await resolveLocationDocumentForBranch(targetBranch, {
      locationId: req.body?.locationId || data.locationId,
      locationName: data.location,
    });
    data.locationId = targetLocation?._id || null;
    data.location = normalizeLocationName(targetLocation?.name || data.location);
    data.stateId = targetLocation?.stateId || targetBranch?.stateId || null;
    data.cityId = targetLocation?.cityId || targetBranch?.cityId || null;
    data.pickupAddress = String(targetLocation?.branchAddress || targetBranch?.address || '').trim();
    if (targetBranch && !targetBranch.isActive) {
      data.fleetStatus = FLEET_STATUS.INACTIVE;
      data.isAvailable = false;
    }
    await assertTenantEntityLimit(req, {
      model: Car,
      limitField: 'maxVehicles',
      label: 'vehicles',
    });
    uploadedImage = await uploadImageFromBuffer(req.file, { folder: 'car-rental/cars' });

    const car = await Car.create({
      ...data,
      image: uploadedImage.url,
      imagePublicId: uploadedImage.publicId,
    });
    const syncedCarResult = await syncCarLocationHierarchy(car, { branch: targetBranch });
    const syncedCar = syncedCarResult.car || car;
    clearSmartPricingCache();

    res.status(201).json(syncedCar);
  } catch (error) {
    console.error('Add car error:', error);
    if (uploadedImage?.publicId) {
      try {
        await deleteImageByPublicId(uploadedImage.publicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup new car image after error:', cleanupError);
      }
    }
    const statusCode = Number(
      error?.statusCode ||
      (String(error.message || '').toLowerCase().includes('cloudinary') ? 500 : 400)
    );
    res.status(statusCode).json({ message: error.message || 'Failed to add car' });
  }
};

exports.toggleCar = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const currentStatus = resolveFleetStatus(car);
    const nextStatus = currentStatus === FLEET_STATUS.INACTIVE ? FLEET_STATUS.AVAILABLE : FLEET_STATUS.INACTIVE;

    req.body.fleetStatus = nextStatus;
    return exports.updateCarFleetStatus(req, res);

  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Toggle failed' });
  }
};

exports.deleteCar = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    await assertCarInScope(req.user, car._id, 'Car does not belong to your branch scope');

    const imagePublicIdToDelete = car.imagePublicId || '';
    await car.deleteOne();
    clearSmartPricingCache();

    if (imagePublicIdToDelete) {
      try {
        await deleteImageByPublicId(imagePublicIdToDelete);
      } catch (cleanupError) {
        console.error('Failed to cleanup deleted car image:', cleanupError);
      }
    }

    res.json({ message: 'Car deleted successfully' });
  } catch (error) {
    res.status(400).json({ message: 'Delete failed' });
  }
};

exports.updateCar = async (req, res) => {
  let uploadedImage = null;

  try {
    const existingCar = await Car.findById(req.params.id);
    if (!existingCar) {
      return res.status(404).json({ message: 'Car not found' });
    }

    await assertCarInScope(req.user, existingCar._id, 'Car does not belong to your branch scope');

    if (req.body?.branchId !== undefined) {
      return res.status(422).json({ message: 'Use branch transfer endpoint to move vehicles between branches' });
    }

    const data = pickCarPayload(req.body);
    const previousImagePublicId = existingCar.imagePublicId || '';
    const previousBasePricePerDay = Number(existingCar.pricePerDay || 0);
    const { branch: existingBranch } = await ensureCarBranch(existingCar);

    if (
      Object.prototype.hasOwnProperty.call(data, 'location') ||
      Object.prototype.hasOwnProperty.call(data, 'locationId')
    ) {
      const nextLocation = await resolveLocationDocumentForBranch(existingBranch, {
        locationId: req.body?.locationId || data.locationId,
        locationName: data.location || existingCar.location,
      });
      data.locationId = nextLocation?._id || null;
      data.location = normalizeLocationName(nextLocation?.name || data.location || existingCar.location);
      data.stateId = nextLocation?.stateId || existingBranch?.stateId || null;
      data.cityId = nextLocation?.cityId || existingBranch?.cityId || null;
      data.pickupAddress = String(nextLocation?.branchAddress || existingBranch?.address || '').trim();
    }

    if (req.file) {
      uploadedImage = await uploadImageFromBuffer(req.file, { folder: 'car-rental/cars' });
      data.image = uploadedImage.url;
      data.imagePublicId = uploadedImage.publicId;
    }

    if (Object.keys(data).length === 0) {
      if (uploadedImage?.publicId) {
        await deleteImageByPublicId(uploadedImage.publicId);
      }
      return res.status(400).json({ message: 'No valid car fields provided for update' });
    }

    Object.assign(existingCar, data);
    const updatedCarBase = await existingCar.save();
    const syncedCarResult = await syncCarLocationHierarchy(updatedCarBase, { branch: existingBranch });
    const updatedCar = syncedCarResult.car || updatedCarBase;
    if (Object.prototype.hasOwnProperty.call(data, 'pricePerDay')) {
      clearSmartPricingCache();
      const nextBasePricePerDay = Number(updatedCar.pricePerDay || 0);
      if (previousBasePricePerDay !== nextBasePricePerDay) {
        queueAuditLog({
          userId: req.user?._id,
          actionType: 'CAR_BASE_PRICE_UPDATED',
          targetEntity: 'CarPricing',
          targetId: String(updatedCar._id),
          meta: {
            from: { pricePerDay: previousBasePricePerDay },
            to: { pricePerDay: nextBasePricePerDay },
          },
        });
      }
    }

    if (uploadedImage?.publicId && previousImagePublicId && previousImagePublicId !== uploadedImage.publicId) {
      try {
        await deleteImageByPublicId(previousImagePublicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup previous car image:', cleanupError);
      }
    }

    res.json(updatedCar);
  } catch (error) {
    console.error('Update error:', error);
    if (uploadedImage?.publicId) {
      try {
        await deleteImageByPublicId(uploadedImage.publicId);
      } catch (cleanupError) {
        console.error('Failed to cleanup new car image after error:', cleanupError);
      }
    }
    const statusCode = Number(
      error?.statusCode ||
      (String(error.message || '').toLowerCase().includes('cloudinary') ? 500 : 400)
    );
    res.status(statusCode).json({ message: error.message || 'Update failed' });
  }
};

exports.updateCarPricing = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    await assertCarInScope(req.user, car._id, 'Car does not belong to your branch scope');

    const hasDynamicFlag = Object.prototype.hasOwnProperty.call(req.body || {}, 'dynamicPriceEnabled');
    const hasManualOverrideValue = Object.prototype.hasOwnProperty.call(req.body || {}, 'manualOverridePrice');
    const resetManualOverride = parseBooleanInput(req.body?.resetManualOverride, false);

    if (!hasDynamicFlag && !hasManualOverrideValue && !resetManualOverride) {
      return res.status(422).json({ message: 'No pricing fields provided' });
    }

    if (hasManualOverrideValue && resetManualOverride) {
      return res.status(422).json({ message: 'Provide manualOverridePrice or resetManualOverride, not both' });
    }

    const previousSnapshot = {
      dynamicPriceEnabled: Boolean(car.dynamicPriceEnabled),
      manualOverridePrice: parseOptionalPositivePrice(car.manualOverridePrice),
      priceSource: String(car.priceSource || 'Base'),
      currentDynamicPrice: Number(car.currentDynamicPrice || car.pricePerDay || 0),
      priceAdjustmentPercent: Number(car.priceAdjustmentPercent || 0),
    };

    if (hasDynamicFlag) {
      car.dynamicPriceEnabled = parseBooleanInput(req.body.dynamicPriceEnabled, Boolean(car.dynamicPriceEnabled));
    }

    if (hasManualOverrideValue) {
      const parsedManualOverridePrice = parseOptionalPositivePrice(req.body.manualOverridePrice);
      if (Number.isNaN(parsedManualOverridePrice)) {
        return res.status(422).json({ message: 'manualOverridePrice must be a positive number' });
      }
      car.manualOverridePrice = parsedManualOverridePrice;
    } else if (resetManualOverride) {
      car.manualOverridePrice = null;
    }

    await car.save();

    const pricingSnapshot = await resolveSmartPriceForCar(car, {
      now: new Date(),
      persist: true,
      branchId: car?.branchId,
    });

    const updatedCar = await Car.findById(car._id).populate(
      'branchId',
      'branchName branchCode isActive dynamicPricingEnabled dynamicPricingMultiplier',
    );

    const currentSnapshot = {
      dynamicPriceEnabled: Boolean(updatedCar?.dynamicPriceEnabled),
      manualOverridePrice: parseOptionalPositivePrice(updatedCar?.manualOverridePrice),
      priceSource: String(pricingSnapshot?.priceSource || updatedCar?.priceSource || 'Base'),
      currentDynamicPrice: Number(pricingSnapshot?.effectivePricePerDay || updatedCar?.currentDynamicPrice || 0),
      priceAdjustmentPercent: Number(
        pricingSnapshot?.priceAdjustmentPercent || updatedCar?.priceAdjustmentPercent || 0,
      ),
    };

    if (hasDynamicFlag && previousSnapshot.dynamicPriceEnabled !== currentSnapshot.dynamicPriceEnabled) {
      queueAuditLog({
        userId: req.user?._id,
        actionType: 'CAR_DYNAMIC_PRICING_TOGGLED',
        targetEntity: 'CarPricing',
        targetId: String(car._id),
        meta: {
          from: { dynamicPriceEnabled: previousSnapshot.dynamicPriceEnabled },
          to: { dynamicPriceEnabled: currentSnapshot.dynamicPriceEnabled },
        },
      });
    }

    if (hasManualOverrideValue && previousSnapshot.manualOverridePrice !== currentSnapshot.manualOverridePrice) {
      queueAuditLog({
        userId: req.user?._id,
        actionType: 'CAR_MANUAL_PRICE_SET',
        targetEntity: 'CarPricing',
        targetId: String(car._id),
        meta: {
          from: { manualOverridePrice: previousSnapshot.manualOverridePrice },
          to: { manualOverridePrice: currentSnapshot.manualOverridePrice },
        },
      });
    }

    if (resetManualOverride && previousSnapshot.manualOverridePrice !== null) {
      queueAuditLog({
        userId: req.user?._id,
        actionType: 'CAR_MANUAL_PRICE_RESET',
        targetEntity: 'CarPricing',
        targetId: String(car._id),
        meta: {
          from: { manualOverridePrice: previousSnapshot.manualOverridePrice },
          to: { manualOverridePrice: null },
        },
      });
    }

    return res.json({
      message: 'Pricing configuration updated successfully',
      car: {
        ...(typeof updatedCar?.toObject === 'function' ? updatedCar.toObject() : updatedCar),
        basePricePerDay: Number(pricingSnapshot?.basePricePerDay || updatedCar?.pricePerDay || 0),
        effectivePricePerDay: Number(pricingSnapshot?.effectivePricePerDay || updatedCar?.pricePerDay || 0),
        currentDynamicPrice: Number(pricingSnapshot?.currentDynamicPrice || updatedCar?.currentDynamicPrice || 0),
        priceSource: String(pricingSnapshot?.priceSource || updatedCar?.priceSource || 'Base'),
        priceAdjustmentPercent: Number(
          pricingSnapshot?.priceAdjustmentPercent || updatedCar?.priceAdjustmentPercent || 0,
        ),
        branchDynamicPricingEnabled: Boolean(
          pricingSnapshot?.branchDynamicPricingEnabled ||
            updatedCar?.branchId?.dynamicPricingEnabled,
        ),
      },
    });
  } catch (error) {
    console.error('updateCarPricing error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update car pricing' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getCarPricingHistory = async (req, res) => {
  try {
    const car = await Car.findById(req.params.id).select('_id');
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    await assertCarInScope(req.user, car._id, 'Car does not belong to your branch scope');

    const limit = Math.max(Math.min(Number(req.query?.limit || 40), 100), 1);
    const historyRows = await AuditLog.find({
      targetEntity: 'CarPricing',
      targetId: String(car._id),
      actionType: { $in: PRICING_AUDIT_ACTION_TYPES },
    })
      .populate('userId', 'firstName lastName email role')
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({
      history: historyRows.map(formatPricingHistoryEntry),
    });
  } catch (error) {
    console.error('getCarPricingHistory error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load pricing history' : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateBranchDynamicPricing = async (req, res) => {
  try {
    ensureSuperAdminAccess(req.user);

    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    const hasEnabledField = Object.prototype.hasOwnProperty.call(req.body || {}, 'dynamicPricingEnabled');
    const hasMultiplierField = Object.prototype.hasOwnProperty.call(req.body || {}, 'dynamicPricingMultiplier');
    if (!hasEnabledField && !hasMultiplierField) {
      return res.status(422).json({ message: 'Provide dynamicPricingEnabled and/or dynamicPricingMultiplier' });
    }

    const previousState = {
      dynamicPricingEnabled: Boolean(branch.dynamicPricingEnabled),
      dynamicPricingMultiplier: Number(branch.dynamicPricingMultiplier || 1),
    };

    if (hasEnabledField) {
      branch.dynamicPricingEnabled = parseBooleanInput(
        req.body.dynamicPricingEnabled,
        Boolean(branch.dynamicPricingEnabled),
      );
    }

    if (hasMultiplierField) {
      const parsedMultiplier = Number(req.body.dynamicPricingMultiplier);
      if (!Number.isFinite(parsedMultiplier) || parsedMultiplier <= 0) {
        return res.status(422).json({ message: 'dynamicPricingMultiplier must be a positive number' });
      }
      branch.dynamicPricingMultiplier = parsedMultiplier;
    }

    await branch.save();
    clearSmartPricingCache();
    await Car.updateMany(
      { branchId: branch._id, dynamicPriceEnabled: true },
      { $set: { lastPriceUpdatedAt: null } },
    );

    const currentState = {
      dynamicPricingEnabled: Boolean(branch.dynamicPricingEnabled),
      dynamicPricingMultiplier: Number(branch.dynamicPricingMultiplier || 1),
    };

    if (
      previousState.dynamicPricingEnabled !== currentState.dynamicPricingEnabled ||
      previousState.dynamicPricingMultiplier !== currentState.dynamicPricingMultiplier
    ) {
      queueAuditLog({
        userId: req.user?._id,
        actionType: 'BRANCH_DYNAMIC_PRICING_TOGGLED',
        targetEntity: 'Branch',
        targetId: String(branch._id),
        meta: {
          from: previousState,
          to: currentState,
        },
      });
    }

    return res.json({
      message: 'Branch dynamic pricing updated successfully',
      branch: normalizeBranchForClient(branch.toObject()),
    });
  } catch (error) {
    console.error('updateBranchDynamicPricing error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update branch pricing configuration' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getAllBookings = async (req, res) => {
  try {
    try {
      await runPendingPaymentTimeoutSweep();
    } catch (sweepError) {
      console.error('payment timeout sweep failed (admin bookings):', sweepError);
    }

    const selectedBranchId = await resolveRequestedBranchId(req);
    let query = selectedBranchId ? { branchId: selectedBranchId } : {};
    query = await applyBookingScopeToQuery(req.user, query);
    const bookings = await Booking.find(query)
      .populate('car')
      .populate('subscriptionPlanId', 'planName durationType durationInDays')
      .populate('branchId', 'branchName branchCode city state serviceCities isActive')
      .populate({
        path: 'user',
        select: 'firstName lastName email stateId cityId',
        populate: [
          { path: 'stateId', select: 'name' },
          { path: 'cityId', select: 'name stateId' },
        ],
      })
      .populate('assignedDriver', 'driverName phoneNumber licenseNumber licenseExpiry availabilityStatus isActive branchId currentAssignedBooking')
      .populate('pickupInspection.inspectedBy', 'firstName lastName email')
      .populate('returnInspection.inspectedBy', 'firstName lastName email')
      .sort({ createdAt: -1 });

    await syncRentalStagesForBookings(bookings, { persist: true });
    res.json(bookings);
  } catch (error) {
    res.status(500).json({ message: 'Failed to load bookings' });
  }
};

exports.getAllUsers = async (req, res) => {
  try {
    const users = await User.find({
      role: { $in: [ROLE.USER, 'user'] },
    })
      .select('-password')
      .lean();

    res.json(users.map(normalizeUserForClient));
  } catch {
    res.status(500).json({ message: 'Failed to load users' });
  }
};

exports.toggleBlockUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.isBlocked = !user.isBlocked;
    await user.save();

    res.json({ message: 'User status updated', isBlocked: user.isBlocked });
  } catch {
    res.status(500).json({ message: 'Update failed' });
  }
};

exports.deleteUser = async (req, res) => {
  try {
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User deleted' });
  } catch {
    res.status(500).json({ message: 'Delete failed' });
  }
};

exports.resetUserPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.password = password;
    await user.save();

    res.json({ message: 'Password reset successful' });
  } catch {
    res.status(500).json({ message: 'Password reset failed' });
  }
};

exports.getRoleManagementData = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 }).lean();
    const branches = await Branch.find()
      .select('_id branchName branchCode city state serviceCities isActive manager dynamicPricingEnabled dynamicPricingMultiplier')
      .sort({ branchName: 1 })
      .lean();
    const normalizedUsers = users.map(normalizeUserForClient);
    const staff = normalizedUsers.filter((user) => user.role !== ROLE.USER);

    return res.json({
      staff,
      users: normalizedUsers,
      roles:
        normalizeRole(req.user?.role, ROLE.USER) === ROLE.PLATFORM_SUPER_ADMIN
          ? ROLES
          : ROLES.filter((role) => role !== ROLE.PLATFORM_SUPER_ADMIN),
      branches: branches.map(normalizeBranchForClient),
    });
  } catch (error) {
    console.error('getRoleManagementData error:', error);
    return res.status(500).json({ message: 'Failed to load role management data' });
  }
};

exports.updateUserRole = async (req, res) => {
  try {
    const targetUser = await User.findById(req.params.id);
    if (!targetUser) {
      return res.status(404).json({ message: 'User not found' });
    }

    const requesterId = String(req.user?._id || '');
    const targetUserId = String(targetUser._id || '');
    const requesterRole = normalizeRole(req.user?.role, ROLE.USER);
    const currentRole = normalizeRole(targetUser.role, ROLE.USER);

    let nextRole = currentRole;
    if (req.body?.role !== undefined) {
      const requestedRole = normalizeRole(req.body.role, '');
      if (!requestedRole || !ROLES.includes(requestedRole)) {
        return res.status(422).json({ message: 'Invalid role' });
      }
      nextRole = requestedRole;
    }

    if (
      requesterId &&
      requesterId === targetUserId &&
      requesterRole === ROLE.SUPER_ADMIN &&
      nextRole !== ROLE.SUPER_ADMIN
    ) {
      return res.status(422).json({ message: 'You cannot downgrade your own SuperAdmin role' });
    }

    if (req.body?.isBlocked === true && requesterId === targetUserId) {
      return res.status(422).json({ message: 'You cannot deactivate your own account' });
    }

    if (nextRole === ROLE.PLATFORM_SUPER_ADMIN && requesterRole !== ROLE.PLATFORM_SUPER_ADMIN) {
      return res.status(403).json({ message: 'Only PlatformSuperAdmin can assign PlatformSuperAdmin role' });
    }

    if (currentRole === ROLE.PLATFORM_SUPER_ADMIN && requesterRole !== ROLE.PLATFORM_SUPER_ADMIN) {
      return res.status(403).json({ message: 'Only PlatformSuperAdmin can modify this user role' });
    }

    if (nextRole === ROLE.SUPER_ADMIN && currentRole !== ROLE.SUPER_ADMIN) {
      const superAdminQuery = {
        role: ROLE.SUPER_ADMIN,
        _id: { $ne: targetUser._id },
      };
      if (targetUser?.tenantId) {
        superAdminQuery.tenantId = targetUser.tenantId;
      }

      const existingSuperAdmin = await User.findOne(superAdminQuery).select('_id email').lean();
      if (existingSuperAdmin?._id) {
        return res.status(422).json({ message: 'Only one SuperAdmin is allowed. Change existing SuperAdmin role first.' });
      }
    }

    const previousState = {
      role: currentRole,
      isBlocked: Boolean(targetUser.isBlocked),
      assignedBranches: normalizeBranches(targetUser.assignedBranches),
    };

    targetUser.role = nextRole;
    if (isBranchScopedRole(nextRole)) {
      if (req.body?.assignedBranches !== undefined) {
        targetUser.assignedBranches = await resolveBranchAssignments(req.body.assignedBranches);
      } else {
        targetUser.assignedBranches = normalizeBranches(targetUser.assignedBranches);
      }

      if (targetUser.assignedBranches.length === 0) {
        return res.status(422).json({ message: 'At least one branch assignment is required for this role' });
      }
    } else {
      targetUser.assignedBranches = [];
    }

    if (req.body?.isBlocked !== undefined) {
      targetUser.isBlocked = parseBooleanInput(req.body.isBlocked, Boolean(targetUser.isBlocked));
    }

    await targetUser.save();

    const updatedRole = normalizeRole(targetUser.role, ROLE.USER);
    const roleChanged = previousState.role !== updatedRole;
    const activeChanged = previousState.isBlocked !== Boolean(targetUser.isBlocked);
    const branchChanged =
      JSON.stringify(previousState.assignedBranches) !== JSON.stringify(normalizeBranches(targetUser.assignedBranches));

    if (roleChanged || activeChanged || branchChanged) {
      queueAuditLog({
        userId: req.user?._id,
        actionType: 'ROLE_CHANGED',
        targetEntity: 'User',
        targetId: targetUserId,
        meta: {
          from: previousState,
          to: {
            role: updatedRole,
            isBlocked: Boolean(targetUser.isBlocked),
            assignedBranches: normalizeBranches(targetUser.assignedBranches),
          },
        },
      });
    }

    return res.json({
      message: 'User role updated successfully',
      user: normalizeUserForClient(targetUser.toObject()),
    });
  } catch (error) {
    console.error('updateUserRole error:', error);
    if (error?.name === 'ValidationError') {
      const firstError = Object.values(error.errors || {})[0];
      return res.status(422).json({ message: firstError?.message || error.message || 'Validation failed' });
    }
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update user role' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getBranchOptions = async (req, res) => {
  try {
    const scopedBranchIds = getScopedBranchIds(req.user);
    const branchQuery =
      Array.isArray(scopedBranchIds)
        ? (scopedBranchIds.length > 0 ? { _id: { $in: scopedBranchIds } } : { _id: { $in: [] } })
        : {};

    const branches = await Branch.find(branchQuery)
      .select('_id branchName branchCode address city state cityId stateId latitude longitude serviceCities isActive manager dynamicPricingEnabled dynamicPricingMultiplier')
      .sort({ branchName: 1 })
      .lean();

    const branchesWithLocations = await attachLocationsToBranches(branches);

    return res.json({
      scoped: Array.isArray(scopedBranchIds),
      branches: branchesWithLocations,
    });
  } catch (error) {
    console.error('getBranchOptions error:', error);
    return res.status(500).json({ message: 'Failed to load branch options' });
  }
};

exports.getCarCategories = async (req, res) => {
  try {
    let carQuery = {};
    carQuery = await applyCarScopeToQuery(req.user, carQuery);

    const [savedCategories, cars] = await Promise.all([
      CarCategory.find({})
        .select('name nameKey')
        .sort({ name: 1 })
        .lean(),
      Car.find(carQuery).select('category').lean(),
    ]);

    const usageMap = toCategoryUsageMap(cars);
    const categories = mergeCategoryEntries({
      savedCategories,
      usageMap,
      includeDefaults: true,
    });

    return res.json({
      categories,
      canManage: canManageCarCategories(req.user),
    });
  } catch (error) {
    console.error('getCarCategories error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load car categories' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createCarCategory = async (req, res) => {
  try {
    ensureCategoryControlAccess(req.user);

    const categoryName = normalizeCategoryName(req.body?.name);
    if (!categoryName) {
      return res.status(422).json({ message: 'Category name is required' });
    }

    const categoryKey = toCategoryKey(categoryName);
    const existingCategory = await CarCategory.findOne({ nameKey: categoryKey }).lean();
    if (existingCategory?._id) {
      return res.status(200).json({
        message: 'Category already exists',
        category: normalizeCategoryName(existingCategory.name),
      });
    }

    const categoryRegex = new RegExp(`^${escapeRegExp(categoryName)}$`, 'i');
    const legacyCategory = await Car.findOne({ category: { $regex: categoryRegex } })
      .select('category')
      .lean();
    if (legacyCategory?.category) {
      return res.status(200).json({
        message: 'Category already exists',
        category: normalizeCategoryName(legacyCategory.category),
      });
    }

    const createdCategory = await CarCategory.create({
      name: categoryName,
    });

    return res.status(201).json({
      message: 'Category added successfully',
      category: normalizeCategoryName(createdCategory.name),
    });
  } catch (error) {
    console.error('createCarCategory error:', error);
    if (Number(error?.code) === 11000) {
      return res.status(200).json({ message: 'Category already exists' });
    }
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to add category' : error.message;
    return res.status(status).json({ message });
  }
};

exports.renameCarCategory = async (req, res) => {
  try {
    ensureCategoryControlAccess(req.user);

    const currentName = normalizeCategoryName(req.body?.currentName);
    const nextName = normalizeCategoryName(req.body?.nextName);

    if (!currentName || !nextName) {
      return res.status(422).json({ message: 'currentName and nextName are required' });
    }
    if (toCategoryKey(currentName) === toCategoryKey(nextName)) {
      return res.status(422).json({ message: 'Please provide a different category name' });
    }

    const currentCategoryKey = toCategoryKey(currentName);
    const nextCategoryKey = toCategoryKey(nextName);
    const [savedCurrentCategory, savedNextCategory] = await Promise.all([
      CarCategory.findOne({ nameKey: currentCategoryKey }),
      CarCategory.findOne({ nameKey: nextCategoryKey }).lean(),
    ]);
    if (savedNextCategory?._id) {
      return res.status(422).json({ message: 'Target category already exists' });
    }

    const currentCategoryRegex = new RegExp(`^${escapeRegExp(currentName)}$`, 'i');
    const nextCategoryRegex = new RegExp(`^${escapeRegExp(nextName)}$`, 'i');
    const [carUsingCurrentCategory, carUsingNextCategory] = await Promise.all([
      Car.findOne({ category: { $regex: currentCategoryRegex } }).select('category').lean(),
      Car.findOne({ category: { $regex: nextCategoryRegex } }).select('_id').lean(),
    ]);

    if (carUsingNextCategory?._id) {
      return res.status(422).json({ message: 'Target category already exists' });
    }
    if (!savedCurrentCategory?._id && !carUsingCurrentCategory?.category) {
      return res.status(404).json({ message: 'Category not found' });
    }

    const existingCurrentName = normalizeCategoryName(
      savedCurrentCategory?.name || carUsingCurrentCategory?.category || currentName,
    );

    if (savedCurrentCategory?._id) {
      savedCurrentCategory.name = nextName;
      await savedCurrentCategory.save();
    } else {
      await CarCategory.create({ name: nextName });
    }

    const existingCategoryRegex = new RegExp(`^${escapeRegExp(existingCurrentName)}$`, 'i');
    const updateResult = await Car.updateMany(
      { category: { $regex: existingCategoryRegex } },
      { $set: { category: nextName } },
    );

    return res.json({
      message: 'Category updated successfully',
      category: nextName,
      movedCars: Number(updateResult?.modifiedCount || 0),
    });
  } catch (error) {
    console.error('renameCarCategory error:', error);
    if (Number(error?.code) === 11000) {
      return res.status(422).json({ message: 'Target category already exists' });
    }
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update category' : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteCarCategory = async (req, res) => {
  try {
    ensureCategoryControlAccess(req.user);

    const categoryName = normalizeCategoryName(req.query?.name || req.body?.name);
    if (!categoryName) {
      return res.status(422).json({ message: 'Category name is required' });
    }

    const categoryKey = toCategoryKey(categoryName);
    const savedCategory = await CarCategory.findOne({ nameKey: categoryKey });
    const existingCategoryName = normalizeCategoryName(savedCategory?.name || categoryName);
    const categoryRegex = new RegExp(`^${escapeRegExp(existingCategoryName)}$`, 'i');

    const carsUsingCategory = await Car.countDocuments({
      category: { $regex: categoryRegex },
    });
    if (carsUsingCategory > 0) {
      return res.status(422).json({
        message: 'Category has active cars. Move or update those cars before deleting this category.',
        carCount: carsUsingCategory,
      });
    }

    if (!savedCategory?._id) {
      return res.status(404).json({ message: 'Category not found' });
    }

    await CarCategory.deleteOne({ _id: savedCategory._id });

    return res.json({
      message: 'Category deleted successfully',
    });
  } catch (error) {
    console.error('deleteCarCategory error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to delete category' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getCarsForCategory = async (req, res) => {
  try {
    ensureCategoryControlAccess(req.user);

    const categoryName = normalizeCategoryName(req.query?.name || req.body?.name);
    if (!categoryName) {
      return res.status(422).json({ message: 'Category name is required' });
    }

    const categoryRegex = new RegExp(`^${escapeRegExp(categoryName)}$`, 'i');
    const cars = await Car.find({ category: { $regex: categoryRegex } })
      .select('_id name brand model registrationNumber category location fleetStatus branchId')
      .populate('branchId', 'branchName branchCode city state serviceCities isActive')
      .sort({ brand: 1, model: 1 })
      .lean();

    return res.json({
      category: categoryName,
      cars,
    });
  } catch (error) {
    console.error('getCarsForCategory error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load cars for category' : error.message;
    return res.status(status).json({ message });
  }
};

exports.moveCarCategory = async (req, res) => {
  try {
    ensureCategoryControlAccess(req.user);

    const carId = String(req.body?.carId || '').trim();
    const fromCategory = normalizeCategoryName(req.body?.fromCategory);
    const toCategory = normalizeCategoryName(req.body?.toCategory);

    if (!carId || !fromCategory || !toCategory) {
      return res.status(422).json({ message: 'carId, fromCategory and toCategory are required' });
    }
    if (toCategoryKey(fromCategory) === toCategoryKey(toCategory)) {
      return res.status(422).json({ message: 'Target category must be different' });
    }

    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const currentCategory = normalizeCategoryName(car.category);
    if (toCategoryKey(currentCategory) !== toCategoryKey(fromCategory)) {
      return res.status(422).json({ message: 'Car is no longer assigned to selected category' });
    }

    car.category = toCategory;
    await car.save();

    return res.json({
      message: 'Car category updated successfully',
      car: {
        _id: String(car._id),
        category: normalizeCategoryName(car.category),
      },
    });
  } catch (error) {
    console.error('moveCarCategory error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to move car category' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getBranchLocations = async (req, res) => {
  try {
    ensureLocationControlAccess(req.user);

    const scopedBranchIds = getScopedBranchIds(req.user);
    const branchQuery =
      Array.isArray(scopedBranchIds)
        ? (scopedBranchIds.length > 0 ? { _id: { $in: scopedBranchIds } } : { _id: { $in: [] } })
        : {};

    const branches = await Branch.find(branchQuery)
      .select('_id branchName branchCode city state serviceCities isActive')
      .sort({ branchName: 1 })
      .lean();

    const branchIds = branches.map((branch) => String(branch?._id || '')).filter(Boolean);
    await Promise.allSettled(branchIds.map((branchId) => syncBranchLocationHierarchy(branchId)));
    const branchLocationDocs = branchIds.length
      ? await Location.find({ branchId: { $in: branchIds }, isActive: true })
        .populate('cityId', 'name')
        .populate('stateId', 'name')
        .populate('branchId', 'branchName')
        .sort({ isPrimary: -1, name: 1 })
        .lean()
      : [];
    const cars = branchIds.length
      ? await Car.find({ branchId: { $in: branchIds } })
        .select('_id branchId location locationId')
        .lean()
      : [];
    const usageByBranch = toLocationUsageMap(cars);

    const branchLocations = branches.map((branch) => {
      const normalizedBranch = normalizeBranchForClient(branch);
      const branchId = String(branch?._id || '').trim();
      const branchUsage = usageByBranch.get(branchId) || new Map();
      const locationDocs = branchLocationDocs.filter(
        (location) => String(location?.branchId?._id || location?.branchId || '') === branchId,
      );

      const mergedLocations = new Map();
      locationDocs.forEach((locationDoc) => {
        const locationId = String(locationDoc?._id || '').trim();
        const key = locationId || toLowerCaseKey(locationDoc?.name);
        if (!key) return;
        const usageEntry = branchUsage.get(key) || branchUsage.get(toLowerCaseKey(locationDoc?.name));
        mergedLocations.set(key, {
          ...normalizeLocationForClient(locationDoc),
          carCount: Number(usageEntry?.carCount || 0),
          name: normalizeLocationName(locationDoc?.name),
          isPrimary: Boolean(locationDoc?.isPrimary),
          legacyOnly: false,
        });
      });

      branchUsage.forEach((usageEntry, key) => {
        const mergedKey = String(usageEntry?.locationId || '').trim() || key;
        if (mergedLocations.has(mergedKey) || mergedLocations.has(key)) return;
        mergedLocations.set(mergedKey, {
          _id: '',
          name: usageEntry.name,
          carCount: Number(usageEntry.carCount || 0),
          isPrimary: false,
          legacyOnly: true,
        });
      });

      const locations = [...mergedLocations.values()].sort((left, right) => left.name.localeCompare(right.name));
      return {
        ...normalizedBranch,
        locations,
      };
    });

    return res.json({
      scoped: Array.isArray(scopedBranchIds),
      branches: branchLocations,
    });
  } catch (error) {
    console.error('getBranchLocations error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load branch locations' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getCarsForBranchLocation = async (req, res) => {
  try {
    const branch = await resolveBranchForLocationWrite(req.user, req.query?.branchId || req.body?.branchId);
    const requestedLocationId = String(req.query?.locationId || req.body?.locationId || '').trim();
    const locationName = normalizeLocationName(req.query?.name || req.body?.name);
    if (!requestedLocationId && !locationName) {
      return res.status(422).json({ message: 'Location id or name is required' });
    }

    const locationDoc = await resolveLocationDocumentForBranch(branch, {
      locationId: requestedLocationId,
      locationName,
    });
    if (!locationDoc?._id) {
      return res.status(404).json({ message: 'Location not found in selected branch' });
    }

    const cars = await Car.find({
      branchId: branch._id,
      $or: [
        { locationId: locationDoc._id },
        { location: { $regex: new RegExp(`^${escapeRegExp(locationDoc.name)}$`, 'i') } },
      ],
    })
      .select('_id name brand model registrationNumber category location locationId fleetStatus branchId')
      .populate('branchId', 'branchName branchCode city state serviceCities isActive')
      .populate('locationId', 'name branchAddress cityId stateId branchId isPrimary')
      .sort({ brand: 1, model: 1 })
      .lean();

    return res.json({
      location: normalizeLocationForClient(locationDoc),
      branch: normalizeBranchForClient(branch.toObject()),
      cars,
    });
  } catch (error) {
    console.error('getCarsForBranchLocation error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load cars for location' : error.message;
    return res.status(status).json({ message });
  }
};

exports.moveCarBranchLocation = async (req, res) => {
  try {
    const sourceBranchId = req.body?.fromBranchId || req.body?.branchId;
    const targetBranchId = req.body?.toBranchId || req.body?.branchId || sourceBranchId;
    const sourceBranch = await resolveBranchForLocationWrite(req.user, sourceBranchId);
    const targetBranch = await resolveBranchForLocationWrite(req.user, targetBranchId);
    const carId = String(req.body?.carId || '').trim();
    const fromLocationId = String(req.body?.fromLocationId || '').trim();
    const toLocationId = String(req.body?.toLocationId || '').trim();
    const fromLocation = normalizeLocationName(req.body?.fromLocation);
    const toLocation = normalizeLocationName(req.body?.toLocation);

    if (!carId || (!fromLocationId && !fromLocation) || (!toLocationId && !toLocation)) {
      return res.status(422).json({ message: 'carId, source location and target location are required' });
    }

    const car = await Car.findById(carId);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }
    if (String(car.branchId || '') !== String(sourceBranch._id || '')) {
      return res.status(422).json({ message: 'Car does not belong to selected branch' });
    }

    const sourceLocationDoc = await resolveLocationDocumentForBranch(sourceBranch, {
      locationId: fromLocationId,
      locationName: fromLocation,
    });
    if (!sourceLocationDoc?._id) {
      return res.status(404).json({ message: 'Current location not found in selected branch' });
    }
    if (String(car.locationId || '') !== String(sourceLocationDoc._id) && toLowerCaseKey(car.location) !== toLowerCaseKey(sourceLocationDoc.name)) {
      return res.status(422).json({ message: 'Car is no longer assigned to selected location' });
    }

    const targetLocationDoc = await resolveLocationDocumentForBranch(targetBranch, {
      locationId: toLocationId,
      locationName: toLocation,
    });
    const branchChanged = String(sourceBranch._id || '') !== String(targetBranch._id || '');
    if (!branchChanged && String(targetLocationDoc?._id || '') === String(sourceLocationDoc?._id || '')) {
      return res.status(422).json({ message: 'Target location must be different' });
    }

    if (branchChanged) {
      const hasBlockingBooking = await hasBlockingBookingsForCar(car._id);
      const hasPendingRequest = Boolean(
        await Request.findOne({ car: car._id, status: 'pending' }).select('_id').lean(),
      );
      if (hasBlockingBooking || hasPendingRequest) {
        return res.status(422).json({
          message: 'Cannot move car to another branch while reservation or booking is active',
        });
      }
      car.branchId = targetBranch._id;
    }
    if (!targetBranch.isActive) {
      car.fleetStatus = FLEET_STATUS.INACTIVE;
      car.isAvailable = false;
    }
    car.locationId = targetLocationDoc?._id || null;
    car.location = normalizeLocationName(targetLocationDoc?.name);
    car.stateId = targetLocationDoc?.stateId || targetBranch?.stateId || null;
    car.cityId = targetLocationDoc?.cityId || targetBranch?.cityId || null;
    car.pickupAddress = String(targetLocationDoc?.branchAddress || targetBranch?.address || '').trim();
    await car.save();
    await syncCarLocationHierarchy(car, { branch: targetBranch });

    return res.json({
      message: 'Car location updated successfully',
      car: {
        _id: String(car._id),
        location: normalizeLocationName(car.location),
        locationId: String(car.locationId || ''),
        branchId: String(car.branchId || ''),
      },
      sourceBranch: normalizeBranchForClient(sourceBranch.toObject()),
      targetBranch: normalizeBranchForClient(targetBranch.toObject()),
    });
  } catch (error) {
    console.error('moveCarBranchLocation error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to move car location' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createBranchLocation = async (req, res) => {
  try {
    const branch = await resolveBranchForLocationWrite(req.user, req.body?.branchId);
    const locationName = normalizeLocationName(req.body?.name);
    if (!locationName) {
      return res.status(422).json({ message: 'Location name is required' });
    }
    const synced = await syncBranchLocationHierarchy(branch, { tenantId: branch.tenantId || null });
    if (!synced?.state?._id || !synced?.city?._id) {
      return res.status(422).json({ message: 'Branch must have a valid state and city before adding locations' });
    }

    const existingLocation = await Location.findOne({
      branchId: branch._id,
      nameKey: locationName.toLowerCase(),
      isActive: true,
    })
      .populate('cityId', 'name')
      .populate('stateId', 'name')
      .populate('branchId', 'branchName')
      .lean();
    if (existingLocation?._id) {
      const [branchWithLocations] = await attachLocationsToBranches([branch.toObject()]);
      return res.status(200).json({
        message: 'Location already exists for this branch',
        location: normalizeLocationForClient(existingLocation),
        branch: branchWithLocations || normalizeBranchForClient(branch.toObject()),
      });
    }

    const createdLocation = await ensureLocationDocument({
      branchId: branch._id,
      cityId: synced.city._id,
      stateId: synced.state._id,
      name: locationName,
      branchAddress: branch.address,
      latitude: branch.latitude,
      longitude: branch.longitude,
      tenantId: branch.tenantId || null,
    });

    const populatedLocation = createdLocation
      ? await Location.findById(createdLocation._id)
        .populate('cityId', 'name')
        .populate('stateId', 'name')
        .populate('branchId', 'branchName')
        .lean()
      : null;
    const [branchWithLocations] = await attachLocationsToBranches([branch.toObject()]);

    return res.status(201).json({
      message: 'Location added successfully',
      location: populatedLocation ? normalizeLocationForClient(populatedLocation) : { _id: '', name: locationName },
      branch: branchWithLocations || normalizeBranchForClient(branch.toObject()),
    });
  } catch (error) {
    console.error('createBranchLocation error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to add location' : error.message;
    return res.status(status).json({ message });
  }
};

exports.renameBranchLocation = async (req, res) => {
  try {
    const branch = await resolveBranchForLocationWrite(req.user, req.body?.branchId);
    const locationId = String(req.body?.locationId || '').trim();
    const currentName = normalizeLocationName(req.body?.currentName);
    const nextName = normalizeLocationName(req.body?.nextName);

    if (!currentName || !nextName) {
      return res.status(422).json({ message: 'currentName and nextName are required' });
    }
    const locationDoc = await resolveLocationDocumentForBranch(branch, {
      locationId,
      locationName: currentName,
    });
    const duplicateLocation = await Location.findOne({
      _id: { $ne: locationDoc._id },
      branchId: branch._id,
      nameKey: nextName.toLowerCase(),
      isActive: true,
    })
      .select('_id')
      .lean();
    if (duplicateLocation?._id) {
      return res.status(422).json({ message: 'Target location already exists in selected branch' });
    }

    locationDoc.name = nextName;
    locationDoc.branchAddress = String(branch.address || locationDoc.branchAddress || '').trim();
    await locationDoc.save();

    const cars = await Car.find({
      branchId: branch._id,
      $or: [
        { locationId: locationDoc._id },
        { location: { $regex: new RegExp(`^${escapeRegExp(currentName)}$`, 'i') } },
      ],
    });
    for (const car of cars) {
      car.locationId = locationDoc._id;
      car.location = nextName;
      car.pickupAddress = String(locationDoc.branchAddress || branch.address || '').trim();
      await car.save();
    }

    const [branchWithLocations] = await attachLocationsToBranches([branch.toObject()]);

    return res.json({
      message: 'Location updated successfully',
      branch: branchWithLocations || normalizeBranchForClient(branch.toObject()),
      movedCars: cars.length,
    });
  } catch (error) {
    console.error('renameBranchLocation error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update location' : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteBranchLocation = async (req, res) => {
  try {
    const branchId = req.query?.branchId || req.body?.branchId;
    const locationName = req.query?.name || req.body?.name;
    const locationId = req.query?.locationId || req.body?.locationId;
    const branch = await resolveBranchForLocationWrite(req.user, branchId);
    const locationDoc = await resolveLocationDocumentForBranch(branch, {
      locationId,
      locationName,
    });
    const carsUsingLocation = await Car.countDocuments({
      branchId: branch._id,
      $or: [
        { locationId: locationDoc._id },
        { location: { $regex: new RegExp(`^${escapeRegExp(locationDoc.name)}$`, 'i') } },
      ],
    });
    if (carsUsingLocation > 0) {
      return res.status(422).json({
        message: 'Location has active cars. Move or remove those cars before deleting this location.',
        carCount: carsUsingLocation,
      });
    }
    await locationDoc.deleteOne();
    const [branchWithLocations] = await attachLocationsToBranches([branch.toObject()]);

    return res.json({
      message: 'Location deleted successfully',
      branch: branchWithLocations || normalizeBranchForClient(branch.toObject()),
    });
  } catch (error) {
    console.error('deleteBranchLocation error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to delete location' : error.message;
    return res.status(status).json({ message });
  }
};

exports.setBranchPrimaryLocation = async (req, res) => {
  try {
    const branch = await resolveBranchForLocationWrite(req.user, req.body?.branchId);
    const locationName = normalizeLocationName(req.body?.name);
    const locationId = String(req.body?.locationId || '').trim();
    const locationDoc = await resolveLocationDocumentForBranch(branch, {
      locationId,
      locationName,
    });
    await Location.updateMany({ branchId: branch._id }, { $set: { isPrimary: false } });
    await Location.updateOne({ _id: locationDoc._id }, { $set: { isPrimary: true } });
    const [branchWithLocations] = await attachLocationsToBranches([branch.toObject()]);

    return res.json({
      message: 'Primary location updated successfully',
      branch: branchWithLocations || normalizeBranchForClient(branch.toObject()),
    });
  } catch (error) {
    console.error('setBranchPrimaryLocation error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update primary location' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getBranches = async (req, res) => {
  try {
    ensureSuperAdminAccess(req.user);

    const [branches, branchAdmins] = await Promise.all([
      Branch.find()
        .populate('manager', 'firstName lastName email role isBlocked assignedBranches')
        .sort({ branchName: 1 }),
      User.find({ role: ROLE.BRANCH_ADMIN, isBlocked: false })
        .select('_id firstName lastName email role assignedBranches')
        .sort({ firstName: 1, lastName: 1 })
        .lean(),
    ]);

    const branchIds = branches.map((branch) => branch?._id).filter(Boolean);
    const carUsage = branchIds.length
      ? await Car.aggregate([
        { $match: { branchId: { $in: branchIds } } },
        { $group: { _id: '$branchId', carCount: { $sum: 1 } } },
      ])
      : [];
    const carCountByBranchId = new Map(
      carUsage.map((entry) => [String(entry?._id || ''), Number(entry?.carCount || 0)]),
    );

    return res.json({
      branches: branches.map((branch) => {
        const normalized = normalizeBranchForClient(branch.toObject());
        return {
          ...normalized,
          carCount: Number(carCountByBranchId.get(String(branch?._id || '')) || 0),
        };
      }),
      eligibleManagers: branchAdmins.map(normalizeUserForClient),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load branches' : error.message;
    return res.status(status).json({ message });
  }
};

exports.getCarsForBranch = async (req, res) => {
  try {
    ensureSuperAdminAccess(req.user);

    const branchId = String(req.query?.branchId || req.body?.branchId || '').trim();
    if (!branchId) {
      return res.status(422).json({ message: 'branchId is required' });
    }

    const branch = await Branch.findById(branchId)
      .populate('manager', 'firstName lastName email role isBlocked assignedBranches');
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    const cars = await Car.find({ branchId: branch._id })
      .select('_id name brand model registrationNumber category location locationId fleetStatus branchId')
      .populate('branchId', 'branchName branchCode city state serviceCities isActive')
      .populate('locationId', 'name branchAddress cityId stateId branchId isPrimary')
      .sort({ brand: 1, model: 1 })
      .lean();

    return res.json({
      branch: normalizeBranchForClient(branch.toObject()),
      cars,
    });
  } catch (error) {
    console.error('getCarsForBranch error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to load cars for branch' : error.message;
    return res.status(status).json({ message });
  }
};

exports.createBranch = async (req, res) => {
  try {
    ensureSuperAdminAccess(req.user);

    const branchName = String(req.body?.branchName || '').trim();
    const branchCode = toValidBranchCode(req.body?.branchCode || branchName);

    if (!branchName) {
      return res.status(422).json({ message: 'branchName is required' });
    }

    if (!branchCode || branchCode.length < 2) {
      return res.status(422).json({ message: 'Valid branchCode is required' });
    }

    await assertTenantEntityLimit(req, {
      model: Branch,
      limitField: 'maxBranches',
      label: 'branches',
    });

    const existingCode = await Branch.findOne({ branchCode }).select('_id').lean();
    if (existingCode?._id) {
      return res.status(422).json({ message: 'branchCode already exists' });
    }

    let managerId = null;
    if (req.body?.manager) {
      const manager = await User.findById(req.body.manager);
      if (!manager) {
        return res.status(404).json({ message: 'Manager user not found' });
      }
      if (normalizeRole(manager.role, ROLE.USER) !== ROLE.BRANCH_ADMIN) {
        return res.status(422).json({ message: 'Manager must have BranchAdmin role' });
      }
      managerId = manager._id;
    }

    const requestedCity = String(req.body?.city || '').trim();
    const requestedServiceCities = normalizeCityList(req.body?.serviceCities);
    const serviceCities = [...new Set([requestedCity, ...requestedServiceCities].filter(Boolean))];

    let branch = await Branch.create({
      branchName,
      branchCode,
      address: String(req.body?.address || '').trim(),
      stateId: req.body?.stateId || null,
      cityId: req.body?.cityId || null,
      city: requestedCity || serviceCities[0] || '',
      serviceCities,
      state: String(req.body?.state || '').trim(),
      contactNumber: parseOptionalTenDigitPhone(req.body?.contactNumber, 'contactNumber'),
      latitude:
        Number.isFinite(Number(req.body?.latitude)) ? Number(req.body.latitude) : null,
      longitude:
        Number.isFinite(Number(req.body?.longitude)) ? Number(req.body.longitude) : null,
      manager: managerId,
      isActive: req.body?.isActive !== undefined ? parseBooleanInput(req.body.isActive, true) : true,
      dynamicPricingEnabled:
        req.body?.dynamicPricingEnabled !== undefined
          ? parseBooleanInput(req.body.dynamicPricingEnabled, false)
          : false,
      dynamicPricingMultiplier:
        Number.isFinite(Number(req.body?.dynamicPricingMultiplier))
          ? Number(req.body.dynamicPricingMultiplier)
          : 1,
    });

    const syncedBranchResult = await syncBranchLocationHierarchy(branch);
    branch = syncedBranchResult.branch || branch;

    if (managerId) {
      const manager = await User.findById(managerId);
      if (manager) {
        manager.assignedBranches = normalizeBranches([...(manager.assignedBranches || []), String(branch._id)]);
        await manager.save();
      }
    }

    return res.status(201).json({
      message: 'Branch created successfully',
      branch: normalizeBranchForClient(branch.toObject()),
    });
  } catch (error) {
    console.error('createBranch error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to create branch' : error.message;
    return res.status(status).json({ message });
  }
};

exports.updateBranch = async (req, res) => {
  try {
    ensureSuperAdminAccess(req.user);

    const branch = await Branch.findById(req.params.id);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    const wasBranchActive = Boolean(branch.isActive);
    let shouldForceCarsInactive = false;

    if (req.body?.branchName !== undefined) {
      const branchName = String(req.body.branchName || '').trim();
      if (!branchName) {
        return res.status(422).json({ message: 'branchName cannot be empty' });
      }
      branch.branchName = branchName;
    }

    if (req.body?.branchCode !== undefined) {
      const nextBranchCode = toValidBranchCode(req.body.branchCode);
      if (!nextBranchCode || nextBranchCode.length < 2) {
        return res.status(422).json({ message: 'Valid branchCode is required' });
      }

      const duplicate = await Branch.findOne({
        _id: { $ne: branch._id },
        branchCode: nextBranchCode,
      })
        .select('_id')
        .lean();
      if (duplicate?._id) {
        return res.status(422).json({ message: 'branchCode already exists' });
      }

      branch.branchCode = nextBranchCode;
    }

    if (req.body?.address !== undefined) branch.address = String(req.body.address || '').trim();
    if (req.body?.stateId !== undefined) {
      if (req.body.stateId === null || req.body.stateId === '') {
        branch.stateId = null;
      } else if (!mongoose.Types.ObjectId.isValid(String(req.body.stateId))) {
        return res.status(422).json({ message: 'Invalid stateId' });
      } else {
        branch.stateId = req.body.stateId;
      }
    }
    if (req.body?.cityId !== undefined) {
      if (req.body.cityId === null || req.body.cityId === '') {
        branch.cityId = null;
      } else if (!mongoose.Types.ObjectId.isValid(String(req.body.cityId))) {
        return res.status(422).json({ message: 'Invalid cityId' });
      } else {
        branch.cityId = req.body.cityId;
      }
    }
    if (req.body?.city !== undefined) branch.city = String(req.body.city || '').trim();
    if (req.body?.serviceCities !== undefined) {
      branch.serviceCities = normalizeCityList(req.body.serviceCities);
    }
    if (req.body?.state !== undefined) branch.state = String(req.body.state || '').trim();
    if (req.body?.latitude !== undefined) {
      branch.latitude =
        req.body.latitude === null || req.body.latitude === ''
          ? null
          : Number(req.body.latitude);
    }
    if (req.body?.longitude !== undefined) {
      branch.longitude =
        req.body.longitude === null || req.body.longitude === ''
          ? null
          : Number(req.body.longitude);
    }
    if (req.body?.contactNumber !== undefined) {
      branch.contactNumber = parseOptionalTenDigitPhone(req.body.contactNumber, 'contactNumber');
    }
    if (req.body?.isActive !== undefined) {
      const nextIsActive = parseBooleanInput(req.body.isActive, Boolean(branch.isActive));
      shouldForceCarsInactive = wasBranchActive && !nextIsActive;
      branch.isActive = nextIsActive;
    }
    if (req.body?.dynamicPricingEnabled !== undefined) {
      branch.dynamicPricingEnabled = parseBooleanInput(
        req.body.dynamicPricingEnabled,
        Boolean(branch.dynamicPricingEnabled),
      );
    }
    if (req.body?.dynamicPricingMultiplier !== undefined) {
      const parsedMultiplier = Number(req.body.dynamicPricingMultiplier);
      if (!Number.isFinite(parsedMultiplier) || parsedMultiplier <= 0) {
        return res.status(422).json({ message: 'dynamicPricingMultiplier must be a positive number' });
      }
      branch.dynamicPricingMultiplier = parsedMultiplier;
    }

    if (req.body?.manager !== undefined) {
      if (!req.body.manager) {
        branch.manager = null;
      } else {
        const manager = await User.findById(req.body.manager);
        if (!manager) {
          return res.status(404).json({ message: 'Manager user not found' });
        }
        if (normalizeRole(manager.role, ROLE.USER) !== ROLE.BRANCH_ADMIN) {
          return res.status(422).json({ message: 'Manager must have BranchAdmin role' });
        }
        branch.manager = manager._id;
        manager.assignedBranches = normalizeBranches([...(manager.assignedBranches || []), String(branch._id)]);
        await manager.save();
      }
    }

    const normalizedBranchCities = [...new Set([branch.city, ...normalizeCityList(branch.serviceCities)].filter(Boolean))];
    branch.serviceCities = normalizedBranchCities;
    if (!String(branch.city || '').trim() && normalizedBranchCities.length > 0) {
      branch.city = normalizedBranchCities[0];
    }

    await branch.save();
    const syncedBranchResult = await syncBranchLocationHierarchy(branch);
    const syncedBranch = syncedBranchResult.branch || branch;
    const branchLocationRefPatch = buildBranchLocationRefPatch(syncedBranch);
    await Promise.allSettled([
      Car.updateMany({ branchId: syncedBranch._id }, { $set: branchLocationRefPatch }),
      Request.updateMany({ branchId: syncedBranch._id }, { $set: branchLocationRefPatch }),
      Booking.updateMany({ branchId: syncedBranch._id }, { $set: branchLocationRefPatch }),
    ]);

    let inactivatedCars = 0;
    if (shouldForceCarsInactive) {
      const updateResult = await Car.updateMany(
        {
          branchId: branch._id,
          $or: [{ fleetStatus: { $ne: FLEET_STATUS.INACTIVE } }, { isAvailable: { $ne: false } }],
        },
        {
          $set: {
            fleetStatus: FLEET_STATUS.INACTIVE,
            isAvailable: false,
          },
        },
      );
      inactivatedCars = Number(updateResult?.modifiedCount || 0);
      if (inactivatedCars > 0) {
        clearSmartPricingCache();
      }
    }

    return res.json({
      message: 'Branch updated successfully',
      branch: normalizeBranchForClient(syncedBranch.toObject()),
      inactivatedCars,
    });
  } catch (error) {
    console.error('updateBranch error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to update branch' : error.message;
    return res.status(status).json({ message });
  }
};

exports.deleteBranch = async (req, res) => {
  try {
    ensureSuperAdminAccess(req.user);

    const branchId = String(req.params?.id || '').trim();
    if (!branchId) {
      return res.status(422).json({ message: 'branchId is required' });
    }

    const branch = await Branch.findById(branchId);
    if (!branch) {
      return res.status(404).json({ message: 'Branch not found' });
    }

    const totalBranches = await Branch.countDocuments({});
    if (totalBranches <= 1) {
      return res.status(422).json({ message: 'Cannot delete the last branch' });
    }

    const branchCode = toValidBranchCode(branch?.branchCode || '');
    if (branchCode === MAIN_BRANCH_CODE) {
      return res.status(422).json({ message: 'Main branch cannot be deleted' });
    }

    const linkedCars = await Car.countDocuments({ branchId: branch._id });
    if (linkedCars > 0) {
      return res.status(422).json({
        message: 'Move or remove cars from this branch before deleting',
      });
    }

    await User.updateMany(
      { assignedBranches: String(branch._id) },
      { $pull: { assignedBranches: String(branch._id) } },
    );

    await Branch.deleteOne({ _id: branch._id });

    return res.json({
      message: 'Branch deleted successfully',
      deletedBranchId: String(branch._id),
    });
  } catch (error) {
    console.error('deleteBranch error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to delete branch' : error.message;
    return res.status(status).json({ message });
  }
};

exports.transferCarBranch = async (req, res) => {
  try {
    ensureSuperAdminAccess(req.user);

    const car = await Car.findById(req.params.id);
    if (!car) {
      return res.status(404).json({ message: 'Car not found' });
    }

    const targetBranch = await ensureBranchById(req.body?.branchId);
    if (!targetBranch) {
      return res.status(404).json({ message: 'Target branch not found' });
    }

    const currentFleetStatus = resolveFleetStatus(car);
    if (currentFleetStatus === FLEET_STATUS.RENTED) {
      return res.status(422).json({ message: 'Cannot transfer vehicle while it is rented' });
    }

    const hasBlockingBooking = await hasBlockingBookingsForCar(car._id);
    if (hasBlockingBooking) {
      return res.status(422).json({ message: 'Cannot transfer vehicle while reservation/booking is active' });
    }

    car.branchId = targetBranch._id;
    if (!targetBranch.isActive) {
      car.fleetStatus = FLEET_STATUS.INACTIVE;
      car.isAvailable = false;
    }
    await car.save();
    const syncedCarResult = await syncCarLocationHierarchy(car, { branch: targetBranch });
    const syncedCar = syncedCarResult.car || car;
    clearSmartPricingCache();

    return res.json({
      message: 'Vehicle transferred successfully',
      car: syncedCar,
      branch: normalizeBranchForClient(targetBranch.toObject()),
    });
  } catch (error) {
    console.error('transferCarBranch error:', error);
    const status = Number(error?.status || 500);
    const message = status >= 500 ? 'Failed to transfer vehicle' : error.message;
    return res.status(status).json({ message });
  }
};
