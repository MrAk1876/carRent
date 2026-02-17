const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const PDFDocument = require('pdfkit');

const UserSubscription = require('../models/UserSubscription');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const SUBSCRIPTION_INVOICE_DIR = path.join(BACKEND_ROOT, 'generated', 'subscription-invoices');
const COMPANY_NAME = process.env.COMPANY_NAME || 'CarRental';
const COMPANY_TAGLINE = process.env.COMPANY_TAGLINE || 'Subscription Invoice';
const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '\u20B9';

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

const sanitizeFileName = (value) =>
  String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '') || 'subscription-invoice';

const isSubscriptionInvoiceGenerated = (subscription) =>
  Boolean(String(subscription?.invoiceNumber || '').trim() && String(subscription?.invoicePdfPath || '').trim());

const toRelativeStoragePath = (absolutePath) => path.relative(BACKEND_ROOT, absolutePath).split(path.sep).join('/');

const resolveSubscriptionInvoiceAbsolutePath = (storedPath) => {
  const normalizedPath = String(storedPath || '').trim().replace(/^[/\\]+/, '');
  if (!normalizedPath) return '';

  const absolutePath = path.resolve(BACKEND_ROOT, normalizedPath);
  if (!absolutePath.startsWith(BACKEND_ROOT)) {
    return '';
  }
  return absolutePath;
};

const createInvoiceNumberCandidate = (now = new Date()) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const randomValue = Math.floor(100000 + Math.random() * 900000);
  return `SUB-INV-${year}-${month}-${randomValue}`;
};

const generateUniqueSubscriptionInvoiceNumber = async (subscriptionId, now = new Date()) => {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = createInvoiceNumberCandidate(now);
    const existing = await UserSubscription.exists({
      invoiceNumber: candidate,
      ...(subscriptionId ? { _id: { $ne: subscriptionId } } : {}),
    });
    if (!existing) return candidate;
  }

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `SUB-INV-${year}-${month}-${String(Date.now()).slice(-6)}`;
};

const hydrateSubscriptionForInvoice = async (subscriptionOrId) => {
  const subscriptionId = subscriptionOrId?._id || subscriptionOrId;
  if (!subscriptionId) return null;

  const hasPopulate = subscriptionOrId && typeof subscriptionOrId.populate === 'function';
  let subscription = hasPopulate ? subscriptionOrId : await UserSubscription.findById(subscriptionId);
  if (!subscription) return null;

  await subscription.populate([
    { path: 'userId', select: 'firstName lastName email' },
    { path: 'planId', select: 'planName durationType durationInDays price includedRentalHours lateFeeDiscountPercentage damageFeeDiscountPercentage branchId' },
    { path: 'branchId', select: 'branchName branchCode city state' },
  ]);

  return subscription;
};

