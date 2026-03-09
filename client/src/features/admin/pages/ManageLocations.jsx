import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const normalizeCompactText = (value) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const toLowerKey = (value) => normalizeCompactText(value).toLowerCase();

const toLocationKey = (branchId, location) => {
  const locationId = String(location?._id || location?.locationId || '').trim();
  const locationName = typeof location === 'string' ? location : location?.name;
  return `${String(branchId || '').trim()}:${locationId || toLowerKey(locationName)}`;
};

const toBranchId = (value) => String(value || '').trim();

const getBranchIdFromCar = (car, fallbackBranchId = '') =>
  toBranchId(car?.branchId?._id || car?.branchId || fallbackBranchId);

const ManageLocations = () => {
  const notify = useNotify();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [createDraftByBranch, setCreateDraftByBranch] = useState({});
  const [renameDraftByLocation, setRenameDraftByLocation] = useState({});
  const [actionKey, setActionKey] = useState('');
  const [carsModalState, setCarsModalState] = useState({
    open: false,
    branch: null,
    locationId: '',
    locationName: '',
    cars: [],
    loading: false,
    error: '',
    movingCarId: '',
    targetByCarId: {},
  });

  const loadLocations = async () => {
    try {
      setLoading(true);
      const response = await API.get('/admin/locations', { showErrorToast: false });
      const nextBranches = Array.isArray(response?.data?.branches) ? response.data.branches : [];
      setBranches(nextBranches);
      setRenameDraftByLocation({});
      setErrorMsg('');
    } catch (error) {
      setBranches([]);
      setErrorMsg(getErrorMessage(error, 'Failed to load branch locations'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLocations();
  }, []);

  const stats = useMemo(() => {
    let totalLocations = 0;
    let usedLocations = 0;

    branches.forEach((branch) => {
      const locations = Array.isArray(branch?.locations) ? branch.locations : [];
      totalLocations += locations.length;
      usedLocations += locations.filter((location) => Number(location?.carCount || 0) > 0).length;
    });

    return {
      totalBranches: branches.length,
      totalLocations,
      usedLocations,
    };
  }, [branches]);

  const updateCreateDraft = (branchId, value) => {
    setCreateDraftByBranch((previous) => ({
      ...previous,
      [branchId]: normalizeCompactText(value),
    }));
  };

  const updateRenameDraft = (branchId, locationName, value) => {
    const key = toLocationKey(branchId, locationName);
    setRenameDraftByLocation((previous) => ({
      ...previous,
      [key]: normalizeCompactText(value),
    }));
  };

  const handleCreateLocation = async (branchId) => {
    const locationName = normalizeCompactText(createDraftByBranch[branchId]);
    if (!locationName) {
      notify.error('Enter a location name');
      return;
    }

    try {
      setActionKey(`create:${branchId}`);
      const response = await API.post(
        '/admin/locations',
        { branchId, name: locationName },
        { showErrorToast: false },
      );
      setCreateDraftByBranch((previous) => ({ ...previous, [branchId]: '' }));
      await loadLocations();
      notify.success(response?.data?.message || 'Location added');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to add location'));
    } finally {
      setActionKey('');
    }
  };

  const handleRenameLocation = async (branchId, location) => {
    const currentName = normalizeCompactText(location?.name || location);
    const key = toLocationKey(branchId, location);
    const nextName = normalizeCompactText(renameDraftByLocation[key] || currentName);
    if (!nextName) {
      notify.error('Enter a valid location name');
      return;
    }
    if (nextName.toLowerCase() === normalizeCompactText(currentName).toLowerCase()) {
      notify.error('Please change the location name before saving');
      return;
    }

    try {
      setActionKey(`rename:${key}`);
      const response = await API.put(
        '/admin/locations',
        { branchId, locationId: location?._id || '', currentName, nextName },
        { showErrorToast: false },
      );
      await loadLocations();
      const movedCars = Number(response?.data?.movedCars || 0);
      notify.success(
        movedCars > 0
          ? `Location renamed and ${movedCars} car${movedCars > 1 ? 's were' : ' was'} updated`
          : response?.data?.message || 'Location renamed',
      );
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to rename location'));
    } finally {
      setActionKey('');
    }
  };

  const handleDeleteLocation = async (branchId, location) => {
    const locationName = normalizeCompactText(location?.name || location);
    const confirmed = window.confirm(`Delete location "${locationName}"?`);
    if (!confirmed) return;

    try {
      setActionKey(`delete:${toLocationKey(branchId, location)}`);
      const response = await API.delete('/admin/locations', {
        params: { branchId, locationId: location?._id || '', name: locationName },
        showErrorToast: false,
      });
      await loadLocations();
      notify.success(response?.data?.message || 'Location deleted');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to delete location'));
    } finally {
      setActionKey('');
    }
  };

  const handleSetPrimaryLocation = async (branchId, location) => {
    try {
      setActionKey(`primary:${toLocationKey(branchId, location)}`);
      const response = await API.patch(
        '/admin/locations/primary',
        { branchId, locationId: location?._id || '', name: location?.name || location },
        { showErrorToast: false },
      );
      await loadLocations();
      notify.success(response?.data?.message || 'Primary location updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update primary location'));
    } finally {
      setActionKey('');
    }
  };

  const closeCarsModal = () => {
    if (carsModalState.movingCarId) return;
    setCarsModalState({
      open: false,
      branch: null,
      locationId: '',
      locationName: '',
      cars: [],
      loading: false,
      error: '',
      movingCarId: '',
      targetByCarId: {},
    });
  };

  const openCarsModal = async (branch, location) => {
    const branchId = String(branch?._id || '').trim();
    const locationId = String(location?._id || '').trim();
    const normalizedLocationName = normalizeCompactText(location?.name || location);
    if (!branchId || (!locationId && !normalizedLocationName)) return;

    setCarsModalState({
      open: true,
      branch,
      locationId,
      locationName: normalizedLocationName,
      cars: [],
      loading: true,
      error: '',
      movingCarId: '',
      targetByCarId: {},
    });

    try {
      const response = await API.get('/admin/locations/cars', {
        params: { branchId, locationId, name: normalizedLocationName },
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
        error: getErrorMessage(error, 'Failed to load cars for this location'),
      }));
    }
  };

  const updateCarMoveTarget = (carId, targetLocation) => {
    const normalizedCarId = String(carId || '').trim();
    if (!normalizedCarId) return;
    setCarsModalState((previous) => ({
      ...previous,
      targetByCarId: {
        ...previous.targetByCarId,
        [normalizedCarId]: {
          ...previous.targetByCarId?.[normalizedCarId],
          ...targetLocation,
        },
      },
    }));
  };

  const handleMoveCarToLocation = async (car) => {
    const carId = String(car?._id || '').trim();
    const sourceBranchId = getBranchIdFromCar(car, carsModalState.branch?._id);
    const sourceLocationId = String(car?.locationId?._id || car?.locationId || carsModalState.locationId || '').trim();
    const sourceLocation = normalizeCompactText(car?.locationId?.name || car?.location || carsModalState.locationName);
    const selectedTarget = carsModalState.targetByCarId?.[carId] || {};
    const targetBranchId = toBranchId(selectedTarget?.branchId || sourceBranchId);
    const targetLocationId = String(selectedTarget?.locationId || '').trim();
    const targetLocation = normalizeCompactText(selectedTarget?.locationName || selectedTarget?.location);
    if (!carId) return;
    if (!targetBranchId) {
      notify.error('Select target branch first');
      return;
    }
    if (!targetLocation) {
      notify.error('Select target location first');
      return;
    }
    if (
      toBranchId(targetBranchId) === toBranchId(sourceBranchId) &&
      toLowerKey(targetLocation) === toLowerKey(sourceLocation)
    ) {
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
          fromLocationId: sourceLocationId,
          toLocationId: targetLocationId,
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
      await loadLocations();
      notify.success('Car location updated');
    } catch (error) {
      setCarsModalState((previous) => ({ ...previous, movingCarId: '' }));
      notify.error(getErrorMessage(error, 'Failed to move car location'));
    }
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title
        title="Branch Locations"
        subTitle="Manage branch-specific pickup locations with scoped access and safe deletion rules."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Visible Branches</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{stats.totalBranches}</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-blue-700">Total Locations</p>
          <p className="mt-2 text-2xl font-semibold text-blue-700">{stats.totalLocations}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Locations With Cars</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{stats.usedLocations}</p>
        </div>
      </div>

      {loading ? (
        <div className="mt-6 rounded-2xl border border-borderColor bg-white p-8 text-sm text-gray-500 shadow-sm">
          Loading location data...
        </div>
      ) : null}

      {!loading && branches.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-borderColor bg-white p-8 text-sm text-gray-500 shadow-sm">
          No branches available for location management.
        </div>
      ) : null}

      {!loading && branches.length > 0 ? (
        <div className="mt-6 space-y-4">
          {branches.map((branch) => (
            <section key={branch._id} className="rounded-2xl border border-borderColor bg-white p-4 md:p-5 shadow-sm">
              <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                <div>
                  <p className="text-base font-semibold text-gray-800">
                    {branch.branchName} <span className="text-xs text-gray-500">({branch.branchCode})</span>
                  </p>
                  <p className="text-xs text-gray-500">
                    {branch.state || 'State N/A'} | Primary city: {branch.city || 'Not set'}
                  </p>
                </div>
                <span
                  className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-semibold ${
                    branch.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                  }`}
                >
                  {branch.isActive ? 'Active Branch' : 'Inactive Branch'}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_auto] gap-2">
                <input
                  type="text"
                  placeholder="Add new location to this branch"
                  value={createDraftByBranch[branch._id] || ''}
                  onChange={(event) => updateCreateDraft(branch._id, event.target.value)}
                  className="rounded-lg border border-borderColor px-3 py-2 text-sm"
                />
                <button
                  type="button"
                  onClick={() => handleCreateLocation(branch._id)}
                  disabled={actionKey === `create:${branch._id}`}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${
                    actionKey === `create:${branch._id}`
                      ? 'cursor-not-allowed bg-slate-400'
                      : 'bg-primary hover:bg-primary/90'
                  }`}
                >
                  {actionKey === `create:${branch._id}` ? 'Adding...' : 'Add Location'}
                </button>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-borderColor">
                <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-sm">
                  <thead className="bg-slate-50 text-gray-700">
                    <tr>
                      <th className="px-3 py-2 font-medium">Location</th>
                      <th className="px-3 py-2 font-medium">Cars</th>
                      <th className="px-3 py-2 font-medium">Rename</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(Array.isArray(branch.locations) ? branch.locations : []).length === 0 ? (
                      <tr className="border-t border-borderColor">
                        <td colSpan={4} className="px-3 py-6 text-center text-gray-500">
                          No locations created for this branch.
                        </td>
                      </tr>
                    ) : (
                      (branch.locations || []).map((location) => {
                        const key = toLocationKey(branch._id, location);
                        const draftValue = renameDraftByLocation[key] ?? location.name;
                        const deleteDisabled = Number(location?.carCount || 0) > 0;
                        return (
                          <tr key={key} className="border-t border-borderColor align-middle">
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-gray-800">{location.name}</span>
                                {location.isPrimary ? (
                                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                                    Primary
                                  </span>
                                ) : null}
                                {location.legacyOnly ? (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                                    From Cars
                                  </span>
                                ) : null}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-gray-700">{Number(location?.carCount || 0)}</td>
                            <td className="px-3 py-2">
                              <input
                                type="text"
                                value={draftValue}
                                onChange={(event) => updateRenameDraft(branch._id, location, event.target.value)}
                                className="w-full rounded-lg border border-borderColor px-2.5 py-1.5 text-xs"
                              />
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => handleSetPrimaryLocation(branch._id, location)}
                                  disabled={location.isPrimary || actionKey === `primary:${key}`}
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                    location.isPrimary || actionKey === `primary:${key}`
                                      ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                      : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                  }`}
                                  title={location.isPrimary ? 'Already primary location' : 'Set as primary location'}
                                >
                                  {actionKey === `primary:${key}` ? 'Updating...' : 'Make Primary'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRenameLocation(branch._id, location)}
                                  disabled={actionKey === `rename:${key}`}
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold text-white ${
                                    actionKey === `rename:${key}`
                                      ? 'cursor-not-allowed bg-slate-400'
                                      : 'bg-primary hover:bg-primary/90'
                                  }`}
                                >
                                  {actionKey === `rename:${key}` ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openCarsModal(branch, location)}
                                  className="rounded-md px-3 py-1.5 text-xs font-semibold bg-indigo-100 text-indigo-700 hover:bg-indigo-200"
                                  title="View cars in this location"
                                >
                                  View Cars
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteLocation(branch._id, location)}
                                  disabled={deleteDisabled || actionKey === `delete:${key}`}
                                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                                    deleteDisabled || actionKey === `delete:${key}`
                                      ? 'cursor-not-allowed bg-slate-200 text-slate-500'
                                      : 'bg-rose-100 text-rose-700 hover:bg-rose-200'
                                  }`}
                                  title={
                                    deleteDisabled
                                      ? 'Move or remove cars from this location before deleting'
                                      : 'Delete location'
                                  }
                                >
                                  {actionKey === `delete:${key}` ? 'Deleting...' : 'Delete'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
        </div>
      ) : null}

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
                  <p className="text-base md:text-lg font-semibold text-slate-900">Cars In Location</p>
                  <p className="mt-1 text-xs md:text-sm text-slate-600">
                    {carsModalState.branch?.branchName || 'Branch'} | {carsModalState.locationName}
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
                  <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
                    <thead className="text-gray-700">
                      <tr>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Car</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Current Branch</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Current Location</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Move To Branch</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Move To Location</th>
                        <th className="sticky top-0 z-20 bg-slate-50 px-3 py-2 font-medium border-b border-borderColor">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {carsModalState.cars.length === 0 ? (
                        <tr className="border-t border-borderColor">
                          <td colSpan={6} className="px-3 py-6 text-center text-gray-500">
                            No cars currently assigned to this location.
                          </td>
                        </tr>
                      ) : (
                        carsModalState.cars.map((car) => {
                          const carId = String(car?._id || '');
                          const currentBranchId = getBranchIdFromCar(car, carsModalState.branch?._id);
                          const currentBranch = branches.find(
                            (entry) => toBranchId(entry?._id) === toBranchId(currentBranchId),
                          );
                          const selectedTarget = carsModalState.targetByCarId?.[carId] || {};
                          const selectedBranchId = toBranchId(selectedTarget?.branchId || currentBranchId);
                          const selectedBranch = branches.find(
                            (entry) => toBranchId(entry?._id) === toBranchId(selectedBranchId),
                          );
                          const selectedTargetLocationId = String(selectedTarget?.locationId || '').trim();
                          const selectedTargetLocation = normalizeCompactText(
                            selectedTarget?.locationName || selectedTarget?.location,
                          );
                          const locationOptions = (Array.isArray(selectedBranch?.locations) ? selectedBranch.locations : [])
                            .map((entry) => ({
                              _id: String(entry?._id || '').trim(),
                              name: normalizeCompactText(entry?.name),
                            }))
                            .filter((entry, index, entries) => {
                              if (!entry.name) return false;
                              return (
                                entries.findIndex(
                                  (candidate) =>
                                    String(candidate?._id || candidate?.name || '') ===
                                    String(entry?._id || entry?.name || ''),
                                ) === index
                              );
                            });
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
                              <td className="px-3 py-2 text-gray-700">
                                {car?.branchId?.branchName || currentBranch?.branchName || 'N/A'}
                              </td>
                              <td className="px-3 py-2 text-gray-700">{car?.locationId?.name || car?.location || 'N/A'}</td>
                              <td className="px-3 py-2">
                                <select
                                  value={selectedBranchId}
                                  onChange={(event) =>
                                    updateCarMoveTarget(carId, {
                                      branchId: toBranchId(event.target.value),
                                      locationId: '',
                                      locationName: '',
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
                                  value={selectedTargetLocationId || selectedTargetLocation}
                                  onChange={(event) => {
                                    const nextLocation = locationOptions.find(
                                      (entry) => String(entry?._id || entry?.name || '') === event.target.value,
                                    );
                                    updateCarMoveTarget(carId, {
                                      branchId: selectedBranchId,
                                      locationId: String(nextLocation?._id || '').trim(),
                                      locationName: nextLocation?.name || '',
                                    });
                                  }}
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
                                  {locationOptions.map((option) => (
                                    <option
                                      key={`${carId}:${option._id || option.name}`}
                                      value={String(option._id || option.name)}
                                    >
                                      {option.name}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => handleMoveCarToLocation(car)}
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

export default ManageLocations;

