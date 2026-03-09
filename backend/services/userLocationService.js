const mongoose = require('mongoose');
const State = require('../models/State');
const City = require('../models/City');
const Location = require('../models/Location');

const createHttpError = (message, status = 400) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const toObjectIdString = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (mongoose.isValidObjectId(value)) return String(value);
  if (value?._id && mongoose.isValidObjectId(value._id)) return String(value._id);
  return '';
};

const extractResolvedLocation = (value) => {
  if (value && typeof value === 'object' && value._id) {
    return {
      _id: toObjectIdString(value._id),
      name: String(value.name || '').trim(),
    };
  }

  return null;
};

const resolveUserLocationSelection = async ({
  stateId,
  cityId,
  locationId,
  required = false,
  activeOnly = true,
} = {}) => {
  const normalizedStateId = toObjectIdString(stateId);
  const normalizedCityId = toObjectIdString(cityId);
  const normalizedLocationId = toObjectIdString(locationId);

  if (!normalizedStateId || !normalizedCityId || (required && !normalizedLocationId)) {
    if (required) {
      throw createHttpError('State, city, and pickup location are required', 422);
    }

    return { state: null, city: null, location: null };
  }

  if (!mongoose.Types.ObjectId.isValid(normalizedStateId)) {
    throw createHttpError('Invalid stateId', 422);
  }

  if (!mongoose.Types.ObjectId.isValid(normalizedCityId)) {
    throw createHttpError('Invalid cityId', 422);
  }

  if (normalizedLocationId && !mongoose.Types.ObjectId.isValid(normalizedLocationId)) {
    throw createHttpError('Invalid locationId', 422);
  }

  const [state, city, location] = await Promise.all([
    State.findById(normalizedStateId),
    City.findById(normalizedCityId).populate('stateId', 'name isActive'),
    normalizedLocationId
      ? Location.findById(normalizedLocationId).populate('cityId', 'name stateId isActive')
      : null,
  ]);

  if (!state || (activeOnly && state.isActive === false)) {
    throw createHttpError('Selected state is not available', 422);
  }

  if (!city || (activeOnly && city.isActive === false)) {
    throw createHttpError('Selected city is not available', 422);
  }

  const cityStateId = toObjectIdString(city?.stateId?._id || city?.stateId);
  if (cityStateId !== normalizedStateId) {
    throw createHttpError('Selected city does not belong to the selected state', 422);
  }

  if (normalizedLocationId) {
    if (!location || (activeOnly && location.isActive === false)) {
      throw createHttpError('Selected pickup location is not available', 422);
    }

    const locationCityId = toObjectIdString(location?.cityId?._id || location?.cityId);
    const locationStateId =
      toObjectIdString(location?.stateId) ||
      toObjectIdString(location?.cityId?.stateId?._id || location?.cityId?.stateId);

    if (locationCityId !== normalizedCityId) {
      throw createHttpError('Selected pickup location does not belong to the selected city', 422);
    }

    if (locationStateId && locationStateId !== normalizedStateId) {
      throw createHttpError('Selected pickup location does not belong to the selected state', 422);
    }
  }

  return { state, city, location: location || null };
};

const loadUserLocationSelection = async (user) => {
  if (!user) {
    return { state: null, city: null, location: null };
  }

  const resolvedState = extractResolvedLocation(user.stateId);
  const resolvedCity = extractResolvedLocation(user.cityId);
  const resolvedLocation = extractResolvedLocation(user.locationId);

  if (resolvedState && resolvedCity && resolvedLocation) {
    return {
      state: resolvedState,
      city: resolvedCity,
      location: resolvedLocation,
    };
  }

  const stateId = toObjectIdString(user.stateId);
  const cityId = toObjectIdString(user.cityId);
  const locationId = toObjectIdString(user.locationId);
  if (!stateId && !cityId && !locationId) {
    return { state: null, city: null, location: null };
  }

  const [state, city, location] = await Promise.all([
    stateId ? State.findById(stateId).lean() : null,
    cityId ? City.findById(cityId).lean() : null,
    locationId ? Location.findById(locationId).lean() : null,
  ]);

  return {
    state: state
      ? {
          _id: toObjectIdString(state._id),
          name: String(state.name || '').trim(),
        }
      : null,
    city: city
      ? {
          _id: toObjectIdString(city._id),
          name: String(city.name || '').trim(),
        }
      : null,
    location: location
      ? {
          _id: toObjectIdString(location._id),
          name: String(location.name || '').trim(),
        }
      : null,
  };
};

const buildUserLocationPayload = async (user, options = {}) => {
  const resolvedState =
    extractResolvedLocation(options.state) ||
    extractResolvedLocation(options?.location?.state) ||
    null;
  const resolvedCity =
    extractResolvedLocation(options.city) ||
    extractResolvedLocation(options?.location?.city) ||
    null;
  const resolvedLocation = extractResolvedLocation(options.location) || null;

  const fallbackLocation =
    resolvedState && resolvedCity && resolvedLocation
      ? {
          state: resolvedState,
          city: resolvedCity,
          location: resolvedLocation,
        }
      : await loadUserLocationSelection(user);

  return {
    stateId: toObjectIdString(fallbackLocation?.state?._id || user?.stateId),
    cityId: toObjectIdString(fallbackLocation?.city?._id || user?.cityId),
    locationId: toObjectIdString(fallbackLocation?.location?._id || user?.locationId),
    stateName: String(fallbackLocation?.state?.name || '').trim(),
    cityName: String(fallbackLocation?.city?.name || '').trim(),
    locationName: String(fallbackLocation?.location?.name || '').trim(),
  };
};

module.exports = {
  resolveUserLocationSelection,
  loadUserLocationSelection,
  buildUserLocationPayload,
  toObjectIdString,
};
