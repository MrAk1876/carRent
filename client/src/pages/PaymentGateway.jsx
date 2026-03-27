import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getErrorMessage } from '../api';
import useNotify from '../hooks/useNotify';
import {
  completePaymentSession,
  getPaymentSession,
  sendPaymentOtp,
  verifyPaymentOtp,
} from '../services/paymentGatewayService';

const PAYMENT_METHOD_LABELS = {
  UPI: 'UPI',
  CARD: 'Card',
  NETBANKING: 'Net Banking',
  WALLET: 'Wallet',
};

const normalizeMobileNumber = (value) => String(value || '').replace(/\D/g, '').slice(-10);
const maskMobileNumber = (value) => {
  const digits = normalizeMobileNumber(value);
  if (!digits) return '';
  return `${'*'.repeat(Math.max(digits.length - 4, 0))}${digits.slice(-4)}`;
};

const PaymentGateway = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [otp, setOtp] = useState('');
  const [selectedMethod, setSelectedMethod] = useState('UPI');
  const [otpDestination, setOtpDestination] = useState('');
  const [busyAction, setBusyAction] = useState('');
  const savedUserPhone = useMemo(() => {
    try {
      const raw = localStorage.getItem('user');
      const parsed = raw ? JSON.parse(raw) : null;
      return normalizeMobileNumber(parsed?.phone || '');
    } catch {
      return '';
    }
  }, []);

  const loadSession = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await getPaymentSession(token);
      setSession(response.session || null);
      const existingMobileNumber = normalizeMobileNumber(response.session?.mobileNumber || '');
      const status = String(response.session?.status || '').toUpperCase();
      setMobileNumber(existingMobileNumber || savedUserPhone || '');
      setOtpDestination(
        existingMobileNumber && ['OTP_SENT', 'OTP_VERIFIED', 'SUCCESS'].includes(status)
          ? maskMobileNumber(existingMobileNumber)
          : '',
      );
      if (response.session?.paymentMethod && response.session.paymentMethod !== 'NONE') {
        setSelectedMethod(response.session.paymentMethod);
      }
    } catch (apiError) {
      setError(getErrorMessage(apiError, 'Failed to load payment gateway'));
    } finally {
      setLoading(false);
    }
  }, [savedUserPhone, token]);

  useEffect(() => {
    if (!token) return;
    loadSession();
  }, [loadSession, token]);

  const statusTone = useMemo(() => {
    const normalized = String(session?.status || '').toUpperCase();
    if (normalized === 'SUCCESS') return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    if (normalized === 'OTP_VERIFIED') return 'bg-blue-100 text-blue-700 border-blue-200';
    if (normalized === 'OTP_SENT') return 'bg-amber-100 text-amber-700 border-amber-200';
    if (normalized === 'EXPIRED' || normalized === 'FAILED') return 'bg-red-100 text-red-700 border-red-200';
    return 'bg-slate-100 text-slate-700 border-slate-200';
  }, [session?.status]);

  const handleSendOtp = async () => {
    try {
      setBusyAction('send-otp');
      const response = await sendPaymentOtp(token, mobileNumber);
      setSession(response.session || null);
      setOtpDestination(response.maskedMobileNumber || maskMobileNumber(mobileNumber));
      setOtp('');
      if (response.otp) {
        setOtp(String(response.otp));
      }
      notify.success('OTP sent to your mobile number');
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Failed to send OTP'));
    } finally {
      setBusyAction('');
    }
  };

  const handleVerifyOtp = async () => {
    try {
      setBusyAction('verify-otp');
      const response = await verifyPaymentOtp(token, otp);
      setSession(response.session || null);
      notify.success('OTP verified');
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Failed to verify OTP'));
    } finally {
      setBusyAction('');
    }
  };

  const handlePay = async () => {
    try {
      setBusyAction('pay');
      const response = await completePaymentSession(token, selectedMethod);
      notify.success('Payment simulated successfully');
      navigate(response.redirectUrl || `/payment-success/${token}`);
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Payment failed'));
    } finally {
      setBusyAction('');
    }
  };

  if (loading) {
    return (
      <div className="mx-auto mt-20 flex min-h-[45vh] w-full max-w-5xl items-center justify-center px-4">
        <div className="rounded-2xl border border-borderColor bg-white px-6 py-5 text-sm text-gray-500 shadow-sm">
          Loading payment gateway...
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="mx-auto mt-20 w-full max-w-3xl px-4">
        <div className="rounded-3xl border border-red-200 bg-white p-8 shadow-sm">
          <p className="text-lg font-semibold text-slate-900">Payment gateway unavailable</p>
          <p className="mt-2 text-sm text-red-600">{error || 'Payment session could not be loaded.'}</p>
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

  return (
    <div className="mx-auto mt-12 w-full max-w-6xl px-4 pb-10 md:px-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="rounded-[28px] border border-borderColor bg-white shadow-[0_24px_60px_rgba(15,23,42,0.08)]">
          <div className="rounded-t-[28px] bg-gradient-to-r from-primary to-primary/80 px-6 py-7 text-white">
            <p className="text-xs uppercase tracking-[0.24em] text-white/75">Simulated Gateway</p>
            <h1 className="mt-2 text-3xl font-semibold">{session.merchantName}</h1>
            <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-white/70">Order ID</p>
                <p className="mt-1 text-base font-medium">{session.orderId}</p>
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-[0.22em] text-white/70">Amount</p>
                <p className="mt-1 text-3xl font-semibold">
                  {currency}
                  {Number(session.amount || 0).toFixed(2)}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-6 px-6 py-6">
            <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${statusTone}`}>
              Status: {session.status}
            </div>

            <section className="rounded-2xl border border-borderColor bg-slate-50/80 p-4">
              <p className="text-sm font-semibold text-slate-900">Step 1. Verify mobile number</p>
              <p className="mt-1 text-sm text-slate-500">
                Enter the number that should receive the OTP. The code expires in 2 minutes and is sent by SMS.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  type="tel"
                  value={mobileNumber}
                  onChange={(event) => setMobileNumber(normalizeMobileNumber(event.target.value))}
                  placeholder="Enter mobile number"
                  className="h-12 flex-1 rounded-xl border border-borderColor bg-white px-4 text-sm outline-none transition focus:border-primary"
                />
                <button
                  type="button"
                  onClick={handleSendOtp}
                  disabled={busyAction === 'send-otp' || session.status === 'SUCCESS' || session.status === 'EXPIRED'}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyAction === 'send-otp' ? 'Sending OTP...' : 'Send OTP'}
                </button>
              </div>
              {otpDestination ? (
                <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                  OTP sent to mobile ending in <span className="font-semibold">{otpDestination}</span>.
                </div>
              ) : null}
            </section>

            <section className="rounded-2xl border border-borderColor bg-slate-50/80 p-4">
              <p className="text-sm font-semibold text-slate-900">Step 2. Verify OTP</p>
              <p className="mt-1 text-sm text-slate-500">
                You get {session.attemptsRemaining} attempts before the current OTP must be resent.
              </p>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit OTP"
                  className="h-12 flex-1 rounded-xl border border-borderColor bg-white px-4 text-sm outline-none transition focus:border-primary"
                />
                <button
                  type="button"
                  onClick={handleVerifyOtp}
                  disabled={busyAction === 'verify-otp' || !session.otpExpiresAt || session.otpVerified}
                  className="inline-flex h-12 items-center justify-center rounded-xl bg-slate-900 px-5 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {busyAction === 'verify-otp' ? 'Verifying...' : session.otpVerified ? 'Verified' : 'Verify OTP'}
                </button>
              </div>
            </section>

            <section className="rounded-2xl border border-borderColor bg-slate-50/80 p-4">
              <p className="text-sm font-semibold text-slate-900">Step 3. Choose payment method</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {session.paymentMethods.map((method) => {
                  const active = selectedMethod === method;
                  return (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setSelectedMethod(method)}
                      disabled={!session.otpVerified}
                      className={`rounded-2xl border px-4 py-4 text-left transition ${
                        active
                          ? 'border-primary bg-primary/10 text-primary shadow-sm'
                          : 'border-borderColor bg-white text-slate-700'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <p className="text-sm font-semibold">{PAYMENT_METHOD_LABELS[method]}</p>
                      <p className="mt-1 text-xs text-slate-500">{PAYMENT_METHOD_LABELS[method]} payment</p>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handlePay}
                disabled={!session.otpVerified || busyAction === 'pay' || session.status === 'SUCCESS'}
                className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-xl bg-emerald-600 px-5 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                {busyAction === 'pay' ? 'Processing payment...' : 'Pay'}
              </button>
            </section>
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[28px] border border-borderColor bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Payment details</p>
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
                <dt>Amount</dt>
                <dd className="font-medium text-slate-900">
                  {currency}
                  {Number(session.amount || 0).toFixed(2)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Session expires</dt>
                <dd className="font-medium text-slate-900">
                  {session.expiresAt ? new Date(session.expiresAt).toLocaleString() : 'N/A'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-[28px] border border-borderColor bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-900">Need to leave?</p>
            <p className="mt-2 text-sm text-slate-500">
              The session stays active until it expires. You can come back and finish the simulated payment before then.
            </p>
            {session.status === 'SUCCESS' ? (
              <button
                type="button"
                onClick={() => navigate(`/payment-success/${token}`)}
                className="mt-4 inline-flex rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white"
              >
                View success page
              </button>
            ) : (
              <Link
                to="/my-bookings"
                className="mt-4 inline-flex rounded-xl border border-borderColor px-4 py-2 text-sm font-medium text-slate-700"
              >
                Back to My Bookings
              </Link>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
};

export default PaymentGateway;
