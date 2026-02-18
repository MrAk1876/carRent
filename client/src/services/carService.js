import API from '../api';

export const getCars = async () => {
  const response = await API.get('/cars');
  return Array.isArray(response.data) ? response.data : [];
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
    citiesByState:
      payload.citiesByState && typeof payload.citiesByState === 'object' ? payload.citiesByState : {},
  };
};
