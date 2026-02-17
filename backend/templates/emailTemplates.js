const COMPANY_NAME = process.env.COMPANY_NAME || 'CarRental';
const COMPANY_SUPPORT_EMAIL = process.env.COMPANY_SUPPORT_EMAIL || '';
const FALLBACK_TERMS =
  'This message is informational only. Please do not share OTPs, passwords, or sensitive personal data.';

const buildLayout = ({ title, preheader, bodyHtml }) => {
  const supportLine = COMPANY_SUPPORT_EMAIL
    ? `<p style="margin:0;color:#64748b;font-size:12px;">Support: ${COMPANY_SUPPORT_EMAIL}</p>`
    : '';

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader || title}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden;">
          <tr>
            <td style="background:#1e3a8a;padding:18px 22px;">
              <h1 style="margin:0;font-size:20px;line-height:1.2;color:#ffffff;">${COMPANY_NAME}</h1>
              <p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">Rental Notification</p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 22px;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="border-top:1px solid #e2e8f0;padding:14px 22px;background:#f8fafc;">
              ${supportLine}
              <p style="margin:8px 0 0;color:#94a3b8;font-size:11px;">${FALLBACK_TERMS}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

const toPlainText = (lines = []) => lines.filter(Boolean).join('\n');

const buildSummaryTable = (rows = []) => {
  const cleanedRows = rows.filter((row) => row && row.label);
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border:1px solid #dbe4ee;border-radius:8px;overflow:hidden;">
    ${cleanedRows
      .map(
        (row) => `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;background:#f8fafc;color:#475569;font-size:13px;width:42%;">${row.label}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#0f172a;font-size:13px;font-weight:600;">${row.value || 'N/A'}</td>
      </tr>`,
      )
      .join('')}
  </table>`;
};

const bookingCreatedTemplate = ({
  customerName,
  bookingReference,
  carName,
  advanceRequired,
  paymentDeadline,
  paymentDeadlineReminder,
}) => {
  const subject = `Booking Created: Advance Payment Pending (${bookingReference})`;
  const html = buildLayout({
    title: subject,
    preheader: 'Complete advance payment before deadline to confirm your booking.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Booking Created (Pending Payment)</h2>
      <p style="margin:0 0 14px;color:#334155;font-size:14px;">Hi ${customerName || 'Customer'}, your booking has been created and is waiting for advance payment confirmation.</p>
      ${buildSummaryTable([
        { label: 'Booking ID', value: bookingReference },
        { label: 'Car', value: carName },
        { label: 'Advance Amount Required', value: advanceRequired },
        { label: 'Payment Deadline', value: paymentDeadline },
        { label: 'Reminder', value: paymentDeadlineReminder },
      ])}
      <p style="margin:14px 0 0;color:#334155;font-size:13px;">If payment is not received before the deadline, the booking may be cancelled automatically.</p>
    `,
  });

  const text = toPlainText([
    'Booking Created (Pending Payment)',
    `Booking ID: ${bookingReference}`,
    `Car: ${carName}`,
    `Advance Required: ${advanceRequired}`,
    `Payment Deadline: ${paymentDeadline}`,
    `Reminder: ${paymentDeadlineReminder}`,
  ]);

  return { subject, html, text };
};

