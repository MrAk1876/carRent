const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const http = require('http');
const https = require('https');
const PDFDocument = require('pdfkit');

const Booking = require('../models/Booking');
const { normalizeStatusKey, resolveFinalAmount } = require('../utils/paymentUtils');

const BACKEND_ROOT = path.resolve(__dirname, '..');
const INVOICE_DIR = path.join(BACKEND_ROOT, 'generated', 'invoices');
const COMPANY_NAME = process.env.COMPANY_NAME || 'CarRental';
const COMPANY_TAGLINE = process.env.COMPANY_TAGLINE || 'Car Rental Platform';
const CURRENCY_SYMBOL = process.env.CURRENCY_SYMBOL || '₹';
const FALLBACK_TERMS =
  'This invoice is system generated and valid without signature. Please keep this document for your records.';

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
    .replace(/^[-.]+|[-.]+$/g, '') || 'invoice';

const isInvoiceEligible = (booking) =>
  normalizeStatusKey(booking?.bookingStatus) === 'COMPLETED' &&
  normalizeStatusKey(booking?.paymentStatus) === 'FULLYPAID';

const isInvoiceGenerated = (booking) =>
  normalizeStatusKey(booking?.invoiceStatus) === 'GENERATED' && Boolean(booking?.invoiceNumber);

const toRelativeStoragePath = (absolutePath) => path.relative(BACKEND_ROOT, absolutePath).split(path.sep).join('/');

const resolveInvoiceAbsolutePath = (storedPath) => {
  const normalizedPath = String(storedPath || '').trim().replace(/^[/\\]+/, '');
  if (!normalizedPath) return '';

  const absolutePath = path.resolve(BACKEND_ROOT, normalizedPath);
  if (!absolutePath.startsWith(BACKEND_ROOT)) {
    return '';
  }

  return absolutePath;
};

const parseUrl = (value) => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

