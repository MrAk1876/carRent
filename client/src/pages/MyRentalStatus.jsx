import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../api';
import LiveLateFeeSummary from '../components/ui/LiveLateFeeSummary';
import LiveStageCountdown from '../components/ui/LiveStageCountdown';
import Title from '../components/Title';
import { calculateLiveLateMetrics, getGraceDeadlineMs, useCountdown } from '../hooks/useCountdown';
import useNotify from '../hooks/useNotify';
import {
  downloadBookingInvoicePdf,
  getUserRentalDashboard,
  settleUserBookingReturn,
} from '../services/bookingService';
import {
  getNormalizedStatusKey,
  hasPickupInspection,
  hasReturnInspection,
  isFullyPaidStatus,
  isPaymentTimeoutCancelled,
  resolveAdvancePaid,
  resolveDamageCost,
  resolveDropDateTime,
  resolveFinalAmount,
  resolveLateFee,
  resolveLateHours,
  resolveHourlyLateRate,
  resolvePaymentDeadline,
  resolvePickupDateTime,
  resolveRefundAmount,
  resolveRefundProcessedAt,
  resolveRefundReason,
  resolveRefundStatus,
  resolveRentalType,
  resolveSubscriptionLateFeeDiscountPercent,
  resolveRentalStage,
  resolveRemainingAmount,
  resolveTotalPaidAmount,
  isRefundProcessedStatus,
} from '../utils/payment';

const PAYMENT_METHODS = ['UPI', 'CARD', 'NETBANKING', 'CASH'];
const TIMELINE_STEPS = [
  { key: 'created', label: 'Booking Created' },
  { key: 'advance_paid', label: 'Advance Paid' },
  { key: 'pickup_scheduled', label: 'Pickup Scheduled' },
  { key: 'rental_active', label: 'Rental Active' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Completed' },
];

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
};

const buildTimelineState = (booking, stage, lateHours) => {
  const normalizedStage = String(stage || '').trim().toLowerCase();
  const advancePaid = Math.max(Number(resolveAdvancePaid(booking) || 0), 0);
  const overdueApplicable = normalizedStage === 'overdue' || lateHours > 0;

  const doneKeys = new Set(['created']);
  if (advancePaid > 0 || isFullyPaidStatus(booking?.paymentStatus)) doneKeys.add('advance_paid');
  if (['scheduled', 'active', 'overdue', 'completed'].includes(normalizedStage)) doneKeys.add('pickup_scheduled');
  if (['active', 'overdue', 'completed'].includes(normalizedStage)) doneKeys.add('rental_active');
  if (overdueApplicable) doneKeys.add('overdue');
  if (normalizedStage === 'completed') doneKeys.add('completed');

  const currentKey =
    normalizedStage === 'completed'
      ? 'completed'
      : normalizedStage === 'overdue'
      ? 'overdue'
      : normalizedStage === 'active'
      ? 'rental_active'
      : normalizedStage === 'scheduled'
      ? 'pickup_scheduled'
      : 'created';

  return TIMELINE_STEPS
    .filter((step) => step.key !== 'overdue' || overdueApplicable || normalizedStage === 'overdue')
    .map((step) => ({
      ...step,
      done: doneKeys.has(step.key),
      current: step.key === currentKey,
    }));
};

const stageBadgeClass = (stage) => {
  if (stage === 'PendingPayment') return 'bg-amber-100 text-amber-700';
  if (stage === 'Cancelled') return 'bg-red-100 text-red-700';
  if (stage === 'Overdue') return 'bg-red-100 text-red-700';
  if (stage === 'Active') return 'bg-emerald-100 text-emerald-700';
  if (stage === 'Completed') return 'bg-gray-200 text-gray-700';
  return 'bg-blue-100 text-blue-700';
};

const RentalTimeline = ({ steps }) => (
  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
    {steps.map((step) => (
      <div
        key={step.key}
        className={`rounded-lg border px-2.5 py-2 text-xs ${
          step.current
            ? 'border-primary bg-primary/10 text-primary font-semibold'
            : step.done
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
            : 'border-borderColor bg-white text-gray-500'
        }`}
      >
        {step.label}
      </div>
    ))}
  </div>
);

