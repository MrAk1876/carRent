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
