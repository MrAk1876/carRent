import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import LiveLateFeeSummary from '../../../components/ui/LiveLateFeeSummary';
import LiveStageCountdown from '../../../components/ui/LiveStageCountdown';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';
import {
  isConfirmedBookingStatus,
  isFullyPaidStatus,
  resolveAdvancePaid,
  resolveAdvanceRequired,
  resolveDropDateTime,
  resolveFinalAmount,
  resolveLateFee,
  resolveLateHours,
  resolveHourlyLateRate,
  resolvePickupDateTime,
  resolveRentalStage,
  resolveRemainingAmount,
} from '../../../utils/payment';

const RENTAL_STAGE_FILTERS = ['all', 'Scheduled', 'Active', 'Overdue', 'Completed'];

const AdminBookings = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const notify = useNotify();
  const [bookings, setBookings] = useState([]);
  const [counterPriceById, setCounterPriceById] = useState({});
  const [completionPaymentMethodById, setCompletionPaymentMethodById] = useState({});
  const [pickupLoadingId, setPickupLoadingId] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [errorMsg, setErrorMsg] = useState('');

  const loadBookings = async () => {
    try {
      const res = await API.get('/admin/bookings');
      setBookings(Array.isArray(res.data) ? res.data : []);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load bookings'));
    }
  };

  useEffect(() => {
    loadBookings();
  }, []);

  const stats = useMemo(() => {
    const active = bookings.filter((booking) => resolveRentalStage(booking) === 'Active').length;
    const overdue = bookings.filter((booking) => resolveRentalStage(booking) === 'Overdue').length;
    const heavyOverdue = bookings.filter((booking) => {
      return resolveRentalStage(booking) === 'Overdue' && resolveLateHours(booking) >= 24;
    }).length;
    const completed = bookings.filter((booking) => resolveRentalStage(booking) === 'Completed').length;
    const pendingAmount = bookings.reduce((sum, booking) => sum + resolveRemainingAmount(booking), 0);
    return { active, overdue, heavyOverdue, completed, pendingAmount };
  }, [bookings]);

  const filteredBookings = useMemo(() => {
    if (stageFilter === 'all') return bookings;
    return bookings.filter((booking) => resolveRentalStage(booking) === stageFilter);
  }, [bookings, stageFilter]);

  const formatDateTimeLabel = (value) => {
    if (!value) return 'N/A';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.toLocaleString();
  };

  const confirmPickup = async (id) => {
    if (!window.confirm('Confirm car handover and start rental?')) return;

    try {
      setPickupLoadingId(id);
      await API.put(`/admin/bookings/pickup/${id}`);
      await loadBookings();
      notify.success('Pickup handover confirmed');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to confirm pickup'));
    } finally {
      setPickupLoadingId('');
    }
  };

  const completeBooking = async (id) => {
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

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Active Rentals"
        subTitle="Track ongoing rentals, collect final payment on return, and close negotiations."
      />

      {errorMsg && <p className="mt-4 text-sm text-red-500">{errorMsg}</p>}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 max-w-6xl">
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
          <p className="text-xs uppercase tracking-wide text-gray-500">Remaining Collection</p>
          <p className="mt-2 text-2xl font-semibold text-primary">
            {currency}
            {stats.pendingAmount}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2 max-w-6xl">
        {RENTAL_STAGE_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => setStageFilter(filter)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              stageFilter === filter
                ? filter === 'Overdue'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-primary text-white border-primary'
                : 'bg-white text-gray-700 border-borderColor'
            }`}
          >
            {filter === 'all' ? 'All' : filter}
          </button>
        ))}
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
              const rentalStage = resolveRentalStage(booking);
              const gracePeriodHours = Number.isFinite(Number(booking?.gracePeriodHours))
                ? Math.max(Number(booking?.gracePeriodHours), 0)
                : 1;
              const isHeavyOverdue = rentalStage === 'Overdue' && lateHours >= 24;
              const rentalStageClass =
                rentalStage === 'Overdue'
                  ? 'bg-red-100 text-red-700'
                  : rentalStage === 'Active'
                  ? 'bg-emerald-100 text-emerald-700'
                  : rentalStage === 'Completed'
                  ? 'bg-gray-200 text-gray-700'
                  : 'bg-blue-100 text-blue-700';
              const pickupDateTime = resolvePickupDateTime(booking);
              const dropDateTime = resolveDropDateTime(booking);
              const userName = `${booking.user?.firstName || ''} ${booking.user?.lastName || ''}`.trim();

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
                        </div>
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
                    </div>

                    <div className="flex flex-col items-stretch gap-2 min-w-45">
                      <div className="rounded-lg bg-light p-3 text-sm">
                        <p className="text-xs text-gray-500">Negotiation</p>
                        <p className="font-semibold text-gray-800">{booking.bargain?.status || 'NONE'}</p>
                      </div>

                      {isConfirmedBookingStatus(booking.bookingStatus) &&
                        booking.tripStatus !== 'completed' &&
                        rentalStage === 'Scheduled' && (
                        <button
                          onClick={() => confirmPickup(booking._id)}
                          disabled={pickupLoadingId === booking._id}
                          className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${
                            pickupLoadingId === booking._id ? 'bg-gray-400 cursor-not-allowed' : 'bg-indigo-600'
                          }`}
                        >
                          {pickupLoadingId === booking._id ? 'Starting...' : 'Confirm Pickup'}
                        </button>
                      )}

                      {isConfirmedBookingStatus(booking.bookingStatus) &&
                        booking.tripStatus !== 'completed' &&
                        rentalStage !== 'Scheduled' && (
                        <>
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
                            onClick={() => completeBooking(booking._id)}
                            className="bg-primary text-white px-4 py-2 rounded-lg text-sm font-medium"
                          >
                            Return Car
                          </button>
                        </>
                      )}

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
