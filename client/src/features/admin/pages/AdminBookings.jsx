import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import LiveLateFeeSummary from '../../../components/ui/LiveLateFeeSummary';
import LiveStageCountdown from '../../../components/ui/LiveStageCountdown';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';
import { downloadBookingInvoicePdf } from '../../../services/bookingService';
import { hasPermission } from '../../../utils/auth';
import { PERMISSIONS } from '../../../utils/rbac';
import {
  getNormalizedStatusKey,
  hasPickupInspection,
  hasReturnInspection,
  isConfirmedBookingStatus,
  isFullyPaidStatus,
  isRefundProcessedStatus,
  isPaymentTimeoutCancelled,
  resolveAdvancePaid,
  resolveAdvanceRequired,
  resolveDamageCost,
  resolveDropDateTime,
  resolveFinalAmount,
  resolveLateFee,
  resolveLateHours,
  resolveHourlyLateRate,
  resolvePickupDateTime,
  resolveRefundAmount,
  resolveRefundProcessedAt,
  resolveRefundReason,
  resolveRefundStatus,
  resolveSubscriptionLateFeeDiscountPercent,
  resolveRentalStage,
  resolveRemainingAmount,
  resolveTotalPaidAmount,
} from '../../../utils/payment';

const RENTAL_STAGE_FILTERS = ['all', 'Scheduled', 'Active', 'Overdue', 'Completed', 'Cancelled', 'Refunded'];

