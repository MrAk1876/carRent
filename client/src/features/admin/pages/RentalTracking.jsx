import React, { useCallback, useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import LiveLateFeeSummary from '../../../components/ui/LiveLateFeeSummary';
import LiveStageCountdown from '../../../components/ui/LiveStageCountdown';
import { calculateLiveLateMetrics, getGraceDeadlineMs, useCountdown } from '../../../hooks/useCountdown';
import useNotify from '../../../hooks/useNotify';
import {
  resolveAdvancePaid,
  resolveDropDateTime,
  resolveFinalAmount,
  resolveLateFee,
  resolveLateHours,
  resolveHourlyLateRate,
  resolvePickupDateTime,
  resolveRentalStage,
  resolveRemainingAmount,
} from '../../../utils/payment';
import Title from '../components/Title';

const PAGE_SIZE = 8;
const CRITICAL_DEADLINE_MS = 2 * 60 * 60 * 1000;

const parseDateMs = (value) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return parsed.getTime();
};

const formatDateTime = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
};

const buildUserName = (booking) => {
  const firstName = booking?.user?.firstName || '';
  const lastName = booking?.user?.lastName || '';
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || 'Unknown User';
};

const ScheduledCard = ({ booking, currency }) => {
  const pickupDateTime = resolvePickupDateTime(booking);
  const advancePaid = resolveAdvancePaid(booking);

  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-800">{buildUserName(booking)}</p>
          <p className="text-sm text-gray-600">
            {booking.car?.brand} {booking.car?.model}
          </p>
          <p className="text-xs text-gray-500 mt-1">Pickup: {formatDateTime(pickupDateTime)}</p>
        </div>
        <p className="text-sm text-gray-700">
          Advance Paid:{' '}
          <span className="font-semibold">
            {currency}
            {advancePaid}
          </span>
        </p>
      </div>

      <LiveStageCountdown
        stage="Scheduled"
        pickupDateTime={pickupDateTime}
        className="mt-2 text-sm text-blue-700"
      />
    </div>
  );
};

