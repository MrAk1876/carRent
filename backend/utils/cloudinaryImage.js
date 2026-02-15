const cloudinary = require('../config/cloudinary');

const REQUIRED_CLOUDINARY_ENV_KEYS = [
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
];
const RETRYABLE_STATUS_CODES = new Set([408, 429, 499, 500, 502, 503, 504]);
const DEFAULT_UPLOAD_TIMEOUT_MS = 120000;
const DEFAULT_UPLOAD_RETRY_COUNT = 2;

const assertCloudinaryConfigured = () => {
  const missingKeys = REQUIRED_CLOUDINARY_ENV_KEYS.filter(
    (key) => !String(process.env[key] || '').trim()
  );

  if (missingKeys.length > 0) {
    throw new Error(`Cloudinary configuration missing: ${missingKeys.join(', ')}`);
  }
};

const toPositiveNumber = (value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number;
};

const toNonNegativeInteger = (value, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableCloudinaryError = (error) => {
  if (!error) return false;

  const httpCode = Number(error.http_code || error.statusCode || 0);
  if (RETRYABLE_STATUS_CODES.has(httpCode)) return true;

  const code = String(error.code || '').toUpperCase();
  if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'EAI_AGAIN') {
    return true;
  }

  const name = String(error.name || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();
  return (
    name.includes('timeout') ||
    message.includes('timeout') ||
    message.includes('timed out')
  );
};

const createUploadError = (error) => {
  const timeoutLikeError = isRetryableCloudinaryError(error);
  const wrappedError = new Error(
    timeoutLikeError
      ? 'Image upload timed out. Please try again.'
      : 'Image upload failed. Please try again.'
  );

  wrappedError.name = 'CloudinaryUploadError';
  wrappedError.statusCode = timeoutLikeError ? 504 : 503;
  wrappedError.originalError = error;
  return wrappedError;
};

const uploadBufferWithCloudinary = (buffer, uploadOptions) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    });

    stream.on('error', reject);
    stream.end(buffer);
  });
};

const uploadImageFromBuffer = async (file, options = {}) => {
  if (!file || !file.buffer) {
    throw new Error('Image file buffer is required');
  }

  assertCloudinaryConfigured();

  const uploadTimeout = toPositiveNumber(
    process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS,
    DEFAULT_UPLOAD_TIMEOUT_MS
  );
  const maxRetries = toNonNegativeInteger(
    process.env.CLOUDINARY_UPLOAD_MAX_RETRIES,
    DEFAULT_UPLOAD_RETRY_COUNT
  );
  const uploadOptions = {
    folder: options.folder || 'car-rental',
    resource_type: 'image',
    timeout: uploadTimeout,
    ...options,
  };

  let attempt = 0;
  let lastError = null;
  while (attempt <= maxRetries) {
    try {
      const uploadResult = await uploadBufferWithCloudinary(file.buffer, uploadOptions);

      if (!uploadResult?.secure_url || !uploadResult?.public_id) {
        throw new Error('Cloudinary upload did not return expected image data');
      }

      return {
        url: uploadResult.secure_url,
        publicId: uploadResult.public_id,
      };
    } catch (error) {
      lastError = error;
      const shouldRetry = attempt < maxRetries && isRetryableCloudinaryError(error);
      if (!shouldRetry) {
        break;
      }

      const backoffDelayMs = 500 * (attempt + 1);
      await wait(backoffDelayMs);
      attempt += 1;
    }
  }

  throw createUploadError(lastError);
};

const deleteImageByPublicId = async (publicId) => {
  if (!publicId) return false;

  assertCloudinaryConfigured();

  const uploadTimeout = toPositiveNumber(
    process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS,
    DEFAULT_UPLOAD_TIMEOUT_MS
  );
  const result = await cloudinary.uploader.destroy(publicId, {
    resource_type: 'image',
    invalidate: true,
    timeout: uploadTimeout,
  });

  if (!result || !result.result) return false;
  return result.result === 'ok' || result.result === 'not found';
};

module.exports = {
  uploadImageFromBuffer,
  deleteImageByPublicId,
};