const AdminBookings = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const notify = useNotify();
  const [bookings, setBookings] = useState([]);
  const [counterPriceById, setCounterPriceById] = useState({});
  const [completionPaymentMethodById, setCompletionPaymentMethodById] = useState({});
  const [refundAmountById, setRefundAmountById] = useState({});
  const [refundReasonById, setRefundReasonById] = useState({});
  const [refundLoadingId, setRefundLoadingId] = useState('');
  const [pickupInspectionById, setPickupInspectionById] = useState({});
  const [returnInspectionById, setReturnInspectionById] = useState({});
  const [inspectionLoadingId, setInspectionLoadingId] = useState('');
  const [inspectionOpenById, setInspectionOpenById] = useState({});
  const [pickupLoadingId, setPickupLoadingId] = useState('');
  const [driverSuggestionsByBookingId, setDriverSuggestionsByBookingId] = useState({});
  const [driverSelectionByBookingId, setDriverSelectionByBookingId] = useState({});
  const [driverLoadingId, setDriverLoadingId] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [branchOptions, setBranchOptions] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const canManageDrivers = hasPermission(PERMISSIONS.MANAGE_DRIVERS);

  const loadBookings = async () => {
    try {
      const params = selectedBranchId ? { branchId: selectedBranchId } : undefined;
      const res = await API.get('/admin/bookings', { params });
      const nextBookings = Array.isArray(res.data) ? res.data : [];
      setBookings(nextBookings);
      setDriverSelectionByBookingId(() => {
        const next = {};
        for (const booking of nextBookings) {
          const bookingId = String(booking?._id || '');
          if (!bookingId) continue;

          const assignedDriverId = String(booking?.assignedDriver?._id || booking?.assignedDriver || '').trim();
          if (assignedDriverId) {
            next[bookingId] = assignedDriverId;
            continue;
          }

          next[bookingId] = '';
        }
        return next;
      });
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load bookings'));
    }
  };

  useEffect(() => {
    const loadBranchOptions = async () => {
      try {
        const response = await API.get('/admin/branch-options');
        const branches = Array.isArray(response.data?.branches) ? response.data.branches : [];
        setBranchOptions(branches);
      } catch {
        setBranchOptions([]);
      }
    };

    loadBranchOptions();
  }, []);

  useEffect(() => {
    loadBookings();
  }, [selectedBranchId]);

  const stats = useMemo(() => {
    const active = bookings.filter((booking) => resolveRentalStage(booking) === 'Active').length;
    const overdue = bookings.filter((booking) => resolveRentalStage(booking) === 'Overdue').length;
    const heavyOverdue = bookings.filter((booking) => {
      return resolveRentalStage(booking) === 'Overdue' && resolveLateHours(booking) >= 24;
    }).length;
    const completed = bookings.filter((booking) => resolveRentalStage(booking) === 'Completed').length;
    const cancelled = bookings.filter((booking) => resolveRentalStage(booking) === 'Cancelled').length;
    const refunded = bookings.filter((booking) => isRefundProcessedStatus(booking?.refundStatus)).length;
    const pendingAmount = bookings.reduce((sum, booking) => sum + resolveRemainingAmount(booking), 0);
    return { active, overdue, heavyOverdue, completed, cancelled, refunded, pendingAmount };
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    if (stageFilter === 'all') return bookings;
    if (stageFilter === 'Refunded') {
      return bookings.filter((booking) => isRefundProcessedStatus(booking?.refundStatus));
    }
    return bookings.filter((booking) => resolveRentalStage(booking) === stageFilter);
  }, [bookings, stageFilter]);

  const formatDateTimeLabel = (value) => {
    if (!value) return 'N/A';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.toLocaleString();
  };

  const updatePickupInspectionDraft = (bookingId, patch) => {
    setPickupInspectionById((previous) => ({
      ...previous,
      [bookingId]: {
        ...(previous[bookingId] || {}),
        ...patch,
      },
    }));
  };

  const updateReturnInspectionDraft = (bookingId, patch) => {
    setReturnInspectionById((previous) => ({
      ...previous,
      [bookingId]: {
        ...(previous[bookingId] || {}),
        ...patch,
      },
    }));
  };

  const confirmPickup = async (id) => {
    if (!window.confirm('Confirm car handover and start rental?')) return;

    const draft = pickupInspectionById[id] || {};
    const conditionNotes = String(draft.conditionNotes || '').trim();
    const images = Array.isArray(draft.images) ? draft.images : [];

    if (conditionNotes.length < 3) {
      notify.error('Pickup inspection notes must be at least 3 characters');
      return;
    }

    if (images.length === 0) {
      notify.error('Please upload at least one pickup inspection image');
      return;
    }

    try {
      setPickupLoadingId(id);
      const payload = new FormData();
      payload.append('conditionNotes', conditionNotes);
      payload.append('damageReported', String(Boolean(draft.damageReported)));
      images.forEach((file) => {
        payload.append('images', file);
      });

      await API.put(`/admin/bookings/pickup/${id}`, payload);
      setPickupInspectionById((previous) => ({
        ...previous,
        [id]: { conditionNotes: '', damageReported: false, images: [] },
      }));
      await loadBookings();
      notify.success('Pickup handover confirmed');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to confirm pickup'));
    } finally {
      setPickupLoadingId('');
    }
  };

  const submitReturnInspection = async (booking) => {
    const bookingId = booking?._id;
    if (!bookingId) return;

    const draft = returnInspectionById[bookingId] || {};
    const conditionNotes = String(draft.conditionNotes || '').trim();
    const images = Array.isArray(draft.images) ? draft.images : [];
    const damageDetected = Boolean(draft.damageDetected);
    const damageCost = Number(draft.damageCost);
    const mileageInput = draft.currentMileage;
    const hasMileageInput =
      mileageInput !== undefined &&
      mileageInput !== null &&
      String(mileageInput).trim() !== '';
    const currentMileage = Number(mileageInput);

    if (conditionNotes.length < 3) {
      notify.error('Return inspection notes must be at least 3 characters');
      return;
    }

    if (images.length === 0) {
      notify.error('Please upload at least one return inspection image');
      return;
    }

    if (damageDetected && (!Number.isFinite(damageCost) || damageCost < 0)) {
      notify.error('Enter a valid non-negative damage cost');
      return;
    }

    if (hasMileageInput && (!Number.isFinite(currentMileage) || currentMileage < 0)) {
      notify.error('Enter a valid non-negative current mileage');
      return;
    }

    try {
      setInspectionLoadingId(bookingId);
      const payload = new FormData();
      payload.append('conditionNotes', conditionNotes);
      payload.append('damageDetected', String(damageDetected));
      payload.append('damageCost', damageDetected ? String(damageCost) : '0');
      if (hasMileageInput) {
        payload.append('currentMileage', String(currentMileage));
      }
      images.forEach((file) => {
        payload.append('images', file);
      });

      await API.put(`/admin/bookings/inspection/return/${bookingId}`, payload);
      setReturnInspectionById((previous) => ({
        ...previous,
        [bookingId]: { conditionNotes: '', damageDetected: false, damageCost: '', currentMileage: '', images: [] },
      }));
      await loadBookings();
      notify.success('Return inspection saved');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to save return inspection'));
    } finally {
      setInspectionLoadingId('');
    }
  };

  const completeBooking = async (booking) => {
    const id = booking?._id;
    if (!id) return;

    const hasLockedReturnInspection = hasReturnInspection(booking);
    if (!hasLockedReturnInspection) {
      notify.error('Return inspection is required before completing booking');
      return;
    }

    if (!window.confirm('Mark car as returned and record full payment?')) return;
    try {
      await API.put(`/admin/bookings/complete/${id}`, {
        paymentMethod: completionPaymentMethodById[id] || 'CASH',
      });
      await loadBookings();
      notify.success('Booking marked as returned and completed');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to complete booking'));
    }
  };

  const acceptBargain = async (id) => {
    try {
      await API.put(`/admin/bookings/${id}/bargain`, { action: 'accept' });
      await loadBookings();
      notify.success('Bargain accepted');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to accept bargain'));
    }
  };

  const rejectBargain = async (id) => {
    try {
      await API.put(`/admin/bookings/${id}/bargain`, { action: 'reject' });
      await loadBookings();
      notify.success('Bargain rejected');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to reject bargain'));
    }
  };

  const counterBargain = async (id) => {
    const counterPrice = Number(counterPriceById[id]);
    if (!Number.isFinite(counterPrice) || counterPrice <= 0) {
      notify.error('Enter a valid counter price');
      return;
    }

    try {
      await API.put(`/admin/bookings/${id}/bargain`, {
        action: 'counter',
        counterPrice,
      });

      setCounterPriceById((prev) => ({ ...prev, [id]: '' }));
      await loadBookings();
      notify.success('Counter offer sent');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to counter bargain'));
    }
  };

  const deleteBooking = async (id) => {
    if (!window.confirm('Delete this booking permanently?')) return;
    try {
      await API.delete(`/bookings/admin/bookings/${id}`);
      await loadBookings();
      notify.success('Booking deleted successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete booking'));
    }
  };

  const downloadInvoice = async (bookingId) => {
    try {
      await downloadBookingInvoicePdf(bookingId);
      notify.success('Invoice downloaded');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to download invoice'));
    }
  };

  const processRefund = async (booking, refundType = 'partial') => {
    if (!booking?._id) {
      notify.error('Booking id is required');
      return;
    }

    const bookingId = booking._id;
    const reason = String(refundReasonById[bookingId] || '').trim();
    const payload = {
      refundType: refundType === 'full' ? 'full' : 'partial',
      refundReason: reason,
    };

    if (payload.refundType === 'partial') {
      const amount = Number(refundAmountById[bookingId]);
      if (!Number.isFinite(amount) || amount <= 0) {
        notify.error('Enter a valid partial refund amount');
        return;
      }
      payload.refundAmount = amount;
    }

    try {
      setRefundLoadingId(bookingId);
      await API.put(`/admin/refund/${bookingId}`, payload);
      await loadBookings();
      setRefundAmountById((previous) => ({
        ...previous,
        [bookingId]: '',
      }));
      notify.success('Refund processed successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to process refund'));
    } finally {
      setRefundLoadingId('');
    }
  };

  const loadDriverSuggestions = async (booking) => {
    const bookingId = String(booking?._id || '');
    if (!bookingId) return [];

    try {
      setDriverLoadingId(`suggest:${bookingId}`);
      const response = await API.get(`/admin/bookings/${bookingId}/driver-suggestions`);
      const suggestions = Array.isArray(response.data?.suggestions) ? response.data.suggestions : [];

      setDriverSuggestionsByBookingId((previous) => ({
        ...previous,
        [bookingId]: suggestions,
      }));

      const currentAssignedDriverId = String(booking?.assignedDriver?._id || booking?.assignedDriver || '').trim();
      const firstAvailableDriverId = String(
        suggestions.find((driver) => driver?.isAvailable || driver?.isAssignedToThisBooking)?._id || '',
      ).trim();
      setDriverSelectionByBookingId((previous) => ({
        ...previous,
        [bookingId]: currentAssignedDriverId || previous[bookingId] || firstAvailableDriverId,
      }));

      return suggestions;
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to load driver suggestions'));
      return [];
    } finally {
      setDriverLoadingId('');
    }
  };

  const assignDriverToBooking = async (booking) => {
    const bookingId = String(booking?._id || '');
    if (!bookingId) return;

    let selectedDriverId = String(driverSelectionByBookingId[bookingId] || '').trim();
    if (!selectedDriverId) {
      const suggestions = await loadDriverSuggestions(booking);
      selectedDriverId = String(
        suggestions.find((driver) => driver?.isAvailable || driver?.isAssignedToThisBooking)?._id || '',
      ).trim();
      if (!selectedDriverId) {
        notify.error('No available driver found for this booking');
        return;
      }
    }

    try {
      setDriverLoadingId(`assign:${bookingId}`);
      await API.put(`/admin/bookings/${bookingId}/assign-driver`, { driverId: selectedDriverId });
      await loadBookings();
      notify.success(booking?.assignedDriver ? 'Driver changed successfully' : 'Driver assigned successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to assign driver'));
    } finally {
      setDriverLoadingId('');
    }
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Active Rentals"
        subTitle="Track ongoing rentals, collect final payment on return, and close negotiations."
      />

      {errorMsg && <p className="mt-4 text-sm text-red-500">{errorMsg}</p>}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-4 max-w-6xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Active Rentals</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{stats.active}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-red-600">Overdue Rentals</p>
          <p className="mt-2 text-2xl font-semibold text-red-700">{stats.overdue}</p>
          <p className="text-[11px] text-red-600 mt-1">Heavy overdue: {stats.heavyOverdue}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Completed Trips</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.completed}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Cancelled</p>
          <p className="mt-2 text-2xl font-semibold text-rose-600">{stats.cancelled}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Refunded</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{stats.refunded}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Remaining Collection</p>
          <p className="mt-2 text-2xl font-semibold text-primary">
            {currency}
            {stats.pendingAmount}
          </p>
        </div>
      </div>

      <div className="mt-5 max-w-6xl flex flex-col gap-3">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="text-xs text-gray-500">Filter rentals by branch and stage</div>
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            className="w-full md:w-72 rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          >
            <option value="">All Branches</option>
            {branchOptions.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.branchName}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap gap-2">
          {RENTAL_STAGE_FILTERS.map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setStageFilter(filter)}
              className={`px-3 py-1.5 rounded-lg text-sm border ${
                stageFilter === filter
                  ? filter === 'Overdue'
                    ? 'bg-red-600 text-white border-red-600'
                    : filter === 'Cancelled'
                    ? 'bg-rose-600 text-white border-rose-600'
                    : filter === 'Refunded'
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-primary text-white border-primary'
                  : 'bg-white text-gray-700 border-borderColor'
              }`}
            >
              {filter === 'all' ? 'All' : filter}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-section-scroll-shell mt-6">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll">
          <div className="space-y-4 max-w-6xl">
            {filteredBookings.length === 0 && (
              <div className="rounded-xl border border-borderColor bg-white p-8 text-center text-gray-500">
                No rentals found.
              </div>
            )}

            {filteredBookings.map((booking) => {
              const finalAmount = resolveFinalAmount(booking);
              const advanceRequired = resolveAdvanceRequired(booking);
              const advancePaid = resolveAdvancePaid(booking) || advanceRequired;
              const lateHours = resolveLateHours(booking);
              const lateFee = resolveLateFee(booking);
              const hourlyLateRate = resolveHourlyLateRate(booking);
              const remainingAmount = resolveRemainingAmount(booking);
              const totalPayable = remainingAmount;
              const totalPaid = resolveTotalPaidAmount(booking);
              const rentalStage = resolveRentalStage(booking);
              const bookingStatusKey = getNormalizedStatusKey(booking?.bookingStatus);
              const paymentStatusKey = getNormalizedStatusKey(booking?.paymentStatus);
              const pickupDateTime = resolvePickupDateTime(booking);
              const dropDateTime = resolveDropDateTime(booking);
              const gracePeriodHours = Number.isFinite(Number(booking?.gracePeriodHours))
                ? Math.max(Number(booking?.gracePeriodHours), 0)
                : 1;
              const isHeavyOverdue = rentalStage === 'Overdue' && lateHours >= 24;
              const refundStatus = resolveRefundStatus(booking);
              const refundAmount = resolveRefundAmount(booking);
              const refundProcessedAt = resolveRefundProcessedAt(booking);
              const refundReason = resolveRefundReason(booking);
              const isRefundProcessed = isRefundProcessedStatus(refundStatus);
              const pickupInspectionDone = hasPickupInspection(booking);
              const returnInspectionDone = hasReturnInspection(booking);
              const damageCost = resolveDamageCost(booking);
              const lateFeeDiscountPercentage = resolveSubscriptionLateFeeDiscountPercent(booking);
              const hasDamageFlag = damageCost > 0;
              const showInspection = Boolean(inspectionOpenById[booking._id]);
              const isRefundEligible =
                ['CANCELLED', 'COMPLETED'].includes(bookingStatusKey) &&
                ['PARTIALLYPAID', 'FULLYPAID'].includes(paymentStatusKey) &&
                !isRefundProcessed;
              const noRefundByPenalty = lateHours > 0 && lateFee > advancePaid;
              const pickupMs = new Date(pickupDateTime || '').getTime();
              const cancelledAtMs = new Date(booking?.cancelledAt || booking?.updatedAt || booking?.createdAt || '').getTime();
              const fullRefundEligible =
                bookingStatusKey === 'CANCELLED' &&
                Number.isFinite(pickupMs) &&
                Number.isFinite(cancelledAtMs) &&
                cancelledAtMs < pickupMs;
              const rentalStageClass =
                rentalStage === 'Overdue'
                  ? 'bg-red-100 text-red-700'
                  : rentalStage === 'Active'
                  ? 'bg-emerald-100 text-emerald-700'
                  : rentalStage === 'Completed'
                  ? 'bg-gray-200 text-gray-700'
                  : rentalStage === 'Cancelled'
                  ? 'bg-red-100 text-red-700'
                  : rentalStage === 'PendingPayment'
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-blue-100 text-blue-700';
              const userName = `${booking.user?.firstName || ''} ${booking.user?.lastName || ''}`.trim();
              const timeoutCancelled = isPaymentTimeoutCancelled(booking);
              const bookingId = String(booking?._id || '');
              const assignedDriver = booking?.assignedDriver || null;
              const assignedDriverName = String(assignedDriver?.driverName || '').trim();
              const assignedDriverPhone = String(assignedDriver?.phoneNumber || '').trim();
              const assignedDriverLicense = String(assignedDriver?.licenseNumber || '').trim();
              const isDriverActionStage = ['Scheduled', 'Active'].includes(rentalStage);
              const canAssignDriver = canManageDrivers && isDriverActionStage && isConfirmedBookingStatus(booking.bookingStatus);
              const driverSuggestions = Array.isArray(driverSuggestionsByBookingId[bookingId])
                ? driverSuggestionsByBookingId[bookingId]
                : [];
              const selectedDriverId = String(
                driverSelectionByBookingId[bookingId] || assignedDriver?._id || assignedDriver || '',
              ).trim();
              const driverSuggestionLoading = driverLoadingId === `suggest:${bookingId}`;
              const driverAssignLoading = driverLoadingId === `assign:${bookingId}`;

              return (
                <div
                  key={booking._id}
                  className={`snap-start rounded-2xl border bg-white p-4 md:p-5 shadow-sm ${
                    rentalStage === 'Overdue'
                      ? isHeavyOverdue
                        ? 'border-red-500 bg-red-50/40'
                        : 'border-red-300 bg-red-50/20'
                      : 'border-borderColor'
                  }`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_1fr_auto] gap-5">
                    <div className="flex gap-4">
                      <img
                        src={booking.car?.image}
                        alt="car"
                        className="w-28 h-20 object-cover rounded-lg border border-borderColor"
                      />
                      <div>
                        <h3 className="font-semibold text-lg text-gray-800">
                          {booking.car?.brand} {booking.car?.model}
                        </h3>
                        <p className="text-sm text-gray-600">
                          User: {userName || 'Unknown'} ({booking.user?.email || 'N/A'})
                        </p>
                        <p className="text-sm text-gray-500 mt-1">
                          Pickup: {formatDateTimeLabel(pickupDateTime)}
                        </p>
                        <p className="text-sm text-gray-500">
                          Drop: {formatDateTimeLabel(dropDateTime)}
                        </p>
                        <LiveStageCountdown
                          stage={rentalStage}
                          pickupDateTime={pickupDateTime}
                          dropDateTime={dropDateTime}
                          paymentDeadline={booking?.paymentDeadline}
                          gracePeriodHours={gracePeriodHours}
                          className={`text-xs mt-1 ${
                            rentalStage === 'Overdue'
                              ? 'text-red-700'
                              : rentalStage === 'Active'
                              ? 'text-emerald-700'
                              : rentalStage === 'Completed'
                              ? 'text-gray-600'
                              : 'text-blue-700'
                          }`}
                        />
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                            {booking.bookingStatus || 'UNKNOWN'}
                          </span>
                          <span className="px-2 py-1 rounded-full bg-violet-50 text-violet-700">
                            {booking.tripStatus || 'upcoming'}
                          </span>
                          <span className={`px-2 py-1 rounded-full ${rentalStageClass} ${rentalStage === 'Overdue' ? 'animate-pulse' : ''}`}>
                            {rentalStage}
                          </span>
                          {isHeavyOverdue ? (
                            <span className="px-2 py-1 rounded-full bg-red-600 text-white">
                              Heavy Overdue
                            </span>
                          ) : null}
                          <span
                            className={`px-2 py-1 rounded-full ${
                              isFullyPaidStatus(booking.paymentStatus)
                                ? 'bg-emerald-100 text-emerald-700'
                                : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {booking.paymentStatus || 'Unpaid'}
                          </span>
                          <span
                            className={`px-2 py-1 rounded-full ${
                              isRefundProcessed ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            Refund: {refundStatus}
                          </span>
                          {hasDamageFlag ? (
                            <span className="px-2 py-1 rounded-full bg-red-100 text-red-700">
                              Damage: {currency}
                              {damageCost}
                            </span>
                          ) : null}
                        </div>
                        {timeoutCancelled ? (
                          <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
                            Payment timeout: booking auto-cancelled due to unpaid advance.
                          </p>
                        ) : null}
                        {['Scheduled', 'Active', 'Overdue'].includes(rentalStage) ? (
                          <div className="mt-2 rounded-lg border border-borderColor bg-light px-2.5 py-2 text-xs">
                            <p className="font-medium text-gray-700">Driver</p>
                            {assignedDriverName ? (
                              <>
                                <p className="mt-1 text-gray-700">{assignedDriverName}</p>
                                <p className="text-gray-500">Contact: {assignedDriverPhone || 'N/A'}</p>
                                <p className="text-gray-500">License: {assignedDriverLicense || 'N/A'}</p>
                              </>
                            ) : (
                              <p className="mt-1 text-gray-500">No driver assigned yet.</p>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-lg bg-light p-3">
                        <p className="text-xs text-gray-500">Total</p>
                        <p className="font-semibold text-gray-800">
                          {currency}
                          {finalAmount}
                        </p>
                      </div>
                      <div className="rounded-lg bg-light p-3">
                        <p className="text-xs text-gray-500">Advance Required</p>
                        <p className="font-semibold text-gray-800">
                          {currency}
                          {advanceRequired}
                        </p>
                        <p className="text-[11px] text-gray-500">{booking.paymentMethod || 'NONE'}</p>
                      </div>
                      <div className="rounded-lg bg-light p-3">
                        <p className="text-xs text-gray-500">Advance Paid</p>
                        <p className="font-semibold text-gray-800">
                          {currency}
                          {advancePaid}
                        </p>
                      </div>
                      <div className="rounded-lg bg-light p-3">
                        <p className="text-xs text-gray-500">Total Payable</p>
                        <p className="font-semibold text-gray-800">
                          {currency}
                          {totalPayable}
                        </p>
                      </div>
                      <div className="rounded-lg bg-light p-3">
                        <p className="text-xs text-gray-500">Damage Cost</p>
                        <p className={`font-semibold ${hasDamageFlag ? 'text-red-700' : 'text-gray-800'}`}>
                          {currency}
                          {damageCost}
                        </p>
                      </div>
                      <div className="rounded-lg bg-light p-3">
                        <p className="text-xs text-gray-500">Net Paid</p>
                        <p className="font-semibold text-gray-800">
                          {currency}
                          {totalPaid}
                        </p>
                      </div>
                      <div className="rounded-lg bg-light p-3">
                        <p className="text-xs text-gray-500">Refunded</p>
                        <p className="font-semibold text-emerald-700">
                          {currency}
                          {refundAmount}
                        </p>
                        <p className="text-[11px] text-gray-500">
                          {refundProcessedAt ? formatDateTimeLabel(refundProcessedAt) : 'Not processed'}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col items-stretch gap-2 min-w-45">
                      <div className="rounded-lg bg-light p-3 text-sm">
                        <p className="text-xs text-gray-500">Negotiation</p>
                        <p className="font-semibold text-gray-800">{booking.bargain?.status || 'NONE'}</p>
                      </div>

                      {canAssignDriver ? (
                        <div className="rounded-lg border border-borderColor bg-light p-3 space-y-2">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs font-medium text-gray-700">
                              {assignedDriverName ? 'Change Driver' : 'Assign Driver'}
                            </p>
                            <button
                              type="button"
                              onClick={() => loadDriverSuggestions(booking)}
                              disabled={driverSuggestionLoading}
                              className={`rounded-md border px-2 py-1 text-[11px] font-medium ${
                                driverSuggestionLoading
                                  ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                                  : 'border-indigo-200 bg-indigo-50 text-indigo-700'
                              }`}
                            >
                              {driverSuggestionLoading ? 'Loading...' : 'Refresh'}
                            </button>
                          </div>

                          <select
                            value={selectedDriverId}
                            onFocus={() => {
                              if (driverSuggestions.length === 0) {
                                loadDriverSuggestions(booking);
                              }
                            }}
                            onChange={(event) =>
                              setDriverSelectionByBookingId((previous) => ({
                                ...previous,
                                [bookingId]: event.target.value,
                              }))
                            }
                            disabled={driverSuggestionLoading || driverAssignLoading}
                            className="w-full rounded-lg border border-borderColor bg-white px-2.5 py-2 text-xs"
                          >
                            <option value="">Select driver</option>
                            {driverSuggestions.map((driver) => {
                              const suggestionId = String(driver?._id || '').trim();
                              const suggestionName = String(driver?.driverName || '').trim() || 'Driver';
                              const suggestionPhone = String(driver?.phoneNumber || '').trim();
                              const suggestionTrips = Number(driver?.totalTripsCompleted || 0);
                              const suggestionDisabled = !(driver?.isAvailable || driver?.isAssignedToThisBooking);
                              const suffix = driver?.isAssignedToThisBooking
                                ? ' (Current)'
                                : suggestionDisabled
                                ? ' (Busy)'
                                : '';

                              return (
                                <option key={suggestionId} value={suggestionId} disabled={suggestionDisabled}>
                                  {`${suggestionName}${suffix} • ${suggestionPhone || 'N/A'} • Trips ${suggestionTrips}`}
                                </option>
                              );
                            })}
                          </select>

                          <button
                            type="button"
                            onClick={() => assignDriverToBooking(booking)}
                            disabled={!selectedDriverId || driverSuggestionLoading || driverAssignLoading}
                            className={`w-full rounded-lg px-3 py-2 text-xs font-medium text-white ${
                              !selectedDriverId || driverSuggestionLoading || driverAssignLoading
                                ? 'cursor-not-allowed bg-slate-400'
                                : 'bg-indigo-600'
                            }`}
                          >
                            {driverAssignLoading
                              ? 'Saving...'
                              : assignedDriverName
                              ? 'Change Driver'
                              : 'Assign Driver'}
                          </button>
                        </div>
                      ) : null}

                      {isConfirmedBookingStatus(booking.bookingStatus) &&
                        booking.tripStatus !== 'completed' &&
                        rentalStage === 'Scheduled' && (
                        <div className="rounded-lg border border-borderColor bg-light p-3 space-y-2">
                          {!pickupInspectionDone ? (
                            <>
                              <p className="text-xs font-medium text-gray-700">Pickup Inspection (Required)</p>
                              <textarea
                                rows={2}
                                placeholder="Condition notes before handover"
                                value={pickupInspectionById[booking._id]?.conditionNotes || ''}
                                onChange={(event) =>
                                  updatePickupInspectionDraft(booking._id, { conditionNotes: event.target.value })
                                }
                                className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                              />
                              <label className="flex items-center gap-2 text-xs text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={Boolean(pickupInspectionById[booking._id]?.damageReported)}
                                  onChange={(event) =>
                                    updatePickupInspectionDraft(booking._id, { damageReported: event.target.checked })
                                  }
                                />
                                Pre-existing damage reported at pickup
                              </label>
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                onChange={(event) =>
                                  updatePickupInspectionDraft(booking._id, {
                                    images: Array.from(event.target.files || []),
                                  })
                                }
                                className="w-full rounded-lg border border-borderColor bg-white px-2.5 py-2 text-xs"
                              />
                              <button
                                onClick={() => confirmPickup(booking._id)}
                                disabled={pickupLoadingId === booking._id}
                                className={`w-full px-4 py-2 rounded-lg text-sm font-medium text-white ${
                                  pickupLoadingId === booking._id ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600'
                                }`}
                              >
                                {pickupLoadingId === booking._id ? 'Starting...' : 'Submit Inspection & Confirm Pickup'}
                              </button>
                            </>
                          ) : (
                            <p className="text-xs text-emerald-700">
                              Pickup inspection already submitted.
                            </p>
                          )}
                        </div>
                      )}

                      {isConfirmedBookingStatus(booking.bookingStatus) &&
                        booking.tripStatus !== 'completed' &&
                        rentalStage !== 'Scheduled' && (
                        <>
                          {!returnInspectionDone ? (
                            <div className="rounded-lg border border-borderColor bg-light p-3 space-y-2">
                              <p className="text-xs font-medium text-gray-700">Return Inspection (Required)</p>
                              <textarea
                                rows={2}
                                placeholder="Condition notes at return"
                                value={returnInspectionById[booking._id]?.conditionNotes || ''}
                                onChange={(event) =>
                                  updateReturnInspectionDraft(booking._id, { conditionNotes: event.target.value })
                                }
                                className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                              />
                              <label className="flex items-center gap-2 text-xs text-gray-600">
                                <input
                                  type="checkbox"
                                  checked={Boolean(returnInspectionById[booking._id]?.damageDetected)}
                                  onChange={(event) =>
                                    updateReturnInspectionDraft(booking._id, { damageDetected: event.target.checked })
                                  }
                                />
                                Damage detected at return
                              </label>
                              {returnInspectionById[booking._id]?.damageDetected ? (
                                <input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  placeholder="Damage cost"
                                  value={returnInspectionById[booking._id]?.damageCost || ''}
                                  onChange={(event) =>
                                    updateReturnInspectionDraft(booking._id, { damageCost: event.target.value })
                                  }
                                  className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                />
                              ) : null}
                              <input
                                type="number"
                                min="0"
                                step="1"
                                placeholder="Current mileage (optional)"
                                value={returnInspectionById[booking._id]?.currentMileage || ''}
                                onChange={(event) =>
                                  updateReturnInspectionDraft(booking._id, { currentMileage: event.target.value })
                                }
                                className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                              />
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                onChange={(event) =>
                                  updateReturnInspectionDraft(booking._id, {
                                    images: Array.from(event.target.files || []),
                                  })
                                }
                                className="w-full rounded-lg border border-borderColor bg-white px-2.5 py-2 text-xs"
                              />
                              <button
                                type="button"
                                disabled={inspectionLoadingId === booking._id}
                                onClick={() => submitReturnInspection(booking)}
                                className={`w-full rounded-lg px-3 py-2 text-xs font-medium text-white ${
                                  inspectionLoadingId === booking._id
                                    ? 'bg-gray-400 cursor-not-allowed'
                                    : 'bg-violet-600'
                                }`}
                              >
                                {inspectionLoadingId === booking._id ? 'Saving...' : 'Submit Return Inspection'}
                              </button>
                            </div>
                          ) : (
                            <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                              Return inspection submitted{hasDamageFlag ? ` with damage ${currency}${damageCost}` : ''}.
                            </p>
                          )}

                          <select
                            value={completionPaymentMethodById[booking._id] || 'CASH'}
                            onChange={(e) =>
                              setCompletionPaymentMethodById((prev) => ({
                                ...prev,
                                [booking._id]: e.target.value,
                              }))
                            }
                            className="border border-borderColor rounded-lg px-3 py-2 text-sm"
                          >
                            <option value="CASH">Cash</option>
                            <option value="CARD">Card</option>
                            <option value="UPI">UPI</option>
                            <option value="NETBANKING">Net Banking</option>
                          </select>
                          <button
                            onClick={() => completeBooking(booking)}
                            disabled={!returnInspectionDone}
                            className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${
                              returnInspectionDone ? 'bg-primary' : 'bg-gray-400 cursor-not-allowed'
                            }`}
                          >
                            Return Car
                          </button>
                        </>
                      )}

                      {rentalStage === 'Completed' ? (
                        <button
                          onClick={() => downloadInvoice(booking._id)}
                          className="border border-borderColor bg-white text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
                        >
                          Download Invoice
                        </button>
                      ) : null}

                      {isRefundProcessed ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                          <p className="font-medium">Refund processed</p>
                          <p>
                            {currency}
                            {refundAmount} on {formatDateTimeLabel(refundProcessedAt)}
                          </p>
                          {refundReason ? <p className="mt-1">Reason: {refundReason}</p> : null}
                        </div>
                      ) : null}

                      {!isRefundProcessed && noRefundByPenalty ? (
                        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                          Refund is blocked because overdue penalty exceeds advance paid.
                        </div>
                      ) : null}

                      {!isRefundProcessed && isRefundEligible && !noRefundByPenalty ? (
                        <div className="rounded-lg border border-borderColor bg-light p-3 space-y-2">
                          <p className="text-xs font-medium text-gray-700">Process Refund</p>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            placeholder="Partial refund amount"
                            value={refundAmountById[booking._id] || ''}
                            onChange={(event) =>
                              setRefundAmountById((previous) => ({
                                ...previous,
                                [booking._id]: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                          />
                          <input
                            type="text"
                            placeholder="Refund reason (optional)"
                            value={refundReasonById[booking._id] || ''}
                            onChange={(event) =>
                              setRefundReasonById((previous) => ({
                                ...previous,
                                [booking._id]: event.target.value,
                              }))
                            }
                            className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                          />
                          <div className="flex flex-wrap gap-2">
                            {fullRefundEligible ? (
                              <button
                                type="button"
                                disabled={refundLoadingId === booking._id}
                                onClick={() => processRefund(booking, 'full')}
                                className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white ${
                                  refundLoadingId === booking._id ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-600'
                                }`}
                              >
                                {refundLoadingId === booking._id ? 'Processing...' : 'Full Refund'}
                              </button>
                            ) : null}
                            <button
                              type="button"
                              disabled={refundLoadingId === booking._id}
                              onClick={() => processRefund(booking, 'partial')}
                              className={`rounded-lg px-3 py-1.5 text-xs font-medium text-white ${
                                refundLoadingId === booking._id ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600'
                              }`}
                            >
                              {refundLoadingId === booking._id ? 'Processing...' : 'Partial Refund'}
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {(rentalStage === 'Active' || rentalStage === 'Overdue' || rentalStage === 'Completed') ? (
                        <button
                          type="button"
                          onClick={() =>
                            setInspectionOpenById((previous) => ({
                              ...previous,
                              [booking._id]: !previous[booking._id],
                            }))
                          }
                          className="border border-borderColor bg-white text-gray-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-50"
                        >
                          {showInspection ? 'Hide Inspection' : 'Inspection'}
                        </button>
                      ) : null}

                      {showInspection ? (
                        <div className="rounded-lg border border-borderColor bg-light p-3 text-xs text-gray-700 space-y-2">
                          <p className="font-medium text-gray-800">Inspection History</p>
                          <div className="rounded-md border border-borderColor bg-white p-2">
                            <p className="font-medium">Pickup</p>
                            <p>Notes: {booking?.pickupInspection?.conditionNotes || 'N/A'}</p>
                            <p>Damage Reported: {booking?.pickupInspection?.damageReported ? 'Yes' : 'No'}</p>
                            <p>Images: {Array.isArray(booking?.pickupInspection?.images) ? booking.pickupInspection.images.length : 0}</p>
                            <p>Inspected At: {formatDateTimeLabel(booking?.pickupInspection?.inspectedAt)}</p>
                          </div>
                          <div className="rounded-md border border-borderColor bg-white p-2">
                            <p className="font-medium">Return</p>
                            <p>Notes: {booking?.returnInspection?.conditionNotes || 'N/A'}</p>
                            <p>Damage Detected: {booking?.returnInspection?.damageDetected ? 'Yes' : 'No'}</p>
                            <p>
                              Damage Cost:{' '}
                              <span className={hasDamageFlag ? 'font-semibold text-red-700' : ''}>
                                {currency}
                                {damageCost}
                              </span>
                            </p>
                            <p>Current Mileage: {booking?.returnInspection?.currentMileage ?? 'N/A'}</p>
                            <p>Images: {Array.isArray(booking?.returnInspection?.images) ? booking.returnInspection.images.length : 0}</p>
                            <p>Inspected At: {formatDateTimeLabel(booking?.returnInspection?.inspectedAt)}</p>
                          </div>
                        </div>
                      ) : null}

                      <button
                        onClick={() => deleteBooking(booking._id)}
                        className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {rentalStage === 'Overdue' || lateHours > 0 || lateFee > 0 ? (
                    <LiveLateFeeSummary
                      className="mt-4 text-sm"
                      stage={rentalStage}
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
                      highlight
                    />
                  ) : null}

                  {booking.bargain?.status === 'USER_OFFERED' && (
                    <div className="mt-4 pt-4 border-t border-borderColor">
                      <p className="text-sm font-medium text-gray-700 mb-2">Negotiation Action</p>
                      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
                        <input
                          type="number"
                          placeholder="Counter price"
                          value={counterPriceById[booking._id] || ''}
                          onChange={(e) =>
                            setCounterPriceById((prev) => ({ ...prev, [booking._id]: e.target.value }))
                          }
                          className="border border-borderColor rounded-lg px-3 py-2 text-sm"
                        />
                        <div className="flex gap-2">
                          <button
                            onClick={() => acceptBargain(booking._id)}
                            className="bg-emerald-600 text-white px-3 py-2 rounded-lg text-sm"
                          >
                            Accept
                          </button>
                          <button
                            onClick={() => counterBargain(booking._id)}
                            className="bg-amber-500 text-white px-3 py-2 rounded-lg text-sm"
                          >
                            Counter
                          </button>
                          <button
                            onClick={() => rejectBargain(booking._id)}
                            className="bg-red-500 text-white px-3 py-2 rounded-lg text-sm"
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <span className="admin-section-blur admin-section-blur--bottom" aria-hidden="true" />
      </div>
    </div>
  );
};

export default AdminBookings;
