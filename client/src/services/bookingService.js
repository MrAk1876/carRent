import API from '../api';

export const getUserRentalDashboard = async (config = {}) => {
  const response = await API.get('/user/dashboard', config);
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

const parseFileNameFromDisposition = (dispositionValue, fallbackName) => {
  const rawValue = String(dispositionValue || '');
  if (!rawValue) return fallbackName;

  const utf8Match = rawValue.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim().replace(/^["']|["']$/g, ''));
    } catch {
      // Continue with basic filename parsing below.
    }
  }

  const basicMatch = rawValue.match(/filename="?([^";]+)"?/i);
  if (basicMatch?.[1]) {
    return basicMatch[1].trim();
  }

  return fallbackName;
};

export const downloadBookingInvoicePdf = async (bookingId) => {
  const fallbackName = `invoice-${String(bookingId || 'booking')}.pdf`;
  const response = await API.get(`/invoice/${bookingId}`, {
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
