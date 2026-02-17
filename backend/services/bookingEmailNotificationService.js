const fs = require('fs/promises');
const path = require('path');

const Booking = require('../models/Booking');
const Request = require('../models/Request');
const { sendEmail } = require('./emailService');
const {
  bookingCreatedTemplate,
  advancePaidConfirmedTemplate,
  autoCancelledTemplate,
  overdueAlertTemplate,
  completedWithInvoiceTemplate,
  refundProcessedTemplate,
} = require('../templates/emailTemplates');
const { resolveInvoiceAbsolutePath } = require('./invoiceService');
const { normalizeStatusKey, isAdvancePaidStatus, resolveFinalAmount, isFullyPaidStatus } = require('../utils/paymentUtils');
const { resolveTotalPaid } = require('./refundService');

const normalizeCurrencyPrefix = (rawValue) => {
  const value = String(rawValue || '').trim();
  if (!value) return 'INR ';
  if (/^[A-Za-z]{3}$/i.test(value)) return `${value.toUpperCase()} `;
  return value;
};

const CURRENCY_SYMBOL = normalizeCurrencyPrefix(process.env.CURRENCY_SYMBOL || 'INR');
const APP_BASE_URL = String(process.env.APP_BASE_URL || process.env.CLIENT_URL || '').trim();
const PAYMENT_TIMEOUT_MS = 15 * 60 * 1000;

const EMAIL_FLAG_MAP = {
  pendingPayment: {
    key: 'pendingPaymentSent',
    timeKey: 'pendingPaymentSentAt',
  },
  advancePaid: {
    key: 'advancePaidConfirmationSent',
    timeKey: 'advancePaidConfirmationSentAt',
  },
  autoCancelled: {
    key: 'autoCancelledSent',
    timeKey: 'autoCancelledSentAt',
  },
  overdue: {
    key: 'overdueAlertSent',
    timeKey: 'overdueAlertSentAt',
  },
  completedInvoice: {
    key: 'completionInvoiceSent',
    timeKey: 'completionInvoiceSentAt',
  },
  refundProcessed: {
    key: 'refundProcessedSent',
    timeKey: 'refundProcessedSentAt',
  },
};

const toSafeNumber = (value, fallback = 0) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return fallback;
  return numericValue;
};