const ActiveCard = ({ booking, currency }) => {
  const dropDateTime = resolveDropDateTime(booking);
  const remainingAmount = resolveRemainingAmount(booking);
  const gracePeriodHours = Number.isFinite(Number(booking?.gracePeriodHours))
    ? Math.max(Number(booking.gracePeriodHours), 0)
    : 1;
  const deadlineMs = getGraceDeadlineMs(dropDateTime, gracePeriodHours);
  const countdown = useCountdown(Number.isFinite(deadlineMs) ? new Date(deadlineMs) : null, {
    direction: 'down',
    autoStop: true,
  });
  const isCritical = countdown.hasTarget && !countdown.isComplete && countdown.totalMilliseconds <= CRITICAL_DEADLINE_MS;

  return (
    <div
      className={`rounded-xl border p-4 md:p-5 shadow-sm ${
        isCritical ? 'border-amber-300 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/35'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-800">{buildUserName(booking)}</p>
          <p className="text-sm text-gray-600">
            {booking.car?.brand} {booking.car?.model}
          </p>
          <p className="text-xs text-gray-500 mt-1">Drop Deadline: {formatDateTime(dropDateTime)}</p>
        </div>
        <p className="text-sm text-gray-700">
          Remaining:{' '}
          <span className="font-semibold">
            {currency}
            {remainingAmount}
          </span>
        </p>
      </div>

      <LiveStageCountdown
        stage="Active"
        dropDateTime={dropDateTime}
        gracePeriodHours={gracePeriodHours}
        className={`mt-2 text-sm ${isCritical ? 'text-amber-700 font-medium' : 'text-emerald-700'}`}
      />
      {isCritical ? <p className="text-xs text-amber-700 mt-1">Deadline is within 2 hours</p> : null}
    </div>
  );
};

const OverdueCard = ({ booking, currency }) => {
  const dropDateTime = resolveDropDateTime(booking);
  const finalAmount = resolveFinalAmount(booking);
  const advancePaid = resolveAdvancePaid(booking);
  const lateHours = resolveLateHours(booking);
  const lateFee = resolveLateFee(booking);
  const hourlyLateRate = resolveHourlyLateRate(booking);
  const gracePeriodHours = Number.isFinite(Number(booking?.gracePeriodHours))
    ? Math.max(Number(booking.gracePeriodHours), 0)
    : 1;
  const deadlineMs = getGraceDeadlineMs(dropDateTime, gracePeriodHours);
  const overdueTimer = useCountdown(Number.isFinite(deadlineMs) ? new Date(deadlineMs) : null, {
    direction: 'up',
    autoStop: false,
  });
  const liveMetrics = calculateLiveLateMetrics({
    stage: 'Overdue',
    nowMs: overdueTimer.nowMs,
    dropDateTime,
    gracePeriodHours,
    lateHours,
    lateFee,
    hourlyLateRate,
    finalAmount,
    advancePaid,
  });

  return (
    <div className="rounded-xl border border-red-300 bg-red-50/60 p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-800">{buildUserName(booking)}</p>
          <p className="text-sm text-gray-600">
            {booking.car?.brand} {booking.car?.model}
          </p>
          <p className="text-xs text-gray-500 mt-1">Drop Deadline: {formatDateTime(dropDateTime)}</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-red-700 font-semibold">Late: {liveMetrics.lateHours}h</p>
          <p className="text-sm text-red-700">
            Late Fee: {currency}
            {liveMetrics.lateFee}
          </p>
          <p className="text-sm text-red-800 font-semibold">
            Total Payable: {currency}
            {liveMetrics.remainingAmount}
          </p>
        </div>
      </div>

      <LiveStageCountdown
        stage="Overdue"
        dropDateTime={dropDateTime}
        gracePeriodHours={gracePeriodHours}
        className="mt-2 text-sm text-red-700 font-medium"
      />

      <LiveLateFeeSummary
        stage="Overdue"
        dropDateTime={dropDateTime}
        gracePeriodHours={gracePeriodHours}
        lateHours={lateHours}
        lateFee={lateFee}
        hourlyLateRate={hourlyLateRate}
        finalAmount={finalAmount}
        advancePaid={advancePaid}
        currency={currency}
        className="mt-3"
        highlight
      />
    </div>
  );
};

const CompletedCard = ({ booking, currency }) => {
  const finalAmount = resolveFinalAmount(booking);
  const advancePaid = resolveAdvancePaid(booking);
  const lateHours = resolveLateHours(booking);
  const lateFee = resolveLateFee(booking);
  const fullPaymentAmount = Math.max(Number(booking?.fullPaymentAmount || 0), 0);
  const totalPaid = Number((advancePaid + fullPaymentAmount).toFixed(2));
  const finalInvoiceAmount = Number((finalAmount + lateFee).toFixed(2));

  return (
    <div className="rounded-xl border border-slate-300 bg-slate-100/60 p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-gray-800">{buildUserName(booking)}</p>
          <p className="text-sm text-gray-600">
            {booking.car?.brand} {booking.car?.model}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            Returned: {formatDateTime(booking.actualReturnTime || booking.fullPaymentReceivedAt)}
          </p>
        </div>
        <p className="text-sm text-gray-700">
          Final Paid:{' '}
          <span className="font-semibold">
            {currency}
            {totalPaid}
          </span>
        </p>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600">
        <p>
          Invoice Amount:{' '}
          <span className="font-semibold">
            {currency}
            {finalInvoiceAmount}
          </span>
        </p>
        <p>
          Late Hours: <span className="font-semibold">{lateHours}</span>
        </p>
        <p>
          Advance Paid:{' '}
          <span className="font-semibold">
            {currency}
            {advancePaid}
          </span>
        </p>
        <p>
          Final Settlement:{' '}
          <span className="font-semibold">
            {currency}
            {fullPaymentAmount}
          </span>
        </p>
      </div>
    </div>
  );
};

const SectionShell = ({
  title,
  subtitle,
  items,
  sectionKey,
  renderItem,
  visibleCount,
  onLoadMore,
  emptyMessage,
}) => (
  <section className="rounded-2xl border border-borderColor bg-white p-4 md:p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
        <p className="text-sm text-gray-500">{subtitle}</p>
      </div>
      <span className="text-xs text-gray-500">
        Showing {Math.min(visibleCount, items.length)} of {items.length}
      </span>
    </div>

    <div className="mt-4 space-y-3">
      {items.length === 0 ? (
        <p className="text-sm text-gray-500">{emptyMessage}</p>
      ) : (
        items.slice(0, visibleCount).map((booking) => (
          <div key={`${sectionKey}-${booking._id}`}>{renderItem(booking)}</div>
        ))
      )}
    </div>

    {items.length > visibleCount ? (
      <button
        type="button"
        className="mt-4 px-3 py-2 rounded-lg border border-borderColor bg-white text-sm text-gray-700 hover:bg-slate-50"
        onClick={() => onLoadMore(sectionKey)}
      >
        Load More
      </button>
    ) : null}
  </section>
);

const RentalTracking = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const notify = useNotify();
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [visibleBySection, setVisibleBySection] = useState({
    scheduled: PAGE_SIZE,
    active: PAGE_SIZE,
    overdue: PAGE_SIZE,
    completed: PAGE_SIZE,
  });

  const loadBookings = useCallback(async () => {
    try {
      setLoading(true);
      const response = await API.get('/admin/bookings');
      setBookings(Array.isArray(response.data) ? response.data : []);
      setErrorMsg('');
    } catch (error) {
      const safeMessage = getErrorMessage(error, 'Failed to load rental tracking data');
      setErrorMsg(safeMessage);
      notify.error(safeMessage);
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  const sectionedBookings = useMemo(() => {
    const normalized = Array.isArray(bookings) ? bookings : [];

    const scheduled = normalized
      .filter((booking) => resolveRentalStage(booking) === 'Scheduled')
      .sort((left, right) => parseDateMs(resolvePickupDateTime(left)) - parseDateMs(resolvePickupDateTime(right)));

    const active = normalized
      .filter((booking) => resolveRentalStage(booking) === 'Active')
      .sort(
        (left, right) =>
          getGraceDeadlineMs(resolveDropDateTime(left), left?.gracePeriodHours) -
          getGraceDeadlineMs(resolveDropDateTime(right), right?.gracePeriodHours),
      );

    const overdue = normalized
      .filter((booking) => resolveRentalStage(booking) === 'Overdue')
      .sort((left, right) => {
        const hoursDiff = resolveLateHours(right) - resolveLateHours(left);
        if (hoursDiff !== 0) return hoursDiff;
        return parseDateMs(resolveDropDateTime(left)) - parseDateMs(resolveDropDateTime(right));
      });

    const completed = normalized
      .filter((booking) => resolveRentalStage(booking) === 'Completed')
      .sort(
        (left, right) =>
          parseDateMs(right?.actualReturnTime || right?.fullPaymentReceivedAt || right?.updatedAt) -
          parseDateMs(left?.actualReturnTime || left?.fullPaymentReceivedAt || left?.updatedAt),
      );

    return { scheduled, active, overdue, completed };
  }, [bookings]);

  const handleLoadMore = (sectionKey) => {
    setVisibleBySection((previous) => ({
      ...previous,
      [sectionKey]: (previous[sectionKey] || PAGE_SIZE) + PAGE_SIZE,
    }));
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Rental Tracking"
        subTitle="Monitor scheduled pickups, active rentals, overdue risk, and completed trip settlements."
      />

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={loadBookings}
          className="px-3 py-2 rounded-lg border border-borderColor bg-white text-sm text-gray-700 hover:bg-slate-50"
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
        {errorMsg ? <p className="text-sm text-red-600">{errorMsg}</p> : null}
      </div>

      <div className="mt-5 space-y-5">
        <SectionShell
          title="Section A - Upcoming Pickups"
          subtitle="Scheduled rentals sorted by nearest pickup time."
          items={sectionedBookings.scheduled}
          sectionKey="scheduled"
          renderItem={(booking) => <ScheduledCard booking={booking} currency={currency} />}
          visibleCount={visibleBySection.scheduled}
          onLoadMore={handleLoadMore}
          emptyMessage="No scheduled pickups right now."
        />

        <SectionShell
          title="Section B - Active Rentals"
          subtitle="Live return deadlines and remaining amounts."
          items={sectionedBookings.active}
          sectionKey="active"
          renderItem={(booking) => <ActiveCard booking={booking} currency={currency} />}
          visibleCount={visibleBySection.active}
          onLoadMore={handleLoadMore}
          emptyMessage="No active rentals right now."
        />

        <SectionShell
          title="Section C - Overdue Rentals"
          subtitle="Sorted by highest late hours with live late fee growth."
          items={sectionedBookings.overdue}
          sectionKey="overdue"
          renderItem={(booking) => <OverdueCard booking={booking} currency={currency} />}
          visibleCount={visibleBySection.overdue}
          onLoadMore={handleLoadMore}
          emptyMessage="No overdue rentals right now."
        />

        <SectionShell
          title="Section D - Completed Rentals"
          subtitle="Finalized payment and late-fee breakdown."
          items={sectionedBookings.completed}
          sectionKey="completed"
          renderItem={(booking) => <CompletedCard booking={booking} currency={currency} />}
          visibleCount={visibleBySection.completed}
          onLoadMore={handleLoadMore}
          emptyMessage="No completed rentals yet."
        />
      </div>
    </div>
  );
};

export default RentalTracking;
