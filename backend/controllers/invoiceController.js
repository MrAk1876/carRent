const fsp = require('fs/promises');
const path = require('path');
const mongoose = require('mongoose');
const { isStaffRole } = require('../utils/rbac');

const {
  ensureBookingInvoiceGenerated,
  hydrateBookingForInvoice,
  isInvoiceEligible,
  isInvoiceGenerated,
  resolveInvoiceAbsolutePath,
  sanitizeFileName,
} = require('../services/invoiceService');

const canDownloadInvoice = (requestUser, booking) => {
  if (!requestUser || !booking) return false;
  if (isStaffRole(requestUser.role)) return true;

  const bookingOwnerId = String(booking?.user?._id || booking?.user || '');
  const requesterId = String(requestUser?._id || '');
  return Boolean(bookingOwnerId) && bookingOwnerId === requesterId;
};

exports.downloadBookingInvoice = async (req, res) => {
  try {
    const bookingId = req.params.bookingId;
    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({ message: 'Invalid booking id' });
    }

    const booking = await hydrateBookingForInvoice(bookingId);
    if (!booking) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    if (!canDownloadInvoice(req.user, booking)) {
      return res.status(403).json({ message: 'You are not allowed to download this invoice' });
    }

    if (!isInvoiceEligible(booking)) {
      return res.status(422).json({
        message: 'Invoice is available only for completed bookings with full payment',
      });
    }

    if (!isInvoiceGenerated(booking)) {
      try {
        await ensureBookingInvoiceGenerated(booking, { generatedAt: new Date() });
      } catch (error) {
        console.error('invoice generation failed during download:', error);
        return res.status(500).json({ message: 'Failed to generate invoice' });
      }
    }

    if (!booking.invoicePdfPath) {
      return res.status(404).json({ message: 'Invoice file is unavailable' });
    }

    const absolutePdfPath = resolveInvoiceAbsolutePath(booking.invoicePdfPath);
    if (!absolutePdfPath) {
      return res.status(404).json({ message: 'Invoice file path is invalid' });
    }

    try {
      await fsp.access(absolutePdfPath);
    } catch {
      return res.status(404).json({ message: 'Invoice file is missing' });
    }

    const baseName = booking.invoiceNumber || `invoice-${sanitizeFileName(booking._id)}`;
    const fileName = `${sanitizeFileName(baseName)}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    return res.sendFile(path.resolve(absolutePdfPath));
  } catch (error) {
    console.error('downloadBookingInvoice error:', error);
    return res.status(500).json({ message: 'Failed to download invoice' });
  }
};
