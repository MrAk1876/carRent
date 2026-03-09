const mongoose = require('mongoose');
const State = require('../models/State');
const City = require('../models/City');
const Location = require('../models/Location');
const Branch = require('../models/Branch');
const Car = require('../models/Car');
const Request = require('../models/Request');
const Booking = require('../models/Booking');
const { ensureDefaultTenant } = require('./tenantService');
const { getTenantIdFromContext, runWithTenantContext } = require('./tenantContextService');

const normalizeName = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizeKey = (value) => normalizeName(value).toLowerCase();
const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (mongoose.isValidObjectId(value)) return String(value);
  if (value?._id && mongoose.isValidObjectId(value._id)) return String(value._id);
  return '';
};

const toObjectId = (value) => {
  const normalized = toObjectIdString(value);
  if (!normalized || !mongoose.Types.ObjectId.isValid(normalized)) return null;
  return new mongoose.Types.ObjectId(normalized);
};

const buildPickupAddress = (location = null, city = null, state = null, branch = null) =>
  [
    normalizeName(location?.branchAddress || branch?.address),
    normalizeName(location?.name || city?.name || branch?.city),
    normalizeName(city?.name || branch?.city),
    normalizeName(state?.name || branch?.state),
  ]
    .filter(Boolean)
    .filter((part, index, arr) => arr.indexOf(part) === index)
    .join(', ');

const getBranchServiceCities = (branch = {}) =>
  [
    ...new Set(
      [branch?.city, ...(Array.isArray(branch?.serviceCities) ? branch.serviceCities : [])]
        .map(normalizeName)
        .filter(Boolean),
    ),
  ];

const resolveTenantObjectId = async (tenantId) => {
  const directTenantId = toObjectId(tenantId || getTenantIdFromContext());
  if (directTenantId) return directTenantId;
  const tenant = await ensureDefaultTenant();
  return toObjectId(tenant?._id);
};

const ensureStateDocument = async ({ stateId, name, tenantId }) => {
  const normalizedStateId = toObjectId(stateId);
  if (normalizedStateId) {
    const stateById = await State.findById(normalizedStateId);
    if (stateById) return stateById;
  }

  const normalizedName = normalizeName(name);
  if (!normalizedName) return null;

  const existing = await State.findOne({ nameKey: normalizeKey(normalizedName) });
  if (existing) return existing;

  return State.create({
    name: normalizedName,
    tenantId: await resolveTenantObjectId(tenantId),
  });
};

const ensureCityDocument = async ({ cityId, stateId, name, tenantId }) => {
  const normalizedCityId = toObjectId(cityId);
  if (normalizedCityId) {
    const cityById = await City.findById(normalizedCityId);
    if (cityById) return cityById;
  }

  const normalizedStateId = toObjectId(stateId);
  const normalizedName = normalizeName(name);
  if (!normalizedStateId || !normalizedName) return null;

  const existing = await City.findOne({
    stateId: normalizedStateId,
    nameKey: normalizeKey(normalizedName),
  });
  if (existing) return existing;

  return City.create({
    name: normalizedName,
    stateId: normalizedStateId,
    tenantId: await resolveTenantObjectId(tenantId),
  });
};