const advancePaidConfirmedTemplate = ({
  customerName,
  bookingReference,
  carName,
  pickupDateTime,
  dropDateTime,
  advancePaid,
  remainingAmount,
}) => {
  const subject = `Booking Confirmed: Advance Received (${bookingReference})`;
  const html = buildLayout({
    title: subject,
    preheader: 'Your advance payment is confirmed and booking is now active.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Advance Paid (Booking Confirmed)</h2>
      <p style="margin:0 0 14px;color:#334155;font-size:14px;">Hi ${customerName || 'Customer'}, your advance payment was received successfully.</p>
      ${buildSummaryTable([
        { label: 'Booking ID', value: bookingReference },
        { label: 'Car', value: carName },
        { label: 'Pickup Date & Time', value: pickupDateTime },
        { label: 'Drop Date & Time', value: dropDateTime },
        { label: 'Advance Paid', value: advancePaid },
        { label: 'Remaining Balance', value: remainingAmount },
      ])}
    `,
  });

  const text = toPlainText([
    'Advance Paid (Booking Confirmed)',
    `Booking ID: ${bookingReference}`,
    `Car: ${carName}`,
    `Pickup: ${pickupDateTime}`,
    `Drop: ${dropDateTime}`,
    `Advance Paid: ${advancePaid}`,
    `Remaining Balance: ${remainingAmount}`,
  ]);

  return { subject, html, text };
};

const autoCancelledTemplate = ({
  customerName,
  bookingReference,
  carName,
  cancellationReason,
  rebookHint,
}) => {
  const subject = `Booking Cancelled: Payment Timeout (${bookingReference})`;
  const html = buildLayout({
    title: subject,
    preheader: 'Your booking was cancelled due to unpaid advance.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Booking Auto Cancelled</h2>
      <p style="margin:0 0 14px;color:#334155;font-size:14px;">Hi ${customerName || 'Customer'}, this booking was cancelled automatically.</p>
      ${buildSummaryTable([
        { label: 'Booking ID', value: bookingReference },
        { label: 'Car', value: carName },
        { label: 'Reason', value: cancellationReason },
      ])}
      <p style="margin:14px 0 0;color:#334155;font-size:13px;">${rebookHint}</p>
    `,
  });

  const text = toPlainText([
    'Booking Auto Cancelled',
    `Booking ID: ${bookingReference}`,
    `Car: ${carName}`,
    `Reason: ${cancellationReason}`,
    rebookHint,
  ]);

  return { subject, html, text };
};

const overdueAlertTemplate = ({
  customerName,
  bookingReference,
  carName,
  lateHours,
  lateFee,
  payableAmount,
}) => {
  const subject = `Rental Overdue Alert (${bookingReference})`;
  const html = buildLayout({
    title: subject,
    preheader: 'Your rental is overdue and additional charges are accruing.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#b91c1c;">Rental Overdue Alert</h2>
      <p style="margin:0 0 14px;color:#334155;font-size:14px;">Hi ${customerName || 'Customer'}, your rental return is overdue.</p>
      ${buildSummaryTable([
        { label: 'Booking ID', value: bookingReference },
        { label: 'Car', value: carName },
        { label: 'Late Hours', value: lateHours },
        { label: 'Current Late Fee', value: lateFee },
        { label: 'Updated Payable Amount', value: payableAmount },
      ])}
      <p style="margin:14px 0 0;color:#334155;font-size:13px;">Please complete return/payment to avoid further penalties.</p>
    `,
  });

  const text = toPlainText([
    'Rental Overdue Alert',
    `Booking ID: ${bookingReference}`,
    `Car: ${carName}`,
    `Late Hours: ${lateHours}`,
    `Current Late Fee: ${lateFee}`,
    `Updated Payable Amount: ${payableAmount}`,
  ]);

  return { subject, html, text };
};

const completedWithInvoiceTemplate = ({
  customerName,
  bookingReference,
  invoiceNumber,
  finalAmount,
  advancePaid,
  lateFee,
  totalPaid,
  remainingAmount,
}) => {
  const subject = `Booking Completed & Invoice Ready (${bookingReference})`;
  const html = buildLayout({
    title: subject,
    preheader: 'Your booking is completed and invoice is attached.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Booking Completed + Invoice</h2>
      <p style="margin:0 0 14px;color:#334155;font-size:14px;">Hi ${customerName || 'Customer'}, your booking is completed successfully.</p>
      ${buildSummaryTable([
        { label: 'Booking ID', value: bookingReference },
        { label: 'Invoice Number', value: invoiceNumber || 'Generated' },
        { label: 'Final Negotiated Amount', value: finalAmount },
        { label: 'Advance Paid', value: advancePaid },
        { label: 'Late Fee', value: lateFee },
        { label: 'Total Amount Paid', value: totalPaid },
        { label: 'Remaining Amount', value: remainingAmount },
      ])}
      <p style="margin:14px 0 0;color:#334155;font-size:13px;">Your invoice PDF is attached with this email when available.</p>
    `,
  });

  const text = toPlainText([
    'Booking Completed + Invoice',
    `Booking ID: ${bookingReference}`,
    `Invoice Number: ${invoiceNumber || 'Generated'}`,
    `Final Amount: ${finalAmount}`,
    `Advance Paid: ${advancePaid}`,
    `Late Fee: ${lateFee}`,
    `Total Paid: ${totalPaid}`,
    `Remaining: ${remainingAmount}`,
  ]);

  return { subject, html, text };
};

