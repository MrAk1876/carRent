import { jsPDF } from 'jspdf';
import logoUrl from '../assets/logo.svg';
import { getUser } from './auth';

const MM_PER_INCH = 25.4;
const DEFAULT_DPI = 96;

const COLOR = {
  primary: [30, 64, 175],
  primaryDark: [15, 35, 95],
  primarySoft: [219, 234, 254],
  ink900: [15, 23, 42],
  ink700: [51, 65, 85],
  ink500: [100, 116, 139],
  border: [203, 213, 225],
  panel: [248, 250, 252],
  white: [255, 255, 255],
  successSoft: [220, 252, 231],
  successText: [21, 128, 61],
  dangerSoft: [254, 226, 226],
  dangerText: [220, 38, 38],
};

const normalizeCurrencyPrefix = (currency) => {
  const raw = String(currency || '').trim();
  if (!raw) return '';
  if (raw.includes('\u20B9') || raw.toLowerCase() === 'inr') return 'INR ';
  if (/^[A-Za-z]{3}$/.test(raw)) return `${raw.toUpperCase()} `;
  return `${raw} `;
};

const toSafeNumber = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric;
};

const toPixels = (mm, dpi = DEFAULT_DPI) => Math.max(Math.round((mm / MM_PER_INCH) * dpi), 1);