const formatMoney = (value) =>
  `${CURRENCY_SYMBOL}${toSafeNumber(value, 0).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
};

const buildCustomerName = (entity) => {
  const firstName = entity?.user?.firstName || '';
  const lastName = entity?.user?.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || 'Customer';
};

const buildCarName = (entity) => {
  const brand = entity?.car?.brand || '';
  const model = entity?.car?.model || '';
  const full = `${brand} ${model}`.trim();
  return full || 'Car';
};

const hasBookingEmailFlag = (booking, eventKey) => {
  const mapping = EMAIL_FLAG_MAP[eventKey];
  if (!mapping) return false;
  return Boolean(booking?.emailNotifications?.[mapping.key]);
};

const markBookingEmailFlag = async (bookingId, eventKey) => {
  const mapping = EMAIL_FLAG_MAP[eventKey];
  if (!mapping || !bookingId) return;

  const now = new Date();
  await Booking.updateOne(
    { _id: bookingId },
    {
      $set: {
        [`emailNotifications.${mapping.key}`]: true,
        [`emailNotifications.${mapping.timeKey}`]: now,
      },
    },
  );
};

const loadBookingById = async (bookingId) => {
  if (!bookingId) return null;
  return Booking.findById(bookingId)
    .populate('user', 'firstName lastName email')
    .populate('car', 'brand model');
};

const loadRequestById = async (requestId) => {
  if (!requestId) return null;
  return Request.findById(requestId)
    .populate('user', 'firstName lastName email')
    .populate('car', 'brand model');
};

const ensureBookingWithRefs = async (bookingIdOrDoc) => {
  if (!bookingIdOrDoc) return null;

  if (typeof bookingIdOrDoc === 'object') {
    const bookingId = bookingIdOrDoc?._id;
    const hasUserEmail = Boolean(bookingIdOrDoc?.user?.email);
    const hasCarName = Boolean(bookingIdOrDoc?.car?.brand || bookingIdOrDoc?.car?.model);
    if (hasUserEmail && hasCarName) {
      return bookingIdOrDoc;
    }
    return loadBookingById(bookingId);
  }

  return loadBookingById(bookingIdOrDoc);
};

const ensureRequestWithRefs = async (requestIdOrDoc) => {
  if (!requestIdOrDoc) return null;

  if (typeof requestIdOrDoc === 'object') {
    const requestId = requestIdOrDoc?._id;
    const hasUserEmail = Boolean(requestIdOrDoc?.user?.email);
    const hasCarName = Boolean(requestIdOrDoc?.car?.brand || requestIdOrDoc?.car?.model);
    if (hasUserEmail && hasCarName) {
      return requestIdOrDoc;
    }
    return loadRequestById(requestId);
  }

  return loadRequestById(requestIdOrDoc);
};

const sendBookingPendingPaymentEmail = async (bookingIdOrDoc) => {
  const booking = await ensureBookingWithRefs(bookingIdOrDoc);
  if (!booking) return { sent: false, skipped: true, reason: 'booking-not-found' };

  if (normalizeStatusKey(booking.bookingStatus) !== 'PENDINGPAYMENT') {
    return { sent: false, skipped: true, reason: 'booking-not-pending-payment' };
  }

  if (hasBookingEmailFlag(booking, 'pendingPayment')) {
    return { sent: false, skipped: true, reason: 'already-sent' };
  }

  const email = String(booking?.user?.email || '').trim();
  if (!email) return { sent: false, skipped: true, reason: 'missing-user-email' };

  const fallbackDeadline = booking.createdAt
    ? new Date(new Date(booking.createdAt).getTime() + PAYMENT_TIMEOUT_MS)
    : null;
  const paymentDeadline = booking.paymentDeadline || fallbackDeadline;
  const minutesLeft = paymentDeadline ? Math.max(Math.ceil((new Date(paymentDeadline).getTime() - Date.now()) / (60 * 1000)), 0) : 0;
  const reminderText = minutesLeft > 0 ? `${minutesLeft} minute(s) remaining for payment` : 'Pay immediately to avoid cancellation';

  const template = bookingCreatedTemplate({
    customerName: buildCustomerName(booking),
    bookingReference: String(booking._id),
    carName: buildCarName(booking),
    advanceRequired: formatMoney(booking.advanceRequired || booking.advanceAmount || 0),
    paymentDeadline: formatDateTime(paymentDeadline),
    paymentDeadlineReminder: reminderText,
  });

  const result = await sendEmail({
    to: email,
    ...template,
  });

  if (result.sent) {
    await markBookingEmailFlag(booking._id, 'pendingPayment');
  }

  return result;
};

const sendRequestPendingPaymentEmail = async (requestIdOrDoc) => {
  const request = await ensureRequestWithRefs(requestIdOrDoc);
  if (!request) return { sent: false, skipped: true, reason: 'request-not-found' };

  const email = String(request?.user?.email || '').trim();
  if (!email) return { sent: false, skipped: true, reason: 'missing-user-email' };

  const createdAt = request.createdAt ? new Date(request.createdAt) : new Date();
  const paymentDeadline = new Date(createdAt.getTime() + PAYMENT_TIMEOUT_MS);
  const template = bookingCreatedTemplate({
    customerName: buildCustomerName(request),
    bookingReference: String(request._id),
    carName: buildCarName(request),
    advanceRequired: formatMoney(request.advanceRequired || request.advanceAmount || 0),
    paymentDeadline: formatDateTime(paymentDeadline),
    paymentDeadlineReminder: `${Math.ceil(PAYMENT_TIMEOUT_MS / (60 * 1000))} minute(s) allowed for payment`,
  });

  return sendEmail({
    to: email,
    ...template,
  });
};

const sendAdvancePaidConfirmationEmail = async (bookingIdOrDoc) => {
  const booking = await ensureBookingWithRefs(bookingIdOrDoc);
  if (!booking) return { sent: false, skipped: true, reason: 'booking-not-found' };

  const bookingStatusKey = normalizeStatusKey(booking.bookingStatus);
  if (!['CONFIRMED'].includes(bookingStatusKey)) {
    return { sent: false, skipped: true, reason: 'booking-not-confirmed' };
  }

  if (hasBookingEmailFlag(booking, 'advancePaid')) {
    return { sent: false, skipped: true, reason: 'already-sent' };
  }

  const hasAdvance = toSafeNumber(booking.advancePaid, 0) > 0 || isAdvancePaidStatus(booking.paymentStatus);
  if (!hasAdvance) {
    return { sent: false, skipped: true, reason: 'advance-not-paid' };
  }

  const email = String(booking?.user?.email || '').trim();
  if (!email) return { sent: false, skipped: true, reason: 'missing-user-email' };

  const template = advancePaidConfirmedTemplate({
    customerName: buildCustomerName(booking),
    bookingReference: String(booking._id),
    carName: buildCarName(booking),
    pickupDateTime: formatDateTime(booking.pickupDateTime || booking.fromDate),
    dropDateTime: formatDateTime(booking.dropDateTime || booking.toDate),
    advancePaid: formatMoney(booking.advancePaid || booking.advanceRequired || booking.advanceAmount || 0),
    remainingAmount: formatMoney(booking.remainingAmount || 0),
  });

  const result = await sendEmail({
    to: email,
    ...template,
  });

  if (result.sent) {
    await markBookingEmailFlag(booking._id, 'advancePaid');
  }

  return result;
};

const sendAutoCancelledEmail = async (bookingIdOrDoc) => {
  const booking = await ensureBookingWithRefs(bookingIdOrDoc);
  if (!booking) return { sent: false, skipped: true, reason: 'booking-not-found' };

  if (normalizeStatusKey(booking.bookingStatus) !== 'CANCELLED') {
    return { sent: false, skipped: true, reason: 'booking-not-cancelled' };
  }

  const cancellationReason = String(booking.cancellationReason || '');
  if (!cancellationReason.toLowerCase().includes('payment timeout')) {
    return { sent: false, skipped: true, reason: 'not-payment-timeout-cancellation' };
  }

  if (hasBookingEmailFlag(booking, 'autoCancelled')) {
    return { sent: false, skipped: true, reason: 'already-sent' };
  }

  const email = String(booking?.user?.email || '').trim();
  if (!email) return { sent: false, skipped: true, reason: 'missing-user-email' };

  const template = autoCancelledTemplate({
    customerName: buildCustomerName(booking),
    bookingReference: String(booking._id),
    carName: buildCarName(booking),
    cancellationReason: 'Payment timeout',
    rebookHint: APP_BASE_URL
      ? `You can create a new booking anytime from ${APP_BASE_URL}.`
      : 'You can create a new booking anytime from the app.',
  });

  const result = await sendEmail({
    to: email,
    ...template,
  });

  if (result.sent) {
    await markBookingEmailFlag(booking._id, 'autoCancelled');
  }

  return result;
};

const sendOverdueAlertEmail = async (bookingIdOrDoc) => {
  const booking = await ensureBookingWithRefs(bookingIdOrDoc);
  if (!booking) return { sent: false, skipped: true, reason: 'booking-not-found' };

  if (normalizeStatusKey(booking.rentalStage) !== 'OVERDUE') {
    return { sent: false, skipped: true, reason: 'booking-not-overdue' };
  }

  if (hasBookingEmailFlag(booking, 'overdue')) {
    return { sent: false, skipped: true, reason: 'already-sent' };
  }

  const email = String(booking?.user?.email || '').trim();
  if (!email) return { sent: false, skipped: true, reason: 'missing-user-email' };

  const template = overdueAlertTemplate({
    customerName: buildCustomerName(booking),
    bookingReference: String(booking._id),
    carName: buildCarName(booking),
    lateHours: String(Math.max(Math.floor(toSafeNumber(booking.lateHours, 0)), 0)),
    lateFee: formatMoney(booking.lateFee || 0),
    payableAmount: formatMoney(booking.remainingAmount || 0),
  });

  const result = await sendEmail({
    to: email,
    ...template,
  });

  if (result.sent) {
    await markBookingEmailFlag(booking._id, 'overdue');
  }

  return result;
};

const buildInvoiceAttachment = async (booking) => {
  const invoicePath = resolveInvoiceAbsolutePath(booking?.invoicePdfPath || '');
  if (!invoicePath) return null;

  try {
    await fs.access(invoicePath);
  } catch {
    return null;
  }

  return {
    filename: path.basename(invoicePath),
    path: invoicePath,
    contentType: 'application/pdf',
  };
};

const sendCompletedWithInvoiceEmail = async (bookingIdOrDoc) => {
  const booking = await ensureBookingWithRefs(bookingIdOrDoc);
  if (!booking) return { sent: false, skipped: true, reason: 'booking-not-found' };

  const isCompleted = normalizeStatusKey(booking.bookingStatus) === 'COMPLETED';
  if (!isCompleted || !isFullyPaidStatus(booking.paymentStatus)) {
    return { sent: false, skipped: true, reason: 'booking-not-completed-or-paid' };
  }

  if (hasBookingEmailFlag(booking, 'completedInvoice')) {
    return { sent: false, skipped: true, reason: 'already-sent' };
  }

  const email = String(booking?.user?.email || '').trim();
  if (!email) return { sent: false, skipped: true, reason: 'missing-user-email' };

  const finalAmount = Math.max(resolveFinalAmount(booking), 0);
  const advancePaid = Math.max(toSafeNumber(booking.advancePaid, 0), 0);
  const lateFee = Math.max(toSafeNumber(booking.lateFee, 0), 0);
  const fullPaymentAmount = Math.max(toSafeNumber(booking.fullPaymentAmount, 0), 0);
  const totalPaid = Number((advancePaid + fullPaymentAmount).toFixed(2));
  const remainingAmount = Math.max(toSafeNumber(booking.remainingAmount, 0), 0);

  const template = completedWithInvoiceTemplate({
    customerName: buildCustomerName(booking),
    bookingReference: String(booking._id),
    invoiceNumber: booking.invoiceNumber || '',
    finalAmount: formatMoney(finalAmount),
    advancePaid: formatMoney(advancePaid),
    lateFee: formatMoney(lateFee),
    totalPaid: formatMoney(totalPaid),
    remainingAmount: formatMoney(remainingAmount),
  });

  const invoiceAttachment = await buildInvoiceAttachment(booking);

  const result = await sendEmail({
    to: email,
    ...template,
    attachments: invoiceAttachment ? [invoiceAttachment] : [],
  });

  if (result.sent) {
    await markBookingEmailFlag(booking._id, 'completedInvoice');
  }

  return result;
};

const sendRefundProcessedEmail = async (bookingIdOrDoc) => {
  const booking = await ensureBookingWithRefs(bookingIdOrDoc);
  if (!booking) return { sent: false, skipped: true, reason: 'booking-not-found' };

  if (normalizeStatusKey(booking?.refundStatus) !== 'PROCESSED') {
    return { sent: false, skipped: true, reason: 'refund-not-processed' };
  }

  if (hasBookingEmailFlag(booking, 'refundProcessed')) {
    return { sent: false, skipped: true, reason: 'already-sent' };
  }

  const email = String(booking?.user?.email || '').trim();
  if (!email) return { sent: false, skipped: true, reason: 'missing-user-email' };

  const totalPaidAfterRefund = resolveTotalPaid(booking);
  const refundAmount = Math.max(toSafeNumber(booking?.refundAmount, 0), 0);
  const totalPaidBeforeRefund = Number((totalPaidAfterRefund + refundAmount).toFixed(2));

  const template = refundProcessedTemplate({
    customerName: buildCustomerName(booking),
    bookingReference: String(booking._id),
    refundAmount: formatMoney(refundAmount),
    refundDate: formatDateTime(booking?.refundProcessedAt || new Date()),
    totalPaidBeforeRefund: formatMoney(totalPaidBeforeRefund),
    totalPaidAfterRefund: formatMoney(totalPaidAfterRefund),
    remainingAmount: formatMoney(Math.max(toSafeNumber(booking?.remainingAmount, 0), 0)),
    refundReason: String(booking?.refundReason || '').trim(),
  });

  const result = await sendEmail({
    to: email,
    ...template,
  });

  if (result.sent) {
    await markBookingEmailFlag(booking._id, 'refundProcessed');
  }

  return result;
};

const runAsyncNotification = (label, task) => {
  Promise.resolve()
    .then(task)
    .catch((error) => {
      console.error(`Email notification task failed (${label}):`, error?.message || error);
    });
};

const queuePendingPaymentEmailForBooking = (bookingIdOrDoc) =>
  runAsyncNotification('pending-payment-booking', () => sendBookingPendingPaymentEmail(bookingIdOrDoc));

const queuePendingPaymentEmailForRequest = (requestIdOrDoc) =>
  runAsyncNotification('pending-payment-request', () => sendRequestPendingPaymentEmail(requestIdOrDoc));

const queueAdvancePaidConfirmationEmail = (bookingIdOrDoc) =>
  runAsyncNotification('advance-paid-confirmation', () => sendAdvancePaidConfirmationEmail(bookingIdOrDoc));

const queueAutoCancelledEmail = (bookingIdOrDoc) =>
  runAsyncNotification('auto-cancelled-booking', () => sendAutoCancelledEmail(bookingIdOrDoc));

const queueOverdueAlertEmail = (bookingIdOrDoc) =>
  runAsyncNotification('overdue-alert', () => sendOverdueAlertEmail(bookingIdOrDoc));

const queueCompletedInvoiceEmail = (bookingIdOrDoc) =>
  runAsyncNotification('completed-invoice', () => sendCompletedWithInvoiceEmail(bookingIdOrDoc));

const queueRefundProcessedEmail = (bookingIdOrDoc) =>
  runAsyncNotification('refund-processed', () => sendRefundProcessedEmail(bookingIdOrDoc));

module.exports = {
  queuePendingPaymentEmailForBooking,
  queuePendingPaymentEmailForRequest,
  queueAdvancePaidConfirmationEmail,
  queueAutoCancelledEmail,
  queueOverdueAlertEmail,
  queueCompletedInvoiceEmail,
  queueRefundProcessedEmail,
  sendBookingPendingPaymentEmail,
  sendRequestPendingPaymentEmail,
  sendAdvancePaidConfirmationEmail,
  sendAutoCancelledEmail,
  sendOverdueAlertEmail,
  sendCompletedWithInvoiceEmail,
  sendRefundProcessedEmail,
};
