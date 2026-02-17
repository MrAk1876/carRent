import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import useNotify from '../../../hooks/useNotify';
import { getUser, hasPermission } from '../../../utils/auth';
import { PERMISSIONS } from '../../../utils/rbac';

const FLEET_FILTERS = ['all', 'Available', 'Reserved', 'Rented', 'Maintenance', 'Inactive'];
const MANUAL_STATUS_TARGETS = ['Available', 'Maintenance', 'Inactive'];
const FALLBACK_SERVICE_TYPES = [
  'Regular Service',
  'Oil Change',
  'Engine Work',
  'Tire Change',
  'Insurance Renewal',
  'Other',
];

const STATUS_STYLES = {
  Available: 'bg-emerald-100 text-emerald-700',
  Reserved: 'bg-amber-100 text-amber-700',
  Rented: 'bg-blue-100 text-blue-700',
  Maintenance: 'bg-orange-100 text-orange-700',
  Inactive: 'bg-slate-200 text-slate-700',
};
const MAINTENANCE_STATUS_STYLES = {
  Scheduled: 'bg-amber-100 text-amber-700',
  Completed: 'bg-emerald-100 text-emerald-700',
};
const PRICING_ACTION_LABELS = {
  CAR_DYNAMIC_PRICING_TOGGLED: 'Dynamic Pricing Toggled',
  CAR_MANUAL_PRICE_SET: 'Manual Price Set',
  CAR_MANUAL_PRICE_RESET: 'Manual Price Reset',
  CAR_BASE_PRICE_UPDATED: 'Base Price Updated',
  BRANCH_DYNAMIC_PRICING_TOGGLED: 'Branch Dynamic Pricing Updated',
};

const toDateLabel = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleDateString();
};

const toDateTimeLabel = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleString();
};

const toDateInputValue = (date = new Date()) => {
  const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return adjusted.toISOString().slice(0, 10);
};

const normalizeText = (value) => String(value || '').trim().toLowerCase();

const createMaintenanceDraft = (serviceTypes = []) => ({
  serviceType: serviceTypes[0] || FALLBACK_SERVICE_TYPES[0],
  serviceDescription: '',
  serviceDate: toDateInputValue(new Date()),
  nextServiceDueDate: '',
  serviceMileage: '',
  serviceCost: '',
  serviceProvider: '',
  invoiceReference: '',
  maintenanceStatus: 'Scheduled',
});

