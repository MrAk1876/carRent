  import axios from "axios";
  import { notifyError } from "./utils/messageBus";

  const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
  const STATIC_TENANT_CODE = String(import.meta.env.VITE_TENANT_CODE || '').trim();
  const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 25000);
  const MAX_RETRY_COUNT = Number(import.meta.env.VITE_API_RETRY_COUNT || 2);
  const RETRY_BASE_DELAY_MS = Number(import.meta.env.VITE_API_RETRY_DELAY_MS || 450);
  const RETRYABLE_METHODS = new Set(['get', 'head', 'options']);

  const API = axios.create({
    baseURL: API_BASE_URL,
    timeout: REQUEST_TIMEOUT_MS,
  });

  const wait = (durationMs) =>
    new Promise((resolve) => {
      setTimeout(resolve, Math.max(Number(durationMs) || 0, 0));
    });

  const isRetriableError = (error) => {
    const statusCode = Number(error?.response?.status || 0);
    const code = String(error?.code || '').toUpperCase();

    if (code === 'ECONNABORTED' || code === 'ETIMEDOUT' || code === 'ERR_NETWORK') {
      return true;
    }

    if (!error?.response) return true;
    if ([408, 425, 429, 500, 502, 503, 504].includes(statusCode)) return true;
    return false;
  };

  API.interceptors.request.use((req) => {
    const token = localStorage.getItem("token");
    if (token) {
      req.headers.Authorization = `Bearer ${token}`;
    }

    try {
      const rawUser = localStorage.getItem('user');
      const parsedUser = rawUser ? JSON.parse(rawUser) : null;
      const tenantCode = String(parsedUser?.tenantCode || STATIC_TENANT_CODE).trim();
      if (tenantCode) {
        req.headers['x-tenant-code'] = tenantCode;
      }
    } catch {
      // no-op
    }

    return req;
  });

  const normalizeApiErrorMessage = (error) => {
    if (!error) return "Something went wrong. Please try again.";

    const rawMessage = String(error?.response?.data?.message || error?.message || "").trim();
    const normalizedRaw = rawMessage.toLowerCase();
    const statusCode = Number(error?.response?.status || 0);

    if (error?.code === "ECONNABORTED") {
      return "Request timed out. Please try again.";
    }

    if (!error?.response) {
      return "Unable to connect to server. Check your internet connection and try again.";
    }

    if (
      normalizedRaw.includes("no token") ||
      normalizedRaw.includes("not authorized") ||
      normalizedRaw.includes("unauthorized")
    ) {
      return "Please log in to continue.";
    }

    if (
      normalizedRaw.includes("jwt") ||
      normalizedRaw.includes("token expired") ||
      normalizedRaw.includes("invalid token")
    ) {
      return "Your session has expired. Please log in again.";
    }

    if (statusCode === 401) return "Please log in to continue.";
    if (statusCode === 403) {
      if (normalizedRaw.includes('tenant') && normalizedRaw.includes('suspend')) {
        return rawMessage || 'Tenant account is suspended.';
      }
      return "You do not have permission to perform this action.";
    }
    if (statusCode === 404) return "The requested resource was not found.";
    if (statusCode >= 500) return "Server error. Please try again in a moment.";

    if (rawMessage) return rawMessage;
    return "Something went wrong. Please try again.";
  };

  API.interceptors.response.use(
    (response) => response,
    async (error) => {
      if (String(error?.code || '').toUpperCase() === 'ERR_CANCELED') {
        return Promise.reject(error);
      }

      const requestConfig = error?.config || {};
      const method = String(requestConfig?.method || 'get').toLowerCase();
      const canRetryMethod = RETRYABLE_METHODS.has(method);
      const retryEnabled = requestConfig?.retry !== false && canRetryMethod;
      const maxRetries = Number.isFinite(Number(requestConfig?.maxRetries))
        ? Math.max(Number(requestConfig.maxRetries), 0)
        : Math.max(MAX_RETRY_COUNT, 0);
      const retryCount = Number(requestConfig.__retryCount || 0);

      if (retryEnabled && isRetriableError(error) && retryCount < maxRetries) {
        const delayMs = RETRY_BASE_DELAY_MS * 2 ** retryCount;
        requestConfig.__retryCount = retryCount + 1;
        await wait(delayMs);
        return API(requestConfig);
      }

      const message = normalizeApiErrorMessage(error);
      error.friendlyMessage = message;

      if (error?.response?.data && typeof error.response.data === "object") {
        error.response.data.message = message;
      }

      if (error?.config?.showErrorToast !== false) {
        notifyError(message);
      }

      return Promise.reject(error);
    },
  );

  export const getErrorMessage = (error, fallback = "Something went wrong. Please try again.") => {
    return (
      error?.friendlyMessage ||
      error?.response?.data?.message ||
      error?.message ||
      fallback
    );
  };

  export default API;
