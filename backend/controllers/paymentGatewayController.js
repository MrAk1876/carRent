const crypto = require('crypto');
const mongoose = require('mongoose');
const Request = require('../models/Request');
const PaymentSession = require('../models/PaymentSession');
const {
  resolveRequestPaymentPreview,
  completeAdvancePaymentForRequest,
  normalizePaymentOption,
} = require('../services/requestAdvancePaymentService');
const { isSmsConfigured, sendSMS } = require('../services/smsService');

const SESSION_WINDOW_MS = 15 * 60 * 1000;
const OTP_WINDOW_MS = 2 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 3;
const MERCHANT_NAME = String(process.env.SIMULATED_PAYMENT_MERCHANT_NAME || 'CarRental Demo Gateway').trim();
const GATEWAY_PAYMENT_METHODS = ['UPI', 'CARD', 'NETBANKING', 'WALLET'];

const createHttpError = (message, status) => {
  const error = new Error(message);
  error.status = status;
  return error;
};

const generateToken = () => crypto.randomBytes(18).toString('hex');
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const generateTransactionId = () =>
  `SIMTXN-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

const normalizeMobileNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return digits;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  return '';
};
const maskMobileNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
};

const isSessionTerminal = (status) => ['SUCCESS', 'EXPIRED'].includes(String(status || '').trim().toUpperCase());

const markSessionExpiredIfNeeded = async (session, now = new Date()) => {
  if (!session) return session;
  if (session.status === 'SUCCESS' || session.status === 'EXPIRED') return session;

  if (session.expiresAt instanceof Date && session.expiresAt.getTime() <= now.getTime()) {
    session.status = 'EXPIRED';
    await session.save();
  }

  return session;
};

const buildSessionResponse = (session) => {
  const attemptsUsed = Math.max(Number(session?.otpAttempts || 0), 0);
  return {
    token: session.token,
    userId: session.userId,
    bookingId: session.bookingId,
    resolvedBookingId: session.resolvedBookingId || null,
    orderId: String(session.resolvedBookingId || session.bookingId || ''),
    amount: Number(session.amount || 0),
    mobileNumber: session.mobileNumber || '',
    otpVerified: Boolean(session.otpVerified),
    paymentMethod: session.paymentMethod || 'NONE',
    status: session.status,
    transactionId: session.transactionId || '',
    merchantName: MERCHANT_NAME,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    otpExpiresAt: session.otpExpiresAt,
    attemptsUsed,
    attemptsRemaining: Math.max(MAX_OTP_ATTEMPTS - attemptsUsed, 0),
    paymentMethods: GATEWAY_PAYMENT_METHODS,
  };
};

const createUniqueToken = async () => {
  for (let index = 0; index < 6; index += 1) {
    const token = generateToken();
    const existing = await PaymentSession.findOne({ token }).setOptions({ skipTenantFilter: true }).select('_id').lean();
    if (!existing?._id) return token;
  }

  throw createHttpError('Failed to initialize payment session', 500);
};

const getOwnedSessionByToken = async (token, userId) => {
  const session = await PaymentSession.findOne({
    token: String(token || '').trim(),
    userId,
  });

  if (!session) {
    throw createHttpError('Payment session not found', 404);
  }

  await markSessionExpiredIfNeeded(session, new Date());
  return session;
};

exports.createPaymentSession = async (req, res) => {
  try {
    const bookingId = String(req.body?.bookingId || '').trim();
    const paymentOption = normalizePaymentOption(req.body?.paymentOption);

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ message: 'Invalid booking id' });
    }

    const request = await Request.findById(bookingId);
    if (!request) {
      return res.status(404).json({ message: 'Booking request not found' });
    }

    if (String(request.user || '') !== String(req.user?._id || '')) {
      return res.status(403).json({ message: 'Not allowed' });
    }

    if (request.status !== 'pending') {
      return res.status(422).json({ message: 'Only pending requests can be paid' });
    }

    const paymentPreview = resolveRequestPaymentPreview(request, { paymentOption });
    const now = new Date();
    const existingSession = await PaymentSession.findOne({
      userId: req.user._id,
      bookingId: request._id,
      referenceModel: 'Request',
      status: { $in: ['CREATED', 'OTP_SENT', 'OTP_VERIFIED', 'FAILED'] },
      expiresAt: { $gt: now },
    }).sort({ createdAt: -1 });

    if (existingSession) {
      existingSession.amount = paymentPreview.amountPaid;
      await existingSession.save();

      return res.status(201).json({
        message: 'Payment session ready',
        token: existingSession.token,
        redirectUrl: `/gateway/${existingSession.token}`,
        session: buildSessionResponse(existingSession),
      });
    }

    const session = await PaymentSession.create({
      token: await createUniqueToken(),
      userId: req.user._id,
      bookingId: request._id,
      referenceModel: 'Request',
      amount: paymentPreview.amountPaid,
      paymentMethod: 'NONE',
      status: 'CREATED',
      expiresAt: new Date(now.getTime() + SESSION_WINDOW_MS),
    });

    return res.status(201).json({
      message: 'Payment session created',
      token: session.token,
      redirectUrl: `/gateway/${session.token}`,
      session: buildSessionResponse(session),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: status >= 500 ? 'Failed to create payment session' : error.message,
    });
  }
};

exports.getPaymentSession = async (req, res) => {
  try {
    const session = await getOwnedSessionByToken(req.params.token, req.user._id);
    return res.json({ session: buildSessionResponse(session) });
  } catch (error) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: status >= 500 ? 'Failed to load payment session' : error.message,
    });
  }
};

exports.sendPaymentOtp = async (req, res) => {
  try {
    const session = await getOwnedSessionByToken(req.params.token, req.user._id);
    if (isSessionTerminal(session.status)) {
      return res.status(422).json({ message: 'This payment session is no longer active' });
    }

    const mobileNumber = normalizeMobileNumber(req.body?.mobileNumber);
    if (!mobileNumber) {
      return res.status(422).json({ message: 'Enter a valid mobile number' });
    }

    if (!isSmsConfigured()) {
      return res.status(503).json({
        message: 'SMS OTP is not configured on the server. Set SMS_PROVIDER and provider credentials first.',
      });
    }

    const now = new Date();
    session.mobileNumber = mobileNumber;
    session.otp = generateOtp();
    session.otpVerified = false;
    session.otpAttempts = 0;
    session.otpSentAt = now;
    session.otpExpiresAt = new Date(now.getTime() + OTP_WINDOW_MS);
    session.status = 'OTP_SENT';
    await session.save();

    const smsResult = await sendSMS(
      mobileNumber,
      `Your CarRental payment OTP is ${session.otp}. It expires in 2 minutes. Do not share this code.`,
    );

    if (!smsResult?.sent) {
      const devOtpBypass = String(process.env.DEV_OTP_BYPASS || '').trim() === 'true';
      if (devOtpBypass) {
        return res.json({
          message: 'OTP generated (dev bypass)',
          maskedMobileNumber: maskMobileNumber(session.mobileNumber),
          otp: session.otp,
          session: buildSessionResponse(session),
        });
      }
      console.error('Payment OTP SMS delivery failed:', {
        bookingId: session.bookingId,
        userId: session.userId,
        provider: String(process.env.SMS_PROVIDER || ''),
        reason: smsResult?.reason,
        statusCode: smsResult?.statusCode,
        response: smsResult?.response,
      });
      session.status = 'FAILED';
      await session.save();
      return res.status(502).json({
        message: 'Failed to deliver OTP to the provided mobile number. Please verify SMS configuration and try again.',
        debug: smsResult?.reason ? `sms:${smsResult.reason}` : undefined,
      });
    }

    return res.json({
      message: 'OTP sent successfully',
      maskedMobileNumber: maskMobileNumber(session.mobileNumber),
      session: buildSessionResponse(session),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: status >= 500 ? 'Failed to send OTP' : error.message,
    });
  }
};

exports.verifyPaymentOtp = async (req, res) => {
  try {
    const session = await getOwnedSessionByToken(req.params.token, req.user._id);
    if (isSessionTerminal(session.status)) {
      return res.status(422).json({ message: 'This payment session is no longer active' });
    }

    if (!session.otp || !session.otpSentAt || !session.otpExpiresAt) {
      return res.status(422).json({ message: 'Send OTP before verification' });
    }

    const now = new Date();
    if (session.otpExpiresAt.getTime() <= now.getTime()) {
      session.status = 'FAILED';
      await session.save();
      return res.status(410).json({ message: 'OTP expired. Please resend OTP.' });
    }

    if (Number(session.otpAttempts || 0) >= MAX_OTP_ATTEMPTS) {
      session.status = 'FAILED';
      await session.save();
      return res.status(429).json({ message: 'Maximum OTP attempts reached. Please resend OTP.' });
    }

    const submittedOtp = String(req.body?.otp || '').trim();
    if (!/^\d{6}$/.test(submittedOtp)) {
      return res.status(422).json({ message: 'Enter a valid 6-digit OTP' });
    }

    if (submittedOtp !== String(session.otp || '')) {
      session.otpAttempts = Math.min(Number(session.otpAttempts || 0) + 1, MAX_OTP_ATTEMPTS);
      session.status = session.otpAttempts >= MAX_OTP_ATTEMPTS ? 'FAILED' : 'OTP_SENT';
      await session.save();
      return res.status(422).json({
        message:
          session.otpAttempts >= MAX_OTP_ATTEMPTS
            ? 'Incorrect OTP. Maximum attempts reached. Please resend OTP.'
            : 'Incorrect OTP. Please try again.',
        session: buildSessionResponse(session),
      });
    }

    session.otpVerified = true;
    session.status = 'OTP_VERIFIED';
    await session.save();

    return res.json({
      message: 'OTP verified successfully',
      session: buildSessionResponse(session),
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: status >= 500 ? 'Failed to verify OTP' : error.message,
    });
  }
};

exports.completePaymentSession = async (req, res) => {
  try {
    const session = await getOwnedSessionByToken(req.params.token, req.user._id);

    if (session.status === 'SUCCESS') {
      return res.json({
        message: 'Payment already completed',
        redirectUrl: `/payment-success/${session.token}`,
        session: buildSessionResponse(session),
      });
    }

    if (session.status === 'EXPIRED') {
      return res.status(410).json({ message: 'Payment session expired. Please start again.' });
    }

    if (!session.otpVerified) {
      return res.status(422).json({ message: 'Verify OTP before payment' });
    }

    const paymentMethod = String(req.body?.paymentMethod || '').trim().toUpperCase();
    if (!GATEWAY_PAYMENT_METHODS.includes(paymentMethod)) {
      return res.status(422).json({ message: 'paymentMethod must be UPI, CARD, NETBANKING, or WALLET' });
    }

    const paymentResult = await completeAdvancePaymentForRequest({
      requestId: session.bookingId,
      userId: req.user._id,
      paymentMethod,
      paymentOption: 'ADVANCE_POLICY',
      paymentReference: session.token,
      now: new Date(),
    });

    session.status = 'SUCCESS';
    session.paymentMethod = paymentMethod;
    session.transactionId = generateTransactionId();
    session.completedAt = new Date();
    session.amount = Number(paymentResult.amountPaid || session.amount || 0);
    session.resolvedBookingId = paymentResult.booking?._id || null;
    session.otpVerified = true;
    await session.save();

    return res.json({
      message: 'Payment successful',
      redirectUrl: `/payment-success/${session.token}`,
      session: buildSessionResponse(session),
      booking: paymentResult.booking,
    });
  } catch (error) {
    const status = Number(error?.status || 500);
    return res.status(status).json({
      message: status >= 500 ? 'Failed to complete payment' : error.message,
    });
  }
};
