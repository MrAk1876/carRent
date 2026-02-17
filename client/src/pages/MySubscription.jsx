import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../api';
import Title from '../components/Title';
import useNotify from '../hooks/useNotify';
import {
  downloadSubscriptionInvoicePdf,
  getMySubscription,
  renewSubscription,
} from '../services/subscriptionService';

const PAYMENT_METHODS = ['CARD', 'UPI', 'NETBANKING', 'CASH'];

const toDateTime = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
};

const toHours = (value) => Math.max(Number(value || 0), 0);

const MySubscription = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const notify = useNotify();

  const [loading, setLoading] = useState(true);
  const [renewing, setRenewing] = useState(false);
  const [downloadingId, setDownloadingId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('CARD');
  const [autoRenew, setAutoRenew] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [activeSubscription, setActiveSubscription] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);

  const loadSubscriptionData = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      const payload = await getMySubscription({});
      setActiveSubscription(payload?.activeSubscription || null);
      setSubscriptions(Array.isArray(payload?.subscriptions) ? payload.subscriptions : []);
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load subscription details'));
      setActiveSubscription(null);
      setSubscriptions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscriptionData();
  }, [loadSubscriptionData]);

  const usageRows = useMemo(() => {
    if (!activeSubscription?.usageHistory || !Array.isArray(activeSubscription.usageHistory)) {
      return [];
    }
    return [...activeSubscription.usageHistory]
      .sort((left, right) => new Date(right?.usedAt || 0).getTime() - new Date(left?.usedAt || 0).getTime())
      .slice(0, 30);
  }, [activeSubscription]);

  const handleRenew = async () => {
    try {
      setRenewing(true);
      await renewSubscription({
        autoRenew,
        paymentMethod,
      });
      notify.success('Subscription renewed successfully');
      await loadSubscriptionData();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to renew subscription'));
    } finally {
      setRenewing(false);
    }
  };

  const handleDownloadInvoice = async (subscriptionId) => {
    try {
      setDownloadingId(subscriptionId);
      await downloadSubscriptionInvoicePdf(subscriptionId);
      notify.success('Subscription invoice downloaded');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to download invoice'));
    } finally {
      setDownloadingId('');
    }
  };

  const latestSubscription = subscriptions[0] || null;

  return (
    <div className="px-4 sm:px-8 md:px-14 lg:px-20 xl:px-28 mt-16 mb-14 space-y-6">
      <Title
        title="My Subscription"
        subTitle="Track remaining hours, renewal details, and subscription usage history."
        align="left"
      />

      {errorMsg ? <p className="text-sm text-red-600">{errorMsg}</p> : null}

      <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
        {loading ? <p className="text-sm text-gray-500">Loading subscription details...</p> : null}

        {!loading && !activeSubscription ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">No active subscription found.</p>
            {latestSubscription ? (
              <div className="rounded-xl border border-borderColor bg-slate-50 p-3 text-sm space-y-1">
                <p>Last Plan: <span className="font-medium">{latestSubscription?.planId?.planName || latestSubscription?.planSnapshot?.planName || 'N/A'}</span></p>
                <p>Status: <span className="font-medium">{latestSubscription?.subscriptionStatus || 'N/A'}</span></p>
                <p>Ended: <span className="font-medium">{toDateTime(latestSubscription?.endDate)}</span></p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-3">
              <select
                value={paymentMethod}
                onChange={(event) => setPaymentMethod(event.target.value)}
                className="border border-borderColor rounded-lg px-3 py-2 text-sm"
              >
                {PAYMENT_METHODS.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>

              <label className="inline-flex items-center gap-2 text-sm text-gray-600">
                <input
                  type="checkbox"
                  checked={autoRenew}
                  onChange={(event) => setAutoRenew(event.target.checked)}
                />
                Auto Renew
              </label>

              <button
                type="button"
                disabled={renewing || !latestSubscription}
                onClick={handleRenew}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
                  renewing || !latestSubscription
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-primary hover:bg-primary-dull'
                }`}
              >
                {renewing ? 'Renewing...' : 'Renew Subscription'}
              </button>
            </div>
          </div>
        ) : null}

        {!loading && activeSubscription ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 text-sm">
              <div className="rounded-xl border border-borderColor bg-light p-3">
                <p className="text-xs text-gray-500">Plan</p>
                <p className="font-semibold text-gray-800">
                  {activeSubscription?.planId?.planName || activeSubscription?.planSnapshot?.planName || 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-borderColor bg-light p-3">
                <p className="text-xs text-gray-500">Remaining Hours</p>
                <p className="font-semibold text-primary">{toHours(activeSubscription?.remainingRentalHours)}</p>
              </div>
              <div className="rounded-xl border border-borderColor bg-light p-3">
                <p className="text-xs text-gray-500">Total Used</p>
                <p className="font-semibold text-gray-800">{toHours(activeSubscription?.totalUsedHours)}</p>
              </div>
              <div className="rounded-xl border border-borderColor bg-light p-3">
                <p className="text-xs text-gray-500">Amount Paid</p>
                <p className="font-semibold text-gray-800">{currency}{Number(activeSubscription?.amountPaid || 0)}</p>
              </div>
            </div>

            <div className="rounded-xl border border-borderColor bg-slate-50 p-3 text-sm space-y-1">
              <p>
                Status: <span className="font-medium">{activeSubscription?.subscriptionStatus || 'N/A'}</span>
              </p>
              <p>
                Start: <span className="font-medium">{toDateTime(activeSubscription?.startDate)}</span>
              </p>
              <p>
                End: <span className="font-medium">{toDateTime(activeSubscription?.endDate)}</span>
              </p>
              <p>
                Auto Renew: <span className="font-medium">{activeSubscription?.autoRenew ? 'Enabled' : 'Disabled'}</span>
              </p>
            </div>

            {activeSubscription?.invoiceNumber ? (
              <button
                type="button"
                disabled={downloadingId === activeSubscription._id}
                onClick={() => handleDownloadInvoice(activeSubscription._id)}
                className={`rounded-lg px-4 py-2 text-sm font-medium border ${
                  downloadingId === activeSubscription._id
                    ? 'bg-gray-100 text-gray-500 border-gray-300 cursor-not-allowed'
                    : 'bg-white text-gray-700 border-borderColor hover:bg-slate-50'
                }`}
              >
                {downloadingId === activeSubscription._id ? 'Downloading...' : 'Download Active Subscription Invoice'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {activeSubscription ? (
        <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-gray-800">Usage History</h3>
          <p className="text-sm text-gray-500">Rental hours consumed by bookings under your active subscription.</p>

          <div className="mt-3 overflow-x-auto rounded-xl border border-borderColor">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-slate-100">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                  <th className="px-3 py-3">Used At</th>
                  <th className="px-3 py-3">Booking</th>
                  <th className="px-3 py-3">Hours Used</th>
                  <th className="px-3 py-3">Amount Covered</th>
                  <th className="px-3 py-3">Amount Charged</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.length ? (
                  usageRows.map((entry, index) => (
                    <tr key={`${entry?.bookingId || 'entry'}-${index}`} className="border-t border-borderColor">
                      <td className="px-3 py-3 text-gray-700">{toDateTime(entry?.usedAt)}</td>
                      <td className="px-3 py-3 text-gray-700">{entry?.bookingId || 'N/A'}</td>
                      <td className="px-3 py-3 text-gray-700">{toHours(entry?.hoursUsed)}</td>
                      <td className="px-3 py-3 text-emerald-700">{currency}{Number(entry?.amountCovered || 0)}</td>
                      <td className="px-3 py-3 text-gray-700">{currency}{Number(entry?.amountCharged || 0)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-3 py-8 text-center text-sm text-gray-500">
                      No usage history recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-800">Subscription History</h3>
        <div className="mt-3 overflow-x-auto rounded-xl border border-borderColor">
          <table className="w-full min-w-[840px] text-sm">
            <thead className="bg-slate-100">
              <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                <th className="px-3 py-3">Plan</th>
                <th className="px-3 py-3">Status</th>
                <th className="px-3 py-3">Start</th>
                <th className="px-3 py-3">End</th>
                <th className="px-3 py-3">Paid</th>
                <th className="px-3 py-3">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {subscriptions.length ? (
                subscriptions.map((subscription) => (
                  <tr key={subscription._id} className="border-t border-borderColor">
                    <td className="px-3 py-3 text-gray-700">
                      {subscription?.planId?.planName || subscription?.planSnapshot?.planName || 'N/A'}
                    </td>
                    <td className="px-3 py-3 text-gray-700">{subscription?.subscriptionStatus || 'N/A'}</td>
                    <td className="px-3 py-3 text-gray-700">{toDateTime(subscription?.startDate)}</td>
                    <td className="px-3 py-3 text-gray-700">{toDateTime(subscription?.endDate)}</td>
                    <td className="px-3 py-3 text-gray-700">{currency}{Number(subscription?.amountPaid || 0)}</td>
                    <td className="px-3 py-3">
                      {subscription?.invoiceNumber ? (
                        <button
                          type="button"
                          disabled={downloadingId === subscription._id}
                          onClick={() => handleDownloadInvoice(subscription._id)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                            downloadingId === subscription._id
                              ? 'bg-gray-100 text-gray-500 border-gray-300 cursor-not-allowed'
                              : 'bg-white text-gray-700 border-borderColor hover:bg-slate-50'
                          }`}
                        >
                          {downloadingId === subscription._id ? 'Downloading...' : 'Download'}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">N/A</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">
                    No subscription history found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default MySubscription;
