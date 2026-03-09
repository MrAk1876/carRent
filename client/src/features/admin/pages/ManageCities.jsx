import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const normalizeText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const toStateId = (state) => {
  if (!state) return '';
  if (typeof state === 'string') return state;
  return String(state?._id || '');
};

const toStateName = (state) => {
  if (!state) return '';
  if (typeof state === 'string') return '';
  return String(state?.name || '').trim();
};

const emptyForm = {
  name: '',
  stateId: '',
};

const ManageCities = () => {
  const notify = useNotify();
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [filterStateId, setFilterStateId] = useState('');
  const [createForm, setCreateForm] = useState(emptyForm);
  const [draftById, setDraftById] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadStates = async () => {
    const response = await API.get('/admin/states', { showErrorToast: false });
    return Array.isArray(response?.data?.states) ? response.data.states : [];
  };

  const loadCities = async (stateId = '') => {
    const response = await API.get('/admin/cities', {
      params: stateId ? { stateId } : {},
      showErrorToast: false,
    });
    return Array.isArray(response?.data?.cities) ? response.data.cities : [];
  };

  const loadData = async (stateId = filterStateId) => {
    try {
      setLoading(true);
      const [nextStates, nextCities] = await Promise.all([loadStates(), loadCities(stateId)]);
      setStates(nextStates);
      setCities(nextCities);
      setDraftById(
        nextCities.reduce((acc, city) => {
          acc[city._id] = {
            name: city.name || '',
            stateId: toStateId(city.stateId),
            isActive: Boolean(city.isActive),
          };
          return acc;
        }, {}),
      );
      setErrorMsg('');
    } catch (error) {
      setStates([]);
      setCities([]);
      setDraftById({});
      setErrorMsg(getErrorMessage(error, 'Failed to load cities'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData('');
  }, []);

  useEffect(() => {
    setCreateForm((previous) => {
      if (previous.stateId || states.length === 0) return previous;
      return {
        ...previous,
        stateId: String(states[0]?._id || ''),
      };
    });
  }, [states]);

  const stats = useMemo(() => {
    const total = cities.length;
    const active = cities.filter((city) => city.isActive).length;
    return {
      total,
      active,
      inactive: Math.max(total - active, 0),
    };
  }, [cities]);

  const updateDraft = (cityId, patch) => {
    setDraftById((previous) => ({
      ...previous,
      [cityId]: {
        ...(previous[cityId] || {}),
        ...patch,
      },
    }));
  };

  const handleCreate = async () => {
    const payload = {
      name: normalizeText(createForm.name),
      stateId: String(createForm.stateId || '').trim(),
    };

    if (!payload.name || !payload.stateId) {
      notify.error('State and city name are required');
      return;
    }

    try {
      setActionKey('create');
      await API.post('/admin/cities', payload, { showErrorToast: false });
      setCreateForm((previous) => ({ ...previous, name: '' }));
      await loadData(filterStateId);
      notify.success('City created successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to create city'));
    } finally {
      setActionKey('');
    }
  };

  const handleSave = async (cityId) => {
    const draft = draftById[cityId];
    if (!draft) return;

    const payload = {
      name: normalizeText(draft.name),
      stateId: String(draft.stateId || '').trim(),
      isActive: Boolean(draft.isActive),
    };

    if (!payload.name || !payload.stateId) {
      notify.error('State and city name are required');
      return;
    }

    try {
      setActionKey(`save:${cityId}`);
      await API.put(`/admin/cities/${cityId}`, payload, { showErrorToast: false });
      await loadData(filterStateId);
      notify.success('City updated successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update city'));
    } finally {
      setActionKey('');
    }
  };

  const handleDelete = async (cityId, cityName) => {
    const confirmed = window.confirm(`Delete city "${cityName}"?`);
    if (!confirmed) return;

    try {
      setActionKey(`delete:${cityId}`);
      await API.delete(`/admin/cities/${cityId}`, { showErrorToast: false });
      await loadData(filterStateId);
      notify.success('City deleted successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete city'));
    } finally {
      setActionKey('');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <Title
            title="Manage Cities"
            subTitle="Maintain tenant-scoped cities linked to states. Cars and branches use this hierarchy for city-based availability and pickup location filtering."
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

      <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-borderColor bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-700">Add City</p>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto]">
            <select
              value={createForm.stateId}
              onChange={(event) => setCreateForm((previous) => ({ ...previous, stateId: event.target.value }))}
              className="w-full rounded-2xl border border-borderColor bg-white px-4 py-3 text-sm outline-none transition focus:border-primary"
            >
              <option value="">Select state</option>
              {states.map((state) => (
                <option value={state._id} key={state._id}>
                  {state.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={createForm.name}
              onChange={(event) => setCreateForm((previous) => ({ ...previous, name: event.target.value }))}
              placeholder="City name"
              className="w-full rounded-2xl border border-borderColor bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-primary focus:bg-white"
            />
            <button
              type="button"
              onClick={handleCreate}
              disabled={actionKey === 'create'}
              className="rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-white transition hover:bg-primary-dull disabled:cursor-not-allowed disabled:opacity-70"
            >
              {actionKey === 'create' ? 'Adding...' : 'Add City'}
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-borderColor bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-slate-700">Filter</p>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
            <select
              value={filterStateId}
              onChange={async (event) => {
                const nextStateId = event.target.value;
                setFilterStateId(nextStateId);
                await loadData(nextStateId);
              }}
              className="w-full rounded-2xl border border-borderColor bg-white px-4 py-3 text-sm outline-none transition focus:border-primary"
            >
              <option value="">All states</option>
              {states.map((state) => (
                <option value={state._id} key={state._id}>
                  {state.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => {
                setFilterStateId('');
                void loadData('');
              }}
              className="rounded-2xl border border-borderColor px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Reset
            </button>
          </div>
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
                <th className="px-5 py-4 font-medium">City</th>
                <th className="px-5 py-4 font-medium">State</th>
                <th className="px-5 py-4 font-medium">Status</th>
                <th className="px-5 py-4 font-medium">Updated</th>
                <th className="px-5 py-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                    Loading cities...
                  </td>
                </tr>
              ) : null}

              {!loading && cities.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-slate-500">
                    No cities created yet.
                  </td>
                </tr>
              ) : null}

              {!loading &&
                cities.map((city) => {
                  const draft = draftById[city._id] || {
                    name: city.name,
                    stateId: toStateId(city.stateId),
                    isActive: city.isActive,
                  };
                  return (
                    <tr key={city._id} className="border-t border-borderColor/80">
                      <td className="px-5 py-4">
                        <input
                          type="text"
                          value={draft.name}
                          onChange={(event) => updateDraft(city._id, { name: event.target.value })}
                          className="w-full rounded-xl border border-borderColor bg-white px-3 py-2 outline-none transition focus:border-primary"
                        />
                      </td>
                      <td className="px-5 py-4">
                        <select
                          value={draft.stateId}
                          onChange={(event) => updateDraft(city._id, { stateId: event.target.value })}
                          className="w-full rounded-xl border border-borderColor bg-white px-3 py-2 outline-none transition focus:border-primary"
                        >
                          <option value="">Select state</option>
                          {states.map((state) => (
                            <option value={state._id} key={state._id}>
                              {state.name}
                            </option>
                          ))}
                        </select>
                        <p className="mt-1 text-xs text-slate-500">{toStateName(city.stateId)}</p>
                      </td>
                      <td className="px-5 py-4">
                        <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                          <input
                            type="checkbox"
                            checked={Boolean(draft.isActive)}
                            onChange={(event) => updateDraft(city._id, { isActive: event.target.checked })}
                            className="h-4 w-4 accent-primary"
                          />
                          {draft.isActive ? 'Active' : 'Inactive'}
                        </label>
                      </td>
                      <td className="px-5 py-4 text-slate-500">
                        {city.updatedAt ? new Date(city.updatedAt).toLocaleDateString() : 'N/A'}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => handleSave(city._id)}
                            disabled={actionKey === `save:${city._id}`}
                            className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 font-medium text-primary transition hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionKey === `save:${city._id}` ? 'Saving...' : 'Save'}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(city._id, city.name)}
                            disabled={actionKey === `delete:${city._id}`}
                            className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {actionKey === `delete:${city._id}` ? 'Deleting...' : 'Delete'}
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

export default ManageCities;