const refundProcessedTemplate = ({
  customerName,
  bookingReference,
  refundAmount,
  refundDate,
  totalPaidBeforeRefund,
  totalPaidAfterRefund,
  remainingAmount,
  refundReason,
}) => {
  const subject = `Refund Processed (${bookingReference})`;
  const html = buildLayout({
    title: subject,
    preheader: 'Your refund has been processed successfully.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Refund Confirmation</h2>
      <p style="margin:0 0 14px;color:#334155;font-size:14px;">Hi ${customerName || 'Customer'}, your refund request has been processed.</p>
      ${buildSummaryTable([
        { label: 'Booking ID', value: bookingReference },
        { label: 'Refund Amount', value: refundAmount },
        { label: 'Refund Date', value: refundDate },
        { label: 'Total Paid (Before Refund)', value: totalPaidBeforeRefund },
        { label: 'Total Paid (After Refund)', value: totalPaidAfterRefund },
        { label: 'Remaining Amount', value: remainingAmount },
        { label: 'Refund Reason', value: refundReason || 'N/A' },
      ])}
      <p style="margin:14px 0 0;color:#334155;font-size:13px;">If you need assistance, please contact support.</p>
    `,
  });

  const text = toPlainText([
    'Refund Confirmation',
    `Booking ID: ${bookingReference}`,
    `Refund Amount: ${refundAmount}`,
    `Refund Date: ${refundDate}`,
    `Total Paid Before Refund: ${totalPaidBeforeRefund}`,
    `Total Paid After Refund: ${totalPaidAfterRefund}`,
    `Remaining Amount: ${remainingAmount}`,
    `Refund Reason: ${refundReason || 'N/A'}`,
  ]);

  return { subject, html, text };
};

const subscriptionActivatedTemplate = ({
  subjectPrefix = '',
  customerName,
  subscriptionReference,
  planName,
  startDate,
  endDate,
  includedRentalHours,
  amountPaid,
  autoRenew,
}) => {
  const prefix = String(subjectPrefix || '').trim();
  const subject = `${prefix ? `${prefix}: ` : ''}Subscription Activated (${subscriptionReference})`;
  const html = buildLayout({
    title: subject,
    preheader: 'Your subscription is active and ready to use.',
    bodyHtml: `
      <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a;">Subscription Activated</h2>
      <p style="margin:0 0 14px;color:#334155;font-size:14px;">Hi ${customerName || 'Customer'}, your subscription has been activated successfully.</p>
      ${buildSummaryTable([
        { label: 'Subscription ID', value: subscriptionReference },
        { label: 'Plan', value: planName },
        { label: 'Start Date', value: startDate },
        { label: 'End Date', value: endDate },
        { label: 'Included Rental Hours', value: includedRentalHours },
        { label: 'Amount Paid', value: amountPaid },
        { label: 'Auto Renew', value: autoRenew },
      ])}
      <p style="margin:14px 0 0;color:#334155;font-size:13px;">You can now book cars using subscription mode from the booking page.</p>
    `,
  });

  const text = toPlainText([
    'Subscription Activated',
    `Subscription ID: ${subscriptionReference}`,
    `Plan: ${planName}`,
    `Start Date: ${startDate}`,
    `End Date: ${endDate}`,
    `Included Rental Hours: ${includedRentalHours}`,
    `Amount Paid: ${amountPaid}`,
    `Auto Renew: ${autoRenew}`,
  ]);

  return { subject, html, text };
};

module.exports = {
  bookingCreatedTemplate,
  advancePaidConfirmedTemplate,
  autoCancelledTemplate,
  overdueAlertTemplate,
  completedWithInvoiceTemplate,
  refundProcessedTemplate,
  subscriptionActivatedTemplate,
};
