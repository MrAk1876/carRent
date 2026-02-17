import React, { useCallback, useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import LiveLateFeeSummary from '../../../components/ui/LiveLateFeeSummary';
import LiveStageCountdown from '../../../components/ui/LiveStageCountdown';
import { calculateLiveLateMetrics, getGraceDeadlineMs, useCountdown } from '../../../hooks/useCountdown';
import useNotify from '../../../hooks/useNotify';
import useSmartPolling from '../../../hooks/useSmartPolling';
import { downloadBookingInvoicePdf } from '../../../services/bookingService';
import {
  hasPickupInspection,
  hasReturnInspection,
  resolveAdvancePaid,
  resolveDamageCost,
  resolveDropDateTime,
  resolveFinalAmount,
  resolveLateFee,
  resolveLateHours,
  resolveHourlyLateRate,
  resolvePickupDateTime,
  resolveRefundAmount,
  resolveRefundProcessedAt,
  resolveRefundStatus,
  resolveSubscriptionLateFeeDiscountPercent,
  resolveRentalStage,
  resolveRemainingAmount,
  isRefundProcessedStatus,
  resolveTotalPaidAmount,
} from '../../../utils/payment';
import Title from '../components/Title';

const PAGE_SIZE = 8;
const CRITICAL_DEADLINE_MS = 2 * 60 * 60 * 1000;
const DEFAULT_GRACE_HOURS = 1;
const SKELETON_ROWS = 3;

const parseDateMs = (value) => {
  if (!value) return Number.POSITIVE_INFINITY;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return Number.POSITIVE_INFINITY;
  return parsed.getTime();
};

const toSafeNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const formatAmount = (value) =>
  toSafeNumber(value).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  });

const formatMoney = (currency, value) => `${currency}${formatAmount(value)}`;

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

const buildCarName = (booking) => {
  const brand = booking?.car?.brand || '';
  const model = booking?.car?.model || '';
  const label = `${brand} ${model}`.trim();
  return label || 'Unknown Car';
};

const buildCarMeta = (booking) => {
  const meta = [booking?.car?.category, booking?.car?.transmission, booking?.car?.location].filter(Boolean);
  return meta.join(' | ') || 'Details unavailable';
};

const SummaryMetric = ({ title, value, caption, tone = 'slate' }) => {
  const toneClassMap = {
    blue: 'border-blue-200 bg-blue-50/70 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-700',
    red: 'border-red-200 bg-red-50/70 text-red-700',
    slate: 'border-slate-200 bg-white text-slate-700',
  };

  const toneClass = toneClassMap[tone] || toneClassMap.slate;

  return (
    <div className={`rounded-xl border p-4 md:p-5 shadow-sm ${toneClass}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-2 text-2xl font-semibold leading-none">{value}</p>
      <p className="mt-2 text-xs text-slate-500">{caption}</p>
    </div>
  );
};

const StageTag = ({ label, tone }) => {
  const toneClassMap = {
    scheduled: 'border-blue-200 bg-blue-100/90 text-blue-700',
    active: 'border-emerald-200 bg-emerald-100/90 text-emerald-700',
    overdue: 'border-red-200 bg-red-100/90 text-red-700',
    completed: 'border-slate-300 bg-slate-100 text-slate-700',
    cancelled: 'border-rose-200 bg-rose-100/90 text-rose-700',
    critical: 'border-amber-200 bg-amber-100/90 text-amber-700',
  };

  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-[11px] font-medium ${toneClassMap[tone] || toneClassMap.completed}`}
    >
      {label}
    </span>
  );
};

const KeyValueTile = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
    <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-sm font-medium text-slate-700">{value}</p>
  </div>
);

