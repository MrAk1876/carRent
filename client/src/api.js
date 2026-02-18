import axios from "axios";
import { notifyError } from "./utils/messageBus";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";
const STATIC_TENANT_CODE = String(import.meta.env.VITE_TENANT_CODE || "").trim();
const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS || 25000);
const MAX_RETRY_COUNT = Number(import.meta.env.VITE_API_RETRY_COUNT || 2);
const RETRY_BASE_DELAY_MS = Number(import.meta.env.VITE_API_RETRY_DELAY_MS || 450);
const GET_CACHE_DEFAULT_TTL_MS = Number(import.meta.env.VITE_API_CACHE_TTL_MS || 0);
const GET_CACHE_MAX_ENTRIES = Math.max(Number(import.meta.env.VITE_API_CACHE_MAX || 250), 50);
const RETRYABLE_METHODS = new Set(["get", "head", "options"]);
const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

const GET_RESPONSE_CACHE = new Map();
const IN_FLIGHT_GET_REQUESTS = new Map();

const API = axios.create({
  baseURL: API_BASE_URL,
  timeout: REQUEST_TIMEOUT_MS,
});

const wait = (durationMs) =>
  new Promise((resolve) => {
    setTimeout(resolve, Math.max(Number(durationMs) || 0, 0));
  });

const stableSerialize = (value) => {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${key}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return String(value);
};

const getCurrentAuthToken = () => String(localStorage.getItem("token") || "").trim();

const getActiveTenantCode = () => {
  try {
    const rawUser = localStorage.getItem("user");
    const parsedUser = rawUser ? JSON.parse(rawUser) : null;
    return String(parsedUser?.tenantCode || STATIC_TENANT_CODE).trim();
  } catch {
    return STATIC_TENANT_CODE;
  }
};

const normalizeCacheTtl = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.max(Number(fallback) || 0, 0);
  return Math.round(parsed);
};

const buildGetCacheKey = (url, config = {}) => {
  const normalizedUrl = String(url || "");
  const normalizedParams = stableSerialize(config?.params || {});
  const normalizedTenant = getActiveTenantCode();
  const authToken = getCurrentAuthToken();
  return [
    "GET",
    normalizedUrl,
    `params:${normalizedParams}`,
    `tenant:${normalizedTenant}`,
    `auth:${authToken}`,
  ].join("|");
};

const pruneExpiredCacheEntries = () => {
  const now = Date.now();
  for (const [key, entry] of GET_RESPONSE_CACHE.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      GET_RESPONSE_CACHE.delete(key);
    }
  }
};

const enforceCacheLimit = () => {
  if (GET_RESPONSE_CACHE.size <= GET_CACHE_MAX_ENTRIES) return;
  const removableKeys = Array.from(GET_RESPONSE_CACHE.keys()).slice(0, GET_RESPONSE_CACHE.size - GET_CACHE_MAX_ENTRIES);
  removableKeys.forEach((key) => GET_RESPONSE_CACHE.delete(key));
};

const clearApiGetCache = () => {
  GET_RESPONSE_CACHE.clear();
};

const isRetriableError = (error) => {
  const statusCode = Number(error?.response?.status || 0);
  const code = String(error?.code || "").toUpperCase();

  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || code === "ERR_NETWORK") {
    return true;
  }

  if (!error?.response) return true;
  if ([408, 425, 429, 500, 502, 503, 504].includes(statusCode)) return true;
  return false;
};

API.interceptors.request.use((req) => {
  const method = String(req?.method || "get").toLowerCase();
  if (MUTATION_METHODS.has(method)) {
    clearApiGetCache();
  }

  const token = getCurrentAuthToken();
  if (token) {
    req.headers.Authorization = `Bearer ${token}`;
  }

  const tenantCode = getActiveTenantCode();
  if (tenantCode) {
    req.headers["x-tenant-code"] = tenantCode;
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
    if (normalizedRaw.includes("tenant") && normalizedRaw.includes("suspend")) {
      return rawMessage || "Tenant account is suspended.";
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
    if (String(error?.code || "").toUpperCase() === "ERR_CANCELED") {
      return Promise.reject(error);
    }

    const requestConfig = error?.config || {};
    const method = String(requestConfig?.method || "get").toLowerCase();
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

const originalGet = API.get.bind(API);

API.get = (url, config = {}) => {
  const requestConfig = config && typeof config === "object" ? { ...config } : {};
  const dedupeEnabled = requestConfig?.dedupe !== false;
  const forceRefresh = requestConfig?.forceRefresh === true;
  const cacheTtlMs = forceRefresh
    ? 0
    : normalizeCacheTtl(requestConfig?.cacheTtlMs, GET_CACHE_DEFAULT_TTL_MS);
  const cacheEnabled = cacheTtlMs > 0;
  const cacheKey = buildGetCacheKey(url, requestConfig);

  delete requestConfig.dedupe;
  delete requestConfig.forceRefresh;
  delete requestConfig.cacheTtlMs;

  if (cacheEnabled) {
    pruneExpiredCacheEntries();
    const cachedEntry = GET_RESPONSE_CACHE.get(cacheKey);
    if (cachedEntry && Number(cachedEntry.expiresAt || 0) > Date.now()) {
      return Promise.resolve(cachedEntry.response);
    }
  }

  if (dedupeEnabled && IN_FLIGHT_GET_REQUESTS.has(cacheKey)) {
    return IN_FLIGHT_GET_REQUESTS.get(cacheKey);
  }

  const requestPromise = originalGet(url, requestConfig)
    .then((response) => {
      if (cacheEnabled) {
        GET_RESPONSE_CACHE.set(cacheKey, {
          response,
          expiresAt: Date.now() + cacheTtlMs,
        });
        enforceCacheLimit();
      }
      return response;
    })
    .finally(() => {
      IN_FLIGHT_GET_REQUESTS.delete(cacheKey);
    });

  if (dedupeEnabled) {
    IN_FLIGHT_GET_REQUESTS.set(cacheKey, requestPromise);
  }

  return requestPromise;
};

API.getCached = (url, config = {}) =>
  API.get(url, {
    ...config,
    dedupe: config?.dedupe !== false,
    cacheTtlMs: normalizeCacheTtl(config?.cacheTtlMs, GET_CACHE_DEFAULT_TTL_MS),
  });

export const getErrorMessage = (error, fallback = "Something went wrong. Please try again.") => {
  return (
    error?.friendlyMessage ||
    error?.response?.data?.message ||
    error?.message ||
    fallback
  );
};

export const clearGetRequestCache = () => {
  clearApiGetCache();
  IN_FLIGHT_GET_REQUESTS.clear();
};

export default API;