const ensureLocationDocument = async ({
  locationId,
  branchId,
  cityId,
  stateId,
  name,
  branchAddress = '',
  latitude = null,
  longitude = null,
  isPrimary = false,
  tenantId,
} = {}) => {
  const normalizedLocationId = toObjectId(locationId);
  if (normalizedLocationId) {
    const locationById = await Location.findById(normalizedLocationId);
    if (locationById) {
      let changed = false;
      if (cityId && String(locationById.cityId || '') !== String(cityId)) {
        locationById.cityId = cityId;
        changed = true;
      }
      if (stateId && String(locationById.stateId || '') !== String(stateId)) {
        locationById.stateId = stateId;
        changed = true;
      }
      if (branchId && String(locationById.branchId || '') !== String(branchId)) {
        locationById.branchId = branchId;
        changed = true;
      }
      const normalizedName = normalizeName(name);
      if (normalizedName && normalizeName(locationById.name) !== normalizedName) {
        locationById.name = normalizedName;
        changed = true;
      }
      if (normalizeName(locationById.branchAddress) !== normalizeName(branchAddress)) {
        locationById.branchAddress = normalizeName(branchAddress);
        changed = true;
      }
      if (locationById.isPrimary !== Boolean(isPrimary)) {
        locationById.isPrimary = Boolean(isPrimary);
        changed = true;
      }
      if (changed) await locationById.save();
      return locationById;
    }
  }

  const normalizedBranchId = toObjectId(branchId);
  const normalizedCityId = toObjectId(cityId);
  const normalizedStateId = toObjectId(stateId);
  const normalizedName = normalizeName(name);
  if (!normalizedBranchId || !normalizedCityId || !normalizedStateId || !normalizedName) return null;

  const existing = await Location.findOne({
    branchId: normalizedBranchId,
    cityId: normalizedCityId,
    nameKey: normalizeKey(normalizedName),
  });

  if (existing) {
    let changed = false;
    if (String(existing.stateId || '') !== String(normalizedStateId)) {
      existing.stateId = normalizedStateId;
      changed = true;
    }
    if (normalizeName(existing.branchAddress) !== normalizeName(branchAddress)) {
      existing.branchAddress = normalizeName(branchAddress);
      changed = true;
    }
    if (existing.isPrimary !== Boolean(isPrimary)) {
      existing.isPrimary = Boolean(isPrimary);
      changed = true;
    }
    if (changed) await existing.save();
    return existing;
  }

  return Location.create({
    name: normalizedName,
    stateId: normalizedStateId,
    cityId: normalizedCityId,
    branchId: normalizedBranchId,
    branchAddress: normalizeName(branchAddress),
    latitude: Number.isFinite(Number(latitude)) ? Number(latitude) : null,
    longitude: Number.isFinite(Number(longitude)) ? Number(longitude) : null,
    isPrimary: Boolean(isPrimary),
    tenantId: await resolveTenantObjectId(tenantId),
  });
};

const ensureBranchServiceCityDocuments = async (branch, { tenantId, state } = {}) => {
  const resolvedState = state || (branch?.stateId ? await State.findById(branch.stateId) : null);
  if (!branch || !resolvedState?._id) return [];

  const locations = getBranchServiceCities(branch);
  const cities = [];

  for (const locationName of locations) {
    const city = await ensureCityDocument({
      stateId: resolvedState._id,
      name: locationName,
      tenantId,
    });
    if (city) cities.push(city);
  }

  return cities;
};

const ensureBranchLocationDocuments = async (branch, { tenantId, state, cities = [] } = {}) => {
  if (!branch || !state?._id) return [];
  const cityMap = new Map(cities.map((city) => [normalizeKey(city?.name), city]));
  const locations = [];

  for (const locationName of getBranchServiceCities(branch)) {
    const matchedCity =
      cityMap.get(normalizeKey(locationName)) ||
      (await ensureCityDocument({
        stateId: state._id,
        name: locationName,
        tenantId,
      }));
    if (!matchedCity?._id) continue;
    const location = await ensureLocationDocument({
      branchId: branch._id,
      cityId: matchedCity._id,
      stateId: state._id,
      name: locationName,
      branchAddress: branch.address,
      latitude: branch.latitude,
      longitude: branch.longitude,
      isPrimary: normalizeKey(locationName) === normalizeKey(branch.city),
      tenantId,
    });
    if (location) locations.push(location);
  }

  return locations;
};

const resolveBranchLocation = async (branch, { tenantId, state, locationId, locationName } = {}) => {
  const resolvedState = state || (branch?.stateId ? await State.findById(branch.stateId) : null);
  if (!branch || !resolvedState?._id) return { location: null, city: null };

  const normalizedLocationId = toObjectId(locationId);
  if (normalizedLocationId) {
    const existingLocation = await Location.findById(normalizedLocationId)
      .populate('cityId')
      .populate('stateId');
    if (existingLocation) {
      return {
        location: existingLocation,
        city: existingLocation.cityId || null,
      };
    }
  }

  const normalizedLocationName = normalizeName(locationName);
  if (!normalizedLocationName) {
    return { location: null, city: null };
  }

  const currentBranchLocations = await Location.find({
    branchId: branch._id,
    nameKey: normalizeKey(normalizedLocationName),
  }).populate('cityId');
  if (currentBranchLocations[0]) {
    return {
      location: currentBranchLocations[0],
      city: currentBranchLocations[0].cityId || null,
    };
  }

  const branchServiceCityName =
    getBranchServiceCities(branch).find((entry) => normalizeKey(entry) === normalizeKey(normalizedLocationName)) || '';
  const primaryBranchCity =
    (branch?.cityId && (await City.findById(branch.cityId))) ||
    (normalizeName(branch?.city)
      ? await ensureCityDocument({
          stateId: resolvedState._id,
          name: branch.city,
          tenantId,
        })
      : null);
  const matchedCity = branchServiceCityName
    ? await ensureCityDocument({
        stateId: resolvedState._id,
        name: branchServiceCityName,
        tenantId,
      })
    : primaryBranchCity;

  const location = await ensureLocationDocument({
    branchId: branch._id,
    cityId: matchedCity?._id,
    stateId: resolvedState._id,
    name: normalizedLocationName,
    branchAddress: branch.address,
    latitude: branch.latitude,
    longitude: branch.longitude,
    isPrimary: normalizeKey(normalizedLocationName) === normalizeKey(branch.city),
    tenantId,
  });

  return {
    location,
    city: matchedCity,
  };
};