const InspectionHistory = ({ booking, currency }) => {
  const damageCost = resolveDamageCost(booking);
  const hasDamage = damageCost > 0;
  const pickupImages = Array.isArray(booking?.pickupInspection?.images) ? booking.pickupInspection.images.length : 0;
  const returnImages = Array.isArray(booking?.returnInspection?.images) ? booking.returnInspection.images.length : 0;

  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs">
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="font-semibold text-slate-700">Pickup Inspection</p>
        <p className="mt-1 text-slate-600">Notes: {booking?.pickupInspection?.conditionNotes || 'N/A'}</p>
        <p className="text-slate-600">Damage Reported: {booking?.pickupInspection?.damageReported ? 'Yes' : 'No'}</p>
        <p className="text-slate-600">Images: {pickupImages}</p>
        <p className="text-slate-600">Inspected At: {formatDateTime(booking?.pickupInspection?.inspectedAt)}</p>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="font-semibold text-slate-700">Return Inspection</p>
        <p className="mt-1 text-slate-600">Notes: {booking?.returnInspection?.conditionNotes || 'N/A'}</p>
        <p className="text-slate-600">Damage Detected: {booking?.returnInspection?.damageDetected ? 'Yes' : 'No'}</p>
        <p className={hasDamage ? 'text-red-700 font-semibold' : 'text-slate-600'}>
          Damage Cost: {formatMoney(currency, damageCost)}
        </p>
        <p className="text-slate-600">Images: {returnImages}</p>
        <p className="text-slate-600">Inspected At: {formatDateTime(booking?.returnInspection?.inspectedAt)}</p>
      </div>
    </div>
  );
};

const IdentityBlock = ({ booking }) => (
  <div className="min-w-0">
    <p className="truncate text-sm font-semibold text-slate-900">{buildUserName(booking)}</p>
    <p className="truncate text-sm text-slate-700">{buildCarName(booking)}</p>
    <p className="truncate text-xs text-slate-500 mt-0.5">{buildCarMeta(booking)}</p>
  </div>
);

const ScheduledCard = ({ booking, currency }) => {
  const pickupDateTime = resolvePickupDateTime(booking);
  const advancePaid = resolveAdvancePaid(booking);

  return (
    <article className="rounded-xl border border-blue-200 bg-linear-to-br from-white via-blue-50/45 to-white p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <IdentityBlock booking={booking} />
        <StageTag label="Scheduled" tone="scheduled" />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <KeyValueTile label="Pickup Date & Time" value={formatDateTime(pickupDateTime)} />
        <KeyValueTile label="Advance Paid" value={formatMoney(currency, advancePaid)} />
      </div>

      <LiveStageCountdown
        stage="Scheduled"
        pickupDateTime={pickupDateTime}
        className="mt-3 text-sm font-medium text-blue-700"
      />
    </article>
  );
};

