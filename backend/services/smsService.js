const https = require('https');

const DEFAULT_COUNTRY_CODE = String(process.env.SMS_DEFAULT_COUNTRY_CODE || '+91').trim() || '+91';

const toBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const normalizePhoneNumber = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';

  if (raw.startsWith('+')) {
    const digits = raw.replace(/[^\d]/g, '');
    if (digits.length >= 10 && digits.length <= 15) return `+${digits}`;
    return '';
  }

  const digits = raw.replace(/[^\d]/g, '');
  if (digits.length === 10) {
    const prefixDigits = String(DEFAULT_COUNTRY_CODE || '+91').replace(/[^\d]/g, '');
    return `+${prefixDigits}${digits}`;
  }
  if (digits.length >= 11 && digits.length <= 15) {
    return `+${digits}`;
  }
  return '';
};

const requestJson = (requestUrl, options = {}, body = '') =>
  new Promise((resolve, reject) => {
    const parsedUrl = new URL(requestUrl);
    const request = https.request(
      {
        protocol: parsedUrl.protocol,
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: `${parsedUrl.pathname}${parsedUrl.search}`,
        method: options.method || 'POST',
        headers: options.headers || {},
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          const statusCode = Number(response.statusCode || 0);
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }

          resolve({
            ok: statusCode >= 200 && statusCode < 300,
            statusCode,
            text,
            json,
          });
        });
      },
    );

    request.on('error', reject);
    if (body) {
      request.write(body);
    }
    request.end();
  });

const isSmsConfigured = () => {
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();
  if (!provider) return false;
  if (provider === 'twilio') {
    const twilioSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
    const twilioToken = String(process.env.TWILIO_AUTH_TOKEN || process.env.SMS_API_KEY || '').trim();
    const twilioFrom = String(process.env.TWILIO_FROM_NUMBER || '').trim();
    return Boolean(twilioSid && twilioToken && twilioFrom);
  }
  if (provider === 'fast2sms') {
    const fast2SmsKey = String(process.env.SMS_API_KEY || '').trim();
    return Boolean(fast2SmsKey);
  }
  return false;
};

const sendViaTwilio = async (phoneNumber, message) => {
  const accountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const authToken = String(process.env.TWILIO_AUTH_TOKEN || process.env.SMS_API_KEY || '').trim();
  const fromNumber = String(process.env.TWILIO_FROM_NUMBER || '').trim();

  if (!accountSid || !authToken || !fromNumber) {
    return { sent: false, skipped: true, reason: 'twilio-not-configured' };
  }

  const body = new URLSearchParams({
    To: phoneNumber,
    From: fromNumber,
    Body: message,
  }).toString();

  const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const response = await requestJson(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body,
  );

  if (!response.ok) {
    return {
      sent: false,
      skipped: false,
      reason: 'twilio-send-failed',
      statusCode: response.statusCode,
      response: response.text,
    };
  }

  return {
    sent: true,
    skipped: false,
    provider: 'twilio',
    messageId: String(response?.json?.sid || ''),
  };
};

const sendViaFast2SMS = async (phoneNumber, message) => {
  const apiKey = String(process.env.SMS_API_KEY || '').trim();
  if (!apiKey) {
    return { sent: false, skipped: true, reason: 'fast2sms-not-configured' };
  }

  const rawDigits = phoneNumber.replace(/[^\d]/g, '');
  const cleanPhone = rawDigits.length > 10 ? rawDigits.slice(-10) : rawDigits;
  if (cleanPhone.length !== 10) {
    return { sent: false, skipped: true, reason: 'fast2sms-invalid-number' };
  }
  const route = String(process.env.FAST2SMS_ROUTE || 'q').trim() || 'q';
  const senderId = String(process.env.FAST2SMS_SENDER_ID || '').trim();
  const templateId = String(process.env.FAST2SMS_TEMPLATE_ID || '').trim();
  const entityId = String(process.env.FAST2SMS_ENTITY_ID || '').trim();

  const requestPayload = {
    route,
    language: 'english',
    flash: 0,
    numbers: cleanPhone,
    message,
  };

  if (senderId) requestPayload.sender_id = senderId;
  if (templateId) requestPayload.template_id = templateId;
  if (entityId) requestPayload.entity_id = entityId;

  const requestBody = JSON.stringify(requestPayload);

  const response = await requestJson(
    'https://www.fast2sms.com/dev/bulkV2',
    {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(requestBody),
      },
    },
    requestBody,
  );

  if (!response.ok) {
    return {
      sent: false,
      skipped: false,
      reason: 'fast2sms-send-failed',
      statusCode: response.statusCode,
      response: response.text,
    };
  }

  const requestAccepted = toBoolean(response?.json?.return, true);
  if (!requestAccepted) {
    return {
      sent: false,
      skipped: false,
      reason: 'fast2sms-provider-rejected',
      response: response.json || response.text,
    };
  }

  return {
    sent: true,
    skipped: false,
    provider: 'fast2sms',
    messageId: String(response?.json?.request_id || ''),
  };
};

const sendSMS = async (phoneNumber, message) => {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const normalizedMessage = String(message || '').trim();
  const provider = String(process.env.SMS_PROVIDER || '').trim().toLowerCase();

  if (!normalizedPhone || !normalizedMessage) {
    return {
      sent: false,
      skipped: true,
      reason: 'missing-phone-or-message',
    };
  }

  if (!provider) {
    return {
      sent: false,
      skipped: true,
      reason: 'sms-provider-not-configured',
    };
  }

  try {
    if (provider === 'twilio') {
      return sendViaTwilio(normalizedPhone, normalizedMessage);
    }

    if (provider === 'fast2sms') {
      return sendViaFast2SMS(normalizedPhone, normalizedMessage);
    }

    return {
      sent: false,
      skipped: true,
      reason: 'unsupported-sms-provider',
    };
  } catch (error) {
    console.error('SMS send failed:', {
      phoneNumber: normalizedPhone,
      provider,
      message: error?.message || error,
    });
    return {
      sent: false,
      skipped: false,
      reason: 'sms-send-error',
      error,
    };
  }
};

module.exports = {
  isSmsConfigured,
  sendSMS,
};
