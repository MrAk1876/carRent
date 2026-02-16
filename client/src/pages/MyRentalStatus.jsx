import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../api';
import LiveLateFeeSummary from '../components/ui/LiveLateFeeSummary';
import LiveStageCountdown from '../components/ui/LiveStageCountdown';
import Title from '../components/Title';
import { calculateLiveLateMetrics, getGraceDeadlineMs, useCountdown } from '../hooks/useCountdown';
import useNotify from '../hooks/useNotify';
import { getUserRentalDashboard, settleUserBookingReturn } from '../services/bookingService';
import {
  isFullyPaidStatus,
  resolveAdvancePaid,
  resolveDropDateTime,
  resolveFinalAmount,
  resolveLateFee,
  resolveLateHours,
  resolveHourlyLateRate,
  resolvePickupDateTime,
  resolveRentalStage,
  resolveRemainingAmount,
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
  loadingId,
}) => {
  const stage = resolveRentalStage(booking) || 'Scheduled';
  const finalAmount = resolveFinalAmount(booking);
  const advancePaid = resolveAdvancePaid(booking);
  const storedRemaining = resolveRemainingAmount(booking);
  const lateHours = resolveLateHours(booking);
  const lateFee = resolveLateFee(booking);
  const hourlyLateRate = resolveHourlyLateRate(booking);
  const pickupDateTime = resolvePickupDateTime(booking);
  const dropDateTime = resolveDropDateTime(booking);
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
  });

  const displayLateHours = stage === 'Overdue' ? liveMetrics.lateHours : lateHours;
  const displayLateFee = stage === 'Overdue' ? liveMetrics.lateFee : lateFee;
  const displayRemaining = stage === 'Overdue' ? liveMetrics.remainingAmount : storedRemaining;
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
        </div>
      </div>

      <div className="mt-4">
        <LiveStageCountdown
          stage={stage}
          pickupDateTime={pickupDateTime}
          dropDateTime={dropDateTime}
          gracePeriodHours={gracePeriodHours}
          className={`text-sm ${
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
        currency={currency}
        highlight={stage === 'Overdue'}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {stage === 'Overdue' ? (
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
        ) : null}

        {stage === 'Completed' ? (
          <button
            type="button"
            onClick={() => window.alert('Invoice download will be enabled in a future update.')}
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
      const data = await getUserRentalDashboard();
      const normalizedBookings = Array.isArray(data.bookings) ? data.bookings : [];
      setBookings(normalizedBookings);
      setErrorMsg('');
    } catch (error) {
      const safeMessage = getErrorMessage(error, 'Failed to load rental status');
      setErrorMsg(safeMessage);
      notify.error(safeMessage);
    } finally {
      setLoading(false);
    }
  }, [notify]);

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
            loadingId={loadingActionId}
          />
        ))}
      </div>
    </div>
  );
};

export default MyRentalStatus;
