import API from '../api';

const parseFileNameFromDisposition = (dispositionValue, fallbackName) => {
  const rawValue = String(dispositionValue || '');
  if (!rawValue) return fallbackName;

  const utf8Match = rawValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      // Continue to basic filename parsing.
    }
  }

  const basicMatch = rawValue.match(/filename="?([^";]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1].trim();
  }

  return fallbackName;
};

export const getSubscriptionPlans = async (params = {}) => {
  const response = await API.get('/subscriptions/plans', { params });
  return Array.isArray(response?.data?.plans) ? response.data.plans : [];
};

export const getMySubscription = async (params = {}) => {
  const response = await API.get('/subscriptions/my', { params });
  return response?.data || {
    activeSubscription: null,
    latestSubscription: null,
    subscriptions: [],
  };
};

export const purchaseSubscription = async ({
  planId,
  autoRenew = false,
  paymentMethod = 'CARD',
} = {}) => {
  const response = await API.post('/subscriptions/purchase', {
    planId,
    autoRenew: Boolean(autoRenew),
    paymentMethod,
  });
  return response?.data || {};
};

export const renewSubscription = async ({
  autoRenew = true,
  paymentMethod = 'CARD',
} = {}) => {
  const response = await API.post('/subscriptions/renew', {
    autoRenew: Boolean(autoRenew),
    paymentMethod,
  });
  return response?.data || {};
};

export const getAdminSubscriptionOverview = async (params = {}) => {
  const response = await API.get('/subscriptions/admin/overview', { params });
  const payload = response?.data || {};
  return {
    summary: payload?.summary || {},
    topPlans: Array.isArray(payload?.topPlans) ? payload.topPlans : [],
    subscriptions: Array.isArray(payload?.subscriptions) ? payload.subscriptions : [],
    plans: Array.isArray(payload?.plans) ? payload.plans : [],
    branchOptions: Array.isArray(payload?.branchOptions) ? payload.branchOptions : [],
    canManagePlans: Boolean(payload?.canManagePlans),
    pagination: payload?.pagination || { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
  };
};

export const createAdminSubscriptionPlan = async (payload = {}) => {
  const response = await API.post('/subscriptions/admin/plans', payload);
  return response?.data || {};
};

export const updateAdminSubscriptionPlan = async (planId, payload = {}) => {
  const response = await API.put(`/subscriptions/admin/plans/${planId}`, payload);
  return response?.data || {};
};

export const downloadSubscriptionInvoicePdf = async (subscriptionId) => {
  const fallbackName = `subscription-invoice-${String(subscriptionId || 'subscription')}.pdf`;
  const response = await API.get(`/subscriptions/my/${subscriptionId}/invoice`, {
    responseType: 'blob',
    showErrorToast: false,
  });

  const fileName = parseFileNameFromDisposition(response?.headers?.['content-disposition'], fallbackName);
  const sourceData = response?.data;
  const blob =
    sourceData instanceof Blob
      ? sourceData
      : new Blob([sourceData], {
          type: response?.headers?.['content-type'] || 'application/pdf',
        });

  const blobUrl = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(blobUrl);

  return {
    fileName,
  };
};