const ActiveCard = ({ booking, currency, inspectionOpen = false, onToggleInspection = () => {} }) => {
  const dropDateTime = resolveDropDateTime(booking);
  const remainingAmount = resolveRemainingAmount(booking);
  const pickupInspectionDone = hasPickupInspection(booking);
  const returnInspectionDone = hasReturnInspection(booking);
  const damageCost = resolveDamageCost(booking);
  const hasDamage = damageCost > 0;
  const gracePeriodHours = Number.isFinite(Number(booking?.gracePeriodHours))
    ? Math.max(Number(booking.gracePeriodHours), 0)
    : DEFAULT_GRACE_HOURS;
  const deadlineMs = getGraceDeadlineMs(dropDateTime, gracePeriodHours);
  const countdown = useCountdown(Number.isFinite(deadlineMs) ? new Date(deadlineMs) : null, {
    direction: 'down',
    autoStop: true,
  });
  const isCritical = countdown.hasTarget && !countdown.isComplete && countdown.totalMilliseconds <= CRITICAL_DEADLINE_MS;

  return (
    <article
      className={`rounded-xl border p-4 md:p-5 shadow-sm ${
        isCritical
          ? 'border-amber-300 bg-linear-to-br from-white via-amber-50/65 to-white'
          : 'border-emerald-200 bg-linear-to-br from-white via-emerald-50/45 to-white'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <IdentityBlock booking={booking} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StageTag label={isCritical ? 'Deadline Near' : 'Active'} tone={isCritical ? 'critical' : 'active'} />
          {hasDamage ? <StageTag label={`Damage ${formatMoney(currency, damageCost)}`} tone="overdue" /> : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <KeyValueTile label="Drop Deadline" value={formatDateTime(dropDateTime)} />
        <KeyValueTile label="Remaining Amount" value={formatMoney(currency, remainingAmount)} />
        <KeyValueTile label="Pickup Inspection" value={pickupInspectionDone ? 'Submitted' : 'Pending'} />
        <KeyValueTile label="Return Inspection" value={returnInspectionDone ? 'Submitted' : 'Pending'} />
      </div>

      <LiveStageCountdown
        stage="Active"
        dropDateTime={dropDateTime}
        gracePeriodHours={gracePeriodHours}
        className={`mt-3 text-sm font-medium ${isCritical ? 'text-amber-700' : 'text-emerald-700'}`}
      />
      {isCritical ? <p className="text-xs text-amber-700 mt-1">Less than 2 hours remaining for return</p> : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={onToggleInspection}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {inspectionOpen ? 'Hide Inspection' : 'Inspection'}
        </button>
      </div>

      {inspectionOpen ? <InspectionHistory booking={booking} currency={currency} /> : null}
    </article>
  );
};

const OverdueCard = ({ booking, currency }) => {
  const dropDateTime = resolveDropDateTime(booking);
  const finalAmount = resolveFinalAmount(booking);
  const advancePaid = resolveAdvancePaid(booking);
  const lateHours = resolveLateHours(booking);
  const lateFee = resolveLateFee(booking);
  const hourlyLateRate = resolveHourlyLateRate(booking);
  const damageCost = resolveDamageCost(booking);
  const lateFeeDiscountPercentage = resolveSubscriptionLateFeeDiscountPercent(booking);
  const gracePeriodHours = Number.isFinite(Number(booking?.gracePeriodHours))
    ? Math.max(Number(booking.gracePeriodHours), 0)
    : DEFAULT_GRACE_HOURS;
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
    damageCost,
    lateFeeDiscountPercentage,
  });

  return (
    <article className="rounded-xl border border-red-300 bg-linear-to-br from-white via-red-50/70 to-white p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <IdentityBlock booking={booking} />
        <StageTag label="Overdue" tone="overdue" />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <KeyValueTile label="Drop Deadline" value={formatDateTime(dropDateTime)} />
        <KeyValueTile label="Late Hours" value={`${formatAmount(liveMetrics.lateHours)}h`} />
        <KeyValueTile label="Total Payable" value={formatMoney(currency, liveMetrics.remainingAmount)} />
      </div>

      <LiveStageCountdown
        stage="Overdue"
        dropDateTime={dropDateTime}
        gracePeriodHours={gracePeriodHours}
        className="mt-3 text-sm font-medium text-red-700"
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
        damageCost={damageCost}
        lateFeeDiscountPercentage={lateFeeDiscountPercentage}
        currency={currency}
        className="mt-3"
        highlight
      />
    </article>
  );
};

const CompletedCard = ({ booking, currency, onDownloadInvoice, inspectionOpen = false, onToggleInspection = () => {} }) => {
  const finalAmount = resolveFinalAmount(booking);
  const advancePaid = resolveAdvancePaid(booking);
  const lateHours = resolveLateHours(booking);
  const lateFee = resolveLateFee(booking);
  const damageCost = resolveDamageCost(booking);
  const hasDamage = damageCost > 0;
  const pickupInspectionDone = hasPickupInspection(booking);
  const returnInspectionDone = hasReturnInspection(booking);
  const fullPaymentAmount = Math.max(Number(booking?.fullPaymentAmount || 0), 0);
  const totalPaid = resolveTotalPaidAmount(booking);
  const finalInvoiceAmount = Number((finalAmount + lateFee + damageCost).toFixed(2));
  const refundStatus = resolveRefundStatus(booking);
  const refundAmount = resolveRefundAmount(booking);
  const refundProcessedAt = resolveRefundProcessedAt(booking);
  const isRefunded = isRefundProcessedStatus(refundStatus);

  return (
    <article className="rounded-xl border border-slate-300 bg-linear-to-br from-white via-slate-100/60 to-white p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <IdentityBlock booking={booking} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <StageTag label="Completed" tone="completed" />
          {hasDamage ? <StageTag label={`Damage ${formatMoney(currency, damageCost)}`} tone="overdue" /> : null}
        </div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <KeyValueTile label="Returned At" value={formatDateTime(booking.actualReturnTime || booking.fullPaymentReceivedAt)} />
        <KeyValueTile label="Final Paid" value={formatMoney(currency, totalPaid)} />
        <KeyValueTile label="Invoice Amount" value={formatMoney(currency, finalInvoiceAmount)} />
        <KeyValueTile label="Late Hours" value={String(lateHours)} />
        <KeyValueTile label="Advance Paid" value={formatMoney(currency, advancePaid)} />
        <KeyValueTile label="Final Settlement" value={formatMoney(currency, fullPaymentAmount)} />
        <KeyValueTile label="Damage Cost" value={formatMoney(currency, damageCost)} />
        <KeyValueTile label="Pickup Inspection" value={pickupInspectionDone ? 'Submitted' : 'N/A'} />
        <KeyValueTile label="Return Inspection" value={returnInspectionDone ? 'Submitted' : 'N/A'} />
        <KeyValueTile label="Refund Status" value={refundStatus} />
        <KeyValueTile label="Refund Amount" value={formatMoney(currency, refundAmount)} />
        <KeyValueTile label="Refund Date" value={formatDateTime(refundProcessedAt)} />
      </div>

      {isRefunded ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          Refund processed for this booking.
        </p>
      ) : null}

      <div className="mt-3">
        <button
          type="button"
          onClick={onToggleInspection}
          className="mr-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {inspectionOpen ? 'Hide Inspection' : 'Inspection'}
        </button>
        <button
          type="button"
          onClick={() => onDownloadInvoice(booking._id)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Download Invoice
        </button>
      </div>

      {inspectionOpen ? <InspectionHistory booking={booking} currency={currency} /> : null}
    </article>
  );
};

const CancelledCard = ({ booking, currency }) => {
  const totalPaid = resolveTotalPaidAmount(booking);
  const refundStatus = resolveRefundStatus(booking);
  const refundAmount = resolveRefundAmount(booking);
  const refundProcessedAt = resolveRefundProcessedAt(booking);
  const isRefunded = isRefundProcessedStatus(refundStatus);

  return (
    <article className="rounded-xl border border-rose-200 bg-linear-to-br from-white via-rose-50/70 to-white p-4 md:p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <IdentityBlock booking={booking} />
        <StageTag label="Cancelled" tone="cancelled" />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <KeyValueTile label="Cancelled At" value={formatDateTime(booking?.updatedAt || booking?.createdAt)} />
        <KeyValueTile label="Paid Amount" value={formatMoney(currency, totalPaid)} />
        <KeyValueTile label="Refund Status" value={refundStatus} />
        <KeyValueTile label="Refund Amount" value={formatMoney(currency, refundAmount)} />
        <KeyValueTile label="Refund Date" value={formatDateTime(refundProcessedAt)} />
        <KeyValueTile label="Reason" value={booking?.refundReason || booking?.cancellationReason || 'N/A'} />
      </div>

      {isRefunded ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          Refund processed for this cancelled booking.
        </p>
      ) : null}
    </article>
  );
};

const SectionMeta = {
  scheduled: {
    chipClass: 'border-blue-200 bg-blue-100/90 text-blue-700',
    borderClass: 'border-blue-200/80',
    headerClass: 'from-blue-50/80 to-white',
  },
  active: {
    chipClass: 'border-emerald-200 bg-emerald-100/90 text-emerald-700',
    borderClass: 'border-emerald-200/80',
    headerClass: 'from-emerald-50/80 to-white',
  },
  overdue: {
    chipClass: 'border-red-200 bg-red-100/90 text-red-700',
    borderClass: 'border-red-200/80',
    headerClass: 'from-red-50/80 to-white',
  },
  completed: {
    chipClass: 'border-slate-300 bg-slate-100/95 text-slate-700',
    borderClass: 'border-slate-200',
    headerClass: 'from-slate-100/80 to-white',
  },
  cancelled: {
    chipClass: 'border-rose-200 bg-rose-100/95 text-rose-700',
    borderClass: 'border-rose-200/80',
    headerClass: 'from-rose-50/80 to-white',
  },
};

const LoadingShell = () =>
  Array.from({ length: SKELETON_ROWS }).map((_, index) => (
    <div key={`loading-${index}`} className="animate-pulse rounded-xl border border-slate-200 bg-white p-4 md:p-5">
      <div className="h-4 w-44 rounded bg-slate-200" />
      <div className="mt-2 h-3 w-56 rounded bg-slate-200" />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <div className="h-14 rounded-lg bg-slate-100" />
        <div className="h-14 rounded-lg bg-slate-100" />
      </div>
    </div>
  ));

const SectionShell = ({
  title,
  subtitle,
  items,
  sectionKey,
  renderItem,
  visibleCount,
  onLoadMore,
  emptyMessage,
  loading = false,
}) => (
  <section
    className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${
      SectionMeta[sectionKey]?.borderClass || 'border-borderColor'
    }`}
  >
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 bg-linear-to-r px-4 py-3.5 md:px-5 ${
        SectionMeta[sectionKey]?.headerClass || 'from-slate-50/80 to-white'
      }`}
    >
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-slate-800 md:text-lg">{title}</h3>
        <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
      </div>
      <span
        className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
          SectionMeta[sectionKey]?.chipClass || 'border-slate-200 bg-slate-100 text-slate-600'
        }`}
      >
        {Math.min(visibleCount, items.length)} / {items.length}
      </span>
    </div>

    <div className="space-y-3 bg-slate-50/35 p-4 md:p-5">
      {loading && items.length === 0 ? (
        <LoadingShell />
      ) : items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
          {emptyMessage}
        </p>
      ) : (
        items.slice(0, visibleCount).map((booking) => (
          <div key={`${sectionKey}-${booking._id}`}>{renderItem(booking)}</div>
        ))
      )}
    </div>

    {items.length > visibleCount ? (
      <button
        type="button"
        className="m-4 mt-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 md:m-5 md:mt-0"
        onClick={() => onLoadMore(sectionKey)}
      >
        Load More Rows
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
  const [inspectionOpenById, setInspectionOpenById] = useState({});
  const [visibleBySection, setVisibleBySection] = useState({
    scheduled: PAGE_SIZE,
    active: PAGE_SIZE,
    overdue: PAGE_SIZE,
    cancelled: PAGE_SIZE,
    completed: PAGE_SIZE,
  });

  const loadBookings = useCallback(async ({ silent = false, suppressErrors = false, showErrorToast = false } = {}) => {
    try {
      if (!silent) {
        setLoading(true);
      }
      const response = await API.get('/admin/bookings', { showErrorToast });
      setBookings(Array.isArray(response.data) ? response.data : []);
      if (!silent) {
        setErrorMsg('');
      }
    } catch (error) {
      if (!suppressErrors) {
        const safeMessage = getErrorMessage(error, 'Failed to load rental tracking data');
        setErrorMsg(safeMessage);
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadBookings();
  }, [loadBookings]);

  useSmartPolling(
    () => loadBookings({ silent: true, suppressErrors: true, showErrorToast: false }),
    { intervalMs: 15000, enabled: true },
  );

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

    const cancelled = normalized
      .filter((booking) => resolveRentalStage(booking) === 'Cancelled')
      .sort((left, right) => parseDateMs(right?.updatedAt || right?.createdAt) - parseDateMs(left?.updatedAt || left?.createdAt));

    return { scheduled, active, overdue, completed, cancelled };
  }, [bookings]);

  const dashboardStats = useMemo(() => {
    const scheduledCount = sectionedBookings.scheduled.length;
    const activeCount = sectionedBookings.active.length;
    const overdueCount = sectionedBookings.overdue.length;
    const completedCount = sectionedBookings.completed.length;
    const cancelledCount = sectionedBookings.cancelled.length;

    const pendingCollection = [...sectionedBookings.active, ...sectionedBookings.overdue].reduce(
      (sum, booking) => sum + resolveRemainingAmount(booking),
      0,
    );

    const lateFeeExposure = sectionedBookings.overdue.reduce((sum, booking) => sum + resolveLateFee(booking), 0);

    return {
      scheduledCount,
      activeCount,
      overdueCount,
      completedCount,
      cancelledCount,
      pendingCollection,
      lateFeeExposure,
    };
  }, [sectionedBookings]);

  const handleLoadMore = (sectionKey) => {
    setVisibleBySection((previous) => ({
      ...previous,
      [sectionKey]: (previous[sectionKey] || PAGE_SIZE) + PAGE_SIZE,
    }));
  };

  const toggleInspection = (bookingId) => {
    setInspectionOpenById((previous) => ({
      ...previous,
      [bookingId]: !previous[bookingId],
    }));
  };

  const handleDownloadInvoice = useCallback(
    async (bookingId) => {
      try {
        await downloadBookingInvoicePdf(bookingId);
        notify.success('Invoice downloaded');
      } catch (error) {
        notify.error(getErrorMessage(error, 'Failed to download invoice'));
      }
    },
    [notify],
  );

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Rental Tracking"
        subTitle="Monitor scheduled pickups, active rentals, overdue risk, and completed trip settlements."
      />

      <div className="admin-section-scroll-shell mt-4 md:mt-6">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll admin-section-scroll--proximity">
          <section className="rounded-2xl border border-slate-700 bg-linear-to-r from-slate-900 via-slate-800 to-slate-900 p-5 md:p-6 text-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[11px] uppercase tracking-[0.2em] text-blue-200">Rental Operations</p>
                <h2 className="mt-2 text-xl font-semibold md:text-2xl">Live Stage Monitoring</h2>
                <p className="mt-2 max-w-2xl text-sm text-slate-200">
                  Track all rental stages from pickup readiness to overdue settlement in one streamlined control panel.
                </p>
              </div>
              <button
                type="button"
                onClick={loadBookings}
                className="rounded-lg border border-slate-500 bg-white/10 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={loading}
              >
                {loading ? 'Refreshing...' : 'Refresh Data'}
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <StageTag label={`Scheduled ${dashboardStats.scheduledCount}`} tone="scheduled" />
              <StageTag label={`Active ${dashboardStats.activeCount}`} tone="active" />
              <StageTag label={`Overdue ${dashboardStats.overdueCount}`} tone="overdue" />
              <StageTag label={`Cancelled ${dashboardStats.cancelledCount}`} tone="cancelled" />
              <StageTag label={`Completed ${dashboardStats.completedCount}`} tone="completed" />
            </div>

            {errorMsg ? <p className="mt-3 text-sm text-red-200">{errorMsg}</p> : null}
          </section>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryMetric
              title="Total Tracked"
              value={formatAmount(bookings.length)}
              caption="All bookings synced with stage engine"
              tone="slate"
            />
            <SummaryMetric
              title="Pending Collection"
              value={formatMoney(currency, dashboardStats.pendingCollection)}
              caption="Remaining from active and overdue rentals"
              tone="blue"
            />
            <SummaryMetric
              title="Overdue Cases"
              value={formatAmount(dashboardStats.overdueCount)}
              caption={`Late fee exposure ${formatMoney(currency, dashboardStats.lateFeeExposure)}`}
              tone="red"
            />
            <SummaryMetric
              title="Cancelled Trips"
              value={formatAmount(dashboardStats.cancelledCount)}
              caption="Cancelled rentals with refund tracking"
              tone="red"
            />
            <SummaryMetric
              title="Completed Trips"
              value={formatAmount(dashboardStats.completedCount)}
              caption="Closed rentals with finalized settlement"
              tone="emerald"
            />
          </div>

          <div className="mt-5 space-y-5 pb-1">
            <SectionShell
              title="Section A - Upcoming Pickups"
              subtitle="Scheduled rentals sorted by nearest pickup time."
              items={sectionedBookings.scheduled}
              sectionKey="scheduled"
              renderItem={(booking) => <ScheduledCard booking={booking} currency={currency} />}
              visibleCount={visibleBySection.scheduled}
              onLoadMore={handleLoadMore}
              emptyMessage="No scheduled pickups right now."
              loading={loading}
            />

            <SectionShell
              title="Section B - Active Rentals"
              subtitle="Live return deadlines and remaining amounts."
              items={sectionedBookings.active}
              sectionKey="active"
              renderItem={(booking) => (
                <ActiveCard
                  booking={booking}
                  currency={currency}
                  inspectionOpen={Boolean(inspectionOpenById[booking._id])}
                  onToggleInspection={() => toggleInspection(booking._id)}
                />
              )}
              visibleCount={visibleBySection.active}
              onLoadMore={handleLoadMore}
              emptyMessage="No active rentals right now."
              loading={loading}
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
              loading={loading}
            />

            <SectionShell
              title="Section D - Cancelled Rentals"
              subtitle="Track cancelled bookings and refund progress."
              items={sectionedBookings.cancelled}
              sectionKey="cancelled"
              renderItem={(booking) => <CancelledCard booking={booking} currency={currency} />}
              visibleCount={visibleBySection.cancelled}
              onLoadMore={handleLoadMore}
              emptyMessage="No cancelled rentals right now."
              loading={loading}
            />

            <SectionShell
              title="Section E - Completed Rentals"
              subtitle="Finalized payment and late-fee breakdown."
              items={sectionedBookings.completed}
              sectionKey="completed"
              renderItem={(booking) => (
                <CompletedCard
                  booking={booking}
                  currency={currency}
                  onDownloadInvoice={handleDownloadInvoice}
                  inspectionOpen={Boolean(inspectionOpenById[booking._id])}
                  onToggleInspection={() => toggleInspection(booking._id)}
                />
              )}
              visibleCount={visibleBySection.completed}
              onLoadMore={handleLoadMore}
              emptyMessage="No completed rentals yet."
              loading={loading}
            />
          </div>
        </div>
        <span className="admin-section-blur admin-section-blur--bottom" aria-hidden="true" />
      </div>
    </div>
  );
};

export default RentalTracking;
