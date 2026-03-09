import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const normalizeText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const ManageStates = () => {
  const notify = useNotify();
  const [states, setStates] = useState([]);
  const [createName, setCreateName] = useState('');
  const [draftById, setDraftById] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadStates = async () => {
    try {
      setLoading(true);
      const response = await API.get('/admin/states', { showErrorToast: false });
      const nextStates = Array.isArray(response?.data?.states) ? response.data.states : [];
      setStates(nextStates);
      setDraftById(
        nextStates.reduce((acc, state) => {
          acc[state._id] = {
            name: state.name || '',
            isActive: Boolean(state.isActive),
          };
          return acc;
        }, {}),
      );
      setErrorMsg('');
    } catch (error) {
      setStates([]);
      setDraftById({});
      setErrorMsg(getErrorMessage(error, 'Failed to load states'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStates();
  }, []);

  const stats = useMemo(() => {
    const total = states.length;
    const active = states.filter((state) => state.isActive).length;
    return {
      total,
      active,
      inactive: Math.max(total - active, 0),
    };
  }, [states]);

  const updateDraft = (stateId, patch) => {
    setDraftById((previous) => ({
      ...previous,
      [stateId]: {
        ...(previous[stateId] || {}),
        ...patch,
      },
    }));
  };

  const handleCreate = async () => {
    const stateName = normalizeText(createName);
    if (!stateName) {
      notify.error('State name is required');
      return;
    }

    try {
      setActionKey('create');
      await API.post('/admin/states', { name: stateName }, { showErrorToast: false });
      setCreateName('');
      await loadStates();
      notify.success('State created successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to create state'));
    } finally {
      setActionKey('');
    }
  };

  const handleSave = async (stateId) => {
    const draft = draftById[stateId];
    if (!draft) return;

    const nextName = normalizeText(draft.name);
    if (!nextName) {
      notify.error('State name is required');
      return;
    }

    try {
      setActionKey(`save:${stateId}`);
      await API.put(
        `/admin/states/${stateId}`,
        {
          name: nextName,
          isActive: Boolean(draft.isActive),
        },
        { showErrorToast: false },
      );
      await loadStates();
      notify.success('State updated successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update state'));
    } finally {
      setActionKey('');
    }
  };

  const handleDelete = async (stateId, stateName) => {
    const confirmed = window.confirm(`Delete state "${stateName}"?`);
    if (!confirmed) return;

    try {
      setActionKey(`delete:${stateId}`);
      await API.delete(`/admin/states/${stateId}`, { showErrorToast: false });
      await loadStates();
      notify.success('State deleted successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete state'));
    } finally {
      setActionKey('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Title
            title="Manage States"
            subTitle="Create and maintain the top-level location hierarchy used by branches, cities, and customer city-based inventory filtering."
          />
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div className="rounded-2xl border border-borderColor bg-white px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Active</p>
            <p className="mt-1 text-2xl font-semibold text-emerald-800">{stats.active}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs uppercase tracking-wide text-slate-500">Inactive</p>
            <p className="mt-1 text-2xl font-semibold text-slate-800">{stats.inactive}</p>
          </div>
        </div>
      </div>

      <div className="rounded-3xl border border-borderColor bg-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <input
            type="text"
            value={createName}
            onChange={(event) => setCreateName(event.target.value)}
            placeholder="Add a new state"
            className="w-full rounded-2xl border border-borderColor bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-primary focus:bg-white"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={actionKey === 'create'}
            className="rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-white transition hover:bg-primary-dull disabled:cursor-not-allowed disabled:opacity-70"
          >
            {actionKey === 'create' ? 'Adding...' : 'Add State'}
          </button>
        </div>
      </div>

      {errorMsg ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{errorMsg}</div>
      ) : null}

      <div className="rounded-3xl border border-borderColor bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr className="text-left text-slate-500">
                <th className="px-5 py-4 font-medium">State</th>
                <th className="px-5 py-4 font-medium">Status</th>
                <th className="px-5 py-4 font-medium">Updated</th>
                <th className="px-5 py-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                    Loading states...
                  </td>
                </tr>
              ) : null}

              {!loading && states.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-8 text-center text-slate-500">
                    No states created yet.
                  </td>
                </tr>
              ) : null}

              {!loading &&
                states.map((state) => {
                  const draft = draftById[state._id] || { name: state.name, isActive: state.isActive };
                  return (
                    <tr key={state._id} className="border-t border-borderColor/80">
                      <td className="px-5 py-4">
                        <input
                          type="text"
                          value={draft.name}
                          onChange={(event) => updateDraft(state._id, { name: event.target.value })}
                          className="w-full rounded-xl border border-borderColor bg-white px-3 py-2 outline-none transition focus:border-primary"
                        />
                      </td>
                      <td className="px-5 py-4">
                        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            checked={Boolean(draft.isActive)}
                            onChange={(event) => updateDraft(state._id, { isActive: event.target.checked })}
                            className="h-4 w-4 accent-primary"
                          />
                          {draft.isActive ? 'Active' : 'Inactive'}
                        </label>
                      </td>
                      <td className="px-5 py-4 text-slate-500">
                        {state.updatedAt ? new Date(state.updatedAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSave(state._id)}
                            disabled={actionKey === `save:${state._id}`}
                            className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 font-medium text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionKey === `save:${state._id}` ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(state._id, state.name)}
                            disabled={actionKey === `delete:${state._id}`}
                            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionKey === `delete:${state._id}` ? 'Deleting...' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ManageStates;
