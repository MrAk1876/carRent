import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';

const STATUS_FILTERS = ['all', 'Available', 'Assigned', 'Inactive'];

const createDraft = (branchId = '') => ({
  driverName: '',
  phoneNumber: '',
  licenseNumber: '',
  licenseExpiry: '',
  branchId: branchId || '',
  rating: '',
});

const toDateInputValue = (value) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const adjusted = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 10);
};

const toDateLabel = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleDateString();
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const statusClassMap = {
  Available: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  Assigned: 'bg-blue-100 text-blue-700 border-blue-200',
  Inactive: 'bg-slate-200 text-slate-700 border-slate-300',
};

const ManageDrivers = () => {
  const notify = useNotify();
  const [drivers, setDrivers] = useState([]);
  const [summary, setSummary] = useState({
    totalDrivers: 0,
    availableDrivers: 0,
    assignedDrivers: 0,
    inactiveDrivers: 0,
    utilizationPercent: 0,
  });
  const [branchOptions, setBranchOptions] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState(createDraft(''));
  const [editingId, setEditingId] = useState('');
  const [processingKey, setProcessingKey] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const branchNameById = useMemo(() => {
    const map = new Map();
    for (const branch of branchOptions) {
      const branchId = String(branch?._id || '');
      if (!branchId) continue;
      map.set(branchId, String(branch?.branchName || '').trim());
    }
    return map;
  }, [branchOptions]);

  const fetchDrivers = async () => {
    try {
      const params = selectedBranchId ? { branchId: selectedBranchId } : undefined;
      const response = await API.get('/admin/drivers', { params });
      const responseDrivers = Array.isArray(response.data?.drivers) ? response.data.drivers : [];
      const responseSummary = response.data?.summary || {};
      const responseBranches = Array.isArray(response.data?.branches) ? response.data.branches : [];

      setDrivers(responseDrivers);
      setSummary({
        totalDrivers: Number(responseSummary.totalDrivers || 0),
        availableDrivers: Number(responseSummary.availableDrivers || 0),
        assignedDrivers: Number(responseSummary.assignedDrivers || 0),
        inactiveDrivers: Number(responseSummary.inactiveDrivers || 0),
        utilizationPercent: Number(responseSummary.utilizationPercent || 0),
      });
      setBranchOptions(responseBranches);

      setDraft((previous) => {
        const previousBranchId = String(previous.branchId || '').trim();
        if (previousBranchId) return previous;
        const fallbackBranchId = String(selectedBranchId || responseBranches?.[0]?._id || '').trim();
        return {
          ...previous,
          branchId: fallbackBranchId,
        };
      });

      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load drivers'));
      setDrivers([]);
    }
  };

  useEffect(() => {
    fetchDrivers();
  }, [selectedBranchId]);

  const filteredDrivers = useMemo(() => {
    const normalizedSearch = normalizeText(search);
    return drivers.filter((driver) => {
      const status = String(driver?.availabilityStatus || 'Available');
      if (statusFilter !== 'all' && status !== statusFilter) return false;

      if (!normalizedSearch) return true;
      const branchId = String(driver?.branchId?._id || driver?.branchId || '');
      const branchName = String(driver?.branchId?.branchName || branchNameById.get(branchId) || '');
      const source = [
        driver?.driverName,
        driver?.phoneNumber,
        driver?.licenseNumber,
        branchName,
      ]
        .map(normalizeText)
        .join(' ');
      return source.includes(normalizedSearch);
    });
  }, [branchNameById, drivers, search, statusFilter]);

  const resetForm = () => {
    setEditingId('');
    setDraft(createDraft(selectedBranchId || branchOptions?.[0]?._id || ''));
  };

  const startEdit = (driver) => {
    const branchId = String(driver?.branchId?._id || driver?.branchId || '');
    setEditingId(String(driver?._id || ''));
    setDraft({
      driverName: String(driver?.driverName || ''),
      phoneNumber: String(driver?.phoneNumber || ''),
      licenseNumber: String(driver?.licenseNumber || ''),
      licenseExpiry: toDateInputValue(driver?.licenseExpiry),
      branchId,
      rating:
        driver?.rating === null || driver?.rating === undefined || driver?.rating === ''
          ? ''
          : String(driver.rating),
    });
  };

  const submitDriver = async () => {
    const payload = {
      driverName: String(draft.driverName || '').trim(),
      phoneNumber: String(draft.phoneNumber || '').trim(),
      licenseNumber: String(draft.licenseNumber || '').trim(),
      licenseExpiry: String(draft.licenseExpiry || '').trim(),
      branchId: String(draft.branchId || '').trim() || undefined,
      rating: String(draft.rating || '').trim() === '' ? undefined : Number(draft.rating),
    };

    if (!payload.driverName || !payload.phoneNumber || !payload.licenseNumber || !payload.licenseExpiry) {
      notify.error('Name, phone, license number, and license expiry are required');
      return;
    }

    const apiPath = editingId ? `/admin/drivers/${editingId}` : '/admin/drivers';
    const apiMethod = editingId ? API.put : API.post;

    try {
      setProcessingKey(editingId ? `edit:${editingId}` : 'create');
      await apiMethod(apiPath, payload);
      await fetchDrivers();
      resetForm();
      notify.success(editingId ? 'Driver updated successfully' : 'Driver added successfully');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to save driver'));
    } finally {
      setProcessingKey('');
    }
  };

  const toggleDriverActive = async (driver) => {
    const driverId = String(driver?._id || '');
    if (!driverId) return;
    const nextActive = !Boolean(driver?.isActive);

    try {
      setProcessingKey(`toggle:${driverId}`);
      await API.put(`/admin/drivers/${driverId}/toggle-active`, { isActive: nextActive });
      await fetchDrivers();
      if (editingId === driverId && !nextActive) {
        resetForm();
      }
      notify.success(nextActive ? 'Driver activated' : 'Driver deactivated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update driver status'));
    } finally {
      setProcessingKey('');
    }
  };

  return (
    <div className="admin-section-page px-4 pt-6 pb-8 md:px-10 md:pt-10 md:pb-10 w-full">
      <Title
        title="Manage Drivers"
        subTitle="Assign and monitor branch drivers with license visibility, availability control, and active allocation tracking."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 max-w-6xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Drivers</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{summary.totalDrivers}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Available</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">{summary.availableDrivers}</p>
        </div>
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-blue-700">Assigned</p>
          <p className="mt-2 text-2xl font-semibold text-blue-700">{summary.assignedDrivers}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-100/70 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-600">Inactive</p>
          <p className="mt-2 text-2xl font-semibold text-slate-700">{summary.inactiveDrivers}</p>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-violet-700">Driver Utilization</p>
          <p className="mt-2 text-2xl font-semibold text-violet-700">{summary.utilizationPercent}%</p>
        </div>
      </div>

      <div className="mt-5 max-w-6xl rounded-2xl border border-borderColor bg-white p-4 shadow-sm">
        <p className="text-sm font-semibold text-gray-800">
          {editingId ? 'Update Driver' : 'Add Driver'}
        </p>

        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <input
            type="text"
            placeholder="Driver name"
            value={draft.driverName}
            onChange={(event) => setDraft((previous) => ({ ...previous, driverName: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Phone number"
            value={draft.phoneNumber}
            onChange={(event) => setDraft((previous) => ({ ...previous, phoneNumber: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="License number"
            value={draft.licenseNumber}
            onChange={(event) => setDraft((previous) => ({ ...previous, licenseNumber: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm uppercase"
          />
          <input
            type="date"
            value={draft.licenseExpiry}
            onChange={(event) => setDraft((previous) => ({ ...previous, licenseExpiry: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          />
          <select
            value={draft.branchId}
            onChange={(event) => setDraft((previous) => ({ ...previous, branchId: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          >
            <option value="">Select Branch</option>
            {branchOptions.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.branchName}
              </option>
            ))}
          </select>
          <input
            type="number"
            min="0"
            max="5"
            step="0.1"
            placeholder="Rating (optional)"
            value={draft.rating}
            onChange={(event) => setDraft((previous) => ({ ...previous, rating: event.target.value }))}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={submitDriver}
            disabled={processingKey === 'create' || processingKey === `edit:${editingId}`}
            className={`rounded-lg px-4 py-2 text-sm font-medium text-white ${
              processingKey === 'create' || processingKey === `edit:${editingId}`
                ? 'cursor-not-allowed bg-slate-400'
                : 'bg-primary'
            }`}
          >
            {editingId
              ? processingKey === `edit:${editingId}`
                ? 'Updating...'
                : 'Update Driver'
              : processingKey === 'create'
              ? 'Adding...'
              : 'Add Driver'}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={resetForm}
              className="rounded-lg border border-borderColor bg-white px-4 py-2 text-sm font-medium text-gray-700"
            >
              Cancel Edit
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 max-w-6xl flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, phone, license, or branch"
          className="w-full md:max-w-md rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
        />

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            className="rounded-lg border border-borderColor bg-white px-3 py-2 text-xs"
          >
            <option value="">All Branches</option>
            {branchOptions.map((branch) => (
              <option key={branch._id} value={branch._id}>
                {branch.branchName}
              </option>
            ))}
          </select>
          {STATUS_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setStatusFilter(status)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                statusFilter === status
                  ? status === 'Assigned'
                    ? 'border-blue-600 bg-blue-600 text-white'
                    : status === 'Inactive'
                    ? 'border-slate-600 bg-slate-600 text-white'
                    : status === 'Available'
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-primary bg-primary text-white'
                  : 'border-borderColor bg-white text-gray-700'
              }`}
            >
              {status === 'all' ? 'All' : status}
            </button>
          ))}
        </div>
      </div>

      <div className="admin-section-scroll-shell admin-section-scroll-shell--table mt-6">
        <div className="admin-section-scroll admin-section-scroll--free admin-section-scroll--table">
          <div className="max-w-6xl rounded-2xl border border-borderColor bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[1120px] w-full border-collapse text-left text-sm text-gray-700">
                <thead className="bg-light text-gray-700">
                  <tr>
                    <th className="p-3 font-medium">Driver</th>
                    <th className="p-3 font-medium">Branch</th>
                    <th className="p-3 font-medium">License</th>
                    <th className="p-3 font-medium">Availability</th>
                    <th className="p-3 font-medium">Assigned Booking</th>
                    <th className="p-3 font-medium">Trips</th>
                    <th className="p-3 font-medium">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {filteredDrivers.length === 0 ? (
                    <tr className="border-t border-borderColor">
                      <td colSpan={7} className="p-8 text-center text-gray-500">
                        No drivers found for current filters.
                      </td>
                    </tr>
                  ) : null}

                  {filteredDrivers.map((driver) => {
                    const driverId = String(driver?._id || '');
                    const availabilityStatus = String(driver?.availabilityStatus || 'Available');
                    const activeBadgeClass = statusClassMap[availabilityStatus] || statusClassMap.Available;
                    const branchId = String(driver?.branchId?._id || driver?.branchId || '');
                    const branchName = String(driver?.branchId?.branchName || branchNameById.get(branchId) || 'N/A');
                    const booking = driver?.currentAssignedBooking || null;
                    const bookingUser = booking?.user
                      ? `${booking.user.firstName || ''} ${booking.user.lastName || ''}`.trim()
                      : '';
                    const bookingCar = booking?.car
                      ? `${booking.car.brand || booking.car.name || ''} ${booking.car.model || ''}`.trim()
                      : '';
                    const toggleBusy = processingKey === `toggle:${driverId}`;
                    const editBusy = processingKey === `edit:${driverId}`;

                    return (
                      <tr key={driverId} className="border-t border-borderColor align-top">
                        <td className="p-3">
                          <p className="font-semibold text-gray-800">{driver?.driverName || 'N/A'}</p>
                          <p className="text-xs text-gray-500">{driver?.phoneNumber || 'N/A'}</p>
                          <p className="text-xs text-gray-500">Rating: {driver?.rating ?? 'N/A'}</p>
                        </td>

                        <td className="p-3">
                          <p className="font-medium text-gray-700">{branchName}</p>
                          <p className="text-xs text-gray-500">{driver?.branchId?.branchCode || ''}</p>
                        </td>

                        <td className="p-3">
                          <p className="font-medium text-gray-700">{driver?.licenseNumber || 'N/A'}</p>
                          <p className="text-xs text-gray-500">Expiry: {toDateLabel(driver?.licenseExpiry)}</p>
                          {driver?.licenseExpired ? (
                            <span className="mt-1 inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                              License Expired
                            </span>
                          ) : null}
                          {!driver?.licenseExpired && driver?.licenseExpiringIn30Days ? (
                            <span className="mt-1 inline-flex rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                              Expires in 30 days
                            </span>
                          ) : null}
                        </td>

                        <td className="p-3">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${activeBadgeClass}`}>
                            {availabilityStatus}
                          </span>
                          {!driver?.isActive ? (
                            <p className="mt-1 text-xs text-slate-500">Driver account inactive</p>
                          ) : null}
                        </td>

                        <td className="p-3">
                          {booking?._id ? (
                            <div>
                              <p className="font-medium text-gray-700">#{String(booking._id).slice(-6)}</p>
                              <p className="text-xs text-gray-500">{bookingCar || 'Car details unavailable'}</p>
                              <p className="text-xs text-gray-500">{bookingUser || 'User details unavailable'}</p>
                              <p className="text-xs text-gray-500">
                                {booking?.rentalStage || booking?.bookingStatus || 'Scheduled'}
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-gray-500">Not assigned</p>
                          )}
                        </td>

                        <td className="p-3">
                          <p className="font-semibold text-gray-800">{Number(driver?.totalTripsCompleted || 0)}</p>
                        </td>

                        <td className="p-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => startEdit(driver)}
                              disabled={toggleBusy || editBusy}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                                toggleBusy || editBusy
                                  ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                                  : 'border-blue-200 bg-blue-50 text-blue-700'
                              }`}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleDriverActive(driver)}
                              disabled={toggleBusy}
                              className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                                toggleBusy
                                  ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                                  : driver?.isActive
                                  ? 'border-red-200 bg-red-50 text-red-700'
                                  : 'border-emerald-200 bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {toggleBusy
                                ? 'Updating...'
                                : driver?.isActive
                                ? 'Deactivate'
                                : 'Activate'}
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
      </div>
    </div>
  );
};

export default ManageDrivers;