const FleetOverview = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const notify = useNotify();
  const isSuperAdmin = String(getUser()?.role || '') === 'SuperAdmin';
  const canManageFleet = hasPermission(PERMISSIONS.MANAGE_FLEET);
  const canManageMaintenance = hasPermission(PERMISSIONS.MANAGE_MAINTENANCE);
  const [cars, setCars] = useState([]);
  const [branchOptions, setBranchOptions] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [transferBranchByCarId, setTransferBranchByCarId] = useState({});
  const [summary, setSummary] = useState({
    totalVehicles: 0,
    available: 0,
    reserved: 0,
    rented: 0,
    maintenance: 0,
    inactive: 0,
    vehiclesInMaintenance: 0,
    serviceDueSoon: 0,
    serviceOverdue: 0,
    totalMaintenanceCost: 0,
  });
  const [maintenanceMeta, setMaintenanceMeta] = useState({
    serviceTypes: FALLBACK_SERVICE_TYPES,
    statuses: ['Scheduled', 'Completed'],
  });
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const [fleetActionKey, setFleetActionKey] = useState('');
  const [pricingActionKey, setPricingActionKey] = useState('');
  const [branchPricingActionKey, setBranchPricingActionKey] = useState('');
  const [maintenanceActionKey, setMaintenanceActionKey] = useState('');
  const [maintenanceDraftByCarId, setMaintenanceDraftByCarId] = useState({});
  const [pricingDraftByCarId, setPricingDraftByCarId] = useState({});
  const [pricingHistoryByCarId, setPricingHistoryByCarId] = useState({});
  const [pricingHistoryLoadingKey, setPricingHistoryLoadingKey] = useState('');
  const [expandedCarId, setExpandedCarId] = useState('');
  const [expandedPricingHistoryCarId, setExpandedPricingHistoryCarId] = useState('');

  const serviceTypeOptions = useMemo(() => {
    const options = Array.isArray(maintenanceMeta?.serviceTypes) ? maintenanceMeta.serviceTypes : [];
    return options.length > 0 ? options : FALLBACK_SERVICE_TYPES;
  }, [maintenanceMeta?.serviceTypes]);
  const branchNameById = useMemo(() => {
    const entries = branchOptions.map((branch) => [String(branch?._id || ''), String(branch?.branchName || '').trim()]);
    return new Map(entries);
  }, [branchOptions]);
  const selectedBranch = useMemo(
    () => branchOptions.find((branch) => String(branch?._id || '') === String(selectedBranchId || '')) || null,
    [branchOptions, selectedBranchId],
  );

  const setMaintenanceDraftField = (carId, key, value) => {
    setMaintenanceDraftByCarId((previous) => ({
      ...previous,
      [carId]: {
        ...(previous[carId] || createMaintenanceDraft(serviceTypeOptions)),
        [key]: value,
      },
    }));
  };

  const loadFleetOverview = async () => {
    try {
      setLoading(true);
      const params = selectedBranchId ? { branchId: selectedBranchId } : undefined;
      const response = await API.get('/admin/fleet-overview', { params });
      const responseCars = Array.isArray(response.data?.cars) ? response.data.cars : [];
      setCars(responseCars);
      const responseBranches = Array.isArray(response.data?.branches) ? response.data.branches : [];
      setBranchOptions(responseBranches);
      setTransferBranchByCarId((previous) => {
        const next = { ...previous };
        for (const car of responseCars) {
          const carId = String(car?._id || '');
          if (!carId) continue;
          next[carId] = String(car?.branchId || next[carId] || '');
        }
        return next;
      });

      const responseSummary = response.data?.summary || {};
      setSummary({
        totalVehicles: Number(responseSummary.totalVehicles || 0),
        available: Number(responseSummary.available || 0),
        reserved: Number(responseSummary.reserved || 0),
        rented: Number(responseSummary.rented || 0),
        maintenance: Number(responseSummary.maintenance || 0),
        inactive: Number(responseSummary.inactive || 0),
        vehiclesInMaintenance: Number(responseSummary.vehiclesInMaintenance || responseSummary.maintenance || 0),
        serviceDueSoon: Number(responseSummary.serviceDueSoon || 0),
        serviceOverdue: Number(responseSummary.serviceOverdue || 0),
        totalMaintenanceCost: Number(responseSummary.totalMaintenanceCost || 0),
      });

      const responseMeta = response.data?.maintenanceMeta || {};
      setMaintenanceMeta({
        serviceTypes:
          Array.isArray(responseMeta.serviceTypes) && responseMeta.serviceTypes.length > 0
            ? responseMeta.serviceTypes
            : FALLBACK_SERVICE_TYPES,
        statuses:
          Array.isArray(responseMeta.statuses) && responseMeta.statuses.length > 0
            ? responseMeta.statuses
            : ['Scheduled', 'Completed'],
      });

      setMaintenanceDraftByCarId((previous) => {
        const next = { ...previous };
        for (const car of responseCars) {
          const carId = String(car?._id || '');
          if (!carId || next[carId]) continue;
          next[carId] = createMaintenanceDraft(
            Array.isArray(responseMeta.serviceTypes) ? responseMeta.serviceTypes : FALLBACK_SERVICE_TYPES,
          );
        }
        return next;
      });
      setPricingDraftByCarId((previous) => {
        const next = { ...previous };
        for (const car of responseCars) {
          const carId = String(car?._id || '');
          if (!carId) continue;
          const manualPrice = Number(car?.manualOverridePrice);
          next[carId] = Number.isFinite(manualPrice) && manualPrice > 0 ? String(manualPrice) : '';
        }
        return next;
      });
      setPricingHistoryByCarId((previous) => {
        const activeCarIds = new Set(responseCars.map((car) => String(car?._id || '')).filter(Boolean));
        const next = {};
        Object.entries(previous || {}).forEach(([carId, value]) => {
          if (activeCarIds.has(carId)) {
            next[carId] = value;
          }
        });
        return next;
      });

      setErrorMsg('');
    } catch (error) {
      setCars([]);
      setErrorMsg(getErrorMessage(error, 'Failed to load fleet overview'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFleetOverview();
  }, [selectedBranchId]);

  const filteredCars = useMemo(() => {
    const searchTerm = normalizeText(search);

    return cars.filter((car) => {
      const fleetStatus = String(car?.fleetStatus || 'Available');
      const statusMatch = filter === 'all' || fleetStatus === filter;

      if (!statusMatch) return false;
      if (!searchTerm) return true;

      const source = [
        car?.name,
        car?.brand,
        car?.model,
        car?.registrationNumber,
        car?.location,
      ]
        .map(normalizeText)
        .join(' ');

      return source.includes(searchTerm);
    });
  }, [cars, filter, search]);

  const updateFleetStatus = async (carId, nextStatus) => {
    if (!canManageFleet) {
      notify.error('Read-only access: fleet status updates are not allowed for your role');
      return;
    }
    if (!carId || !nextStatus) return;

    const actionId = `${carId}:${nextStatus}`;
    try {
      setFleetActionKey(actionId);
      await API.put(`/admin/cars/${carId}/fleet-status`, {
        fleetStatus: nextStatus,
      });
      await loadFleetOverview();
      notify.success('Fleet status updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update fleet status'));
    } finally {
      setFleetActionKey('');
    }
  };

  const submitMaintenance = async (carId) => {
    if (!canManageMaintenance) {
      notify.error('Read-only access: maintenance updates are not allowed for your role');
      return;
    }
    const draft = maintenanceDraftByCarId[carId] || createMaintenanceDraft(serviceTypeOptions);
    const parsedCost = Number(draft.serviceCost || 0);
    const parsedMileage = draft.serviceMileage === '' ? null : Number(draft.serviceMileage);

    if (!draft.serviceType) {
      notify.error('Select service type');
      return;
    }
    if (!draft.serviceDate) {
      notify.error('Select service date');
      return;
    }
    if (!Number.isFinite(parsedCost) || parsedCost < 0) {
      notify.error('Enter a valid non-negative service cost');
      return;
    }
    if (parsedMileage !== null && (!Number.isFinite(parsedMileage) || parsedMileage < 0)) {
      notify.error('Enter a valid non-negative service mileage');
      return;
    }

    const actionId = `add:${carId}`;
    try {
      setMaintenanceActionKey(actionId);
      await API.post(`/admin/cars/${carId}/maintenance`, {
        serviceType: draft.serviceType,
        serviceDescription: draft.serviceDescription,
        serviceDate: draft.serviceDate,
        nextServiceDueDate: draft.nextServiceDueDate || undefined,
        serviceMileage: parsedMileage,
        serviceCost: parsedCost,
        serviceProvider: draft.serviceProvider,
        invoiceReference: draft.invoiceReference,
        maintenanceStatus: draft.maintenanceStatus || 'Scheduled',
      });
      setMaintenanceDraftByCarId((previous) => ({
        ...previous,
        [carId]: createMaintenanceDraft(serviceTypeOptions),
      }));
      await loadFleetOverview();
      notify.success('Maintenance record added');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to add maintenance record'));
    } finally {
      setMaintenanceActionKey('');
    }
  };

  const markMaintenanceCompleted = async (maintenanceId) => {
    if (!canManageMaintenance) {
      notify.error('Read-only access: maintenance updates are not allowed for your role');
      return;
    }
    if (!maintenanceId) return;

    const actionId = `complete:${maintenanceId}`;
    try {
      setMaintenanceActionKey(actionId);
      await API.patch(`/admin/maintenance/${maintenanceId}/complete`, {});
      await loadFleetOverview();
      notify.success('Maintenance marked as completed');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to complete maintenance'));
    } finally {
      setMaintenanceActionKey('');
    }
  };

  const transferCarBranch = async (carId) => {
    if (!isSuperAdmin) {
      notify.error('Only SuperAdmin can transfer vehicles across branches');
      return;
    }

    const targetBranchId = String(transferBranchByCarId[carId] || '').trim();
    if (!targetBranchId) {
      notify.error('Select a target branch');
      return;
    }

    const actionId = `transfer:${carId}`;
    try {
      setFleetActionKey(actionId);
      await API.put(`/admin/cars/${carId}/transfer-branch`, { branchId: targetBranchId });
      await loadFleetOverview();
      notify.success('Vehicle transferred to selected branch');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to transfer vehicle'));
    } finally {
      setFleetActionKey('');
    }
  };

  const updateCarPricing = async (carId, payload, successMessage = 'Pricing updated') => {
    if (!canManageFleet) {
      notify.error('Read-only access: pricing updates are not allowed for your role');
      return;
    }
    if (!carId) return;

    const actionId = `${carId}:${JSON.stringify(payload)}`;
    try {
      setPricingActionKey(actionId);
      await API.patch(`/admin/cars/${carId}/pricing`, payload);
      await loadFleetOverview();
      notify.success(successMessage);
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update pricing configuration'));
    } finally {
      setPricingActionKey('');
    }
  };

  const toggleDynamicPricing = async (car) => {
    const carId = String(car?._id || '');
    if (!carId) return;
    const nextDynamicEnabled = !Boolean(car?.dynamicPriceEnabled);
    await updateCarPricing(
      carId,
      { dynamicPriceEnabled: nextDynamicEnabled },
      nextDynamicEnabled ? 'Dynamic pricing enabled' : 'Dynamic pricing disabled',
    );
  };

  const applyManualPrice = async (car) => {
    const carId = String(car?._id || '');
    if (!carId) return;
    const draftValue = String(pricingDraftByCarId[carId] || '').trim();
    const parsedPrice = Number(draftValue);
    if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
      notify.error('Enter a valid manual override price');
      return;
    }

    await updateCarPricing(
      carId,
      { manualOverridePrice: parsedPrice },
      'Manual override price applied',
    );
  };

  const resetManualPrice = async (car) => {
    const carId = String(car?._id || '');
    if (!carId) return;
    await updateCarPricing(
      carId,
      { resetManualOverride: true },
      'Manual override reset to dynamic/base pricing',
    );
  };

  const togglePricingHistory = async (car) => {
    const carId = String(car?._id || '');
    if (!carId) return;

    setExpandedPricingHistoryCarId((previous) => (previous === carId ? '' : carId));
    if (pricingHistoryByCarId[carId]) return;

    try {
      setPricingHistoryLoadingKey(carId);
      const response = await API.get(`/admin/cars/${carId}/pricing-history`);
      const history = Array.isArray(response?.data?.history) ? response.data.history : [];
      setPricingHistoryByCarId((previous) => ({
        ...previous,
        [carId]: history,
      }));
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to load pricing history'));
    } finally {
      setPricingHistoryLoadingKey('');
    }
  };

  const toggleSelectedBranchDynamicPricing = async () => {
    if (!isSuperAdmin) {
      notify.error('Only SuperAdmin can update branch-level dynamic pricing');
      return;
    }

    const branchId = String(selectedBranch?._id || '');
    if (!branchId) {
      notify.error('Select a branch to update branch-level dynamic pricing');
      return;
    }

    try {
      setBranchPricingActionKey(branchId);
      await API.patch(`/admin/branches/${branchId}/dynamic-pricing`, {
        dynamicPricingEnabled: !Boolean(selectedBranch?.dynamicPricingEnabled),
      });
      await loadFleetOverview();
      notify.success('Branch dynamic pricing updated');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update branch dynamic pricing'));
    } finally {
      setBranchPricingActionKey('');
    }
  };

  return (
    <div className="admin-section-page px-4 pt-6 pb-8 md:px-10 md:pt-10 md:pb-10 w-full">
      <Title
        title="Fleet Overview"
        subTitle="Track vehicle availability, active reservations, and maintenance readiness from one dashboard."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 max-w-6xl">
        <div className="rounded-xl border border-borderColor bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-gray-500">Total Vehicles</p>
          <p className="mt-2 text-2xl font-semibold text-gray-800">{summary.totalVehicles}</p>
        </div>
        <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-orange-700">Vehicles In Maintenance</p>
          <p className="mt-2 text-2xl font-semibold text-orange-700">{summary.vehiclesInMaintenance}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-amber-700">Service Due Soon</p>
          <p className="mt-2 text-2xl font-semibold text-amber-700">{summary.serviceDueSoon}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-red-700">Service Overdue</p>
          <p className="mt-2 text-2xl font-semibold text-red-700">{summary.serviceOverdue}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700">Total Maintenance Cost</p>
          <p className="mt-2 text-2xl font-semibold text-emerald-700">
            {currency}
            {summary.totalMaintenanceCost}
          </p>
        </div>
      </div>

      <div className="mt-5 max-w-6xl flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <input
          type="text"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by car name, brand, registration, or location"
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
          {FLEET_FILTERS.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setFilter(status)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                filter === status
                  ? 'border-primary bg-primary text-white'
                  : 'border-borderColor bg-white text-gray-700'
              }`}
            >
              {status === 'all' ? 'All' : status}
            </button>
          ))}
        </div>
      </div>

      {isSuperAdmin && selectedBranch ? (
        <div className="mt-3 max-w-6xl rounded-xl border border-borderColor bg-white p-3 shadow-sm flex flex-wrap items-center gap-3">
          <p className="text-sm text-gray-700">
            Branch Dynamic Pricing:
            <span
              className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${
                selectedBranch?.dynamicPricingEnabled
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-slate-200 text-slate-700'
              }`}
            >
              {selectedBranch?.dynamicPricingEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </p>
          <button
            type="button"
            onClick={toggleSelectedBranchDynamicPricing}
            disabled={branchPricingActionKey === String(selectedBranch?._id || '')}
            className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
              branchPricingActionKey === String(selectedBranch?._id || '')
                ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                : 'border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
            }`}
          >
            {branchPricingActionKey === String(selectedBranch?._id || '')
              ? 'Updating...'
              : selectedBranch?.dynamicPricingEnabled
                ? 'Disable Branch Dynamic'
                : 'Enable Branch Dynamic'}
          </button>
          <p className="text-xs text-gray-500">
            Vehicle-level dynamic pricing works only when branch dynamic pricing is enabled.
          </p>
        </div>
      ) : null}

      <div className="admin-section-scroll-shell admin-section-scroll-shell--table mt-6">
        <div className="admin-section-scroll admin-section-scroll--free admin-section-scroll--table">
          <div className="w-full max-w-6xl rounded-2xl border border-borderColor bg-white shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-[1720px] w-full table-auto border-collapse text-left text-sm text-gray-700">
                <thead className="bg-light text-gray-700">
                  <tr>
                    <th className="min-w-[260px] p-3 font-medium whitespace-nowrap">Vehicle</th>
                    <th className="min-w-[150px] p-3 font-medium whitespace-nowrap">Fleet Status</th>
                    <th className="min-w-[190px] p-3 font-medium whitespace-nowrap">Current Allocation</th>
                    <th className="min-w-[190px] p-3 font-medium whitespace-nowrap">Reminders</th>
                    <th className="min-w-[200px] p-3 font-medium whitespace-nowrap">Insurance / Service</th>
                    <th className="min-w-[170px] p-3 font-medium whitespace-nowrap">Maintenance Cost</th>
                    <th className="min-w-[310px] p-3 font-medium whitespace-nowrap">Pricing</th>
                    <th className="min-w-[360px] p-3 font-medium whitespace-nowrap">Actions</th>
                  </tr>
                </thead>

                <tbody>
                  {loading ? (
                    <tr className="border-t border-borderColor">
                      <td colSpan={8} className="p-8 text-center text-gray-500">
                        Loading fleet data...
                      </td>
                    </tr>
                  ) : null}

                  {!loading && filteredCars.length === 0 ? (
                    <tr className="border-t border-borderColor">
                      <td colSpan={8} className="p-8 text-center text-gray-500">
                        No vehicles found for current filters.
                      </td>
                    </tr>
                  ) : null}

                  {!loading &&
                    filteredCars.map((car) => {
                      const carId = String(car?._id || '');
                      const fleetStatus = String(car?.fleetStatus || 'Available');
                      const allocation = car?.currentAllocation || car?.currentBooking || car?.currentRequest || null;
                      const hasActiveAllocation = Boolean(allocation);
                      const allocationUser = allocation?.user
                        ? `${allocation.user.firstName || ''} ${allocation.user.lastName || ''}`.trim()
                        : 'N/A';
                      const allocationPickup = allocation?.pickupDateTime || allocation?.fromDate || null;
                      const allocationType = allocation?.bookingStatus ? 'Booking' : allocation?.status ? 'Request' : 'None';
                      const insuranceExpiring = Boolean(car?.insuranceExpiringIn30Days);
                      const overdueService = Boolean(car?.serviceOverdue);
                      const dueSoonService = Boolean(car?.serviceDueSoon) && !overdueService;
                      const rowHighlightClass = overdueService ? 'bg-red-50/40' : dueSoonService ? 'bg-amber-50/30' : '';

                      const history = Array.isArray(car?.maintenanceHistory) ? car.maintenanceHistory : [];
                      const maintenanceDraft = maintenanceDraftByCarId[carId] || createMaintenanceDraft(serviceTypeOptions);
                      const isExpanded = expandedCarId === carId;
                      const basePricePerDay = Number(car?.basePricePerDay || car?.pricePerDay || 0);
                      const effectivePricePerDay = Number(car?.effectivePricePerDay || car?.currentDynamicPrice || car?.pricePerDay || 0);
                      const manualOverridePrice = Number(car?.manualOverridePrice || 0);
                      const hasManualOverride = Number.isFinite(manualOverridePrice) && manualOverridePrice > 0;
                      const priceSource = String(car?.priceSource || 'Base');
                      const priceAdjustmentPercent = Number(car?.priceAdjustmentPercent || 0);
                      const branchDynamicEnabled = Boolean(car?.branchDynamicPricingEnabled);
                      const dynamicEnabled = Boolean(car?.dynamicPriceEnabled);
                      const pricingDraft = Object.prototype.hasOwnProperty.call(pricingDraftByCarId, carId)
                        ? pricingDraftByCarId[carId]
                        : hasManualOverride
                          ? String(manualOverridePrice)
                          : '';
                      const pricingHistory = Array.isArray(pricingHistoryByCarId[carId]) ? pricingHistoryByCarId[carId] : [];
                      const isPricingHistoryExpanded = expandedPricingHistoryCarId === carId;
                      const isPricingHistoryLoading = pricingHistoryLoadingKey === carId;
                      const isPricingActionInProgress = pricingActionKey.startsWith(`${carId}:`);

                      return (
                        <React.Fragment key={carId}>
                          <tr className={`border-t border-borderColor align-top ${rowHighlightClass}`}>
                            <td className="min-w-[260px] p-3">
                              <div className="flex items-center gap-3">
                                <img
                                  src={car.image}
                                  alt="car"
                                  className="h-12 w-16 rounded-md border border-borderColor object-cover"
                                />
                                <div>
                                  <p className="font-semibold text-gray-800">
                                    {car.brand} {car.model}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    {car.registrationNumber || 'N/A'} | {car.location || 'N/A'}
                                  </p>
                                  <p className="text-xs text-gray-500">
                                    Branch: {branchNameById.get(String(car?.branchId || '')) || 'Main Branch'}
                                  </p>
                                </div>
                              </div>
                            </td>

                            <td className="min-w-[150px] p-3">
                              <span className={`rounded-full px-3 py-1 text-xs font-medium ${STATUS_STYLES[fleetStatus] || 'bg-slate-100 text-slate-700'}`}>
                                {fleetStatus}
                              </span>
                              {fleetStatus === 'Maintenance' ? (
                                <p className="mt-1 text-xs text-orange-700">Vehicle under maintenance</p>
                              ) : null}
                            </td>

                            <td className="min-w-[190px] p-3">
                              {allocation ? (
                                <>
                                  <p className="font-medium text-gray-800">{allocationType}</p>
                                  <p className="text-xs text-gray-600">{allocationUser || 'N/A'}</p>
                                  <p className="text-xs text-gray-500">Pickup: {toDateTimeLabel(allocationPickup)}</p>
                                </>
                              ) : (
                                <p className="text-sm text-gray-500">No active allocation</p>
                              )}
                            </td>

                            <td className="min-w-[190px] p-3">
                              {overdueService ? (
                                <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700">
                                  Service Overdue
                                </span>
                              ) : dueSoonService ? (
                                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700">
                                  Service Due Soon
                                </span>
                              ) : (
                                <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                                  No Immediate Alert
                                </span>
                              )}
                              <p className="mt-1 text-xs text-gray-500">
                                Next Due: {toDateLabel(car?.nearestServiceDueDate)}
                              </p>
                            </td>

                            <td className="min-w-[200px] p-3">
                              <p className={`font-medium ${insuranceExpiring ? 'text-red-700' : 'text-gray-800'}`}>
                                Insurance: {toDateLabel(car.insuranceExpiry)}
                              </p>
                              <p className="text-xs text-gray-500">Last Service: {toDateLabel(car.lastServiceDate)}</p>
                              <p className="text-xs text-gray-500">Mileage: {Number(car.currentMileage || 0)}</p>
                            </td>

                            <td className="min-w-[170px] p-3">
                              <p className="font-semibold text-gray-800">
                                {currency}
                                {Number(car.totalMaintenanceCost || 0)}
                              </p>
                              <p className="text-xs text-gray-500">Trips: {Number(car.totalTripsCompleted || 0)}</p>
                            </td>

                            <td className="min-w-[310px] p-3">
                              <div className="min-w-[290px] space-y-2">
                                <p className="text-xs text-gray-500">
                                  Base: <span className="font-medium text-gray-800">{currency}{basePricePerDay}</span>
                                </p>
                                <p className="text-xs text-gray-500">
                                  Effective: <span className="font-medium text-gray-800">{currency}{effectivePricePerDay}</span>
                                </p>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                      priceSource === 'Manual'
                                        ? 'bg-amber-100 text-amber-700'
                                        : priceSource === 'Dynamic'
                                          ? 'bg-indigo-100 text-indigo-700'
                                          : 'bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    {priceSource}
                                  </span>
                                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                                    {priceAdjustmentPercent > 0 ? '+' : ''}
                                    {priceAdjustmentPercent.toFixed(2)}%
                                  </span>
                                </div>
                                {branchDynamicEnabled ? (
                                  <p className="text-[11px] text-emerald-700">Branch dynamic pricing enabled</p>
                                ) : (
                                  <p className="text-[11px] text-slate-500">Branch dynamic pricing disabled</p>
                                )}

                                {canManageFleet ? (
                                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => toggleDynamicPricing(car)}
                                        disabled={isPricingActionInProgress}
                                        className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-medium ${
                                          dynamicEnabled
                                            ? 'border-indigo-200 bg-indigo-100 text-indigo-700'
                                            : 'border-slate-300 bg-white text-slate-700'
                                        }`}
                                      >
                                        {isPricingActionInProgress
                                          ? 'Updating...'
                                          : dynamicEnabled
                                            ? 'Disable Dynamic'
                                            : 'Enable Dynamic'}
                                      </button>

                                      <button
                                        type="button"
                                        onClick={() => togglePricingHistory(car)}
                                        className="shrink-0 whitespace-nowrap rounded-lg border border-cyan-200 bg-cyan-50 px-2 py-1 text-[11px] font-medium text-cyan-700"
                                      >
                                        {isPricingHistoryExpanded ? 'Hide History' : 'View History'}
                                      </button>
                                    </div>

                                    <div className="flex flex-wrap items-center gap-2">
                                      <input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        value={pricingDraft}
                                        disabled={isPricingActionInProgress}
                                        onChange={(event) =>
                                          setPricingDraftByCarId((previous) => ({
                                            ...previous,
                                            [carId]: event.target.value,
                                          }))
                                        }
                                        placeholder="Manual price"
                                        className="w-28 shrink-0 rounded-lg border border-borderColor bg-white px-2 py-1 text-[11px]"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => applyManualPrice(car)}
                                        disabled={isPricingActionInProgress}
                                        className="shrink-0 whitespace-nowrap rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700"
                                      >
                                        Set Manual
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => resetManualPrice(car)}
                                        disabled={!hasManualOverride || isPricingActionInProgress}
                                        className={`shrink-0 whitespace-nowrap rounded-lg border px-2 py-1 text-[11px] font-medium ${
                                          hasManualOverride && !isPricingActionInProgress
                                            ? 'border-slate-300 bg-white text-slate-700'
                                            : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                                        }`}
                                      >
                                        Reset Manual
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-slate-500">Read-only pricing access</p>
                                )}

                                {isPricingHistoryExpanded ? (
                                  <div className="rounded-lg border border-borderColor bg-white p-2">
                                    {isPricingHistoryLoading ? (
                                      <p className="text-[11px] text-gray-500">Loading pricing history...</p>
                                    ) : pricingHistory.length > 0 ? (
                                      <div className="space-y-1.5">
                                        {pricingHistory.slice(0, 8).map((entry) => {
                                          const actorName = entry?.user
                                            ? `${entry.user.firstName || ''} ${entry.user.lastName || ''}`.trim()
                                            : 'System';
                                          return (
                                            <div key={entry?._id || `${entry?.actionType}-${entry?.createdAt}`} className="rounded-md bg-slate-50 px-2 py-1">
                                              <p className="text-[11px] font-medium text-slate-700">
                                                {PRICING_ACTION_LABELS[entry?.actionType] || entry?.actionType || 'Pricing Update'}
                                              </p>
                                              <p className="text-[10px] text-slate-500">
                                                {toDateTimeLabel(entry?.createdAt)} by {actorName || 'System'}
                                              </p>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    ) : (
                                      <p className="text-[11px] text-gray-500">No pricing history found.</p>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </td>

                            <td className="min-w-[360px] p-3">
                              <div className="flex min-w-[340px] flex-wrap items-start gap-2">
                                {canManageFleet ? (
                                  MANUAL_STATUS_TARGETS.map((targetStatus) => {
                                    const actionId = `${carId}:${targetStatus}`;
                                    const isLoading = fleetActionKey === actionId;
                                    const isCurrent = fleetStatus === targetStatus;
                                    const transitionLockedByAllocation = hasActiveAllocation && !isCurrent;
                                    const disabled = isLoading || isCurrent || transitionLockedByAllocation;

                                    return (
                                      <button
                                        key={targetStatus}
                                        type="button"
                                        disabled={disabled}
                                        onClick={() => updateFleetStatus(carId, targetStatus)}
                                        className={`shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                                          isCurrent
                                            ? 'border-primary bg-primary text-white'
                                            : disabled
                                            ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                                            : 'border-borderColor bg-white text-gray-700 hover:bg-light'
                                        }`}
                                      >
                                        {isLoading ? 'Updating...' : targetStatus}
                                      </button>
                                    );
                                  })
                                ) : (
                                  <span className="shrink-0 whitespace-nowrap rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">
                                    Read-only fleet access
                                  </span>
                                )}

                                <button
                                  type="button"
                                  onClick={() => setExpandedCarId((previous) => (previous === carId ? '' : carId))}
                                  className="shrink-0 whitespace-nowrap rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 text-xs font-medium text-indigo-700"
                                >
                                  {isExpanded ? 'Hide Maintenance' : 'Maintenance History'}
                                </button>

                                {isSuperAdmin ? (
                                  <div className="flex min-w-[230px] flex-wrap items-center gap-2">
                                    <select
                                      value={transferBranchByCarId[carId] || ''}
                                      onChange={(event) =>
                                        setTransferBranchByCarId((previous) => ({
                                          ...previous,
                                          [carId]: event.target.value,
                                        }))
                                      }
                                      className="min-w-[132px] shrink-0 rounded-lg border border-borderColor bg-white px-2.5 py-1.5 text-xs"
                                    >
                                      <option value="">Select Branch</option>
                                      {branchOptions.map((branch) => (
                                        <option key={branch._id} value={branch._id}>
                                          {branch.branchName}
                                        </option>
                                      ))}
                                    </select>
                                    <button
                                      type="button"
                                      onClick={() => transferCarBranch(carId)}
                                      disabled={fleetActionKey === `transfer:${carId}` || hasActiveAllocation}
                                      className={`shrink-0 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                                        fleetActionKey === `transfer:${carId}` || hasActiveAllocation
                                          ? 'cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400'
                                          : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
                                      }`}
                                    >
                                      {fleetActionKey === `transfer:${carId}` ? 'Transferring...' : 'Transfer Branch'}
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                              {hasActiveAllocation ? (
                                <p className="mt-2 text-[11px] text-slate-500">
                                  Status change is locked while reservation/booking is active.
                                </p>
                              ) : null}
                            </td>
                          </tr>

                          {isExpanded ? (
                            <tr className="border-t border-borderColor bg-slate-50/60">
                              <td colSpan={8} className="p-4">
                                <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
                                  <div className="rounded-xl border border-borderColor bg-white p-4">
                                    <p className="text-sm font-semibold text-gray-800">
                                      {canManageMaintenance ? 'Add New Service' : 'Maintenance Form'}
                                    </p>
                                    {canManageMaintenance ? (
                                      <div className="mt-3 space-y-2">
                                      <select
                                        value={maintenanceDraft.serviceType}
                                        onChange={(event) => setMaintenanceDraftField(carId, 'serviceType', event.target.value)}
                                        className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                      >
                                        {serviceTypeOptions.map((type) => (
                                          <option key={type} value={type}>
                                            {type}
                                          </option>
                                        ))}
                                      </select>

                                      <select
                                        value={maintenanceDraft.maintenanceStatus || 'Scheduled'}
                                        onChange={(event) =>
                                          setMaintenanceDraftField(carId, 'maintenanceStatus', event.target.value)
                                        }
                                        className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                      >
                                        <option value="Scheduled">Scheduled</option>
                                        <option value="Completed">Completed</option>
                                      </select>

                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          type="date"
                                          value={maintenanceDraft.serviceDate}
                                          onChange={(event) => setMaintenanceDraftField(carId, 'serviceDate', event.target.value)}
                                          className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                        />
                                        <input
                                          type="date"
                                          value={maintenanceDraft.nextServiceDueDate}
                                          onChange={(event) =>
                                            setMaintenanceDraftField(carId, 'nextServiceDueDate', event.target.value)
                                          }
                                          className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                        />
                                      </div>

                                      <div className="grid grid-cols-2 gap-2">
                                        <input
                                          type="number"
                                          min="0"
                                          step="1"
                                          placeholder="Service mileage"
                                          value={maintenanceDraft.serviceMileage}
                                          onChange={(event) =>
                                            setMaintenanceDraftField(carId, 'serviceMileage', event.target.value)
                                          }
                                          className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                        />
                                        <input
                                          type="number"
                                          min="0"
                                          step="0.01"
                                          placeholder="Service cost"
                                          value={maintenanceDraft.serviceCost}
                                          onChange={(event) =>
                                            setMaintenanceDraftField(carId, 'serviceCost', event.target.value)
                                          }
                                          className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                        />
                                      </div>

                                      <input
                                        type="text"
                                        placeholder="Service provider"
                                        value={maintenanceDraft.serviceProvider}
                                        onChange={(event) => setMaintenanceDraftField(carId, 'serviceProvider', event.target.value)}
                                        className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                      />
                                      <input
                                        type="text"
                                        placeholder="Invoice reference (optional)"
                                        value={maintenanceDraft.invoiceReference}
                                        onChange={(event) =>
                                          setMaintenanceDraftField(carId, 'invoiceReference', event.target.value)
                                        }
                                        className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                      />
                                      <textarea
                                        rows={3}
                                        placeholder="Service description"
                                        value={maintenanceDraft.serviceDescription}
                                        onChange={(event) =>
                                          setMaintenanceDraftField(carId, 'serviceDescription', event.target.value)
                                        }
                                        className="w-full rounded-lg border border-borderColor px-2.5 py-2 text-xs"
                                      />

                                      <button
                                        type="button"
                                        onClick={() => submitMaintenance(carId)}
                                        disabled={maintenanceActionKey === `add:${carId}`}
                                        className={`w-full rounded-lg px-3 py-2 text-xs font-medium text-white ${
                                          maintenanceActionKey === `add:${carId}`
                                            ? 'cursor-not-allowed bg-slate-400'
                                            : 'bg-primary'
                                        }`}
                                      >
                                        {maintenanceActionKey === `add:${carId}` ? 'Saving...' : 'Add Service Record'}
                                      </button>
                                      </div>
                                    ) : (
                                      <p className="mt-3 text-xs text-slate-500">
                                        Your role can view maintenance history but cannot create or update maintenance records.
                                      </p>
                                    )}
                                  </div>

                                  <div className="rounded-xl border border-borderColor bg-white p-4">
                                    <p className="text-sm font-semibold text-gray-800">Maintenance History</p>
                                    {history.length === 0 ? (
                                      <p className="mt-3 text-sm text-gray-500">No maintenance records found for this vehicle.</p>
                                    ) : (
                                      <div className="mt-3 overflow-x-auto">
                                        <table className="w-full min-w-[720px] border-collapse text-left text-xs text-gray-700">
                                          <thead className="bg-slate-50">
                                            <tr>
                                              <th className="p-2 font-medium">Service Type</th>
                                              <th className="p-2 font-medium">Service Date</th>
                                              <th className="p-2 font-medium">Cost</th>
                                              <th className="p-2 font-medium">Mileage</th>
                                              <th className="p-2 font-medium">Status</th>
                                              <th className="p-2 font-medium">Next Due</th>
                                              <th className="p-2 font-medium">Action</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {history.map((record) => {
                                              const status = String(record?.maintenanceStatus || 'Scheduled');
                                              const completeKey = `complete:${record._id}`;

                                              return (
                                                <tr key={record._id} className="border-t border-borderColor">
                                                  <td className="p-2">{record.serviceType || 'N/A'}</td>
                                                  <td className="p-2">{toDateLabel(record.serviceDate)}</td>
                                                  <td className="p-2">
                                                    {currency}
                                                    {Number(record.serviceCost || 0)}
                                                  </td>
                                                  <td className="p-2">{record.serviceMileage ?? 'N/A'}</td>
                                                  <td className="p-2">
                                                    <span
                                                      className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                                        MAINTENANCE_STATUS_STYLES[status] || 'bg-slate-100 text-slate-700'
                                                      }`}
                                                    >
                                                      {status}
                                                    </span>
                                                  </td>
                                                  <td className="p-2">{toDateLabel(record.nextServiceDueDate)}</td>
                                                  <td className="p-2">
                                                    {status === 'Scheduled' && canManageMaintenance ? (
                                                      <button
                                                        type="button"
                                                        onClick={() => markMaintenanceCompleted(record._id)}
                                                        disabled={maintenanceActionKey === completeKey}
                                                        className={`rounded-lg px-2 py-1 text-[11px] font-medium text-white ${
                                                          maintenanceActionKey === completeKey
                                                            ? 'cursor-not-allowed bg-slate-400'
                                                            : 'bg-emerald-600'
                                                        }`}
                                                      >
                                                        {maintenanceActionKey === completeKey ? 'Updating...' : 'Mark Completed'}
                                                      </button>
                                                    ) : (
                                                      <span className="text-[11px] text-slate-500">
                                                        {status === 'Scheduled' ? 'Scheduled (Read-only)' : 'Completed'}
                                                      </span>
                                                    )}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </React.Fragment>
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

export default FleetOverview;