const RentalStatusCard = ({
  booking,
  currency,
  paymentMethod,
  onPaymentMethodChange,
  onPayRemaining,
  onDownloadInvoice,
  loadingId,
}) => {
  const stage = resolveRentalStage(booking) || 'Scheduled';
  const finalAmount = resolveFinalAmount(booking);
  const advancePaid = resolveAdvancePaid(booking);
  const storedRemaining = resolveRemainingAmount(booking);
  const lateHours = resolveLateHours(booking);
  const lateFee = resolveLateFee(booking);
  const hourlyLateRate = resolveHourlyLateRate(booking);
  const damageCost = resolveDamageCost(booking);
  const rentalType = resolveRentalType(booking);
  const lateFeeDiscountPercentage = resolveSubscriptionLateFeeDiscountPercent(booking);
  const pickupInspectionDone = hasPickupInspection(booking);
  const returnInspectionDone = hasReturnInspection(booking);
  const pickupDateTime = resolvePickupDateTime(booking);
  const dropDateTime = resolveDropDateTime(booking);
  const paymentDeadline = resolvePaymentDeadline(booking);
  const refundStatus = resolveRefundStatus(booking);
  const refundAmount = resolveRefundAmount(booking);
  const refundReason = resolveRefundReason(booking);
  const refundProcessedAt = resolveRefundProcessedAt(booking);
  const netPaidAmount = resolveTotalPaidAmount(booking);
  const refundProcessed = isRefundProcessedStatus(refundStatus);
  const normalizedBookingStatus = getNormalizedStatusKey(booking?.bookingStatus);
  const isPendingPaymentBooking = normalizedBookingStatus === 'PENDINGPAYMENT';
  const timeoutCancelled = isPaymentTimeoutCancelled(booking);
  const gracePeriodHours = Number.isFinite(Number(booking?.gracePeriodHours))
    ? Math.max(Number(booking.gracePeriodHours), 0)
    : 1;

  const deadlineMs = getGraceDeadlineMs(dropDateTime, gracePeriodHours);
  const overdueTicker = useCountdown(Number.isFinite(deadlineMs) ? new Date(deadlineMs) : null, {
    direction: 'up',
    autoStop: false,
  });
  const liveMetrics = calculateLiveLateMetrics({
    stage,
    nowMs: overdueTicker.nowMs,
    dropDateTime,
    gracePeriodHours,
    lateHours,
    lateFee,
    hourlyLateRate,
    finalAmount,
    advancePaid,
    damageCost,
    lateFeeDiscountPercentage,
  });

  const displayLateHours = stage === 'Overdue' ? liveMetrics.lateHours : lateHours;
  const displayLateFee = stage === 'Overdue' ? liveMetrics.lateFee : lateFee;
  const displayRemaining = stage === 'Overdue' ? liveMetrics.remainingAmount : storedRemaining;
  const displayDamageCost = damageCost;
  const timelineSteps = useMemo(() => buildTimelineState(booking, stage, displayLateHours), [booking, stage, displayLateHours]);

  return (
    <article className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-800">
            {booking.car?.brand} {booking.car?.model}
          </h3>
          <p className="text-sm text-gray-500">
            {booking.car?.category || 'Car'} | {booking.car?.transmission || 'N/A'} | {booking.car?.location || 'N/A'}
          </p>
        </div>
        <span className={`px-3 py-1 text-xs rounded-full ${stageBadgeClass(stage)}`}>{stage}</span>
      </div>

      <div className="mt-4">
        <p className="text-sm font-medium text-gray-700 mb-2">Rental Timeline</p>
        <RentalTimeline steps={timelineSteps} />
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-borderColor bg-light p-3">
          <p>Pickup: <span className="font-medium">{formatDateTime(pickupDateTime)}</span></p>
          <p className="mt-1">Drop: <span className="font-medium">{formatDateTime(dropDateTime)}</span></p>
          <p className="mt-1">Grace Period: <span className="font-medium">{gracePeriodHours} hour(s)</span></p>
        </div>
        <div className="rounded-lg border border-borderColor bg-light p-3">
          <p>
            Remaining Amount:{' '}
            <span className="font-semibold">
              {currency}
              {displayRemaining}
            </span>
          </p>
          <p className="mt-1">Late Hours: <span className="font-medium">{displayLateHours}</span></p>
          <p className="mt-1">
            Late Fee:{' '}
            <span className="font-medium">
              {currency}
              {displayLateFee}
            </span>
          </p>
          <p className="mt-1">
            Damage Cost:{' '}
            <span className={`font-medium ${displayDamageCost > 0 ? 'text-red-700' : ''}`}>
              {currency}
              {displayDamageCost}
            </span>
          </p>
          <p className="mt-1">
            Rental Type: <span className="font-medium">{rentalType}</span>
          </p>
          {rentalType === 'Subscription' ? (
            <p className="mt-1">
              Late Fee Discount:{' '}
              <span className="font-medium text-emerald-700">{lateFeeDiscountPercentage}%</span>
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div className="rounded-lg border border-borderColor bg-light p-3">
          <p className="font-medium text-gray-700">Pickup Condition Summary</p>
          <p className="mt-1 text-gray-600">
            Status: <span className="font-medium">{pickupInspectionDone ? 'Submitted' : 'Pending'}</span>
          </p>
          <p className="text-gray-600">Notes: {booking?.pickupInspection?.conditionNotes || 'N/A'}</p>
          <p className="text-gray-600">
            Images: {Array.isArray(booking?.pickupInspection?.images) ? booking.pickupInspection.images.length : 0}
          </p>
        </div>
        <div className="rounded-lg border border-borderColor bg-light p-3">
          <p className="font-medium text-gray-700">Return Condition Summary</p>
          <p className="mt-1 text-gray-600">
            Status: <span className="font-medium">{returnInspectionDone ? 'Submitted' : 'Pending'}</span>
          </p>
          <p className="text-gray-600">Notes: {booking?.returnInspection?.conditionNotes || 'N/A'}</p>
          <p className="text-gray-600">
            Damage: {booking?.returnInspection?.damageDetected ? 'Yes' : 'No'} ({currency}{displayDamageCost})
          </p>
          <p className="text-gray-600">
            Images: {Array.isArray(booking?.returnInspection?.images) ? booking.returnInspection.images.length : 0}
          </p>
        </div>
      </div>

      <div className="mt-4">
        <LiveStageCountdown
          stage={isPendingPaymentBooking ? 'PendingPayment' : stage}
          pickupDateTime={pickupDateTime}
          dropDateTime={dropDateTime}
          paymentDeadline={isPendingPaymentBooking ? paymentDeadline : null}
          gracePeriodHours={gracePeriodHours}
          className={`text-sm ${
            stage === 'PendingPayment'
              ? 'text-amber-700'
              : stage === 'Cancelled'
              ? 'text-red-700'
              : 
            stage === 'Overdue'
              ? 'text-red-700'
              : stage === 'Active'
              ? 'text-emerald-700'
              : stage === 'Completed'
              ? 'text-gray-600'
              : 'text-blue-700'
          }`}
        />
      </div>

      {timeoutCancelled ? (
        <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          Booking cancelled due to unpaid advance.
        </p>
      ) : null}

      <LiveLateFeeSummary
        className="mt-3"
        stage={stage}
        dropDateTime={dropDateTime}
        gracePeriodHours={gracePeriodHours}
        lateHours={lateHours}
        lateFee={lateFee}
        hourlyLateRate={hourlyLateRate}
        finalAmount={finalAmount}
        advancePaid={advancePaid}
        damageCost={damageCost}
        lateFeeDiscountPercentage={lateFeeDiscountPercentage}
        currency={currency}
        highlight={stage === 'Overdue'}
      />

      {refundProcessed ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <p className="font-medium text-emerald-700">Refund Summary</p>
          <p className="mt-1 text-emerald-700">
            Refund Status: <span className="font-semibold">{refundStatus}</span>
          </p>
          <p className="text-emerald-700">
            Refund Amount:{' '}
            <span className="font-semibold">
              {currency}
              {refundAmount}
            </span>
          </p>
          <p className="text-emerald-700">
            Processed At: <span className="font-semibold">{formatDateTime(refundProcessedAt)}</span>
          </p>
          <p className="text-emerald-700">
            Net Paid:{' '}
            <span className="font-semibold">
              {currency}
              {netPaidAmount}
            </span>
          </p>
          {refundReason ? <p className="text-emerald-700">Reason: {refundReason}</p> : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {stage === 'Overdue' ? (
          <>
            {returnInspectionDone ? (
              <>
                <select
                  value={paymentMethod}
                  onChange={(event) => onPaymentMethodChange(booking._id, event.target.value)}
                  className="border border-borderColor rounded-lg px-3 py-2 text-sm"
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={`${booking._id}-${method}`} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={loadingId === booking._id}
                  onClick={() => onPayRemaining(booking._id)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${
                    loadingId === booking._id ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-600 hover:bg-red-700'
                  }`}
                >
                  {loadingId === booking._id ? 'Processing...' : 'Pay Remaining'}
                </button>
              </>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Return inspection is pending. Please contact admin to complete inspection before payment.
              </p>
            )}
          </>
        ) : null}

        {stage === 'Completed' ? (
          <button
            type="button"
            onClick={() => onDownloadInvoice(booking)}
            className="px-4 py-2 rounded-lg text-sm font-medium border border-borderColor bg-white text-gray-700 hover:bg-slate-50"
          >
            Download Invoice
          </button>
        ) : null}
      </div>
    </article>
  );
};

const MyRentalStatus = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const notify = useNotify();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [paymentMethodById, setPaymentMethodById] = useState({});
  const [loadingActionId, setLoadingActionId] = useState('');

  const loadRentalStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getUserRentalDashboard({ showErrorToast: false });
      const normalizedBookings = Array.isArray(data.bookings) ? data.bookings : [];
      setBookings(normalizedBookings);
      setErrorMsg('');
    } catch (error) {
      const safeMessage = getErrorMessage(error, 'Failed to load rental status');
      setErrorMsg(safeMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRentalStatus();
  }, [loadRentalStatus]);

  const sortedBookings = useMemo(() => {
    return [...bookings].sort((left, right) => {
      const leftUpdated = new Date(left.updatedAt || left.createdAt || 0).getTime();
      const rightUpdated = new Date(right.updatedAt || right.createdAt || 0).getTime();
      return rightUpdated - leftUpdated;
    });
  }, [bookings]);

  const handlePaymentMethodChange = (bookingId, value) => {
    setPaymentMethodById((previous) => ({
      ...previous,
      [bookingId]: value,
    }));
  };

  const handlePayRemaining = async (bookingId) => {
    try {
      setLoadingActionId(bookingId);
      await settleUserBookingReturn(bookingId, paymentMethodById[bookingId] || 'UPI');
      notify.success('Return and remaining payment completed');
      await loadRentalStatus();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to complete remaining payment'));
    } finally {
      setLoadingActionId('');
    }
  };

  const handleDownloadInvoice = async (booking) => {
    try {
      if (!booking?._id) {
        notify.error('Booking id is required for invoice download');
        return;
      }

      await downloadBookingInvoicePdf(booking._id);
      notify.success('Invoice downloaded');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to download invoice'));
    }
  };

  return (
    <div className="px-4 sm:px-8 md:px-14 lg:px-20 xl:px-28 mt-16 mb-14">
      <Title
        title="My Rental Status"
        subTitle="Track your complete rental lifecycle with live stage and payment status."
        align="left"
      />

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={loadRentalStatus}
          className="px-3 py-2 rounded-lg border border-borderColor bg-white text-sm text-gray-700 hover:bg-slate-50"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        {errorMsg ? <p className="text-sm text-red-600">{errorMsg}</p> : null}
      </div>

      <div className="mt-6 space-y-4">
        {loading ? <p className="text-sm text-gray-500">Loading rental status...</p> : null}
        {!loading && sortedBookings.length === 0 ? (
          <p className="text-sm text-gray-500">No rentals available yet.</p>
        ) : null}

        {sortedBookings.map((booking) => (
          <RentalStatusCard
            key={booking._id}
            booking={booking}
            currency={currency}
            paymentMethod={paymentMethodById[booking._id] || 'UPI'}
            onPaymentMethodChange={handlePaymentMethodChange}
            onPayRemaining={handlePayRemaining}
            onDownloadInvoice={handleDownloadInvoice}
            loadingId={loadingActionId}
          />
        ))}
      </div>
    </div>
  );
};

export default MyRentalStatus;
