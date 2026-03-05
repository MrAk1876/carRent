import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getErrorMessage } from '../../../api';
import useNotify from '../../../hooks/useNotify';
import Title from '../components/Title';
import {
  createAdminDepositRule,
  deleteAdminDepositRule,
  getAdminDepositRules,
  updateAdminDepositRule,
} from '../../../services/depositRuleService';
import { hasPermission } from '../../../utils/auth';
import { PERMISSIONS } from '../../../utils/rbac';

const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
const RANGE_OPTIONS = ['LOW_RANGE', 'MEDIUM_RANGE', 'HIGH_RANGE'];

const createEmptyDraft = () => ({
  rangeName: 'LOW_RANGE',
  minPrice: '0',
  maxPrice: '3000',
  depositAmount: '2000',
  isActive: true,
});

const toNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatCurrency = (value) =>
  `${currency}${Math.max(Number(value || 0), 0).toLocaleString('en-IN', {
    maximumFractionDigits: 2,
  })}`;

const DepositRules = () => {
  const notify = useNotify();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [rules, setRules] = useState([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [editingRuleId, setEditingRuleId] = useState('');
  const [ruleDraft, setRuleDraft] = useState(createEmptyDraft);

  const canManageDepositRules = hasPermission(PERMISSIONS.MANAGE_FLEET);

  const loadRules = useCallback(async () => {
    try {
      setLoading(true);
      const data = await getAdminDepositRules();
      const normalized = data
        .map((rule) => ({
          ...rule,
          minPrice: Math.max(toNumber(rule?.minPrice, 0), 0),
          maxPrice: Math.max(toNumber(rule?.maxPrice, 0), 0),
          depositAmount: Math.max(toNumber(rule?.depositAmount, 0), 0),
          isActive: Boolean(rule?.isActive),
        }))
        .sort((left, right) => left.minPrice - right.minPrice);
      setRules(normalized);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load deposit rules'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const resetDraft = () => {
    setEditingRuleId('');
    setRuleDraft(createEmptyDraft());
  };

  const startEdit = (rule) => {
    if (!rule?._id) return;
    setEditingRuleId(String(rule._id));
    setRuleDraft({
      rangeName: String(rule.rangeName || rule.rangeType || 'LOW_RANGE'),
      minPrice: String(rule.minPrice ?? 0),
      maxPrice: String(rule.maxPrice ?? 0),
      depositAmount: String(rule.depositAmount ?? 0),
      isActive: Boolean(rule.isActive),
    });
  };

  const validateDraft = () => {
    const normalizedRangeName = String(ruleDraft.rangeName || '').trim().toUpperCase();
    const minPrice = toNumber(ruleDraft.minPrice, NaN);
    const maxPrice = toNumber(ruleDraft.maxPrice, NaN);
    const depositAmount = toNumber(ruleDraft.depositAmount, NaN);

    if (!RANGE_OPTIONS.includes(normalizedRangeName)) {
      notify.error('Range name must be LOW_RANGE, MEDIUM_RANGE, or HIGH_RANGE');
      return null;
    }
    if (!Number.isFinite(minPrice) || minPrice < 0) {
      notify.error('Min price must be a valid non-negative number');
      return null;
    }
    if (!Number.isFinite(maxPrice) || maxPrice < 0) {
      notify.error('Max price must be a valid non-negative number');
      return null;
    }
    if (maxPrice < minPrice) {
      notify.error('Max price must be greater than or equal to min price');
      return null;
    }
    if (!Number.isFinite(depositAmount) || depositAmount < 0) {
      notify.error('Deposit amount must be a valid non-negative number');
      return null;
    }

    return {
      rangeName: normalizedRangeName,
      minPrice: Number(minPrice.toFixed(2)),
      maxPrice: Number(maxPrice.toFixed(2)),
      depositAmount: Number(depositAmount.toFixed(2)),
      isActive: Boolean(ruleDraft.isActive),
    };
  };

  const saveRule = async () => {
    if (!canManageDepositRules) {
      notify.error('You do not have permission to manage deposit rules');
      return;
    }

    const payload = validateDraft();
    if (!payload) return;

    try {
      setSubmitting(true);
      if (editingRuleId) {
        await updateAdminDepositRule(editingRuleId, payload);
        notify.success('Deposit rule updated');
      } else {
        await createAdminDepositRule(payload);
        notify.success('Deposit rule created');
      }
      resetDraft();
      await loadRules();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to save deposit rule'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRuleStatus = async (rule) => {
    if (!canManageDepositRules || !rule?._id) return;
    try {
      setSubmitting(true);
      await updateAdminDepositRule(rule._id, { isActive: !Boolean(rule.isActive) });
      notify.success(Boolean(rule.isActive) ? 'Rule deactivated' : 'Rule activated');
      await loadRules();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update rule status'));
    } finally {
      setSubmitting(false);
    }
  };

  const removeRule = async (rule) => {
    if (!canManageDepositRules || !rule?._id) return;
    const confirmed = window.confirm(`Delete ${rule.rangeName} deposit rule?`);
    if (!confirmed) return;
    try {
      setSubmitting(true);
      await deleteAdminDepositRule(rule._id);
      notify.success('Deposit rule deleted');
      if (editingRuleId && editingRuleId === String(rule._id)) {
        resetDraft();
      }
      await loadRules();
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete deposit rule'));
    } finally {
      setSubmitting(false);
    }
  };

  const summaryCards = useMemo(() => {
    const totalRules = rules.length;
    const activeRules = rules.filter((rule) => rule.isActive).length;
    const minDeposit = rules.length ? Math.min(...rules.map((rule) => rule.depositAmount)) : 0;
    const maxDeposit = rules.length ? Math.max(...rules.map((rule) => rule.depositAmount)) : 0;

    return [
      {
        title: 'Total Rules',
        value: totalRules,
        tone: 'bg-white border-borderColor text-slate-800',
      },
      {
        title: 'Active Rules',
        value: activeRules,
        tone: 'bg-emerald-50 border-emerald-200 text-emerald-700',
      },
      {
        title: 'Lowest Deposit',
        value: formatCurrency(minDeposit),
        tone: 'bg-blue-50 border-blue-200 text-blue-700',
      },
      {
        title: 'Highest Deposit',
        value: formatCurrency(maxDeposit),
        tone: 'bg-violet-50 border-violet-200 text-violet-700',
      },
    ];
  }, [rules]);

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Deposit Rules"
        subTitle="Define refundable deposit slabs by car price range. Rules apply automatically when booking is created."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 max-w-6xl">
        {summaryCards.map((card) => (
          <div key={card.title} className={`rounded-xl border p-4 shadow-sm ${card.tone}`}>
            <p className="text-xs uppercase tracking-wide">{card.title}</p>
            <p className="mt-2 text-2xl font-semibold">{card.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-800">
            {editingRuleId ? 'Edit Deposit Rule' : 'Create Deposit Rule'}
          </p>
          {!canManageDepositRules ? (
            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs text-amber-700">
              Read-only access
            </span>
          ) : null}
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
          <select
            value={ruleDraft.rangeName}
            onChange={(event) => setRuleDraft((prev) => ({ ...prev, rangeName: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!canManageDepositRules}
          >
            {RANGE_OPTIONS.map((option) => (
              <option value={option} key={option}>{option}</option>
            ))}
          </select>

          <input
            type="number"
            min="0"
            placeholder="Min price"
            value={ruleDraft.minPrice}
            onChange={(event) => setRuleDraft((prev) => ({ ...prev, minPrice: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!canManageDepositRules}
          />

          <input
            type="number"
            min="0"
            placeholder="Max price"
            value={ruleDraft.maxPrice}
            onChange={(event) => setRuleDraft((prev) => ({ ...prev, maxPrice: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!canManageDepositRules}
          />

          <input
            type="number"
            min="0"
            placeholder="Deposit amount"
            value={ruleDraft.depositAmount}
            onChange={(event) => setRuleDraft((prev) => ({ ...prev, depositAmount: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            disabled={!canManageDepositRules}
          />

          <label className="inline-flex items-center gap-2 rounded-lg border border-borderColor px-3 py-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={ruleDraft.isActive}
              onChange={(event) => setRuleDraft((prev) => ({ ...prev, isActive: event.target.checked }))}
              disabled={!canManageDepositRules}
            />
            Active
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={saveRule}
            disabled={!canManageDepositRules || submitting}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Saving...' : editingRuleId ? 'Update Rule' : 'Create Rule'}
          </button>
          {editingRuleId ? (
            <button
              type="button"
              onClick={resetDraft}
              disabled={submitting}
              className="rounded-lg border border-borderColor px-4 py-2 text-sm font-semibold text-gray-700"
            >
              Cancel Edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-gray-800">Configured Deposit Rules</p>
          {loading ? <p className="text-xs text-gray-500">Loading...</p> : null}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-y border-borderColor bg-slate-50 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-3 py-2">Range</th>
                <th className="px-3 py-2">Price Window</th>
                <th className="px-3 py-2">Deposit</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-center text-gray-500">
                    No deposit rules configured yet.
                  </td>
                </tr>
              ) : (
                rules.map((rule) => (
                  <tr key={rule._id} className="border-b border-borderColor/80">
                    <td className="px-3 py-3 font-semibold text-gray-800">{rule.rangeName}</td>
                    <td className="px-3 py-3 text-gray-700">
                      {formatCurrency(rule.minPrice)} - {formatCurrency(rule.maxPrice)}
                    </td>
                    <td className="px-3 py-3 text-gray-700">{formatCurrency(rule.depositAmount)}</td>
                    <td className="px-3 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${rule.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                        {rule.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(rule)}
                          className="rounded-md border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleRuleStatus(rule)}
                          disabled={!canManageDepositRules || submitting}
                          className="rounded-md border border-amber-200 px-3 py-1 text-xs font-semibold text-amber-700 disabled:opacity-60"
                        >
                          {rule.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeRule(rule)}
                          disabled={!canManageDepositRules || submitting}
                          className="rounded-md border border-rose-200 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-60"
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DepositRules;
