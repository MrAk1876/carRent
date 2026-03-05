import API from '../api';

export const getAdminDepositRules = async () => {
  const response = await API.get('/admin/deposit-rules');
  return Array.isArray(response?.data?.rules) ? response.data.rules : [];
};

export const createAdminDepositRule = async (payload = {}) => {
  const response = await API.post('/admin/deposit-rules', payload);
  return response?.data || {};
};

export const updateAdminDepositRule = async (ruleId, payload = {}) => {
  const response = await API.put(`/admin/deposit-rules/${ruleId}`, payload);
  return response?.data || {};
};

export const deleteAdminDepositRule = async (ruleId) => {
  const response = await API.delete(`/admin/deposit-rules/${ruleId}`);
  return response?.data || {};
};
