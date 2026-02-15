import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const AdminBookings = () => {
  const currency = import.meta.env.VITE_CURRENCY;
  const notify = useNotify();
  const [bookings, setBookings] = useState([]);
  const [counterPriceById, setCounterPriceById] = useState({});
  const [completionPaymentMethodById, setCompletionPaymentMethodById] = useState({});
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
    const active = bookings.filter(
      (booking) => booking.bookingStatus === 'CONFIRMED' && booking.tripStatus !== 'completed'
    ).length;
    const completed = bookings.filter((booking) => booking.tripStatus === 'completed').length;
    const pendingSettlement = bookings.filter((booking) => booking.paymentStatus !== 'FULLY_PAID').length;
    const pendingAmount = bookings.reduce((sum, booking) => {
      const total = Number(booking.totalAmount || 0);
      const advance = Number(booking.advanceAmount || 0);
      return sum + Math.max(total - advance, 0);
    }, 0);
    return { active, completed, pendingSettlement, pendingAmount };
  }, [bookings]);

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
    <div className="px-4 pt-10 md:px-10 pb-10 w-full">
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
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Completed Trips</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.completed}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Settlement Pending</p>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{stats.pendingSettlement}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Remaining Collection</p>
          <p className="mt-2 text-2xl font-semibold text-primary">
            {currency}
            {stats.pendingAmount}
          </p>
        </div>
      </div>

      <div className="mt-6 space-y-4 max-w-6xl">
        {bookings.length === 0 && (
          <div className="rounded-xl border border-borderColor bg-white p-8 text-center text-gray-500">
            No rentals found.
          </div>
        )}

        {bookings.map((booking) => {
          const remainingAmount = Math.max(
            Number(booking.totalAmount || 0) - Number(booking.advanceAmount || 0),
            0
          );
          const userName = `${booking.user?.firstName || ''} ${booking.user?.lastName || ''}`.trim();

          return (
            <div key={booking._id} className="rounded-2xl border border-borderColor bg-white p-4 md:p-5 shadow-sm">
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
                      {booking.fromDate?.split('T')[0]} to {booking.toDate?.split('T')[0]}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      <span className="px-2 py-1 rounded-full bg-blue-50 text-blue-700">
                        {booking.bookingStatus || 'UNKNOWN'}
                      </span>
                      <span className="px-2 py-1 rounded-full bg-violet-50 text-violet-700">
                        {booking.tripStatus || 'upcoming'}
                      </span>
                      <span
                        className={`px-2 py-1 rounded-full ${
                          booking.paymentStatus === 'FULLY_PAID'
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-amber-100 text-amber-700'
                        }`}
                      >
                        {booking.paymentStatus || 'PENDING'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-light p-3">
                    <p className="text-xs text-gray-500">Total</p>
                    <p className="font-semibold text-gray-800">
                      {currency}
                      {booking.totalAmount}
                    </p>
                  </div>
                  <div className="rounded-lg bg-light p-3">
                    <p className="text-xs text-gray-500">Advance</p>
                    <p className="font-semibold text-gray-800">
                      {currency}
                      {booking.advanceAmount || 0}
                    </p>
                    <p className="text-[11px] text-gray-500">{booking.paymentMethod || 'NONE'}</p>
                  </div>
                  <div className="rounded-lg bg-light p-3">
                    <p className="text-xs text-gray-500">Remaining</p>
                    <p className="font-semibold text-gray-800">
                      {currency}
                      {remainingAmount}
                    </p>
                  </div>
                  <div className="rounded-lg bg-light p-3">
                    <p className="text-xs text-gray-500">Negotiation</p>
                    <p className="font-semibold text-gray-800">{booking.bargain?.status || 'NONE'}</p>
                  </div>
                </div>

                <div className="flex flex-col items-stretch gap-2 min-w-45">
                  {booking.bookingStatus === 'CONFIRMED' && booking.tripStatus !== 'completed' && (
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
  );
};

export default AdminBookings;
