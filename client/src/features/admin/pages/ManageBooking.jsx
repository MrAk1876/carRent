import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';

const ManageBooking = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const [bookings, setBookings] = useState([]);
  const [loadingId, setLoadingId] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');

  const toSafeNumber = (value) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  };

  const getPriceSummary = (request) => {
    const days = Math.max(toSafeNumber(request.days), 1);
    const pricePerDay = toSafeNumber(request.car?.pricePerDay);
    const totalAmount = toSafeNumber(request.totalAmount);
    const originalAmount = pricePerDay > 0 ? pricePerDay * days : totalAmount;

    const bargainStatus = request.bargain?.status;
    const negotiatedUserPrice = toSafeNumber(request.bargain?.userPrice);
    const isFinalizedNegotiation = ['LOCKED', 'ACCEPTED'].includes(bargainStatus);

    const finalPrice = isFinalizedNegotiation && negotiatedUserPrice > 0 ? negotiatedUserPrice : totalAmount;
    const advanceAmount = Number(request.advanceAmount || Math.round(finalPrice * 0.3));

    return {
      totalAmount: Math.round(originalAmount),
      finalPrice: Math.round(finalPrice),
      advanceAmount,
    };
  };

  const stats = useMemo(() => {
    const total = bookings.length;
    const paidAdvance = bookings.filter((request) => request.paymentStatus === 'PAID').length;
    const pendingAdvance = Math.max(total - paidAdvance, 0);
    const expectedRevenue = bookings.reduce((sum, request) => sum + Number(request.totalAmount || 0), 0);
    return { total, paidAdvance, pendingAdvance, expectedRevenue };
  }, [bookings]);

  const handleStatusChange = async (id, newStatus) => {
    try {
      setLoadingId(id);
      setErrorMsg('');

      const selectedRequest = bookings.find((item) => item._id === id);
      if (
        newStatus === 'approved' &&
        selectedRequest &&
        String(selectedRequest.paymentStatus || 'UNPAID') !== 'PAID'
      ) {
        setErrorMsg('Advance payment is not completed yet for this request.');
        setLoadingId(null);
        return;
      }

      if (newStatus === 'approved') {
        await API.put(`/admin/requests/approve/${id}`);
      } else if (newStatus === 'rejected') {
        await API.put(`/admin/requests/reject/${id}`);
      }

      setBookings((prev) => prev.filter((item) => item._id !== id));
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to update booking status'));
    } finally {
      setLoadingId(null);
    }
  };

  const fetchOwnerBookings = async () => {
    try {
      const res = await API.get('/admin/requests');
      setBookings(Array.isArray(res.data) ? res.data : []);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load bookings'));
    }
  };

  useEffect(() => {
    fetchOwnerBookings();
    const interval = setInterval(fetchOwnerBookings, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Manage Bookings"
        subTitle="Review request pricing, payment readiness, and approve bookings only after advance payment."
      />

      {errorMsg && <p className="mt-4 text-sm text-red-500">{errorMsg}</p>}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-4 max-w-6xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Requests</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Advance Paid</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-600">{stats.paidAdvance}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Advance Pending</p>
          <p className="mt-2 text-2xl font-semibold text-amber-600">{stats.pendingAdvance}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm md:col-span-3 xl:col-span-1">
          <p className="text-xs uppercase tracking-wide text-gray-500">Requested Revenue</p>
          <p className="mt-2 text-2xl font-semibold text-primary">
            {currency}
            {stats.expectedRevenue}
          </p>
        </div>
      </div>

      <div className="admin-section-scroll-shell admin-section-scroll-shell--table mt-6">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll admin-section-scroll--free admin-section-scroll--table">
          <div className="max-w-6xl rounded-2xl border border-borderColor bg-white shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-borderColor flex items-center justify-between">
              <p className="font-medium text-gray-800">Booking Approval Queue</p>
              <p className="text-xs text-gray-500">Auto-refresh every 8 seconds</p>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-245 w-full border-collapse text-left text-sm text-gray-600">
                <thead className="bg-light text-gray-700">
                  <tr>
                    <th className="p-3 font-medium">Car & User</th>
                    <th className="p-3 font-medium">Date Range</th>
                    <th className="p-3 font-medium">Pricing</th>
                    <th className="p-3 font-medium">Payment</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {bookings.length === 0 && (
                    <tr className="border-t border-borderColor">
                      <td colSpan={5} className="p-8 text-center text-gray-500">
                        No pending booking requests.
                      </td>
                    </tr>
                  )}

                  {bookings.map((booking) => {
                    const summary = getPriceSummary(booking);
                    const isAdvancePaid = booking.paymentStatus === 'PAID';
                    const name = `${booking.user?.firstName || ''} ${booking.user?.lastName || ''}`.trim();
                    const negotiationStatus = booking.bargain?.status || 'NONE';

                    return (
                      <tr key={booking._id} className="border-t border-borderColor align-top">
                        <td className="p-3">
                          <div className="flex items-start gap-3">
                            <img
                              src={booking.car?.image}
                              alt="car"
                              className="w-16 h-12 object-cover rounded-md border border-borderColor"
                            />
                            <div>
                              <p className="font-semibold text-gray-800">
                                {booking.car?.brand} {booking.car?.model}
                              </p>
                              <p className="text-xs text-gray-500 mt-1">{name || 'Unknown User'}</p>
                              <p className="text-xs text-gray-500">{booking.user?.email || 'N/A'}</p>
                            </div>
                          </div>
                        </td>

                        <td className="p-3 text-gray-700">
                          <p>
                            {booking.fromDate?.split('T')[0]} to {booking.toDate?.split('T')[0]}
                          </p>
                          <p className="text-xs text-gray-500 mt-1">
                            {Math.max(Number(booking.days || 0), 1)} day(s)
                          </p>
                        </td>

                        <td className="p-3">
                          <p className="text-xs text-gray-500">
                            Total Amount:{' '}
                            <span className="font-medium text-gray-700">
                              {currency}
                              {summary.totalAmount}
                            </span>
                          </p>
                          <p className="text-xs text-gray-500">
                            Final Price:{' '}
                            <span className="font-medium text-gray-700">
                              {currency}
                              {summary.finalPrice}
                            </span>
                          </p>
                          <p className="text-xs text-gray-500">
                            Advance (30%):{' '}
                            <span className="font-medium text-gray-700">
                              {currency}
                              {summary.advanceAmount}
                            </span>
                          </p>
                          <p className="text-xs text-gray-500">
                            Negotiation: <span className="font-medium text-gray-700">{negotiationStatus}</span>
                          </p>
                        </td>

                        <td className="p-3">
                          <div className="space-y-1">
                            <span
                              className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                                isAdvancePaid ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                              }`}
                            >
                              {isAdvancePaid ? 'Advance Paid' : 'Advance Pending'}
                            </span>
                            <p className="text-xs text-gray-500">Method: {booking.paymentMethod || 'NONE'}</p>
                            {booking.advancePaidAt ? (
                              <p className="text-xs text-gray-500">
                                Paid: {booking.advancePaidAt.split('T')[0]}
                              </p>
                            ) : null}
                          </div>
                        </td>

                        <td className="p-3">
                          {booking.status === 'pending' ? (
                            <>
                              <select
                                disabled={loadingId === booking._id}
                                value={booking.status}
                                onChange={(e) => handleStatusChange(booking._id, e.target.value)}
                                className={`px-3 py-2 rounded-lg text-xs border border-borderColor ${
                                  loadingId === booking._id ? 'bg-gray-100 cursor-not-allowed' : 'bg-white'
                                }`}
                              >
                                <option value="pending">Pending</option>
                                <option value="approved" disabled={!isAdvancePaid}>
                                  {isAdvancePaid ? 'Approve' : 'Approve (Advance Pending)'}
                                </option>
                                <option value="rejected">Reject</option>
                              </select>
                              {loadingId === booking._id && (
                                <p className="text-xs text-primary mt-1">Processing...</p>
                              )}
                            </>
                          ) : (
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium ${
                                booking.status === 'approved'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-red-100 text-red-700'
                              }`}
                            >
                              {booking.status}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <span className="admin-section-blur admin-section-blur--bottom" aria-hidden="true" />
      </div>
    </div>
  );
};

export default ManageBooking;