const syncBranchLocationHierarchy = async (branchOrId, options = {}) => {
  let branch = branchOrId;
  if (!branch || !branch._id) {
    const branchId = toObjectId(branchOrId);
    if (!branchId) return { branch: null, state: null, city: null, locations: [] };
    branch = await Branch.findById(branchId);
  }

  if (!branch) return { branch: null, state: null, city: null, locations: [] };

  const tenantId = options.tenantId || branch.tenantId || null;
  const normalizedStateName = normalizeName(options.stateName || branch.state);
  let state = await ensureStateDocument({
    stateId: options.stateId || branch.stateId,
    name: normalizedStateName,
    tenantId,
  });

  let normalizedCityName = normalizeName(options.cityName || branch.city);
  if (!normalizedCityName) {
    normalizedCityName = normalizeName(
      Array.isArray(branch.serviceCities) && branch.serviceCities.length > 0 ? branch.serviceCities[0] : '',
    );
  }

  const city = await ensureCityDocument({
    cityId: options.cityId || branch.cityId,
    stateId: state?._id || null,
    name: normalizedCityName,
    tenantId,
  });

  if (city && String(city.stateId || '') && String(state?._id || '') !== String(city.stateId || '')) {
    const linkedState = await State.findById(city.stateId);
    if (linkedState) state = linkedState;
  }

  const serviceCities = await ensureBranchServiceCityDocuments(branch, { tenantId, state });
  const locations = await ensureBranchLocationDocuments(branch, { tenantId, state, cities: serviceCities });

  let hasChanges = false;
  if (state && String(branch.stateId || '') !== String(state._id)) {
    branch.stateId = state._id;
    hasChanges = true;
  }
  if (city && String(branch.cityId || '') !== String(city._id)) {
    branch.cityId = city._id;
    hasChanges = true;
  }
  if (state && normalizeName(branch.state) !== normalizeName(state.name)) {
    branch.state = state.name;
    hasChanges = true;
  }
  if (city && normalizeName(branch.city) !== normalizeName(city.name)) {
    branch.city = city.name;
    hasChanges = true;
  }

  const normalizedServiceCities = getBranchServiceCities(branch);
  if (JSON.stringify(normalizedServiceCities) !== JSON.stringify(getBranchServiceCities({ ...branch.toObject?.() || branch, serviceCities: branch.serviceCities }))) {
    branch.serviceCities = normalizedServiceCities;
    hasChanges = true;
  } else {
    branch.serviceCities = normalizedServiceCities;
  }

  if (hasChanges) {
    await branch.save();
  }

  return { branch, state, city, locations };
};