const renderSubscriptionInvoicePdf = async (subscription, options = {}) => {
  await fsp.mkdir(SUBSCRIPTION_INVOICE_DIR, { recursive: true });

  const invoiceNumber = subscription.invoiceNumber || options.invoiceNumber;
  const safeInvoiceNumber = sanitizeFileName(invoiceNumber || `subscription-${subscription._id}`);
  const fileName = `${safeInvoiceNumber}.pdf`;
  const absolutePath = path.join(SUBSCRIPTION_INVOICE_DIR, fileName);
  const relativePath = toRelativeStoragePath(absolutePath);
  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date();

  const user = subscription?.userId || {};
  const plan = subscription?.planId || {};
  const planSnapshot = subscription?.planSnapshot || {};
  const userFullName = `${String(user?.firstName || '').trim()} ${String(user?.lastName || '').trim()}`.trim() || 'Subscriber';
  const email = String(user?.email || 'N/A');

  const planName = String(plan?.planName || planSnapshot?.planName || 'Subscription Plan');
  const durationType = String(plan?.durationType || planSnapshot?.durationType || 'N/A');
  const durationInDays = Math.max(Number(plan?.durationInDays || planSnapshot?.durationInDays || 0), 0);
  const includedHours = Math.max(Number(plan?.includedRentalHours || planSnapshot?.includedRentalHours || 0), 0);
  const lateDiscount = Math.max(Number(plan?.lateFeeDiscountPercentage || planSnapshot?.lateFeeDiscountPercentage || 0), 0);
  const damageDiscount = Math.max(Number(plan?.damageFeeDiscountPercentage || planSnapshot?.damageFeeDiscountPercentage || 0), 0);
  const amountPaid = Math.max(Number(subscription?.amountPaid || plan?.price || planSnapshot?.price || 0), 0);

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      info: {
        Title: `Subscription Invoice ${invoiceNumber}`,
        Author: COMPANY_NAME,
        Subject: 'Subscription purchase invoice',
      },
    });

    const stream = fs.createWriteStream(absolutePath);
    doc.pipe(stream);

    doc.save();
    doc.roundedRect(36, 36, 523, 92, 10).fill('#0f3b82');
    doc.restore();

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(19).text(COMPANY_NAME, 52, 54);
    doc.fillColor('#c7d8ff').font('Helvetica').fontSize(10).text(COMPANY_TAGLINE, 52, 78);
    doc.fillColor('#dbeafe').font('Helvetica').fontSize(10).text(`Invoice No: ${invoiceNumber}`, 352, 54, { width: 190, align: 'right' });
    doc.text(`Issued: ${formatDateTime(generatedAt)}`, 352, 70, { width: 190, align: 'right' });
    doc.text(`Status: ${subscription?.paymentStatus || 'Paid'}`, 352, 86, { width: 190, align: 'right' });

    let y = 146;

    const drawBox = (x, width, heading, lines = []) => {
      doc.save();
      doc.roundedRect(x, y, width, 102, 8).fill('#f8fafc');
      doc.restore();
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text(heading, x + 14, y + 14);
      let lineY = y + 36;
      lines.forEach((line) => {
        doc.fillColor('#334155').font('Helvetica').fontSize(10).text(String(line || 'N/A'), x + 14, lineY, {
          width: width - 28,
        });
        lineY += 16;
      });
    };

    drawBox(36, 255, 'Subscriber', [
      userFullName,
      email,
      `Subscription ID: ${subscription?._id || 'N/A'}`,
      `Auto Renew: ${subscription?.autoRenew ? 'Enabled' : 'Disabled'}`,
    ]);
    drawBox(304, 255, 'Plan', [
      planName,
      `${durationType} (${durationInDays} days)`,
      `Included Hours: ${includedHours}`,
      `Branch: ${subscription?.branchId?.branchName || 'All Branches'}`,
    ]);

    y += 118;

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Subscription Details', 36, y);
    y += 20;

    const drawLine = (label, value) => {
      doc.fillColor('#475569').font('Helvetica').fontSize(10).text(label, 40, y);
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text(String(value || 'N/A'), 260, y);
      doc.moveTo(36, y + 14).lineTo(559, y + 14).lineWidth(0.6).strokeColor('#dbe4ee').stroke();
      y += 18;
    };

    drawLine('Plan Name', planName);
    drawLine('Subscription Start', formatDateTime(subscription?.startDate));
    drawLine('Subscription End', formatDateTime(subscription?.endDate));
    drawLine('Late Fee Discount', `${lateDiscount}%`);
    drawLine('Damage Fee Discount', `${damageDiscount}%`);
    drawLine('Remaining Hours (at purchase)', `${Math.max(Number(subscription?.remainingRentalHours || 0), 0)}`);
    drawLine('Total Used Hours (at purchase)', `${Math.max(Number(subscription?.totalUsedHours || 0), 0)}`);

    y += 6;
    doc.save();
    doc.roundedRect(36, y, 523, 34, 6).fill('#1d4ed8');
    doc.restore();
    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12).text('Total Paid', 50, y + 10);
    doc.text(formatMoney(amountPaid), 380, y + 10, { width: 162, align: 'right' });

    const footerY = 770;
    doc.fillColor('#334155').font('Helvetica').fontSize(9).text('Thank you for choosing CarRental subscriptions.', 36, footerY);
    doc.fillColor('#64748b').fontSize(8.5).text('This invoice is system generated and valid without signature.', 36, footerY + 12, { width: 523 });

    doc.end();

    doc.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
  }).catch(async (error) => {
    try {
      await fsp.unlink(absolutePath);
    } catch {
      // Ignore cleanup errors.
    }
    throw error;
  });

  return {
    absolutePath,
    relativePath,
    fileName,
    generatedAt,
  };
};

const ensureSubscriptionInvoiceGenerated = async (subscriptionOrId, options = {}) => {
  const subscription = await hydrateSubscriptionForInvoice(subscriptionOrId);
  if (!subscription) {
    const error = new Error('Subscription not found');
    error.status = 404;
    throw error;
  }

  if (isSubscriptionInvoiceGenerated(subscription)) {
    return {
      generated: false,
      reason: 'already-generated',
      subscription,
    };
  }

  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date();
  subscription.invoiceNumber =
    subscription.invoiceNumber || (await generateUniqueSubscriptionInvoiceNumber(subscription._id, generatedAt));

  const pdfPayload = await renderSubscriptionInvoicePdf(subscription, {
    invoiceNumber: subscription.invoiceNumber,
    generatedAt,
  });

  subscription.invoiceGeneratedAt = generatedAt;
  subscription.invoicePdfPath = pdfPayload.relativePath;
  await subscription.save();

  return {
    generated: true,
    subscription,
    ...pdfPayload,
  };
};

module.exports = {
  SUBSCRIPTION_INVOICE_DIR,
  sanitizeFileName,
  isSubscriptionInvoiceGenerated,
  resolveSubscriptionInvoiceAbsolutePath,
  hydrateSubscriptionForInvoice,
  ensureSubscriptionInvoiceGenerated,
};
