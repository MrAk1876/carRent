const { toObjectIdString } = require('./userLocationService');

const LOCATION_MISMATCH_TYPES = Object.freeze({
  NONE: 'NONE',
  OTHER_LOCATION: 'OTHER_LOCATION',
  OTHER_CITY: 'OTHER_CITY',
  OTHER_STATE: 'OTHER_STATE',
});

const normalizeText = (value) => String(value || '').trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();

const buildLocationLabel = (locationName, cityName, stateName) =>
  [normalizeText(locationName), normalizeText(cityName), normalizeText(stateName)].filter(Boolean).join(', ');

const buildUserLocationSnapshot = (payload = {}) => ({
  customerStateId: toObjectIdString(payload?.stateId) || null,
  customerCityId: toObjectIdString(payload?.cityId) || null,
  customerLocationId: toObjectIdString(payload?.locationId) || null,
  customerStateName: normalizeText(payload?.stateName),
  customerCityName: normalizeText(payload?.cityName),
  customerLocationName: normalizeText(payload?.locationName),
});

const resolveLocationMismatch = ({
  customerStateId,
  customerCityId,
  customerLocationId,
  customerStateName,
  customerCityName,
  customerLocationName,
  pickupStateId,
  pickupCityId,
  pickupLocationId,
  pickupStateName,
  pickupCityName,
  pickupLocationName,
} = {}) => {
  const normalizedCustomerStateId = toObjectIdString(customerStateId);
  const normalizedCustomerCityId = toObjectIdString(customerCityId);
  const normalizedCustomerLocationId = toObjectIdString(customerLocationId);
  const normalizedPickupStateId = toObjectIdString(pickupStateId);
  const normalizedPickupCityId = toObjectIdString(pickupCityId);
  const normalizedPickupLocationId = toObjectIdString(pickupLocationId);
  const customerStateKey = normalizeKey(customerStateName);
  const customerCityKey = normalizeKey(customerCityName);
  const customerLocationKey = normalizeKey(customerLocationName);
  const pickupStateKey = normalizeKey(pickupStateName);
  const pickupCityKey = normalizeKey(pickupCityName);
  const pickupLocationKey = normalizeKey(pickupLocationName);

  const hasCustomerState = Boolean(normalizedCustomerStateId || customerStateKey);
  const hasPickupState = Boolean(normalizedPickupStateId || pickupStateKey);
  const hasCustomerCity = Boolean(normalizedCustomerCityId || customerCityKey);
  const hasPickupCity = Boolean(normalizedPickupCityId || pickupCityKey);
  const hasCustomerLocation = Boolean(normalizedCustomerLocationId || customerLocationKey);
  const hasPickupLocation = Boolean(normalizedPickupLocationId || pickupLocationKey);

  const customerLocationLabel = buildLocationLabel(customerLocationName, customerCityName, customerStateName);
  const pickupLocationLabel = buildLocationLabel(pickupLocationName, pickupCityName, pickupStateName);

  const isDifferentState =
    hasCustomerState &&
    hasPickupState &&
    ((normalizedCustomerStateId && normalizedPickupStateId && normalizedCustomerStateId !== normalizedPickupStateId) ||
      (!normalizedCustomerStateId || !normalizedPickupStateId ? customerStateKey !== pickupStateKey : false));

  if (isDifferentState) {
    return {
      type: LOCATION_MISMATCH_TYPES.OTHER_STATE,
      message:
        customerLocationLabel && pickupLocationLabel
          ? `You are booking a car from another state. Your location is ${customerLocationLabel}, but this pickup is in ${pickupLocationLabel}.`
          : 'You are booking a car from another state.',
    };
  }

  const isDifferentCity =
    hasCustomerCity &&
    hasPickupCity &&
    ((normalizedCustomerCityId && normalizedPickupCityId && normalizedCustomerCityId !== normalizedPickupCityId) ||
      (!normalizedCustomerCityId || !normalizedPickupCityId ? customerCityKey !== pickupCityKey : false));

  if (isDifferentCity) {
    return {
      type: LOCATION_MISMATCH_TYPES.OTHER_CITY,
      message:
        customerLocationLabel && pickupLocationLabel
          ? `You are booking a car from another city. Your location is ${customerLocationLabel}, but this pickup is in ${pickupLocationLabel}.`
          : 'You are booking a car from another city.',
    };
  }

  const isDifferentLocation =
    hasCustomerLocation &&
    hasPickupLocation &&
    ((normalizedCustomerLocationId &&
      normalizedPickupLocationId &&
      normalizedCustomerLocationId !== normalizedPickupLocationId) ||
      (!normalizedCustomerLocationId || !normalizedPickupLocationId
        ? customerLocationKey !== pickupLocationKey
        : false));

  if (isDifferentLocation) {
    return {
      type: LOCATION_MISMATCH_TYPES.OTHER_LOCATION,
      message:
        customerLocationLabel && pickupLocationLabel
          ? `You are booking a car from another pickup location. Your location is ${customerLocationLabel}, but this pickup is in ${pickupLocationLabel}.`
          : 'You are booking a car from another pickup location.',
    };
  }

  return {
    type: LOCATION_MISMATCH_TYPES.NONE,
    message: '',
  };
};

const buildLocationAlertSnapshot = ({
  userLocation = {},
  pickupLocation = {},
} = {}) => {
  const snapshot = buildUserLocationSnapshot(userLocation);
  const alert = resolveLocationMismatch({
    ...snapshot,
    pickupStateId: pickupLocation?.stateId,
    pickupCityId: pickupLocation?.cityId,
    pickupLocationId: pickupLocation?.locationId,
    pickupStateName: pickupLocation?.stateName,
    pickupCityName: pickupLocation?.cityName,
    pickupLocationName: pickupLocation?.locationName,
  });

  return {
    ...snapshot,
    locationMismatchType: alert.type,
    locationMismatchMessage: alert.message,
  };
};

module.exports = {
  LOCATION_MISMATCH_TYPES,
  buildUserLocationSnapshot,
  resolveLocationMismatch,
  buildLocationAlertSnapshot,
};