const syncCarLocationHierarchy = async (carOrId, options = {}) => {
  let car = carOrId;
  if (!car || !car._id) {
    const carId = toObjectId(carOrId);
    if (!carId) return { car: null, branch: null, state: null, city: null, location: null };
    car = await Car.findById(carId);
  }

  if (!car) return { car: null, branch: null, state: null, city: null, location: null };

  let branch = options.branch || null;
  if (!branch && car.branchId) {
    branch = await Branch.findById(car.branchId);
  }
  if (!branch) {
    return { car, branch: null, state: null, city: null, location: null };
  }

  const synced = await syncBranchLocationHierarchy(branch, { tenantId: car.tenantId || branch.tenantId || null });
  const resolvedLocation = await resolveBranchLocation(synced.branch, {
    tenantId: car.tenantId || branch.tenantId || null,
    state: synced.state,
    locationId: car.locationId,
    locationName: car.location,
  });

  let hasChanges = false;
  if (String(car.branchId || '') !== String(synced.branch?._id || '')) {
    car.branchId = synced.branch?._id || null;
    hasChanges = true;
  }
  if (String(car.stateId || '') !== String(synced.state?._id || '')) {
    car.stateId = synced.state?._id || null;
    hasChanges = true;
  }
  if (String(car.cityId || '') !== String(resolvedLocation.city?._id || synced.city?._id || '')) {
    car.cityId = resolvedLocation.city?._id || synced.city?._id || null;
    hasChanges = true;
  }
  if (String(car.locationId || '') !== String(resolvedLocation.location?._id || '')) {
    car.locationId = resolvedLocation.location?._id || null;
    hasChanges = true;
  }
  if (resolvedLocation.location && normalizeName(car.location) !== normalizeName(resolvedLocation.location.name)) {
    car.location = resolvedLocation.location.name;
    hasChanges = true;
  }
  const nextPickupAddress = buildPickupAddress(
    resolvedLocation.location,
    resolvedLocation.city || synced.city,
    synced.state,
    synced.branch,
  );
  if (normalizeName(car.pickupAddress) !== normalizeName(nextPickupAddress)) {
    car.pickupAddress = nextPickupAddress;
    hasChanges = true;
  }

  if (hasChanges) await car.save();

  return {
    car,
    branch: synced.branch,
    state: synced.state,
    city: resolvedLocation.city || synced.city,
    location: resolvedLocation.location,
  };
};

const syncRequestLocationHierarchy = async (requestOrId, options = {}) => {
  let request = requestOrId;
  if (!request || !request._id) {
    const requestId = toObjectId(requestOrId);
    if (!requestId) return { request: null, branch: null, state: null, city: null, location: null };
    request = await Request.findById(requestId);
  }

  if (!request) return { request: null, branch: null, state: null, city: null, location: null };

  let branch = options.branch || null;
  let car = null;
  if (!branch && request.branchId) branch = await Branch.findById(request.branchId);
  if (options.carId) car = await Car.findById(options.carId).select('branchId stateId cityId locationId location');
  if (!branch && car?.branchId) branch = await Branch.findById(car.branchId);
  if (!branch) {
    return { request, branch: null, state: null, city: null, location: null };
  }

  const synced = await syncBranchLocationHierarchy(branch, { tenantId: request.tenantId || branch.tenantId || null });
  const resolvedLocation = await resolveBranchLocation(synced.branch, {
    tenantId: request.tenantId || branch.tenantId || null,
    state: synced.state,
    locationId: request.locationId || car?.locationId,
    locationName: request.locationName || car?.location || '',
  });

  let hasChanges = false;
  if (String(request.branchId || '') !== String(synced.branch?._id || '')) {
    request.branchId = synced.branch?._id || null;
    hasChanges = true;
  }
  if (String(request.stateId || '') !== String(synced.state?._id || '')) {
    request.stateId = synced.state?._id || null;
    hasChanges = true;
  }
  if (String(request.cityId || '') !== String(resolvedLocation.city?._id || synced.city?._id || '')) {
    request.cityId = resolvedLocation.city?._id || synced.city?._id || null;
    hasChanges = true;
  }
  if (String(request.locationId || '') !== String(resolvedLocation.location?._id || '')) {
    request.locationId = resolvedLocation.location?._id || null;
    hasChanges = true;
  }

  if (hasChanges) await request.save();

  return {
    request,
    branch: synced.branch,
    state: synced.state,
    city: resolvedLocation.city || synced.city,
    location: resolvedLocation.location,
  };
};

