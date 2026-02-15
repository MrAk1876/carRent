import API from '../api';

export const sendContactMessage = async (payload) => {
  const response = await API.post('/contact', payload);
  return response.data;
};
