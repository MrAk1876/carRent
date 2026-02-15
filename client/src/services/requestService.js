import API from '../api';

export const createBookingRequest = async ({ carId, fromDate, toDate }) => {
  const response = await API.post('/requests', {
    carId,
    fromDate,
    toDate,
  });

  return response.data;
};