const formatMoney = (currency, value) =>
  `${normalizeCurrencyPrefix(currency)}${toSafeNumber(value).toLocaleString('en-IN', {
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

const setTextColor = (doc, color) => {
  doc.setTextColor(color[0], color[1], color[2]);
};

const setFillColor = (doc, color) => {
  doc.setFillColor(color[0], color[1], color[2]);
};

const setDrawColor = (doc, color) => {
  doc.setDrawColor(color[0], color[1], color[2]);
};

const drawImageToDataUrl = (src, options = {}) =>
  new Promise((resolve, reject) => {
    const {
      width = 800,
      height = 450,
      fit = 'cover',
      format = 'image/jpeg',
      quality = 0.92,
      background = '#ffffff',
    } = options;

    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas rendering failed');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        if (background) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, width, height);
        } else {
          ctx.clearRect(0, 0, width, height);
        }

        const imageRatio = image.width / image.height;
        const canvasRatio = width / height;

        let drawWidth = width;
        let drawHeight = height;
        let dx = 0;
        let dy = 0;

        if (fit === 'contain') {
          if (imageRatio > canvasRatio) {
            drawHeight = width / imageRatio;
            dy = (height - drawHeight) / 2;
          } else {
            drawWidth = height * imageRatio;
            dx = (width - drawWidth) / 2;
          }
        } else {
          if (imageRatio > canvasRatio) {
            drawWidth = height * imageRatio;
            dx = (width - drawWidth) / 2;
          } else {
            drawHeight = width / imageRatio;
            dy = (height - drawHeight) / 2;
          }
        }

        ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
        resolve(canvas.toDataURL(format, quality));
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('Image load failed'));
    image.src = src;
  });

const loadImageDataUrl = async (sourceUrl, options) => {
  if (!sourceUrl) return '';

  try {
    const response = await fetch(sourceUrl, { mode: 'cors' });
    if (response.ok) {
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        return await drawImageToDataUrl(objectUrl, options);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }
  } catch {
    // Continue with direct URL fallback.
  }

  try {
    return await drawImageToDataUrl(sourceUrl, options);
  } catch {
    return '';
  }
};

const drawCard = (doc, x, y, width, height, options = {}) => {
  const { fill = COLOR.white, border = COLOR.border, radius = 2.5 } = options;
  setFillColor(doc, fill);
  setDrawColor(doc, border);
  doc.roundedRect(x, y, width, height, radius, radius, 'FD');
};

const drawBadge = (doc, x, y, text, tone = 'default') => {
  const normalizedTone = String(tone || '').toLowerCase();
  const isPositive = normalizedTone === 'success';
  const isNegative = normalizedTone === 'danger';

  const fill = isPositive ? COLOR.successSoft : isNegative ? COLOR.dangerSoft : COLOR.primarySoft;
  const textColor = isPositive ? COLOR.successText : isNegative ? COLOR.dangerText : COLOR.primaryDark;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.2);
  const horizontalPadding = 2.7;
  const width = Math.max(doc.getTextWidth(text) + horizontalPadding * 2, 24);

  setFillColor(doc, fill);
  doc.roundedRect(x, y, width, 6.8, 2.4, 2.4, 'F');

  setTextColor(doc, textColor);
  doc.text(text, x + width / 2, y + 4.5, { align: 'center' });

  return width;
};

const drawMetricCard = (doc, x, y, width, height, label, value, tone = 'default') => {
  const normalizedTone = String(tone || '').toLowerCase();
  const fill =
    normalizedTone === 'danger'
      ? [254, 242, 242]
      : normalizedTone === 'success'
      ? [240, 253, 244]
      : COLOR.panel;
  const valueColor =
    normalizedTone === 'danger'
      ? COLOR.dangerText
      : normalizedTone === 'success'
      ? COLOR.successText
      : COLOR.ink900;

  drawCard(doc, x, y, width, height, { fill, border: COLOR.border });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  setTextColor(doc, COLOR.ink500);
  doc.text(label, x + 3, y + 5.5);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13.2);
  setTextColor(doc, valueColor);
  doc.text(value, x + 3, y + 13.2);
};

const addRow = (doc, label, value, x, y, width, options = {}) => {
  const { drawDivider = true } = options;
  const valueText = String(value || 'N/A');
  const valueX = x + width * 0.42;
  const valueWidth = width - (valueX - x);
  const wrappedValue = doc.splitTextToSize(valueText, valueWidth);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.7);
  setTextColor(doc, COLOR.ink700);
  doc.text(label, x, y);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setTextColor(doc, COLOR.ink900);
  doc.text(wrappedValue, valueX, y);

  const rowHeight = Math.max(6, wrappedValue.length * 4.2 + 1.2);

  if (drawDivider) {
    setDrawColor(doc, COLOR.border);
    doc.setLineDashPattern([1, 1], 0);
    doc.line(x, y + rowHeight - 2.2, x + width, y + rowHeight - 2.2);
    doc.setLineDashPattern([], 0);
  }

  return y + rowHeight;
};

const getCompanyOrigin = () => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'CarRental';
};

const getStageTone = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized.includes('overdue') || normalized.includes('cancel')) return 'danger';
  if (normalized.includes('completed') || normalized.includes('confirmed')) return 'success';
  return 'default';
};

const inferImageType = (dataUrl, fallback = 'JPEG') => {
  if (typeof dataUrl !== 'string') return fallback;
  if (dataUrl.startsWith('data:image/png')) return 'PNG';
  if (dataUrl.startsWith('data:image/webp')) return 'WEBP';
  return fallback;
};

export const downloadBookingInvoice = async ({ booking, currency = '\u20B9' }) => {
  if (!booking?._id) {
    throw new Error('Valid booking is required to download invoice');
  }

  const safeId = String(booking._id).replace(/[^a-zA-Z0-9-_]/g, '').slice(-10) || 'booking';
  const currentUser = getUser() || {};
  const customerName =
    `${booking?.user?.firstName || ''} ${booking?.user?.lastName || ''}`.trim() ||
    `${currentUser?.firstName || ''} ${currentUser?.lastName || ''}`.trim() ||
    'Customer';
  const customerEmail = booking?.user?.email || currentUser?.email || 'N/A';

  const finalAmount = toSafeNumber(booking?.finalAmount || booking?.totalAmount);
  const advancePaid = toSafeNumber(booking?.advancePaid || booking?.advanceRequired || booking?.advanceAmount);
  const settlementAmount = toSafeNumber(booking?.fullPaymentAmount);
  const lateFee = toSafeNumber(booking?.lateFee);
  const lateHours = Math.max(Math.floor(toSafeNumber(booking?.lateHours)), 0);
  const invoiceAmount = Number((finalAmount + lateFee).toFixed(2));
  const totalPaid = Number((advancePaid + settlementAmount).toFixed(2));

  const remainingFromBooking = toSafeNumber(booking?.remainingAmount);
  const computedRemaining = Number((invoiceAmount - totalPaid).toFixed(2));
  const remainingAmount =
    remainingFromBooking > 0 ? Number(remainingFromBooking.toFixed(2)) : Math.max(computedRemaining, 0);

  const carName = `${booking?.car?.brand || ''} ${booking?.car?.model || ''}`.trim() || 'Car';
  const carMeta =
    [booking?.car?.category, booking?.car?.transmission, booking?.car?.location].filter(Boolean).join(' | ') ||
    'N/A';
  const pickupDateTime = booking?.pickupDateTime || booking?.fromDate;
  const dropDateTime = booking?.dropDateTime || booking?.toDate;
  const returnedAt = booking?.actualReturnTime || booking?.fullPaymentReceivedAt || booking?.updatedAt;
  const issuedAt = new Date();

  const paymentMethod = booking?.fullPaymentMethod || booking?.paymentMethod || 'N/A';
  const bookingStatus = booking?.bookingStatus || 'N/A';
  const rentalStage = booking?.rentalStage || booking?.tripStatus || 'N/A';

  const logoDataUrl = await loadImageDataUrl(logoUrl, {
    width: toPixels(38),
    height: toPixels(12),
    fit: 'contain',
    format: 'image/png',
    quality: 1,
    background: null,
  });

  const carImageDataUrl = await loadImageDataUrl(booking?.car?.image, {
    width: 1600,
    height: 900,
    fit: 'contain',
    format: 'image/png',
    quality: 1,
    background: '#f1f5f9',
  });

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 12;
  const contentWidth = pageWidth - margin * 2;
  const footerY = pageHeight - 8;
  let cursorY = margin;

  const ensureSpace = (height) => {
    if (cursorY + height <= footerY - 4) return;
    doc.addPage();
    cursorY = margin;
  };

  ensureSpace(36);
  drawCard(doc, margin, cursorY, contentWidth, 34, {
    fill: COLOR.primaryDark,
    border: COLOR.primaryDark,
    radius: 3.2,
  });
  setFillColor(doc, COLOR.primary);
  doc.roundedRect(margin + 1.2, cursorY + 1.2, contentWidth - 2.4, 9.5, 2.4, 2.4, 'F');

  if (logoDataUrl) {
    doc.addImage(logoDataUrl, 'PNG', margin + 3.2, cursorY + 2.2, 29, 8.4);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16.5);
  setTextColor(doc, COLOR.white);
  doc.text('Rental Invoice', margin + 3.6, cursorY + 18.4);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.6);
  doc.text(`Issued: ${formatDateTime(issuedAt.toISOString())}`, margin + 3.6, cursorY + 23.8);
  doc.text(`Portal: ${getCompanyOrigin()}`, margin + 3.6, cursorY + 28.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.8);
  setTextColor(doc, COLOR.white);
  doc.text(`INV-${safeId.toUpperCase()}`, margin + contentWidth - 3.8, cursorY + 5.8, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.2);
  doc.text(`Booking: ${booking._id}`, margin + contentWidth - 3.8, cursorY + 18.2, { align: 'right' });
  doc.text(`Customer: ${customerName}`, margin + contentWidth - 3.8, cursorY + 22.6, { align: 'right' });

  let badgeX = margin + 3.6;
  badgeX += drawBadge(
    doc,
    badgeX,
    cursorY + 29,
    `Stage: ${String(rentalStage).toUpperCase()}`,
    getStageTone(rentalStage),
  );
  badgeX += 1.8;
  drawBadge(
    doc,
    badgeX,
    cursorY + 29,
    `Status: ${String(bookingStatus).toUpperCase()}`,
    getStageTone(bookingStatus),
  );

  cursorY += 39;

  ensureSpace(20);
  const metricGap = 3;
  const metricWidth = (contentWidth - metricGap * 2) / 3;
  drawMetricCard(
    doc,
    margin,
    cursorY,
    metricWidth,
    18,
    'INVOICE TOTAL',
    formatMoney(currency, invoiceAmount),
    'default',
  );
  drawMetricCard(
    doc,
    margin + metricWidth + metricGap,
    cursorY,
    metricWidth,
    18,
    'TOTAL PAID',
    formatMoney(currency, totalPaid),
    totalPaid >= invoiceAmount ? 'success' : 'default',
  );
  drawMetricCard(
    doc,
    margin + (metricWidth + metricGap) * 2,
    cursorY,
    metricWidth,
    18,
    'BALANCE DUE',
    formatMoney(currency, remainingAmount),
    remainingAmount > 0 ? 'danger' : 'success',
  );

  cursorY += 22;

  ensureSpace(30);
  const topGap = 4;
  const infoWidth = (contentWidth - topGap) / 2;
  const infoHeight = 27;

  drawCard(doc, margin, cursorY, infoWidth, infoHeight, { fill: COLOR.white, border: COLOR.border });
  drawCard(doc, margin + infoWidth + topGap, cursorY, infoWidth, infoHeight, {
    fill: COLOR.white,
    border: COLOR.border,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  setTextColor(doc, COLOR.ink900);
  doc.text('Billed To', margin + 3.4, cursorY + 6.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(customerName, margin + 3.4, cursorY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.6);
  setTextColor(doc, COLOR.ink700);
  const customerLines = doc.splitTextToSize(customerEmail, infoWidth - 6.8);
  doc.text(customerLines, margin + 3.4, cursorY + 16.8);
  doc.text(`User ID: ${booking?.user?._id || 'N/A'}`, margin + 3.4, cursorY + 23.4);

  const carX = margin + infoWidth + topGap + 3.4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  setTextColor(doc, COLOR.ink900);
  doc.text('Vehicle', carX, cursorY + 6.2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(carName, carX, cursorY + 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.6);
  setTextColor(doc, COLOR.ink700);
  const carLines = doc.splitTextToSize(carMeta, infoWidth - 6.8);
  doc.text(carLines, carX, cursorY + 16.8);
  doc.text(`Car ID: ${booking?.car?._id || 'N/A'}`, carX, cursorY + 23.4);

  cursorY += infoHeight + 4;

  ensureSpace(45);
  drawCard(doc, margin, cursorY, contentWidth, 41, { fill: COLOR.panel, border: COLOR.border });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  setTextColor(doc, COLOR.ink900);
  doc.text('Car Snapshot', margin + 3.4, cursorY + 6.1);

  const imageX = margin + 3.4;
  const imageY = cursorY + 8.4;
  const imageWidth = contentWidth - 6.8;
  const imageHeight = 29.8;

  if (carImageDataUrl) {
    setFillColor(doc, COLOR.white);
    setDrawColor(doc, COLOR.border);
    doc.roundedRect(imageX, imageY, imageWidth, imageHeight, 1.8, 1.8, 'FD');
    doc.addImage(
      carImageDataUrl,
      inferImageType(carImageDataUrl, 'PNG'),
      imageX + 0.6,
      imageY + 0.6,
      imageWidth - 1.2,
      imageHeight - 1.2,
    );
  } else {
    setFillColor(doc, COLOR.white);
    setDrawColor(doc, COLOR.border);
    doc.roundedRect(imageX, imageY, imageWidth, imageHeight, 1.8, 1.8, 'FD');
    setTextColor(doc, COLOR.ink500);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Car image unavailable', margin + contentWidth / 2, imageY + imageHeight / 2 + 1.6, {
      align: 'center',
    });
  }

  cursorY += 45;

  ensureSpace(65);
  const bottomGap = 4;
  const leftWidth = (contentWidth - bottomGap) * 0.46;
  const rightWidth = contentWidth - bottomGap - leftWidth;
  const sectionHeight = 61;

  drawCard(doc, margin, cursorY, leftWidth, sectionHeight, {
    fill: COLOR.white,
    border: COLOR.border,
  });
  drawCard(doc, margin + leftWidth + bottomGap, cursorY, rightWidth, sectionHeight, {
    fill: COLOR.white,
    border: COLOR.border,
  });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.3);
  setTextColor(doc, COLOR.ink900);
  doc.text('Rental Details', margin + 3.4, cursorY + 6.2);

  let leftY = cursorY + 12.2;
  leftY = addRow(doc, 'Pickup Date & Time', formatDateTime(pickupDateTime), margin + 3.4, leftY, leftWidth - 6.8);
  leftY = addRow(doc, 'Drop Date & Time', formatDateTime(dropDateTime), margin + 3.4, leftY, leftWidth - 6.8);
  leftY = addRow(doc, 'Returned At', formatDateTime(returnedAt), margin + 3.4, leftY, leftWidth - 6.8);
  leftY = addRow(
    doc,
    'Grace Period',
    `${Math.max(toSafeNumber(booking?.gracePeriodHours), 0) || 1} hour(s)`,
    margin + 3.4,
    leftY,
    leftWidth - 6.8,
  );
  addRow(doc, 'Payment Method', paymentMethod, margin + 3.4, leftY, leftWidth - 6.8, {
    drawDivider: false,
  });

  const rightX = margin + leftWidth + bottomGap + 3.4;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.3);
  setTextColor(doc, COLOR.ink900);
  doc.text('Payment Breakdown', rightX, cursorY + 6.2);

  let rightY = cursorY + 12.2;
  rightY = addRow(doc, 'Final Amount', formatMoney(currency, finalAmount), rightX, rightY, rightWidth - 6.8);
  rightY = addRow(doc, 'Advance Paid', formatMoney(currency, advancePaid), rightX, rightY, rightWidth - 6.8);
  rightY = addRow(
    doc,
    'Settlement Paid',
    formatMoney(currency, settlementAmount),
    rightX,
    rightY,
    rightWidth - 6.8,
  );
  rightY = addRow(doc, 'Late Hours', String(lateHours), rightX, rightY, rightWidth - 6.8);
  addRow(doc, 'Late Fee', formatMoney(currency, lateFee), rightX, rightY, rightWidth - 6.8, {
    drawDivider: false,
  });

  const summaryX = margin + leftWidth + bottomGap + 3.4;
  const summaryY = cursorY + sectionHeight - 15.6;
  const summaryWidth = rightWidth - 6.8;

  setFillColor(doc, COLOR.primaryDark);
  doc.roundedRect(summaryX, summaryY, summaryWidth, 11.8, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.2);
  setTextColor(doc, COLOR.white);
  doc.text('Final Invoice Total', summaryX + 2.6, summaryY + 7.4);
  doc.text(formatMoney(currency, invoiceAmount), summaryX + summaryWidth - 2.6, summaryY + 7.4, {
    align: 'right',
  });

  const footerLineY = footerY - 3.1;
  setDrawColor(doc, COLOR.border);
  doc.line(margin, footerLineY, margin + contentWidth, footerLineY);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  setTextColor(doc, COLOR.ink500);
  doc.text('System generated invoice. Keep this PDF for rental and payment reference.', margin, footerY);
  doc.text(`Invoice ID: INV-${safeId.toUpperCase()}`, margin + contentWidth, footerY, { align: 'right' });

  doc.save(`invoice-${safeId}.pdf`);
};
