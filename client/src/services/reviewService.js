import API from '../api';

export const getPublicReviews = async (limit = 3) => {
  const response = await API.get(`/reviews/public?limit=${limit}`);
  return Array.isArray(response.data) ? response.data : [];
};

export const getCarReviews = async (carId) => {
  const response = await API.get(`/reviews/car/${carId}`);
  return Array.isArray(response.data) ? response.data : [];
};