const fetchRemoteBuffer = (sourceUrl, timeoutMs = 7000, redirectCount = 0) =>
  new Promise((resolve, reject) => {
    const parsed = parseUrl(sourceUrl);
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error('Unsupported URL protocol'));
      return;
    }

    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.get(
      sourceUrl,
      {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'CarRental-InvoiceService/1.0',
        },
      },
      (response) => {
        const statusCode = Number(response.statusCode || 0);
        const location = response.headers.location;

        if ([301, 302, 303, 307, 308].includes(statusCode) && location && redirectCount < 3) {
          response.resume();
          const nextUrl = location.startsWith('http') ? location : new URL(location, sourceUrl).toString();
          fetchRemoteBuffer(nextUrl, timeoutMs, redirectCount + 1).then(resolve).catch(reject);
          return;
        }

        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          reject(new Error(`Image request failed with status ${statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );

    request.on('timeout', () => {
      request.destroy(new Error('Image request timed out'));
    });
    request.on('error', reject);
  });

const detectRasterImageType = (buffer) => {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return '';

  const isPng =
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;
  if (isPng) return 'png';

  const isJpeg = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (isJpeg) return 'jpeg';

  return '';
};

const loadImageBuffer = async (source) => {
  const normalizedSource = String(source || '').trim();
  if (!normalizedSource) return null;

  try {
    if (/^https?:\/\//i.test(normalizedSource)) {
      const remoteBuffer = await fetchRemoteBuffer(normalizedSource);
      return detectRasterImageType(remoteBuffer) ? remoteBuffer : null;
    }

    const absolutePath = path.isAbsolute(normalizedSource)
      ? normalizedSource
      : path.resolve(BACKEND_ROOT, normalizedSource.replace(/^[/\\]+/, ''));
    const localBuffer = await fsp.readFile(absolutePath);
    return detectRasterImageType(localBuffer) ? localBuffer : null;
  } catch {
    return null;
  }
};

const loadCompanyLogo = async () => {
  const logoCandidates = [
    process.env.COMPANY_LOGO_URL,
    process.env.COMPANY_LOGO_PATH,
    path.join(BACKEND_ROOT, 'assets', 'logo.png'),
    path.join(BACKEND_ROOT, 'assets', 'logo.jpg'),
    path.join(BACKEND_ROOT, 'public', 'logo.png'),
    path.join(BACKEND_ROOT, 'public', 'logo.jpg'),
    path.join(BACKEND_ROOT, '..', 'client', 'public', 'logo.png'),
    path.join(BACKEND_ROOT, '..', 'client', 'public', 'logo.jpg'),
  ].filter(Boolean);

  for (const candidate of logoCandidates) {
    const logoBuffer = await loadImageBuffer(candidate);
    if (logoBuffer) return logoBuffer;
  }

  return null;
};

const drawLabelValue = (doc, label, value, x, y, valueX) => {
  doc.fillColor('#475569').font('Helvetica').fontSize(10).text(label, x, y, { lineBreak: false });
  doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(10).text(String(value || 'N/A'), valueX, y, {
    width: 220,
  });
};

const renderInvoicePdf = async (booking, options = {}) => {
  await fsp.mkdir(INVOICE_DIR, { recursive: true });

  const invoiceNumber = booking.invoiceNumber || options.invoiceNumber;
  const safeInvoiceNumber = sanitizeFileName(invoiceNumber || `invoice-${booking._id}`);
  const fileName = `${safeInvoiceNumber}.pdf`;
  const absolutePath = path.join(INVOICE_DIR, fileName);
  const relativePath = toRelativeStoragePath(absolutePath);
  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date();

  const logoBuffer = await loadCompanyLogo();
  const carImageBuffer = await loadImageBuffer(booking?.car?.image);

  const finalAmount = Math.max(resolveFinalAmount(booking), 0);
  const advancePaid = Math.max(
    toSafeNumber(booking?.advancePaid, toSafeNumber(booking?.advanceRequired, toSafeNumber(booking?.advanceAmount, 0))),
    0,
  );
  const lateHours = Math.max(Math.floor(toSafeNumber(booking?.lateHours, 0)), 0);
  const lateFee = Math.max(toSafeNumber(booking?.lateFee, 0), 0);
  const damageDetected = Boolean(booking?.returnInspection?.damageDetected);
  const damageCost = damageDetected ? Math.max(toSafeNumber(booking?.returnInspection?.damageCost, 0), 0) : 0;
  const damageNotes = String(booking?.returnInspection?.conditionNotes || '').trim();
  const totalAmount = Number((finalAmount + lateFee + damageCost).toFixed(2));
  const amountPaid = Math.max(toSafeNumber(booking?.fullPaymentAmount, 0) + advancePaid, 0);
  const remainingAmount = Math.max(Number((totalAmount - amountPaid).toFixed(2)), 0);

  const customerName =
    `${booking?.user?.firstName || ''} ${booking?.user?.lastName || ''}`.trim() || booking?.user?.email || 'Customer';
  const customerEmail = booking?.user?.email || 'N/A';
  const carName = `${booking?.car?.brand || ''} ${booking?.car?.model || ''}`.trim() || 'Car';
  const carMeta = [booking?.car?.category, booking?.car?.transmission, booking?.car?.location].filter(Boolean).join(' | ');

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 36,
      info: {
        Title: `Invoice ${invoiceNumber}`,
        Author: COMPANY_NAME,
        Subject: 'Car rental invoice',
        Creator: COMPANY_NAME,
      },
    });

    const stream = fs.createWriteStream(absolutePath);
    doc.pipe(stream);

    doc.save();
    doc.roundedRect(36, 36, 523, 92, 10).fill('#1e3a8a');
    doc.restore();

    if (logoBuffer) {
      try {
        doc.image(logoBuffer, 48, 48, { fit: [72, 30], align: 'left', valign: 'center' });
      } catch {
        // Ignore logo rendering issues.
      }
    }

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(20).text('INVOICE', 130, 50);
    doc.fillColor('#dbeafe').font('Helvetica').fontSize(11).text(COMPANY_NAME, 130, 78);
    doc.fillColor('#bfdbfe').font('Helvetica').fontSize(9).text(COMPANY_TAGLINE, 130, 94);

    doc.fillColor('#dbeafe').font('Helvetica').fontSize(10).text(`Invoice No: ${invoiceNumber}`, 366, 52, {
      width: 182,
      align: 'right',
    });
    doc.fillColor('#dbeafe').font('Helvetica').fontSize(10).text(`Invoice Date: ${formatDateTime(generatedAt)}`, 366, 68, {
      width: 182,
      align: 'right',
    });
    doc.fillColor('#dbeafe').font('Helvetica').fontSize(10).text(`Booking ID: ${booking._id}`, 366, 84, {
      width: 182,
      align: 'right',
    });
    doc.fillColor('#dbeafe').font('Helvetica').fontSize(10).text(`Status: ${booking.bookingStatus || 'Completed'}`, 366, 100, {
      width: 182,
      align: 'right',
    });

    let y = 144;

    doc.save();
    doc.roundedRect(36, y, 255, 90, 8).fill('#f8fafc');
    doc.roundedRect(304, y, 255, 90, 8).fill('#f8fafc');
    doc.restore();

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Customer', 50, y + 14);
    doc.fillColor('#334155').font('Helvetica').fontSize(10).text(customerName, 50, y + 36);
    doc.text(customerEmail, 50, y + 52);
    doc.text(`Booking User ID: ${booking?.user?._id || booking?.user || 'N/A'}`, 50, y + 68);

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Rental Details', 318, y + 14);
    doc.fillColor('#334155').font('Helvetica').fontSize(10).text(carName, 318, y + 36);
    if (carMeta) {
      doc.text(carMeta, 318, y + 52, { width: 220 });
    }
    doc.text(`Pickup: ${formatDateTime(booking?.pickupDateTime || booking?.fromDate)}`, 318, y + 68);

    y += 106;

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Car Snapshot', 36, y);
    y += 16;

    doc.save();
    doc.roundedRect(36, y, 523, 120, 8).fill('#f8fafc');
    doc.restore();

    if (carImageBuffer) {
      try {
        doc.image(carImageBuffer, 44, y + 8, { fit: [507, 104], align: 'center', valign: 'center' });
      } catch {
        doc.fillColor('#64748b').font('Helvetica').fontSize(10).text('Car image unavailable', 250, y + 54, {
          align: 'center',
        });
      }
    } else {
      doc.fillColor('#64748b').font('Helvetica').fontSize(10).text('Car image unavailable', 250, y + 54, {
        align: 'center',
      });
    }

    y += 136;

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Rental Timeline', 36, y);
    y += 18;

    drawLabelValue(doc, 'Pickup Date & Time', formatDateTime(booking?.pickupDateTime || booking?.fromDate), 36, y, 220);
    y += 18;
    drawLabelValue(doc, 'Drop Date & Time', formatDateTime(booking?.dropDateTime || booking?.toDate), 36, y, 220);
    y += 18;
    drawLabelValue(doc, 'Actual Return Time', formatDateTime(booking?.actualReturnTime || booking?.fullPaymentReceivedAt), 36, y, 220);
    y += 24;

    doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Financial Breakdown', 36, y);
    y += 18;

    const rowStartX = 36;
    const rowValueX = 366;
    const rowWidth = 523;
    const drawFinancialRow = (label, value, isLast = false) => {
      drawLabelValue(doc, label, value, rowStartX, y, rowValueX);
      if (!isLast) {
        doc.moveTo(36, y + 14).lineTo(559, y + 14).lineWidth(0.6).strokeColor('#dbe4ee').stroke();
      }
      y += 18;
    };

    drawFinancialRow('Final Negotiated Amount', formatMoney(finalAmount));
    drawFinancialRow('Advance Paid', formatMoney(advancePaid));
    drawFinancialRow('Late Hours', String(lateHours));
    drawFinancialRow('Late Fee', formatMoney(lateFee));
    drawFinancialRow('Damage Cost', formatMoney(damageCost));
    drawFinancialRow('Total Amount', formatMoney(totalAmount));
    drawFinancialRow('Amount Paid', formatMoney(amountPaid));
    drawFinancialRow('Remaining Amount', formatMoney(remainingAmount), true);

    y += 4;
    doc.save();
    doc.roundedRect(36, y, 523, 30, 6).fill('#1e3a8a');
    doc.restore();

    doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(12).text('Invoice Settlement Status', 50, y + 8);
    doc.text(remainingAmount <= 0 ? 'Paid in Full' : `Pending ${formatMoney(remainingAmount)}`, 366, y + 8, {
      width: 182,
      align: 'right',
    });

    if (damageCost > 0) {
      y += 44;
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(12).text('Damage Charges', 36, y);
      y += 18;
      drawLabelValue(doc, 'Damage Cost', formatMoney(damageCost), 36, y, 220);
      y += 18;
      drawLabelValue(doc, 'Inspection Notes', damageNotes || 'No notes', 36, y, 220);
    }

    const footerY = 772;
    doc.font('Helvetica').fontSize(9).fillColor('#334155').text('Thank you for choosing CarRental.', 36, footerY);
    doc.fillColor('#64748b').fontSize(8.5).text(FALLBACK_TERMS, 36, footerY + 12, {
      width: 523,
    });

    doc.end();

    doc.on('error', reject);
    stream.on('error', reject);
    stream.on('finish', resolve);
  }).catch(async (error) => {
    try {
      await fsp.unlink(absolutePath);
    } catch {
      // Ignore cleanup failures.
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

const createInvoiceNumberCandidate = (now = new Date()) => {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const randomValue = Math.floor(100000 + Math.random() * 900000);
  return `INV-${year}-${month}-${randomValue}`;
};

const generateUniqueInvoiceNumber = async (bookingId, now = new Date()) => {
  const targetBookingId = bookingId || null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const candidate = createInvoiceNumberCandidate(now);
    const existing = await Booking.exists({
      invoiceNumber: candidate,
      ...(targetBookingId ? { _id: { $ne: targetBookingId } } : {}),
    });
    if (!existing) return candidate;
  }

  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `INV-${year}-${month}-${String(Date.now()).slice(-6)}`;
};

const hydrateBookingForInvoice = async (bookingOrId) => {
  const bookingId = bookingOrId?._id || bookingOrId;
  if (!bookingId) return null;

  const hasPopulate = bookingOrId && typeof bookingOrId.populate === 'function';
  let booking = hasPopulate ? bookingOrId : await Booking.findById(bookingId);
  if (!booking) return null;

  await booking.populate([
    { path: 'user', select: 'firstName lastName email' },
    { path: 'car', select: 'brand model category transmission location image pricePerDay' },
  ]);

  return booking;
};

const ensureBookingInvoiceGenerated = async (bookingOrId, options = {}) => {
  const booking = await hydrateBookingForInvoice(bookingOrId);
  if (!booking) {
    const error = new Error('Booking not found');
    error.status = 404;
    throw error;
  }

  if (!isInvoiceEligible(booking)) {
    return {
      generated: false,
      reason: 'not-eligible',
      booking,
    };
  }

  if (isInvoiceGenerated(booking)) {
    return {
      generated: false,
      reason: 'already-generated',
      booking,
    };
  }

  const generatedAt = options.generatedAt instanceof Date ? options.generatedAt : new Date();
  booking.invoiceNumber = booking.invoiceNumber || (await generateUniqueInvoiceNumber(booking._id, generatedAt));

  const pdfPayload = await renderInvoicePdf(booking, {
    invoiceNumber: booking.invoiceNumber,
    generatedAt,
  });

  booking.invoiceGeneratedAt = generatedAt;
  booking.invoicePdfPath = pdfPayload.relativePath;
  booking.invoiceStatus = 'Generated';
  await booking.save();

  return {
    generated: true,
    booking,
    ...pdfPayload,
  };
};

module.exports = {
  INVOICE_DIR,
  isInvoiceEligible,
  isInvoiceGenerated,
  sanitizeFileName,
  resolveInvoiceAbsolutePath,
  ensureBookingInvoiceGenerated,
  hydrateBookingForInvoice,
};
