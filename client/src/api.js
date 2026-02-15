import axios from "axios";
import { notifyError } from "./utils/messageBus";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

const API = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
});

API.interceptors.request.use((req) => {
  const token = localStorage.getItem("token");
  if (token) {
    req.headers.Authorization = `Bearer ${token}`;
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
  if (statusCode === 403) return "You do not have permission to perform this action.";
  if (statusCode === 404) return "The requested resource was not found.";
  if (statusCode >= 500) return "Server error. Please try again in a moment.";

  if (rawMessage) return rawMessage;
  return "Something went wrong. Please try again.";
};

API.interceptors.response.use(
  (response) => response,
  (error) => {
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
