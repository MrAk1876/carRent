import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const emptyBranchForm = {
  branchName: '',
  branchCode: '',
  address: '',
  city: '',
  state: '',
  contactNumber: '',
  manager: '',
  isActive: true,
};

const toSafeManagerId = (manager) => {
  if (!manager) return '';
  if (typeof manager === 'string') return manager;
  if (manager?._id) return String(manager._id);
  return '';
};

const toManagerName = (manager) => {
  if (!manager || typeof manager === 'string') return 'Not Assigned';
  const fullName = `${manager.firstName || ''} ${manager.lastName || ''}`.trim();
  return fullName || manager.email || 'Not Assigned';
};

const ManageBranches = () => {
  const notify = useNotify();
  const [branches, setBranches] = useState([]);
  const [eligibleManagers, setEligibleManagers] = useState([]);
  const [createForm, setCreateForm] = useState(emptyBranchForm);
  const [editDraftById, setEditDraftById] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const loadBranches = async () => {
    try {
      setLoading(true);
      const response = await API.get('/admin/branches');
      const responseBranches = Array.isArray(response.data?.branches) ? response.data.branches : [];
      const managers = Array.isArray(response.data?.eligibleManagers) ? response.data.eligibleManagers : [];

      setBranches(responseBranches);
      setEligibleManagers(managers);
      setEditDraftById(
        responseBranches.reduce((acc, branch) => {
          acc[branch._id] = {
            branchName: branch.branchName || '',
            branchCode: branch.branchCode || '',
            address: branch.address || '',
            city: branch.city || '',
            state: branch.state || '',
            contactNumber: branch.contactNumber || '',
            manager: toSafeManagerId(branch.manager),
            isActive: Boolean(branch.isActive),
          };
          return acc;
        }, {}),
      );
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load branch data'));
      setBranches([]);
      setEligibleManagers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBranches();
  }, []);

  const stats = useMemo(() => {
    const total = branches.length;
    const active = branches.filter((branch) => branch.isActive).length;
    const inactive = Math.max(total - active, 0);
    return { total, active, inactive };
  }, [branches]);

  const handleCreateBranch = async () => {
    const branchName = String(createForm.branchName || '').trim();
    const branchCode = String(createForm.branchCode || '').trim();

    if (!branchName || !branchCode) {
      notify.error('Branch name and code are required');
      return;
    }

    try {
      setActionKey('create');
      await API.post('/admin/branches', {
        ...createForm,
        branchName,
        branchCode,
        manager: createForm.manager || undefined,
      });
      setCreateForm(emptyBranchForm);
      await loadBranches();
      notify.success('Branch created successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to create branch'));
    } finally {
      setActionKey('');
    }
  };

  const handleSaveBranch = async (branchId) => {
    const draft = editDraftById[branchId];
    if (!draft) return;

    try {
      setActionKey(`save:${branchId}`);
      await API.put(`/admin/branches/${branchId}`, {
        ...draft,
        manager: draft.manager || null,
      });
      await loadBranches();
      notify.success('Branch updated successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update branch'));
    } finally {
      setActionKey('');
    }
  };

  const updateDraft = (branchId, patch) => {
    setEditDraftById((prev) => ({
      ...prev,
      [branchId]: {
        ...(prev[branchId] || {}),
        ...patch,
      },
    }));
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Branch Management"
        subTitle="Create branches, control active state, and assign branch managers with SuperAdmin governance."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Branches</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Active Branches</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{stats.active}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-rose-700">Inactive Branches</p>
          <p className="mt-2 text-2xl font-semibold text-rose-700">{stats.inactive}</p>
        </div>
      </div>

      <div className="mt-6 max-w-5xl rounded-2xl border border-borderColor bg-white p-4 shadow-sm">
        <h3 className="text-sm font-semibold text-gray-800">Create Branch</h3>
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <input
            type="text"
            placeholder="Branch Name"
            value={createForm.branchName}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, branchName: event.target.value }))}
            className="rounded-lg border border-borderColor px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Branch Code"
            value={createForm.branchCode}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, branchCode: event.target.value }))}
            className="rounded-lg border border-borderColor px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="City"
            value={createForm.city}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, city: event.target.value }))}
            className="rounded-lg border border-borderColor px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="State"
            value={createForm.state}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, state: event.target.value }))}
            className="rounded-lg border border-borderColor px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Contact Number"
            value={createForm.contactNumber}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, contactNumber: event.target.value }))}
            className="rounded-lg border border-borderColor px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Address"
            value={createForm.address}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, address: event.target.value }))}
            className="rounded-lg border border-borderColor px-3 py-2 text-sm"
          />
          <select
            value={createForm.manager}
            onChange={(event) => setCreateForm((prev) => ({ ...prev, manager: event.target.value }))}
            className="rounded-lg border border-borderColor px-3 py-2 text-sm"
          >
            <option value="">Manager (Optional)</option>
            {eligibleManagers.map((manager) => (
              <option key={manager._id} value={manager._id}>
                {`${manager.firstName || ''} ${manager.lastName || ''}`.trim() || manager.email}
              </option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 rounded-lg border border-borderColor px-3 py-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(createForm.isActive)}
              onChange={(event) => setCreateForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              className="h-4 w-4 accent-primary"
            />
            Active
          </label>
        </div>

        <button
          type="button"
          onClick={handleCreateBranch}
          disabled={actionKey === 'create'}
          className={`mt-4 rounded-lg px-4 py-2 text-sm font-medium text-white ${
            actionKey === 'create' ? 'cursor-not-allowed bg-slate-400' : 'bg-primary'
          }`}
        >
          {actionKey === 'create' ? 'Creating...' : 'Create Branch'}
        </button>
      </div>

      <div className="mt-6 max-w-6xl w-full rounded-2xl overflow-hidden border border-borderColor bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-275 border-collapse text-left text-sm">
                <thead className="bg-light text-gray-700">
                  <tr>
                    <th className="p-3 font-medium">Branch</th>
                    <th className="p-3 font-medium">Location</th>
                    <th className="p-3 font-medium">Contact</th>
                    <th className="p-3 font-medium">Manager</th>
                    <th className="p-3 font-medium">Status</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>
            <tbody>
                  {loading ? (
                    <tr className="border-t border-borderColor">
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        Loading branch data...
                      </td>
                    </tr>
                  ) : null}

                  {!loading && branches.length === 0 ? (
                    <tr className="border-t border-borderColor">
                      <td colSpan={6} className="p-8 text-center text-gray-500">
                        No branches found.
                      </td>
                    </tr>
                  ) : null}

                  {!loading &&
                    branches.map((branch) => {
                      const draft = editDraftById[branch._id] || {};
                      const saveKey = `save:${branch._id}`;

                      return (
                        <tr key={branch._id} className="border-t border-borderColor align-top">
                          <td className="p-3">
                            <input
                              type="text"
                              value={draft.branchName || ''}
                              onChange={(event) => updateDraft(branch._id, { branchName: event.target.value })}
                              className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                            />
                            <input
                              type="text"
                              value={draft.branchCode || ''}
                              onChange={(event) => updateDraft(branch._id, { branchCode: event.target.value })}
                              className="mt-2 w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                            />
                          </td>

                          <td className="p-3">
                            <input
                              type="text"
                              placeholder="City"
                              value={draft.city || ''}
                              onChange={(event) => updateDraft(branch._id, { city: event.target.value })}
                              className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                            />
                            <input
                              type="text"
                              placeholder="State"
                              value={draft.state || ''}
                              onChange={(event) => updateDraft(branch._id, { state: event.target.value })}
                              className="mt-2 w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                            />
                            <input
                              type="text"
                              placeholder="Address"
                              value={draft.address || ''}
                              onChange={(event) => updateDraft(branch._id, { address: event.target.value })}
                              className="mt-2 w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                            />
                          </td>

                          <td className="p-3">
                            <input
                              type="text"
                              placeholder="Contact"
                              value={draft.contactNumber || ''}
                              onChange={(event) => updateDraft(branch._id, { contactNumber: event.target.value })}
                              className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                            />
                          </td>

                          <td className="p-3">
                            <select
                              value={draft.manager || ''}
                              onChange={(event) => updateDraft(branch._id, { manager: event.target.value })}
                              className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                            >
                              <option value="">No Manager</option>
                              {eligibleManagers.map((manager) => (
                                <option key={manager._id} value={manager._id}>
                                  {`${manager.firstName || ''} ${manager.lastName || ''}`.trim() || manager.email}
                                </option>
                              ))}
                            </select>
                            <p className="mt-2 text-[11px] text-gray-500">Current: {toManagerName(branch.manager)}</p>
                          </td>

                          <td className="p-3">
                            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                              <input
                                type="checkbox"
                                checked={Boolean(draft.isActive)}
                                onChange={(event) => updateDraft(branch._id, { isActive: event.target.checked })}
                                className="h-4 w-4 accent-primary"
                              />
                              {draft.isActive ? 'Active' : 'Inactive'}
                            </label>
                          </td>

                          <td className="p-3">
                            <button
                              type="button"
                              onClick={() => handleSaveBranch(branch._id)}
                              disabled={actionKey === saveKey}
                              className={`rounded-lg px-3 py-2 text-xs font-medium text-white ${
                                actionKey === saveKey ? 'cursor-not-allowed bg-slate-400' : 'bg-primary'
                              }`}
                            >
                              {actionKey === saveKey ? 'Saving...' : 'Save'}
                            </button>
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

export default ManageBranches;
