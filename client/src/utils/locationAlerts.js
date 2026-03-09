const toText = (value) => String(value || '').trim();
const toKey = (value) => toText(value).toLowerCase();
const toId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (value?._id) return String(value._id).trim();
  return '';
};

export const LOCATION_ALERT_TYPES = Object.freeze({
  NONE: 'NONE',
  OTHER_LOCATION: 'OTHER_LOCATION',
  OTHER_CITY: 'OTHER_CITY',
  OTHER_STATE: 'OTHER_STATE',
});

export const buildLocationLabel = (locationName, cityName, stateName) =>
  [toText(locationName), toText(cityName), toText(stateName)].filter(Boolean).join(', ');

export const resolveLocationAlert = ({
  userStateId,
  userCityId,
  userLocationId,
  userStateName,
  userCityName,
  userLocationName,
  pickupStateId,
  pickupCityId,
  pickupLocationId,
  pickupStateName,
  pickupCityName,
  pickupLocationName,
} = {}) => {
  const normalizedUserStateId = toId(userStateId);
  const normalizedUserCityId = toId(userCityId);
  const normalizedUserLocationId = toId(userLocationId);
  const normalizedPickupStateId = toId(pickupStateId);
  const normalizedPickupCityId = toId(pickupCityId);
  const normalizedPickupLocationId = toId(pickupLocationId);
  const normalizedUserStateKey = toKey(userStateName);
  const normalizedUserCityKey = toKey(userCityName);
  const normalizedUserLocationKey = toKey(userLocationName);
  const normalizedPickupStateKey = toKey(pickupStateName);
  const normalizedPickupCityKey = toKey(pickupCityName);
  const normalizedPickupLocationKey = toKey(pickupLocationName);

  const userLocationLabel = buildLocationLabel(userLocationName, userCityName, userStateName);
  const pickupLocationLabel = buildLocationLabel(pickupLocationName, pickupCityName, pickupStateName);

  const hasUserState = Boolean(normalizedUserStateId || normalizedUserStateKey);
  const hasPickupState = Boolean(normalizedPickupStateId || normalizedPickupStateKey);
  const hasUserCity = Boolean(normalizedUserCityId || normalizedUserCityKey);
  const hasPickupCity = Boolean(normalizedPickupCityId || normalizedPickupCityKey);
  const hasUserLocation = Boolean(normalizedUserLocationId || normalizedUserLocationKey);
  const hasPickupLocation = Boolean(normalizedPickupLocationId || normalizedPickupLocationKey);

  const isOtherState =
    hasUserState &&
    hasPickupState &&
    ((normalizedUserStateId && normalizedPickupStateId && normalizedUserStateId !== normalizedPickupStateId) ||
      (!normalizedUserStateId || !normalizedPickupStateId
        ? normalizedUserStateKey !== normalizedPickupStateKey
        : false));

  if (isOtherState) {
    return {
      type: LOCATION_ALERT_TYPES.OTHER_STATE,
      message:
        userLocationLabel && pickupLocationLabel
          ? `This car is located in another state. Your default location is ${userLocationLabel}, but this pickup is in ${pickupLocationLabel}.`
          : 'This car is located in another state.',
    };
  }

  const isOtherCity =
    hasUserCity &&
    hasPickupCity &&
    ((normalizedUserCityId && normalizedPickupCityId && normalizedUserCityId !== normalizedPickupCityId) ||
      (!normalizedUserCityId || !normalizedPickupCityId
        ? normalizedUserCityKey !== normalizedPickupCityKey
        : false));

  if (isOtherCity) {
    return {
      type: LOCATION_ALERT_TYPES.OTHER_CITY,
      message:
        userLocationLabel && pickupLocationLabel
          ? `This car is located in another city. Your default location is ${userLocationLabel}, but this pickup is in ${pickupLocationLabel}.`
          : 'This car is located in another city.',
    };
  }

  const isOtherLocation =
    hasUserLocation &&
    hasPickupLocation &&
    ((normalizedUserLocationId &&
      normalizedPickupLocationId &&
      normalizedUserLocationId !== normalizedPickupLocationId) ||
      (!normalizedUserLocationId || !normalizedPickupLocationId
        ? normalizedUserLocationKey !== normalizedPickupLocationKey
        : false));

  if (isOtherLocation) {
    return {
      type: LOCATION_ALERT_TYPES.OTHER_LOCATION,
      message:
        userLocationLabel && pickupLocationLabel
          ? `This car is located in another pickup location. Your default location is ${userLocationLabel}, but this pickup is in ${pickupLocationLabel}.`
          : 'This car is located in another pickup location.',
    };
  }

  return {
    type: LOCATION_ALERT_TYPES.NONE,
    message: '',
  };
};

export const resolveBookingLocationAlert = (booking = {}) => {
  const branch = booking?.branchId && typeof booking.branchId === 'object' ? booking.branchId : null;
  const location = booking?.locationId && typeof booking.locationId === 'object' ? booking.locationId : null;
  const userStateName = toText(booking?.customerStateName || booking?.user?.stateId?.name || '');
  const userCityName = toText(booking?.customerCityName || booking?.user?.cityId?.name || '');
  const userLocationName = toText(booking?.customerLocationName || booking?.user?.locationId?.name || '');

  return resolveLocationAlert({
    userStateId: booking?.customerStateId || booking?.user?.stateId?._id || booking?.user?.stateId,
    userCityId: booking?.customerCityId || booking?.user?.cityId?._id || booking?.user?.cityId,
    userLocationId: booking?.customerLocationId || booking?.user?.locationId?._id || booking?.user?.locationId,
    userStateName,
    userCityName,
    userLocationName,
    pickupStateId: location?.stateId?._id || location?.stateId || branch?.stateId?._id || branch?.stateId || booking?.stateId,
    pickupCityId: location?.cityId?._id || location?.cityId || branch?.cityId?._id || branch?.cityId || booking?.cityId,
    pickupLocationId: location?._id || booking?.locationId,
    pickupStateName: location?.stateId?.name || branch?.state || '',
    pickupCityName: location?.cityId?.name || branch?.city || '',
    pickupLocationName: location?.name || '',
  });
};
