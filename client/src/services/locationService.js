import API from '../api';

export const getPublicStates = async () => {
  const response = await API.get('/locations/states', {
    showErrorToast: false,
    cacheTtlMs: 5 * 60 * 1000,
  });

  return Array.isArray(response?.data?.states) ? response.data.states : [];
};

export const getPublicCities = async (stateId = '') => {
  const response = await API.get('/locations/cities', {
    params: stateId ? { stateId } : {},
    showErrorToast: false,
    cacheTtlMs: 5 * 60 * 1000,
  });

  return Array.isArray(response?.data?.cities) ? response.data.cities : [];
};

export const getPublicLocations = async (cityId = '') => {
  const response = await API.get('/locations/locations', {
    params: cityId ? { cityId } : {},
    showErrorToast: false,
    cacheTtlMs: 5 * 60 * 1000,
  });

  return Array.isArray(response?.data?.locations) ? response.data.locations : [];
};
