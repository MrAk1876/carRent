import React, { useEffect, useState } from 'react';
import { assets } from '../../../assets/assets';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import {
  getNormalizedStatusKey,
  isConfirmedBookingStatus,
  isFullyPaidStatus,
  isPendingPaymentBookingStatus,
  resolveFinalAmount,
} from '../../../utils/payment';

const Dashboard = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';

  const [data, setData] = useState({
    totalCars: 0,
    totalBookings: 0,
    confirmedBookings: 0,
    pendingBookings: 0,
    completedBookings: 0,
    recentBookings: [],
    monthlyRevenue: 0,
    totalRevenue: 0,
    revenueTrend: [],
  });
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const maxRevenueBar = Math.max(...data.revenueTrend.map((item) => item.amount), 1);

  const dashboardCards = [
    { title: 'Total Cars', value: data.totalCars, icon: assets.carIconColored, tone: 'bg-blue-50' },
    { title: 'Total Bookings', value: data.totalBookings, icon: assets.listIconColored, tone: 'bg-violet-50' },
    { title: 'Pending', value: data.pendingBookings, icon: assets.cautionIconColored, tone: 'bg-amber-50' },
    { title: 'Completed', value: data.completedBookings, icon: assets.check_icon, tone: 'bg-emerald-50' },
  ];

  const statusClass = (status) => {
    const normalized = getNormalizedStatusKey(status);
    if (normalized === 'CONFIRMED') return 'bg-green-100 text-green-700 border-green-200';
    if (normalized === 'PENDING' || normalized === 'PENDINGPAYMENT') return 'bg-yellow-100 text-yellow-700 border-yellow-200';
    if (normalized === 'COMPLETED') return 'bg-blue-100 text-blue-700 border-blue-200';
    if (normalized === 'REJECTED' || normalized === 'CANCELLEDBYUSER' || normalized === 'CANCELLED') {
      return 'bg-red-100 text-red-700 border-red-200';
    }
    return 'bg-gray-100 text-gray-700 border-gray-200';
  };

  useEffect(() => {
    const loadDashboard = async () => {
      try {
        setLoading(true);
        setErrorMsg('');
        const [bookingsRes, carsRes] = await Promise.all([
          API.get('/admin/bookings'),
          API.get('/admin/cars'),
        ]);

        const bookings = Array.isArray(bookingsRes.data) ? bookingsRes.data : [];
        const cars = Array.isArray(carsRes.data) ? carsRes.data : [];
        const sortedBookings = [...bookings].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        const pending = bookings.filter((b) => isPendingPaymentBookingStatus(b.bookingStatus));
        const confirmed = bookings.filter((b) => isConfirmedBookingStatus(b.bookingStatus));
        const completed = bookings.filter((b) => b.tripStatus === 'completed');
        const fullyPaidBookings = bookings.filter((b) => isFullyPaidStatus(b.paymentStatus));

        const now = new Date();
        const revenue = fullyPaidBookings
          .filter((b) => {
            const receivedAt = b.fullPaymentReceivedAt ? new Date(b.fullPaymentReceivedAt) : new Date(b.updatedAt);
            return receivedAt.getMonth() === now.getMonth() && receivedAt.getFullYear() === now.getFullYear();
          })
          .reduce((sum, b) => sum + resolveFinalAmount(b), 0);

        const totalRevenue = fullyPaidBookings.reduce((sum, b) => sum + resolveFinalAmount(b), 0);

        const revenueTrend = [];
        for (let offset = 5; offset >= 0; offset -= 1) {
          const monthDate = new Date(now.getFullYear(), now.getMonth() - offset, 1);
          const month = monthDate.getMonth();
          const year = monthDate.getFullYear();

          const amount = fullyPaidBookings
            .filter((booking) => {
              const receivedAt = booking.fullPaymentReceivedAt
                ? new Date(booking.fullPaymentReceivedAt)
                : new Date(booking.updatedAt);
              return receivedAt.getMonth() === month && receivedAt.getFullYear() === year;
            })
            .reduce((sum, booking) => sum + resolveFinalAmount(booking), 0);

          revenueTrend.push({
            label: monthDate.toLocaleString('default', { month: 'short' }),
            amount,
          });
        }

        const recentBookings = sortedBookings.slice(0, 5);

        setData({
          totalCars: cars.length,
          totalBookings: bookings.length,
          confirmedBookings: confirmed.length,
          pendingBookings: pending.length,
          completedBookings: completed.length,
          recentBookings,
          monthlyRevenue: revenue,
          totalRevenue,
          revenueTrend,
        });
      } catch (error) {
        setErrorMsg(getErrorMessage(error, 'Failed to load dashboard data'));
      } finally {
        setLoading(false);
      }
    };

    loadDashboard();
  }, []);

  return (
    <div className="admin-section-page px-3.5 pt-6 md:px-10 md:pt-10 pb-8 md:pb-10">
      <Title title="Dashboard" subTitle="Monitor overall platform performance including total cars, bookings, revenue and more." />
      {errorMsg && <p className="mt-4 text-sm text-red-500">{errorMsg}</p>}

      <div className="admin-section-scroll-shell mt-4 md:mt-6">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll admin-section-scroll--proximity">
          <div className="rounded-2xl border border-borderColor bg-linear-to-r from-primary/5 via-white to-primary/10 p-5 md:p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Overview</p>
                <h2 className="text-xl md:text-2xl font-semibold mt-1">Admin Control Center</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Quick summary of rentals, requests, and performance for this month.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 rounded-full text-xs bg-white border border-borderColor">
                  Cars: {data.totalCars}
                </span>
                <span className="px-3 py-1 rounded-full text-xs bg-white border border-borderColor">
                  Bookings: {data.totalBookings}
                </span>
                <span className="px-3 py-1 rounded-full text-xs bg-white border border-borderColor">
                  Total Revenue: {currency}
                  {data.totalRevenue}
                </span>
              </div>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4 my-4 md:my-6">
            {dashboardCards.map((card) => (
              <div key={card.title} className="rounded-xl border border-borderColor p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-gray-500">{card.title}</p>
                    <p className="font-semibold text-2xl mt-1">{loading ? '...' : card.value}</p>
                  </div>
                  <div className={`flex items-center justify-center w-11 h-11 rounded-full ${card.tone}`}>
                    <img src={card.icon} alt="icon" className="w-5 h-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-6 pb-1">
            <div className="p-4 md:p-6 border border-borderColor rounded-xl bg-white shadow-sm">
              <h1 className="text-lg font-semibold">Recent Bookings</h1>
              <p className="text-gray-500 text-sm">Latest customer bookings across the platform</p>

              <div className="mt-4 space-y-3">
                {loading && <p className="text-sm text-gray-500">Loading recent bookings...</p>}

                {!loading && data.recentBookings.length === 0 && (
                  <p className="text-sm text-gray-500">No booking activity yet.</p>
                )}

                {!loading &&
                  data.recentBookings.map((booking) => (
                    <div
                      key={booking._id}
                      className="flex flex-col gap-3 rounded-lg border border-borderColor px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {booking.car?.image ? (
                          <img
                            src={booking.car.image}
                            alt="car"
                            className="w-11 h-11 rounded-md object-cover border border-borderColor"
                          />
                        ) : (
                          <div className="w-11 h-11 rounded-md bg-primary/10 flex items-center justify-center">
                            <img src={assets.listIconColored} alt="list" className="h-5 w-5" />
                          </div>
                        )}

                        <div className="min-w-0">
                          <p className="font-medium truncate">
                            {booking.car?.brand || 'Car'} {booking.car?.model || ''}
                          </p>
                          <p className="text-xs text-gray-500">{booking.createdAt?.split('T')[0]}</p>
                        </div>
                      </div>

                      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end sm:gap-2.5">
                          <p className="text-sm font-medium whitespace-nowrap">
                          {currency}
                          {resolveFinalAmount(booking)}
                        </p>
                        <p
                          className={`px-2.5 py-0.5 border rounded-full text-[11px] sm:text-xs whitespace-nowrap ${statusClass(
                            booking.bookingStatus
                          )}`}
                        >
                          {booking.bookingStatus}
                        </p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="p-4 md:p-6 border border-borderColor rounded-xl bg-white shadow-sm">
              <h1 className="text-lg font-semibold">Monthly Revenue</h1>
              <p className="text-gray-500 text-sm">Full payments received from returned cars this month</p>

              <p className="text-3xl mt-4 font-semibold text-primary">
                {currency}
                {loading ? '...' : ` ${data.monthlyRevenue}`}
              </p>

              <div className="mt-5 space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Confirmed bookings</span>
                  <span className="font-medium">{data.confirmedBookings}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Pending approvals</span>
                  <span className="font-medium">{data.pendingBookings}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Completed trips</span>
                  <span className="font-medium">{data.completedBookings}</span>
                </div>
              </div>

              <div className="mt-6">
                <p className="text-xs uppercase tracking-wide text-gray-500">Revenue Trend (Last 6 Months)</p>
                <div className="mt-3 grid grid-cols-6 gap-2 h-28 items-end">
                  {data.revenueTrend.map((point) => {
                    const heightPct = point.amount > 0 ? Math.max((point.amount / maxRevenueBar) * 100, 10) : 8;

                    return (
                      <div key={point.label} className="flex flex-col items-center gap-1">
                        <div className="w-full h-20 flex items-end">
                          <div
                            className="w-full rounded-sm bg-primary/80"
                            style={{ height: `${heightPct}%` }}
                            title={`${currency}${point.amount}`}
                          />
                        </div>
                        <span className="text-[10px] text-gray-500">{point.label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
        <span className="admin-section-blur admin-section-blur--bottom" aria-hidden="true" />
      </div>
    </div>
  );
};

export default Dashboard;
