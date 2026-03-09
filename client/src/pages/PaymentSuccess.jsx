import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getErrorMessage } from '../api';
import { getPaymentSession } from '../services/paymentGatewayService';

const PaymentSuccess = () => {
  const { token = '' } = useParams();
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadSession = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await getPaymentSession(token);
      setSession(response.session || null);
    } catch (apiError) {
      setError(getErrorMessage(apiError, 'Failed to load payment result'));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    loadSession();
  }, [loadSession, token]);

  if (loading) {
    return (
      <div className="mx-auto mt-20 flex min-h-[40vh] w-full max-w-4xl items-center justify-center px-4">
        <div className="rounded-2xl border border-borderColor bg-white px-6 py-5 text-sm text-gray-500 shadow-sm">
          Loading payment status...
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="mx-auto mt-20 w-full max-w-3xl px-4">
        <div className="rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Payment result unavailable</p>
          <p className="mt-2 text-sm text-red-600">{error || 'The payment session could not be loaded.'}</p>
          <Link
            to="/my-bookings"
            className="mt-5 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white"
          >
            Back to My Bookings
          </Link>
        </div>
      </div>
    );
  }

  const paymentSuccessful = session.status === 'SUCCESS';

  return (
    <div className="mx-auto mt-14 w-full max-w-4xl px-4 pb-10 md:px-8">
      <div className="overflow-hidden rounded-[30px] border border-borderColor bg-white shadow-[0_22px_60px_rgba(15,23,42,0.08)]">
        <div className={`px-8 py-8 ${paymentSuccessful ? 'bg-emerald-600 text-white' : 'bg-amber-500 text-slate-950'}`}>
          <p className="text-xs uppercase tracking-[0.24em] opacity-80">Payment Result</p>
          <h1 className="mt-3 text-3xl font-semibold">
            {paymentSuccessful ? 'Payment successful' : `Session status: ${session.status}`}
          </h1>
          <p className="mt-2 text-sm opacity-90">
            {paymentSuccessful
              ? 'Your simulated payment was recorded and the booking is now confirmed.'
              : 'This session has not completed successfully yet.'}
          </p>
        </div>

        <div className="grid gap-6 px-8 py-8 md:grid-cols-2">
          <div className="rounded-2xl border border-borderColor bg-slate-50 p-5">
            <p className="text-sm font-semibold text-slate-900">Transaction summary</p>
            <dl className="mt-4 space-y-3 text-sm text-slate-600">
              <div className="flex items-center justify-between gap-3">
                <dt>Merchant</dt>
                <dd className="font-medium text-slate-900">{session.merchantName}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Order ID</dt>
                <dd className="font-medium text-slate-900">{session.orderId}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Transaction ID</dt>
                <dd className="font-medium text-slate-900">{session.transactionId || 'Pending'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Paid Amount</dt>
                <dd className="font-medium text-slate-900">
                  {currency}
                  {Number(session.amount || 0).toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Payment Method</dt>
                <dd className="font-medium text-slate-900">{session.paymentMethod || 'N/A'}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-borderColor bg-slate-50 p-5">
            <p className="text-sm font-semibold text-slate-900">What happened</p>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li className="rounded-xl bg-white px-4 py-3">A temporary payment session was created for your booking request.</li>
              <li className="rounded-xl bg-white px-4 py-3">OTP was verified inside the simulated gateway.</li>
              <li className="rounded-xl bg-white px-4 py-3">
                {paymentSuccessful
                  ? 'The backend confirmed payment and converted the request into a confirmed booking.'
                  : 'The request has not been converted into a confirmed booking yet.'}
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-wrap gap-3 border-t border-borderColor px-8 py-6">
          {!paymentSuccessful ? (
            <Link
              to={`/gateway/${token}`}
              className="inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              Return to Gateway
            </Link>
          ) : null}
          <Link
            to="/my-bookings"
            className="inline-flex rounded-xl border border-borderColor px-4 py-2 text-sm font-medium text-slate-700"
          >
            Back to My Bookings
          </Link>
        </div>
      </div>
    </div>
  );
};

export default PaymentSuccess;
