import API from '../api';

const FALLBACK_THRESHOLD = 5;

const normalizeText = (value) => String(value || '').trim();
const normalizeKey = (value) => normalizeText(value).toLowerCase();
const normalizeId = (value) => {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (value?._id) return String(value._id).trim();
  return '';
};

const getBranch = (car) => (car?.branchId && typeof car.branchId === 'object' ? car.branchId : null);
const getLocationDoc = (car) => (car?.locationId && typeof car.locationId === 'object' ? car.locationId : null);
const buildAddress = (...parts) =>
  parts
    .map(normalizeText)
    .filter(Boolean)
    .filter((part, index, arr) => arr.indexOf(part) === index)
    .join(', ');

const dedupeCars = (cars = []) => {
  const seen = new Set();
  return (cars || []).filter((car) => {
    const carId = normalizeId(car?._id);
    if (!carId || seen.has(carId)) return false;
    seen.add(carId);
    return true;
  });
};

export const getCars = async (params = {}) => {
  const response = await API.get('/cars', {
    params,
    showErrorToast: false,
  });
  return Array.isArray(response.data) ? response.data : [];
};

export const getCarPickupSummary = (car = {}) => {
  const branch = getBranch(car);
  const location = getLocationDoc(car);
  const pickupStateId = normalizeId(location?.stateId || car?.stateId || branch?.stateId);
  const pickupCityId = normalizeId(location?.cityId || car?.cityId || branch?.cityId);
  const pickupLocationId = normalizeId(location?._id || car?.locationId);
  const pickupStateName = normalizeText(location?.stateId?.name || car?.state || branch?.stateId?.name || branch?.state);
  const pickupCityName = normalizeText(location?.cityId?.name || car?.city || branch?.cityId?.name || branch?.city);
  const pickupLocationName = normalizeText(location?.name || car?.location || pickupCityName);
  const pickupBranchName =
    normalizeText(branch?.branchName || branch?.branchCode || pickupLocationName) || 'Assigned Branch';
  const pickupAddress =
    normalizeText(car?.pickupAddress) ||
    normalizeText(location?.branchAddress) ||
    buildAddress(branch?.address, pickupLocationName, pickupCityName, pickupStateName) ||
    'Branch address will be shared at confirmation.';

  return {
    pickupStateId,
    pickupCityId,
    pickupLocationId,
    pickupStateName,
    pickupCityName,
    pickupLocationName,
    pickupBranchName,
    pickupAddress,
  };
};

export const annotateCarsWithUserLocation = (cars = [], userLocation = {}) => {
  const userStateId = normalizeId(userLocation?.stateId);
  const userCityId = normalizeId(userLocation?.cityId);
  const userLocationId = normalizeId(userLocation?.locationId);
  const userStateName = normalizeText(userLocation?.stateName);
  const userCityName = normalizeText(userLocation?.cityName);
  const userLocationName = normalizeText(userLocation?.locationName);

  return (cars || []).map((car) => {
    const pickup = getCarPickupSummary(car);
    const sameState = userStateId
      ? pickup.pickupStateId === userStateId
      : userStateName
        ? normalizeKey(pickup.pickupStateName) === normalizeKey(userStateName)
        : false;
    const sameCity = userCityId
      ? pickup.pickupCityId === userCityId
      : userCityName
        ? normalizeKey(pickup.pickupCityName) === normalizeKey(userCityName)
        : false;
    const sameLocation = userLocationId
      ? pickup.pickupLocationId === userLocationId
      : userLocationName
        ? normalizeKey(pickup.pickupLocationName) === normalizeKey(userLocationName)
        : false;

    let locationWarningBadge = '';
    let locationWarningText = '';
    if (sameCity && !sameLocation) {
      locationWarningBadge = 'Not in your pickup location';
      locationWarningText = 'This car is in your city but outside your default pickup location.';
    } else if (!sameCity) {
      locationWarningBadge = 'Not in your city';
      locationWarningText = sameState
        ? 'This car is in another city within your state.'
        : 'This car is in another city and state.';
    }

    return {
      ...car,
      ...pickup,
      isLocalLocation: sameLocation,
      isCityFallback: sameCity && !sameLocation,
      isStateFallback: !sameCity && sameState,
      isFallbackLocation: Boolean(locationWarningBadge),
      locationWarningBadge,
      locationWarningText,
    };
  });
};

const splitCarsByHierarchy = (cars = [], userLocation = {}) => {
  const annotatedCars = annotateCarsWithUserLocation(cars, userLocation);
  return annotatedCars.reduce(
    (result, car) => {
      if (car.isLocalLocation) {
        result.localCars.push(car);
      } else if (car.isCityFallback) {
        result.cityFallbackCars.push(car);
      } else if (car.isStateFallback) {
        result.stateFallbackCars.push(car);
      } else {
        result.remoteFallbackCars.push(car);
      }
      return result;
    },
    { localCars: [], cityFallbackCars: [], stateFallbackCars: [], remoteFallbackCars: [] },
  );
};

