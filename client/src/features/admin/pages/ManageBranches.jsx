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

const normalizeCompactText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const normalizePhoneDigits = (value) => String(value || '').replace(/\D/g, '').slice(0, 10);

const toBranchId = (value) => String(value || '').trim();

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

const getBranchIdFromCar = (car, fallbackBranchId = '') =>
  toBranchId(car?.branchId?._id || car?.branchId || fallbackBranchId);

const getBranchLocationOptions = (branch) =>
  Array.from(
    new Set(
      [branch?.city, ...(Array.isArray(branch?.serviceCities) ? branch.serviceCities : [])]
        .map((entry) => normalizeCompactText(entry))
        .filter(Boolean),
    ),
  );

const ManageBranches = () => {
  const notify = useNotify();
  const [branches, setBranches] = useState([]);
  const [eligibleManagers, setEligibleManagers] = useState([]);
  const [createForm, setCreateForm] = useState(emptyBranchForm);
  const [editDraftById, setEditDraftById] = useState({});
  const [loading, setLoading] = useState(true);
  const [actionKey, setActionKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [carsModalState, setCarsModalState] = useState({
    open: false,
    branch: null,
    cars: [],
    loading: false,
    error: '',
    movingCarId: '',
    targetByCarId: {},
  });

  const loadBranches = async () => {
    try {
      setLoading(true);
      const response = await API.get('/admin/branches', { showErrorToast: false });
      const responseBranches = Array.isArray(response?.data?.branches) ? response.data.branches : [];
      const managers = Array.isArray(response?.data?.eligibleManagers) ? response.data.eligibleManagers : [];

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
            contactNumber: normalizePhoneDigits(branch.contactNumber),
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
      await API.post(
        '/admin/branches',
        {
          ...createForm,
          branchName,
          branchCode,
          manager: createForm.manager || undefined,
        },
        { showErrorToast: false },
      );
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
      await API.put(
        `/admin/branches/${branchId}`,
        {
          ...draft,
          manager: draft.manager || null,
        },
        { showErrorToast: false },
      );
      await loadBranches();
      notify.success('Branch updated successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update branch'));
    } finally {
      setActionKey('');
    }
  };

  const handleDeleteBranch = async (branch) => {
    const branchId = toBranchId(branch?._id);
    if (!branchId) return;

    if (String(branch?.branchCode || '').toUpperCase() === 'MAIN') {
      notify.error('Main branch cannot be deleted');
      return;
    }

    if (Number(branch?.carCount || 0) > 0) {
      notify.error('Move or remove cars from this branch before deleting');
      return;
    }

    const confirmed = window.confirm(`Delete branch "${branch?.branchName || 'this branch'}"?`);
    if (!confirmed) return;

    try {
      setActionKey(`delete:${branchId}`);
      await API.delete(`/admin/branches/${branchId}`, { showErrorToast: false });
      await loadBranches();
      notify.success('Branch deleted successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete branch'));
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

  const closeCarsModal = () => {
    if (carsModalState.movingCarId) return;
    setCarsModalState({
      open: false,
      branch: null,
      cars: [],
      loading: false,
      error: '',
      movingCarId: '',
      targetByCarId: {},
    });
  };

  const openCarsModal = async (branch) => {
    const branchId = toBranchId(branch?._id);
    if (!branchId) return;

    setCarsModalState({
      open: true,
      branch,
      cars: [],
      loading: true,
      error: '',
      movingCarId: '',
      targetByCarId: {},
    });

    try {
      const response = await API.get('/admin/branches/cars', {
        params: { branchId },
        showErrorToast: false,
      });
      const cars = Array.isArray(response?.data?.cars) ? response.data.cars : [];
      setCarsModalState((previous) => ({
        ...previous,
        cars,
        loading: false,
      }));
    } catch (error) {
      setCarsModalState((previous) => ({
        ...previous,
        loading: false,
        error: getErrorMessage(error, 'Failed to load cars for this branch'),
      }));
    }
  };

  const updateCarMoveTarget = (carId, patch) => {
    const normalizedCarId = String(carId || '').trim();
    if (!normalizedCarId) return;
    setCarsModalState((previous) => ({
      ...previous,
      targetByCarId: {
        ...previous.targetByCarId,
        [normalizedCarId]: {
          ...previous.targetByCarId?.[normalizedCarId],
          ...patch,
        },
      },
    }));
  };

  const handleMoveCarToBranch = async (car) => {
    const carId = String(car?._id || '').trim();
    const sourceBranchId = getBranchIdFromCar(car, carsModalState.branch?._id);
    const sourceLocation = normalizeCompactText(car?.location || carsModalState.branch?.city);
    const selectedTarget = carsModalState.targetByCarId?.[carId] || {};
    const targetBranchId = toBranchId(selectedTarget?.branchId || sourceBranchId);
    const targetLocation = normalizeCompactText(selectedTarget?.location);

    if (!carId) return;
    if (!sourceLocation) {
      notify.error('Current location is missing for this car');
      return;
    }
    if (!targetBranchId) {
      notify.error('Select target branch first');
      return;
    }
    if (!targetLocation) {
      notify.error('Select target location first');
      return;
    }
    if (targetBranchId === sourceBranchId && targetLocation.toLowerCase() === sourceLocation.toLowerCase()) {
      notify.error('Select a different branch or location');
      return;
    }

    try {
      setCarsModalState((previous) => ({ ...previous, movingCarId: carId }));
      await API.patch(
        '/admin/locations/cars/move',
        {
          carId,
          fromBranchId: sourceBranchId,
          toBranchId: targetBranchId,
          fromLocation: sourceLocation,
          toLocation: targetLocation,
        },
        { showErrorToast: false },
      );
      setCarsModalState((previous) => ({
        ...previous,
        movingCarId: '',
        cars: previous.cars.filter((item) => String(item?._id || '') !== carId),
      }));
      await loadBranches();
      notify.success('Car moved successfully');
    } catch (error) {
      setCarsModalState((previous) => ({ ...previous, movingCarId: '' }));
      notify.error(getErrorMessage(error, 'Failed to move car'));
    }
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Branch Management"
        subTitle="Create, update, and safely delete branches with vehicle transfer safeguards."
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
            placeholder="Contact Number (10 digits)"
            value={createForm.contactNumber}
            onChange={(event) =>
              setCreateForm((prev) => ({ ...prev, contactNumber: normalizePhoneDigits(event.target.value) }))
            }
            inputMode="numeric"
            maxLength={10}
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
          <table className="w-full min-w-275 border-separate border-spacing-0 text-left text-sm">
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
                  const deleteKey = `delete:${branch._id}`;
                  const isMainBranch = String(branch?.branchCode || '').toUpperCase() === 'MAIN';
                  const hasCars = Number(branch?.carCount || 0) > 0;
                  const deleteDisabled = isMainBranch || hasCars || actionKey === deleteKey;

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
                        <p className="mt-2 text-[11px] text-gray-500">
                          Cars: {Number(branch?.carCount || 0)}
                        </p>
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
                          onChange={(event) =>
                            updateDraft(branch._id, { contactNumber: normalizePhoneDigits(event.target.value) })
                          }
                          inputMode="numeric"
                          maxLength={10}
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
                        <div className="flex flex-wrap items-center gap-2">
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
                          <button
                            type="button"
                            onClick={() => openCarsModal(branch)}
                            className="rounded-lg px-3 py-2 text-xs font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                          >
                            View Cars
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteBranch(branch)}
                            disabled={deleteDisabled}
                            title={
                              isMainBranch
                                ? 'Main branch cannot be deleted'
                                : hasCars
                                  ? 'Move or remove cars before deleting this branch'
                                  : 'Delete branch'
                            }
                            className={`rounded-lg px-3 py-2 text-xs font-medium ${
                              deleteDisabled
                                ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                            }`}
                          >
                            {actionKey === deleteKey ? 'Deleting...' : 'Delete'}
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

      {carsModalState.open ? (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-900/45 backdrop-blur-[2px] p-3 md:p-4 modal-backdrop-enter"
          onClick={closeCarsModal}
        >
          <div
            className="w-full max-w-[min(1120px,96vw)] max-h-[92vh] rounded-3xl border border-slate-200 bg-white shadow-[0_28px_60px_rgba(15,23,42,0.28)] overflow-hidden flex flex-col modal-panel-enter"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-slate-200 bg-gradient-to-r from-slate-50 to-blue-50/70 px-5 py-4 md:px-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base md:text-lg font-semibold text-slate-900">Cars In Branch</p>
                  <p className="mt-1 text-xs md:text-sm text-slate-600">
                    {carsModalState.branch?.branchName || 'Branch'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closeCarsModal}
                  disabled={Boolean(carsModalState.movingCarId)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="px-5 pb-5 pt-4 md:px-6 md:pb-6 md:pt-5 flex-1 min-h-0 overflow-hidden flex flex-col">
              {carsModalState.error ? <p className="text-sm text-red-500">{carsModalState.error}</p> : null}

              {carsModalState.loading ? (
                <div className="rounded-xl border border-borderColor bg-slate-50 px-4 py-6 text-sm text-gray-500">
                  Loading cars...
                </div>
              ) : null}

              {!carsModalState.loading && !carsModalState.error ? (
                <div className="mt-4 min-h-0 flex-1 overflow-auto relative rounded-xl border border-borderColor bg-white shadow-inner">
                  <table className="w-full min-w-[820px] border-separate border-spacing-0 text-left text-sm">
                    <thead className="text-gray-700">
                      <tr>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Car</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Current Location</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Move To Branch</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Move To Location</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {carsModalState.cars.length === 0 ? (
                        <tr className="border-t border-borderColor">
                          <td colSpan={5} className="px-3 py-6 text-center text-gray-500">
                            No cars currently assigned to this branch.
                          </td>
                        </tr>
                      ) : (
                        carsModalState.cars.map((car) => {
                          const carId = String(car?._id || '');
                          const sourceBranchId = getBranchIdFromCar(car, carsModalState.branch?._id);
                          const selectedTarget = carsModalState.targetByCarId?.[carId] || {};
                          const selectedBranchId = toBranchId(selectedTarget?.branchId || sourceBranchId);
                          const selectedBranch = branches.find(
                            (entry) => toBranchId(entry?._id) === selectedBranchId,
                          );
                          const selectedTargetLocation = normalizeCompactText(selectedTarget?.location);
                          const locationOptions = getBranchLocationOptions(selectedBranch);
                          const moving = carsModalState.movingCarId === carId;

                          return (
                            <tr key={carId} className="border-t border-borderColor align-middle">
                              <td className="px-3 py-2">
                                <p className="font-medium text-gray-800">
                                  {`${car?.brand || ''} ${car?.model || car?.name || ''}`.trim() || 'Car'}
                                </p>
                                <p className="text-xs text-gray-500">
                                  {car?.registrationNumber || 'N/A'} | {car?.fleetStatus || 'Status N/A'}
                                </p>
                              </td>
                              <td className="px-3 py-2 text-gray-700">{car?.location || 'N/A'}</td>
                              <td className="px-3 py-2">
                                <select
                                  value={selectedBranchId}
                                  onChange={(event) =>
                                    updateCarMoveTarget(carId, {
                                      branchId: toBranchId(event.target.value),
                                      location: '',
                                    })
                                  }
                                  className="w-full rounded-lg border border-borderColor px-2.5 py-1.5 text-xs"
                                  disabled={moving || branches.length === 0}
                                >
                                  <option value="">{branches.length ? 'Select branch' : 'No branch available'}</option>
                                  {branches.map((optionBranch) => (
                                    <option key={`${carId}:branch:${optionBranch._id}`} value={optionBranch._id}>
                                      {optionBranch?.branchName || optionBranch?.branchCode || 'Branch'}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <select
                                  value={selectedTargetLocation}
                                  onChange={(event) =>
                                    updateCarMoveTarget(carId, {
                                      branchId: selectedBranchId,
                                      location: event.target.value,
                                    })
                                  }
                                  className="w-full rounded-lg border border-borderColor px-2.5 py-1.5 text-xs"
                                  disabled={moving || !selectedBranchId || locationOptions.length === 0}
                                >
                                  <option value="">
                                    {!selectedBranchId
                                      ? 'Select branch first'
                                      : locationOptions.length
                                        ? 'Select location'
                                        : 'No location available'}
                                  </option>
                                  {locationOptions.map((optionName) => (
                                    <option key={`${carId}:${optionName}`} value={optionName}>
                                      {optionName}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => handleMoveCarToBranch(car)}
                                  disabled={moving || !selectedBranchId || !selectedTargetLocation}
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                    moving || !selectedBranchId || !selectedTargetLocation
                                      ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                      : 'bg-primary text-white hover:bg-primary/90'
                                  }`}
                                >
                                  {moving ? 'Moving...' : 'Move'}
                                </button>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default ManageBranches;

