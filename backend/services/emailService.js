const nodemailer = require('nodemailer');

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const toNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return numericValue;
};

const EMAIL_HOST = String(process.env.SMTP_HOST || process.env.EMAIL_HOST || '').trim();
const EMAIL_PORT = toNumber(process.env.SMTP_PORT || process.env.EMAIL_PORT, 0);
const EMAIL_USER = String(process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
const EMAIL_PASS = String(process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();
const EMAIL_FROM = String(process.env.SMTP_FROM || process.env.EMAIL_FROM || '').trim() || EMAIL_USER;
const EMAIL_POOL = toBoolean(process.env.EMAIL_POOL, true);
const EMAIL_REJECT_UNAUTHORIZED = toBoolean(process.env.EMAIL_TLS_REJECT_UNAUTHORIZED, true);

const isEmailConfigured = () => {
  return Boolean(EMAIL_HOST && EMAIL_PORT > 0 && EMAIL_USER && EMAIL_PASS && EMAIL_FROM);
};

let cachedTransporter = null;

const createTransporter = () => {
  const secure = EMAIL_PORT === 465;
  return nodemailer.createTransport({
    host: EMAIL_HOST,
    port: EMAIL_PORT,
    secure,
    requireTLS: !secure,
    auth: {
      user: EMAIL_USER,
      pass: EMAIL_PASS,
    },
    pool: EMAIL_POOL,
    maxConnections: 5,
    maxMessages: 100,
    tls: {
      minVersion: 'TLSv1.2',
      rejectUnauthorized: EMAIL_REJECT_UNAUTHORIZED,
    },
  });
};

const getTransporter = () => {
  if (!cachedTransporter) {
    cachedTransporter = createTransporter();
  }
  return cachedTransporter;
};

const resolvePayload = (payloadOrTo, subject, htmlContent, options = {}) => {
  if (payloadOrTo && typeof payloadOrTo === 'object' && !Array.isArray(payloadOrTo)) {
    return {
      to: String(payloadOrTo.to || '').trim(),
      subject: String(payloadOrTo.subject || '').trim(),
      html: String(payloadOrTo.html || '').trim(),
      text: String(payloadOrTo.text || '').trim(),
      attachments: Array.isArray(payloadOrTo.attachments) ? payloadOrTo.attachments : [],
    };
  }

  return {
    to: String(payloadOrTo || '').trim(),
    subject: String(subject || '').trim(),
    html: String(htmlContent || '').trim(),
    text: String(options.text || '').trim(),
    attachments: Array.isArray(options.attachments) ? options.attachments : [],
  };
};

const sendEmail = async (payloadOrTo = {}, subject = '', htmlContent = '', options = {}) => {
  const payload = resolvePayload(payloadOrTo, subject, htmlContent, options);
  const to = String(payload.to || '').trim();
  const emailSubject = String(payload.subject || '').trim();

  if (!to || !emailSubject) {
    return {
      sent: false,
      skipped: true,
      reason: 'missing-recipient-or-subject',
    };
  }

  if (!isEmailConfigured()) {
    return {
      sent: false,
      skipped: true,
      reason: 'email-not-configured',
    };
  }

  try {
    const transporter = getTransporter();
    const info = await transporter.sendMail({
      from: EMAIL_FROM,
      to,
      subject: emailSubject,
      html: payload.html || '',
      text: payload.text || '',
      attachments: Array.isArray(payload.attachments) ? payload.attachments : [],
    });

    return {
      sent: true,
      skipped: false,
      messageId: info?.messageId || '',
    };
  } catch (error) {
    console.error('Email send failed:', {
      to,
      subject: emailSubject,
      message: error?.message || error,
    });
    return {
      sent: false,
      skipped: false,
      error,
    };
  }
};

module.exports = {
  EMAIL_FROM,
  isEmailConfigured,
  sendEmail,
};