export const getLocationAwareCars = async ({
  userLocation = {},
  selectedStateId = '',
  selectedCityId = '',
  selectedLocationId = '',
  allStates = false,
  fallbackThreshold = FALLBACK_THRESHOLD,
} = {}) => {
  const normalizedUserStateId = normalizeId(userLocation?.stateId);
  const normalizedUserCityId = normalizeId(userLocation?.cityId);
  const normalizedUserLocationId = normalizeId(userLocation?.locationId);
  const normalizedStateId = normalizeId(selectedStateId);
  const normalizedCityId = normalizeId(selectedCityId);
  const normalizedLocationId = normalizeId(selectedLocationId);

  if (allStates) {
    const allCars = dedupeCars(await getCars());
    const grouped = splitCarsByHierarchy(allCars, userLocation);
    const fallbackCars = [
      ...grouped.cityFallbackCars,
      ...grouped.stateFallbackCars,
      ...grouped.remoteFallbackCars,
    ];
    return { cars: [...grouped.localCars, ...fallbackCars], localCars: grouped.localCars, fallbackCars, mode: 'all' };
  }

  if (normalizedLocationId) {
    const locationCars = dedupeCars(await getCars({ locationId: normalizedLocationId }));
    const grouped = splitCarsByHierarchy(locationCars, userLocation);
    return { cars: [...grouped.localCars, ...grouped.cityFallbackCars], localCars: grouped.localCars, fallbackCars: grouped.cityFallbackCars, mode: 'location' };
  }

  if (normalizedCityId) {
    const cityCars = dedupeCars(
      await getCars({
        ...(normalizedStateId ? { stateId: normalizedStateId } : {}),
        cityId: normalizedCityId,
      }),
    );
    const grouped = splitCarsByHierarchy(cityCars, userLocation);
    const fallbackCars = [...grouped.cityFallbackCars];
    return { cars: [...grouped.localCars, ...fallbackCars], localCars: grouped.localCars, fallbackCars, mode: 'city' };
  }

  if (normalizedStateId) {
    const stateCars = dedupeCars(await getCars({ stateId: normalizedStateId }));
    const grouped = splitCarsByHierarchy(stateCars, userLocation);
    const fallbackCars = [...grouped.cityFallbackCars, ...grouped.stateFallbackCars];
    return { cars: [...grouped.localCars, ...fallbackCars], localCars: grouped.localCars, fallbackCars, mode: 'state' };
  }

  if (normalizedUserLocationId || normalizedUserCityId || normalizedUserStateId) {
    const allCars = dedupeCars(await getCars());
    const grouped = splitCarsByHierarchy(allCars, userLocation);
    const localCars = grouped.localCars;
    const cityFallbackCars = grouped.cityFallbackCars;
    const stateFallbackCars = grouped.stateFallbackCars;
    const remoteFallbackCars = grouped.remoteFallbackCars;

    const fallbackCars = [];
    if (localCars.length < Math.max(Number(fallbackThreshold) || FALLBACK_THRESHOLD, 0)) {
      fallbackCars.push(...cityFallbackCars, ...stateFallbackCars);
    }
    if (localCars.length === 0 && fallbackCars.length === 0) {
      fallbackCars.push(...remoteFallbackCars);
    }

    return {
      cars: [...localCars, ...fallbackCars],
      localCars,
      fallbackCars,
      mode: 'default',
    };
  }

  const allCars = dedupeCars(await getCars());
  const annotatedCars = annotateCarsWithUserLocation(allCars, userLocation);
  return {
    cars: annotatedCars,
    localCars: [],
    fallbackCars: annotatedCars,
    mode: 'default',
  };
};

export const getFeaturedCars = async (count = 6) => {
  const cars = await getCars();
  const shuffled = [...cars].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
};

export const getCarById = async (id) => {
  const response = await API.get(`/cars/${id}`);
  return response.data;
};

export const getCarLocations = async () => {
  const response = await API.get('/cars/locations', {
    showErrorToast: false,
    cacheTtlMs: 5 * 60 * 1000,
  });
  return Array.isArray(response.data) ? response.data : [];
};

export const getCarFilterOptions = async () => {
  const response = await API.get('/cars/filter-options', {
    showErrorToast: false,
    cacheTtlMs: 5 * 60 * 1000,
  });
  const payload = response?.data || {};

  return {
    states: Array.isArray(payload.states) ? payload.states : [],
    cities: Array.isArray(payload.cities) ? payload.cities : [],
    locations: Array.isArray(payload.locations) ? payload.locations : [],
    citiesByState:
      payload.citiesByState && typeof payload.citiesByState === 'object' ? payload.citiesByState : {},
    stateOptions: Array.isArray(payload.stateOptions) ? payload.stateOptions : [],
    cityOptions: Array.isArray(payload.cityOptions) ? payload.cityOptions : [],
    locationOptions: Array.isArray(payload.locationOptions) ? payload.locationOptions : [],
    citiesByStateId:
      payload.citiesByStateId && typeof payload.citiesByStateId === 'object' ? payload.citiesByStateId : {},
    locationsByCityId:
      payload.locationsByCityId && typeof payload.locationsByCityId === 'object' ? payload.locationsByCityId : {},
  };
};