const syncBookingLocationHierarchy = async (bookingOrId, options = {}) => {
  let booking = bookingOrId;
  if (!booking || !booking._id) {
    const bookingId = toObjectId(bookingOrId);
    if (!bookingId) return { booking: null, branch: null, state: null, city: null, location: null };
    booking = await Booking.findById(bookingId);
  }

  if (!booking) return { booking: null, branch: null, state: null, city: null, location: null };

  let branch = options.branch || null;
  let car = null;
  if (!branch && booking.branchId) branch = await Branch.findById(booking.branchId);
  if (options.carId) car = await Car.findById(options.carId).select('branchId stateId cityId locationId location');
  if (!branch && car?.branchId) branch = await Branch.findById(car.branchId);
  if (!branch) {
    return { booking, branch: null, state: null, city: null, location: null };
  }

  const synced = await syncBranchLocationHierarchy(branch, { tenantId: booking.tenantId || branch.tenantId || null });
  const resolvedLocation = await resolveBranchLocation(synced.branch, {
    tenantId: booking.tenantId || branch.tenantId || null,
    state: synced.state,
    locationId: booking.locationId || car?.locationId,
    locationName: booking.locationName || car?.location || '',
  });

  let hasChanges = false;
  if (String(booking.branchId || '') !== String(synced.branch?._id || '')) {
    booking.branchId = synced.branch?._id || null;
    hasChanges = true;
  }
  if (String(booking.stateId || '') !== String(synced.state?._id || '')) {
    booking.stateId = synced.state?._id || null;
    hasChanges = true;
  }
  if (String(booking.cityId || '') !== String(resolvedLocation.city?._id || synced.city?._id || '')) {
    booking.cityId = resolvedLocation.city?._id || synced.city?._id || null;
    hasChanges = true;
  }
  if (String(booking.locationId || '') !== String(resolvedLocation.location?._id || '')) {
    booking.locationId = resolvedLocation.location?._id || null;
    hasChanges = true;
  }

  if (hasChanges) await booking.save();

  return {
    booking,
    branch: synced.branch,
    state: synced.state,
    city: resolvedLocation.city || synced.city,
    location: resolvedLocation.location,
  };
};

const bootstrapLocationHierarchy = async () => {
  const branches = await Branch.find({})
    .setOptions({ skipTenantFilter: true })
    .select('_id tenantId state stateId city cityId serviceCities address latitude longitude')
    .lean();

  for (const rawBranch of branches) {
    const tenantId = toObjectIdString(rawBranch?.tenantId);
    await runWithTenantContext({ tenantId }, async () => {
      const branch = await Branch.findById(rawBranch._id).setOptions({ skipTenantFilter: true });
      if (!branch) return;
      await syncBranchLocationHierarchy(branch, { tenantId });
    });
  }

  const cars = await Car.find({})
    .setOptions({ skipTenantFilter: true })
    .select('_id tenantId branchId stateId cityId locationId location pickupAddress')
    .lean();

  for (const rawCar of cars) {
    const tenantId = toObjectIdString(rawCar?.tenantId);
    await runWithTenantContext({ tenantId }, async () => {
      const car = await Car.findById(rawCar._id).setOptions({ skipTenantFilter: true });
      if (!car) return;
      await syncCarLocationHierarchy(car);
    });
  }

  const requests = await Request.find({})
    .setOptions({ skipTenantFilter: true })
    .select('_id tenantId car branchId stateId cityId locationId')
    .lean();

  for (const rawRequest of requests) {
    const tenantId = toObjectIdString(rawRequest?.tenantId);
    await runWithTenantContext({ tenantId }, async () => {
      const request = await Request.findById(rawRequest._id).setOptions({ skipTenantFilter: true });
      if (!request) return;
      await syncRequestLocationHierarchy(request, { carId: rawRequest?.car || null });
    });
  }

  const bookings = await Booking.find({})
    .setOptions({ skipTenantFilter: true })
    .select('_id tenantId car branchId stateId cityId locationId')
    .lean();

  for (const rawBooking of bookings) {
    const tenantId = toObjectIdString(rawBooking?.tenantId);
    await runWithTenantContext({ tenantId }, async () => {
      const booking = await Booking.findById(rawBooking._id).setOptions({ skipTenantFilter: true });
      if (!booking) return;
      await syncBookingLocationHierarchy(booking, { carId: rawBooking?.car || null });
    });
  }
};

module.exports = {
  normalizeName,
  normalizeKey,
  toObjectIdString,
  toObjectId,
  ensureStateDocument,
  ensureCityDocument,
  ensureLocationDocument,
  ensureBranchServiceCityDocuments,
  syncBranchLocationHierarchy,
  syncCarLocationHierarchy,
  syncRequestLocationHierarchy,
  syncBookingLocationHierarchy,
  bootstrapLocationHierarchy,
};
