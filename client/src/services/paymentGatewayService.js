import API from '../api';

export const createPaymentSession = async ({ bookingId, paymentOption } = {}) => {
  const response = await API.post('/payments/sessions', { bookingId, paymentOption });
  return response.data;
};

export const getPaymentSession = async (token) => {
  const response = await API.get(`/payments/sessions/${token}`, { cacheTtlMs: 0, dedupe: false });
  return response.data;
};

export const sendPaymentOtp = async (token, mobileNumber) => {
  const response = await API.post(`/payments/sessions/${token}/send-otp`, { mobileNumber });
  return response.data;
};

export const verifyPaymentOtp = async (token, otp) => {
  const response = await API.post(`/payments/sessions/${token}/verify-otp`, { otp });
  return response.data;
};

export const completePaymentSession = async (token, paymentMethod) => {
  const response = await API.post(`/payments/sessions/${token}/pay`, { paymentMethod });
  return response.data;
};
