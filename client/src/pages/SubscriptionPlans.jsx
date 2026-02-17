import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getErrorMessage } from '../api';
import Title from '../components/Title';
import useNotify from '../hooks/useNotify';
import { isAdmin, isLoggedIn } from '../utils/auth';
import {
  getMySubscription,
  getSubscriptionPlans,
  purchaseSubscription,
} from '../services/subscriptionService';

const PAYMENT_METHODS = ['CARD', 'UPI', 'NETBANKING', 'CASH'];

const toDateLabel = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleDateString();
};

const SubscriptionPlans = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const navigate = useNavigate();
  const notify = useNotify();

  const [loading, setLoading] = useState(true);
  const [subscribingPlanId, setSubscribingPlanId] = useState('');
  const [plans, setPlans] = useState([]);
  const [activeSubscription, setActiveSubscription] = useState(null);
  const [paymentMethod, setPaymentMethod] = useState('CARD');
  const [autoRenew, setAutoRenew] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const loggedIn = isLoggedIn();
  const staffUser = isAdmin();

  const loadData = async () => {
    try {
      setLoading(true);
      setErrorMsg('');

      const [plansResult, mySubscriptionResult] = await Promise.allSettled([
        getSubscriptionPlans(),
        loggedIn && !staffUser ? getMySubscription({}) : Promise.resolve(null),
      ]);

      if (plansResult.status === 'fulfilled') {
        setPlans(Array.isArray(plansResult.value) ? plansResult.value : []);
      } else {
        setPlans([]);
        setErrorMsg(getErrorMessage(plansResult.reason, 'Failed to load subscription plans'));
      }

      if (mySubscriptionResult.status === 'fulfilled' && mySubscriptionResult.value) {
        setActiveSubscription(mySubscriptionResult.value.activeSubscription || null);
      } else {
        setActiveSubscription(null);
      }
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load subscription plans'));
      setPlans([]);
      setActiveSubscription(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const planCards = useMemo(
    () =>
      (Array.isArray(plans) ? plans : []).map((plan) => ({
        ...plan,
        durationLabel: `${Number(plan.durationInDays || 0)} days`,
        includedHoursLabel: `${Number(plan.includedRentalHours || 0)} hours`,
      })),
    [plans],
  );

  const canSubscribe = loggedIn && !staffUser && !activeSubscription;

  const handleSubscribe = async (planId) => {
    if (!loggedIn) {
      notify.error('Please log in to purchase a subscription');
      navigate('/');
      return;
    }
    if (staffUser) {
      notify.error('Staff accounts cannot purchase subscriptions');
      return;
    }
    if (activeSubscription) {
      notify.error('You already have an active subscription');
      navigate('/my-subscription');
      return;
    }

    try {
      setSubscribingPlanId(planId);
      await purchaseSubscription({
        planId,
        autoRenew,
        paymentMethod,
      });
      notify.success('Subscription activated successfully');
      navigate('/my-subscription');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to activate subscription'));
    } finally {
      setSubscribingPlanId('');
    }
  };

  return (
    <div className="px-4 sm:px-8 md:px-14 lg:px-20 xl:px-28 mt-16 mb-14">
      <Title
        title="Subscription Plans"
        subTitle="Choose a plan to unlock rental-hour coverage with late and damage discounts."
        align="left"
      />

      <div className="mt-5 rounded-2xl border border-borderColor bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <label className="text-sm text-gray-600">
            Payment Method
            <select
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value)}
              className="ml-2 border border-borderColor rounded-lg px-2 py-1 text-sm"
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-gray-600 inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={autoRenew}
              onChange={(event) => setAutoRenew(event.target.checked)}
              className="rounded border-borderColor"
            />
            Auto Renew
          </label>

          {activeSubscription ? (
            <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              Active plan until {toDateLabel(activeSubscription?.endDate)} ({Number(activeSubscription?.remainingRentalHours || 0)} hours left)
            </p>
          ) : null}
        </div>
      </div>

      {errorMsg ? <p className="text-sm text-red-600 mt-4">{errorMsg}</p> : null}
      {staffUser ? (
        <p className="text-sm text-blue-700 mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          Staff accounts can review plans but cannot subscribe.
        </p>
      ) : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {loading ? (
          <p className="text-sm text-gray-500">Loading plans...</p>
        ) : null}

        {!loading && planCards.length === 0 ? (
          <p className="text-sm text-gray-500">No active subscription plans available right now.</p>
        ) : null}

        {planCards.map((plan) => (
          <article key={plan._id} className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm space-y-4">
            <div>
              <h3 className="text-lg font-semibold text-gray-800">{plan.planName}</h3>
              <p className="text-sm text-gray-500 mt-1">{plan.description || 'Flexible subscription plan.'}</p>
            </div>

            <div className="space-y-1 text-sm text-gray-600">
              <p>Duration: <span className="font-medium">{plan.durationLabel}</span></p>
              <p>Included Hours: <span className="font-medium">{plan.includedHoursLabel}</span></p>
              <p>Late Fee Discount: <span className="font-medium">{Number(plan.lateFeeDiscountPercentage || 0)}%</span></p>
              <p>Damage Discount: <span className="font-medium">{Number(plan.damageFeeDiscountPercentage || 0)}%</span></p>
            </div>

            <div className="rounded-xl bg-slate-50 border border-borderColor px-3 py-2">
              <p className="text-xs text-gray-500">Plan Price</p>
              <p className="text-2xl font-semibold text-primary">
                {currency}{Number(plan.price || 0)}
              </p>
            </div>

            <button
              type="button"
              disabled={!canSubscribe || subscribingPlanId === plan._id}
              onClick={() => handleSubscribe(plan._id)}
              className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium text-white ${
                !canSubscribe || subscribingPlanId === plan._id
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-primary hover:bg-primary-dull'
              }`}
            >
              {subscribingPlanId === plan._id
                ? 'Activating...'
                : activeSubscription
                ? 'Already Subscribed'
                : loggedIn
                ? 'Subscribe Now'
                : 'Login To Subscribe'}
            </button>
          </article>
        ))}
      </div>
    </div>
  );
};

export default SubscriptionPlans;
