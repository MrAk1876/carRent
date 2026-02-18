import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../api';
import useNotify from '../../../hooks/useNotify';
import Title from '../components/Title';
import {
  createAdminSubscriptionPlan,
  downloadSubscriptionInvoicePdf,
  getAdminSubscriptionOverview,
  updateAdminSubscriptionPlan,
} from '../../../services/subscriptionService';
import { hasPermission } from '../../../utils/auth';
import { PERMISSIONS } from '../../../utils/rbac';

const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
const PAGE_SIZE = 15;

const STATUS_FILTERS = ['all', 'Active', 'Expired', 'Cancelled'];
const DURATION_TYPES = ['Monthly', 'Quarterly', 'Yearly'];

const toSafeNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatDate = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
};

const createEmptyPlanDraft = () => ({
  planName: '',
  description: '',
  durationType: 'Monthly',
  durationInDays: '30',
  price: '',
  includedRentalHours: '',
  lateFeeDiscountPercentage: '0',
  damageFeeDiscountPercentage: '0',
  branchId: '',
  isActive: true,
});

const ManageSubscriptions = () => {
  const notify = useNotify();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState({});
  const [topPlans, setTopPlans] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [plans, setPlans] = useState([]);
  const [branchOptions, setBranchOptions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 1 });
  const [canManagePlans, setCanManagePlans] = useState(false);

  const [editingPlanId, setEditingPlanId] = useState('');
  const [planDraft, setPlanDraft] = useState(createEmptyPlanDraft);
  const [invoiceLoadingId, setInvoiceLoadingId] = useState('');

  const hasPlanPermission = hasPermission(PERMISSIONS.MANAGE_ROLES);
  const isPlanEditable = canManagePlans && hasPlanPermission;

  const loadOverview = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await getAdminSubscriptionOverview({
        branchId: selectedBranchId || undefined,
        status: statusFilter,
        page,
        pageSize: PAGE_SIZE,
      });

      setSummary(payload.summary || {});
      setTopPlans(Array.isArray(payload.topPlans) ? payload.topPlans : []);
      setSubscriptions(Array.isArray(payload.subscriptions) ? payload.subscriptions : []);
      setPlans(Array.isArray(payload.plans) ? payload.plans : []);
      setBranchOptions(Array.isArray(payload.branchOptions) ? payload.branchOptions : []);
      setCanManagePlans(Boolean(payload.canManagePlans));
      setPagination(payload.pagination || { page: 1, pageSize: PAGE_SIZE, totalItems: 0, totalPages: 1 });
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load subscription admin panel'));
    } finally {
      setLoading(false);
    }
  }, [page, selectedBranchId, statusFilter]);

  useEffect(() => {
    loadOverview();
  }, [loadOverview]);

  const resetPlanDraft = () => {
    setEditingPlanId('');
    setPlanDraft(createEmptyPlanDraft());
  };

  const startPlanEdit = (plan) => {
    if (!plan?._id) return;
    setEditingPlanId(String(plan._id));
    setPlanDraft({
      planName: String(plan.planName || ''),
      description: String(plan.description || ''),
      durationType: String(plan.durationType || 'Monthly'),
      durationInDays: String(toSafeNumber(plan.durationInDays || 30)),
      price: String(toSafeNumber(plan.price || 0)),
      includedRentalHours: String(toSafeNumber(plan.includedRentalHours || 0)),
      lateFeeDiscountPercentage: String(toSafeNumber(plan.lateFeeDiscountPercentage || 0)),
      damageFeeDiscountPercentage: String(toSafeNumber(plan.damageFeeDiscountPercentage || 0)),
      branchId: String(plan?.branchId?._id || plan?.branchId || ''),
      isActive: Boolean(plan.isActive),
    });
  };

  const savePlan = async () => {
    if (!isPlanEditable) {
      notify.error('You do not have permission to manage plans');
      return;
    }

    const payload = {
      planName: String(planDraft.planName || '').trim(),
      description: String(planDraft.description || '').trim(),
      durationType: String(planDraft.durationType || 'Monthly'),
      durationInDays: toSafeNumber(planDraft.durationInDays),
      price: toSafeNumber(planDraft.price),
      includedRentalHours: toSafeNumber(planDraft.includedRentalHours),
      lateFeeDiscountPercentage: toSafeNumber(planDraft.lateFeeDiscountPercentage),
      damageFeeDiscountPercentage: toSafeNumber(planDraft.damageFeeDiscountPercentage),
      branchId: String(planDraft.branchId || '').trim() || null,
      isActive: Boolean(planDraft.isActive),
    };

    if (!payload.planName) {
      notify.error('Plan name is required');
      return;
    }
    if (payload.durationInDays <= 0 || payload.price < 0 || payload.includedRentalHours < 0) {
      notify.error('Duration, price, and included hours must be valid values');
      return;
    }

    try {
      setSubmitting(true);
      if (editingPlanId) {
        await updateAdminSubscriptionPlan(editingPlanId, payload);
        notify.success('Subscription plan updated');
      } else {
        await createAdminSubscriptionPlan(payload);
        notify.success('Subscription plan created');
      }
      resetPlanDraft();
      await loadOverview();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to save subscription plan'));
    } finally {
      setSubmitting(false);
    }
  };

  const togglePlanActive = async (plan) => {
    if (!isPlanEditable || !plan?._id) return;
    try {
      setSubmitting(true);
      await updateAdminSubscriptionPlan(plan._id, { isActive: !Boolean(plan.isActive) });
      notify.success(Boolean(plan.isActive) ? 'Plan deactivated' : 'Plan activated');
      await loadOverview();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update plan status'));
    } finally {
      setSubmitting(false);
    }
  };

  const downloadInvoice = async (subscriptionId) => {
    if (!subscriptionId) return;
    try {
      setInvoiceLoadingId(subscriptionId);
      await downloadSubscriptionInvoicePdf(subscriptionId);
      notify.success('Subscription invoice downloaded');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to download invoice'));
    } finally {
      setInvoiceLoadingId('');
    }
  };

  const incomeCards = useMemo(() => ([
    {
      title: 'Total Subscriptions',
      value: Number(summary?.totalSubscriptions || 0),
      tone: 'bg-white border-borderColor text-slate-800',
    },
    {
      title: 'Active Subscriptions',
      value: Number(summary?.activeSubscriptions || 0),
      tone: 'bg-blue-50 border-blue-200 text-blue-700',
    },
    {
      title: 'Subscription Revenue',
      value: `${currency}${Number(summary?.totalRevenue || 0).toLocaleString('en-IN')}`,
      tone: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    },
    {
      title: 'Revenue This Month',
      value: `${currency}${Number(summary?.monthlyRevenue || 0).toLocaleString('en-IN')}`,
      tone: 'bg-violet-50 border-violet-200 text-violet-700',
    },
    {
      title: 'Avg Ticket Size',
      value: `${currency}${Number(summary?.avgRevenuePerSubscription || 0).toLocaleString('en-IN')}`,
      tone: 'bg-amber-50 border-amber-200 text-amber-700',
    },
  ]), [summary]);

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Manage Subscriptions"
        subTitle="Create subscription plans, track who purchased them, and monitor subscription income."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 max-w-6xl">
        {incomeCards.map((card) => (
          <div key={card.title} className={`rounded-xl border p-4 shadow-sm ${card.tone}`}>
            <p className="text-xs uppercase tracking-wide">{card.title}</p>
            <p className="mt-2 text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-800">
            {editingPlanId ? 'Edit Subscription Plan' : 'Create Subscription Plan'}
          </p>
          {!isPlanEditable ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
              Read-only access
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Plan name"
            value={planDraft.planName}
            onChange={(event) => setPlanDraft((prev) => ({ ...prev, planName: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!isPlanEditable}
          />
          <select
            value={planDraft.durationType}
            onChange={(event) => setPlanDraft((prev) => ({ ...prev, durationType: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!isPlanEditable}
          >
            {DURATION_TYPES.map((type) => (
              <option value={type} key={type}>{type}</option>
            ))}
          </select>
          <input
            type="number"
            min="1"
            placeholder="Duration (days)"
            value={planDraft.durationInDays}
            onChange={(event) => setPlanDraft((prev) => ({ ...prev, durationInDays: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!isPlanEditable}
          />
          <select
            value={planDraft.branchId}
            onChange={(event) => setPlanDraft((prev) => ({ ...prev, branchId: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!isPlanEditable}
          >
            <option value="">All Branches</option>
            {branchOptions.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.branchName}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            placeholder="Price"
            value={planDraft.price}
            onChange={(event) => setPlanDraft((prev) => ({ ...prev, price: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!isPlanEditable}
          />
          <input
            type="number"
            min="0"
            placeholder="Included hours"
            value={planDraft.includedRentalHours}
            onChange={(event) => setPlanDraft((prev) => ({ ...prev, includedRentalHours: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!isPlanEditable}
          />
          <input
            type="number"
            min="0"
            max="100"
            placeholder="Late fee discount %"
            value={planDraft.lateFeeDiscountPercentage}
            onChange={(event) =>
              setPlanDraft((prev) => ({ ...prev, lateFeeDiscountPercentage: event.target.value }))
            }
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!isPlanEditable}
          />
          <input
            type="number"
            min="0"
            max="100"
            placeholder="Damage discount %"
            value={planDraft.damageFeeDiscountPercentage}
            onChange={(event) =>
              setPlanDraft((prev) => ({ ...prev, damageFeeDiscountPercentage: event.target.value }))
            }
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!isPlanEditable}
          />
        </div>
        <textarea
          rows={2}
          placeholder="Plan description"
          value={planDraft.description}
          onChange={(event) => setPlanDraft((prev) => ({ ...prev, description: event.target.value }))}
          className="mt-3 w-full rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          disabled={!isPlanEditable}
        />
        <label className="mt-3 inline-flex items-center gap-2 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={Boolean(planDraft.isActive)}
            onChange={(event) => setPlanDraft((prev) => ({ ...prev, isActive: event.target.checked }))}
            disabled={!isPlanEditable}
          />
          Plan Active
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={savePlan}
            disabled={!isPlanEditable || submitting}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              !isPlanEditable || submitting ? 'bg-slate-400 cursor-not-allowed' : 'bg-primary'
            }`}
          >
            {submitting ? 'Saving...' : editingPlanId ? 'Update Plan' : 'Create Plan'}
          </button>
          {editingPlanId ? (
            <button
              type="button"
              onClick={resetPlanDraft}
              className="rounded-lg border border-borderColor bg-white px-4 py-2 text-sm font-medium text-gray-700"
            >
              Cancel Edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-borderColor">
          <p className="font-medium text-gray-800">Subscription Plans</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-left text-sm text-gray-700">
            <thead className="bg-light text-gray-700">
              <tr>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Duration</th>
                <th className="px-3 py-2 font-medium">Pricing</th>
                <th className="px-3 py-2 font-medium">Discounts</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {plans.length === 0 ? (
                <tr className="border-t border-borderColor">
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-500">No plans found.</td>
                </tr>
              ) : null}
              {plans.map((plan) => (
                <tr key={plan._id} className="border-t border-borderColor">
                  <td className="px-3 py-3">
                    <p className="font-medium">{plan.planName}</p>
                    <p className="text-xs text-gray-500">{plan.description || 'No description'}</p>
                  </td>
                  <td className="px-3 py-3">{plan?.branchId?.branchName || 'All Branches'}</td>
                  <td className="px-3 py-3">{plan.durationInDays} days ({plan.durationType})</td>
                  <td className="px-3 py-3">
                    <p>{currency}{Number(plan.price || 0).toLocaleString('en-IN')}</p>
                    <p className="text-xs text-gray-500">{plan.includedRentalHours} hours</p>
                  </td>
                  <td className="px-3 py-3">
                    <p className="text-xs">Late: {Number(plan.lateFeeDiscountPercentage || 0)}%</p>
                    <p className="text-xs">Damage: {Number(plan.damageFeeDiscountPercentage || 0)}%</p>
                  </td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      plan.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-700'
                    }`}>
                      {plan.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => startPlanEdit(plan)}
                        className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
                        disabled={!isPlanEditable}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => togglePlanActive(plan)}
                        className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700"
                        disabled={!isPlanEditable || submitting}
                      >
                        {plan.isActive ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 max-w-6xl flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="text-xs text-gray-500">Track buyers and subscription income by branch and status.</div>
        <div className="flex flex-wrap gap-2">
          <select
            value={selectedBranchId}
            onChange={(event) => {
              setSelectedBranchId(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          >
            <option value="">All Branches</option>
            {branchOptions.map((branch) => (
              <option key={branch._id} value={branch._id}>{branch.branchName}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          >
            {STATUS_FILTERS.map((item) => (
              <option key={item} value={item}>{item === 'all' ? 'All Statuses' : item}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadOverview}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-slate-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="mt-4 max-w-6xl rounded-2xl border border-borderColor bg-white shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-borderColor flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-gray-800">Purchased Subscriptions</p>
          <p className="text-xs text-gray-500">
            Page {pagination.page} of {pagination.totalPages} ({pagination.totalItems} records)
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1100px] w-full text-left text-sm text-gray-700">
            <thead className="bg-light text-gray-700">
              <tr>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Branch</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Timeline</th>
                <th className="px-3 py-2 font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="border-t border-borderColor">
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-500">Loading subscriptions...</td>
                </tr>
              ) : null}
              {!loading && subscriptions.length === 0 ? (
                <tr className="border-t border-borderColor">
                  <td colSpan={7} className="px-3 py-8 text-center text-gray-500">No subscriptions found.</td>
                </tr>
              ) : null}
              {!loading && subscriptions.map((subscription) => (
                <tr key={subscription._id} className="border-t border-borderColor">
                  <td className="px-3 py-3">
                    <p className="font-medium">
                      {`${subscription?.userId?.firstName || ''} ${subscription?.userId?.lastName || ''}`.trim() || 'N/A'}
                    </p>
                    <p className="text-xs text-gray-500">{subscription?.userId?.email || 'No email'}</p>
                  </td>
                  <td className="px-3 py-3">
                    <p>{subscription?.planId?.planName || subscription?.planSnapshot?.planName || 'N/A'}</p>
                    <p className="text-xs text-gray-500">
                      {Number(subscription?.remainingRentalHours || 0)}h remaining
                    </p>
                  </td>
                  <td className="px-3 py-3">{subscription?.branchId?.branchName || 'All Branches'}</td>
                  <td className="px-3 py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
                      subscription?.subscriptionStatus === 'Active'
                        ? 'bg-emerald-100 text-emerald-700'
                        : subscription?.subscriptionStatus === 'Expired'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-slate-200 text-slate-700'
                    }`}>
                      {subscription?.subscriptionStatus || 'N/A'}
                    </span>
                    <p className="text-xs text-gray-500 mt-1">Payment: {subscription?.paymentStatus || 'N/A'}</p>
                  </td>
                  <td className="px-3 py-3 font-medium">{currency}{Number(subscription?.amountPaid || 0).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-3">
                    <p className="text-xs text-gray-600">Start: {formatDate(subscription?.startDate)}</p>
                    <p className="text-xs text-gray-600">End: {formatDate(subscription?.endDate)}</p>
                  </td>
                  <td className="px-3 py-3">
                    {subscription?.invoiceNumber ? (
                      <button
                        type="button"
                        onClick={() => downloadInvoice(subscription._id)}
                        className="rounded-lg border border-borderColor bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-slate-50"
                        disabled={invoiceLoadingId === subscription._id}
                      >
                        {invoiceLoadingId === subscription._id ? 'Downloading...' : 'Download'}
                      </button>
                    ) : (
                      <span className="text-xs text-gray-500">Not generated</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-borderColor px-4 py-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setPage((previous) => Math.max(previous - 1, 1))}
            disabled={page <= 1}
            className="rounded-lg border border-borderColor bg-white px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((previous) => Math.min(previous + 1, pagination.totalPages || 1))}
            disabled={page >= (pagination.totalPages || 1)}
            className="rounded-lg border border-borderColor bg-white px-3 py-1.5 text-xs font-medium text-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Next
          </button>
        </div>
      </div>

      <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-800">Top Revenue Plans</p>
        {topPlans.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">No revenue data available yet.</p>
        ) : (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            {topPlans.map((item) => (
              <div key={`${item.planId}-${item.planName}`} className="rounded-lg border border-borderColor bg-light p-3">
                <p className="text-sm font-medium text-gray-800">{item.planName}</p>
                <p className="text-xs text-gray-500 mt-1">Purchases: {Number(item.purchases || 0)}</p>
                <p className="text-sm font-semibold text-emerald-700 mt-2">
                  {currency}{Number(item.revenue || 0).toLocaleString('en-IN')}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ManageSubscriptions;
