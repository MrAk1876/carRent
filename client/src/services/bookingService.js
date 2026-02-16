import API from '../api';

export const getUserRentalDashboard = async () => {
  const response = await API.get('/user/dashboard');
  const data = response.data || {};

  return {
    requests: Array.isArray(data.requests) ? data.requests : [],
    bookings: Array.isArray(data.bookings) ? data.bookings : [],
  };
};

export const settleUserBookingReturn = async (bookingId, paymentMethod = 'UPI') => {
  const response = await API.put(`/user/bookings/${bookingId}/return`, {
    paymentMethod,
  });

  return response.data;
};

