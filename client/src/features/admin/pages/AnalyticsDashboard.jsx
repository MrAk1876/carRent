import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import Title from '../components/Title';
import { BarTrendChart, StackedBarTrendChart, TrendLineChart } from '../../../components/ui/AnalyticsCharts';
import GeoHeatmapMap from '../../../components/ui/GeoHeatmapMap';

const RANGE_OPTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'last7days', label: 'Last 7 Days' },
  { key: 'last30days', label: 'Last 30 Days' },
  { key: 'custom', label: 'Custom' },
];

const SORT_OPTIONS = [
  { key: 'bookings', label: 'Most Bookings' },
  { key: 'revenue', label: 'Highest Revenue' },
];

const CUSTOMER_SORT_OPTIONS = [
  { key: 'highestRevenue', label: 'Highest Revenue' },
  { key: 'mostBookings', label: 'Most Bookings' },
  { key: 'highestLateRisk', label: 'Highest Late Risk' },
  { key: 'highestCancellationRate', label: 'Highest Cancellation Rate' },
];

const GEO_OVERLAY_OPTIONS = [
  { key: 'pickup', label: 'Pickup Heatmap' },
  { key: 'drop', label: 'Drop Heatmap' },
  { key: 'revenue', label: 'Revenue Map' },
  { key: 'overdue', label: 'Overdue Density' },
];

const ANALYTICS_TABS = [
  { key: 'overview', label: '\ud83d\udcca Overview' },
  { key: 'predictive', label: '\ud83d\udd2e Predictive Intelligence' },
  { key: 'customer', label: '\ud83e\udde0 Customer Intelligence' },
  { key: 'admin', label: '\ud83d\udc68\u200d\ud83d\udcbc Admin Performance' },
  { key: 'geo', label: '\ud83d\udccd Geographic Intelligence' },
];

const toDateLabel = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'N/A';
  return parsed.toLocaleDateString();
};

const safeNumber = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return 0;
  return numericValue;
};

const toCompactMetric = (value) => {
  const numericValue = safeNumber(value);
  if (Math.abs(numericValue) >= 10000000) return `${(numericValue / 10000000).toFixed(1)}Cr`;
  if (Math.abs(numericValue) >= 100000) return `${(numericValue / 100000).toFixed(1)}L`;
  if (Math.abs(numericValue) >= 1000) return `${(numericValue / 1000).toFixed(1)}K`;
  return `${Math.round(numericValue)}`;
};

const toShortDateLabel = (value) => {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const toMonthLabel = (value, fallback = 'N/A') => {
  if (!value) return fallback;
  const [year, month] = String(value).split('-');
  if (!year || !month) return fallback;
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  if (Number.isNaN(parsed.getTime())) return fallback;
  return parsed.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
};

const formatHours = (value) => {
  const numericValue = safeNumber(value);
  return `${numericValue.toFixed(1)}h`;
};

const toHourDurationLabel = (value) => {
  const numericValue = safeNumber(value);
  if (numericValue <= 0) return '0h';
  if (numericValue >= 48) return `${(numericValue / 24).toFixed(1)}d`;
  return `${numericValue.toFixed(1)}h`;
};

const AnalyticsDashboard = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const browserTimezone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', []);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const [activeTab, setActiveTab] = useState('overview');
  const [rangeKey, setRangeKey] = useState('last30days');
  const [sortType, setSortType] = useState('bookings');
  const [customerSortType, setCustomerSortType] = useState('highestRevenue');
  const [geoOverlayType, setGeoOverlayType] = useState('pickup');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');

  const [branches, setBranches] = useState([]);
  const [roleView, setRoleView] = useState({
    role: '',
    canViewFinancial: false,
    canViewFleet: false,
  });

  const [summary, setSummary] = useState({
    totalRevenue: null,
    totalAdvanceCollected: null,
    totalLateFeesCollected: null,
    totalRefundAmount: null,
    dynamicRevenueContribution: null,
    priceAdjustmentImpact: null,
    subscriptionRevenue: null,
    activeSubscribersCount: null,
    churnRatePercent: null,
    averageSubscriptionDurationDays: null,
    revenuePerSubscriber: null,
    activeRentalsCount: null,
    overdueRentalsCount: null,
    totalBookings: null,
    cancelledBookings: null,
    fleetUtilizationPercent: null,
    totalMaintenanceCost: null,
  });
  const [financialBreakdown, setFinancialBreakdown] = useState(null);
  const [fleetMeta, setFleetMeta] = useState(null);
  const [trendData, setTrendData] = useState({
    dailyRevenue: [],
    monthlyRevenue: [],
    dailyLateTrend: [],
    overduePercentageTrend: [],
    lateSummary: null,
  });
  const [mostRentedCars, setMostRentedCars] = useState([]);
  const [utilizationStats, setUtilizationStats] = useState([]);
  const [topPerformers, setTopPerformers] = useState({
    highestRevenue: [],
    mostBookings: [],
    highestLateFeeContribution: [],
    lowestUtilization: [],
    lowestRevenue: [],
    highMaintenanceLowUsage: [],
  });
  const [branchComparison, setBranchComparison] = useState([]);
  const [customerInsights, setCustomerInsights] = useState([]);
  const [customerSegments, setCustomerSegments] = useState({
    vipCustomers: { count: 0, customers: [] },
    highRiskCustomers: { count: 0, customers: [] },
    frequentRenters: { count: 0, customers: [] },
    oneTimeUsers: { count: 0, customers: [] },
    distribution: [],
    thresholds: {},
  });
  const [repeatMetrics, setRepeatMetrics] = useState({
    activeCustomers: 0,
    repeatCustomers: 0,
    oneTimeCustomers: 0,
    repeatBookingRatePercent: 0,
    averageTimeBetweenBookingsHours: 0,
    retentionRatePercent: 0,
  });
  const [adminPerformance, setAdminPerformance] = useState([]);
  const [pickupHeatmap, setPickupHeatmap] = useState([]);
  const [dropHeatmap, setDropHeatmap] = useState([]);
  const [areaRevenueStats, setAreaRevenueStats] = useState([]);
  const [areaOverdueStats, setAreaOverdueStats] = useState([]);
  const [peakTimeByArea, setPeakTimeByArea] = useState([]);
  const [geoStrategicInsights, setGeoStrategicInsights] = useState({
    topHighDemandAreas: [],
    topHighLateAreas: [],
    mostProfitableArea: null,
    peakHourByBranch: [],
  });
  const [historicalDemand, setHistoricalDemand] = useState({
    historyWindow: null,
    bookingsPerDay: [],
    bookingsPerWeekday: [],
    bookingsPerHour: [],
    revenuePerDay: [],
    branchBookingVolume: [],
    vehicleCategoryDemand: [],
    monthlyBookingVolume: [],
  });
  const [demandForecast, setDemandForecast] = useState([]);
  const [highDemandDays, setHighDemandDays] = useState([]);
  const [predictedPeakHours, setPredictedPeakHours] = useState([]);
  const [fleetRiskAlerts, setFleetRiskAlerts] = useState([]);
  const [vehicleDemandPrediction, setVehicleDemandPrediction] = useState([]);
  const [predictiveInsights, setPredictiveInsights] = useState({
    mostDemandedCategory: null,
    underutilizedVehicles: [],
    recommendedActions: [],
    baseline: null,
  });
  const [selectedGeoPointKey, setSelectedGeoPointKey] = useState('');
  const [timezone, setTimezone] = useState('UTC');
  const [resolvedRange, setResolvedRange] = useState({
    rangeKey: 'last30days',
    label: 'Last 30 Days',
    fromDate: null,
    toDate: null,
    isCustom: false,
  });

  const loadAnalytics = async (options = {}) => {
    try {
      setLoading(true);
      setErrorMsg('');

      const nextRangeKey = options.rangeKey || rangeKey;
      const nextSortType = options.sortType || sortType;
      const nextCustomerSortType = options.customerSortType || customerSortType;
      const nextSelectedBranchId =
        options.selectedBranchId !== undefined ? options.selectedBranchId : selectedBranchId;
      const nextCustomStartDate =
        options.customStartDate !== undefined ? options.customStartDate : customStartDate;
      const nextCustomEndDate =
        options.customEndDate !== undefined ? options.customEndDate : customEndDate;

      const params = {
        range: nextRangeKey,
        timezone: browserTimezone,
        sortType: nextSortType,
        customerSort: nextCustomerSortType,
      };

      if (nextSelectedBranchId) {
        params.branchId = nextSelectedBranchId;
      }

      if (nextRangeKey === 'custom') {
        params.startDate = nextCustomStartDate || undefined;
        params.endDate = nextCustomEndDate || undefined;
      }

      const response = await API.get('/admin/analytics', { params });
      const payload = response.data || {};

      const nextBranches = Array.isArray(payload.branches) ? payload.branches : [];
      setBranches(nextBranches);

      setRoleView({
        role: String(payload?.roleView?.role || ''),
        canViewFinancial: Boolean(payload?.roleView?.canViewFinancial),
        canViewFleet: Boolean(payload?.roleView?.canViewFleet),
      });

      setSummary({
        totalRevenue: payload?.summary?.totalRevenue ?? null,
        totalAdvanceCollected: payload?.summary?.totalAdvanceCollected ?? null,
        totalLateFeesCollected: payload?.summary?.totalLateFeesCollected ?? null,
        totalRefundAmount: payload?.summary?.totalRefundAmount ?? null,
        dynamicRevenueContribution: payload?.summary?.dynamicRevenueContribution ?? null,
        priceAdjustmentImpact: payload?.summary?.priceAdjustmentImpact ?? null,
        subscriptionRevenue: payload?.summary?.subscriptionRevenue ?? null,
        activeSubscribersCount: payload?.summary?.activeSubscribersCount ?? null,
        churnRatePercent: payload?.summary?.churnRatePercent ?? null,
        averageSubscriptionDurationDays: payload?.summary?.averageSubscriptionDurationDays ?? null,
        revenuePerSubscriber: payload?.summary?.revenuePerSubscriber ?? null,
        activeRentalsCount: payload?.summary?.activeRentalsCount ?? null,
        overdueRentalsCount: payload?.summary?.overdueRentalsCount ?? null,
        totalBookings: payload?.summary?.totalBookings ?? null,
        cancelledBookings: payload?.summary?.cancelledBookings ?? null,
        fleetUtilizationPercent: payload?.summary?.fleetUtilizationPercent ?? null,
        totalMaintenanceCost: payload?.summary?.totalMaintenanceCost ?? null,
      });

      setFinancialBreakdown(payload?.financialBreakdown || null);
      setFleetMeta(payload?.fleetMeta || null);
      setTrendData({
        dailyRevenue: Array.isArray(payload?.trendData?.dailyRevenue) ? payload.trendData.dailyRevenue : [],
        monthlyRevenue: Array.isArray(payload?.trendData?.monthlyRevenue) ? payload.trendData.monthlyRevenue : [],
        dailyLateTrend: Array.isArray(payload?.trendData?.dailyLateTrend) ? payload.trendData.dailyLateTrend : [],
        overduePercentageTrend: Array.isArray(payload?.trendData?.overduePercentageTrend)
          ? payload.trendData.overduePercentageTrend
          : [],
        lateSummary: payload?.trendData?.lateSummary || null,
      });
      setMostRentedCars(Array.isArray(payload?.mostRentedCars) ? payload.mostRentedCars : []);
      setUtilizationStats(Array.isArray(payload?.utilizationStats) ? payload.utilizationStats : []);
      setTopPerformers({
        highestRevenue: Array.isArray(payload?.topPerformers?.highestRevenue)
          ? payload.topPerformers.highestRevenue
          : [],
        mostBookings: Array.isArray(payload?.topPerformers?.mostBookings) ? payload.topPerformers.mostBookings : [],
        highestLateFeeContribution: Array.isArray(payload?.topPerformers?.highestLateFeeContribution)
          ? payload.topPerformers.highestLateFeeContribution
          : [],
        lowestUtilization: Array.isArray(payload?.topPerformers?.lowestUtilization)
          ? payload.topPerformers.lowestUtilization
          : [],
        lowestRevenue: Array.isArray(payload?.topPerformers?.lowestRevenue) ? payload.topPerformers.lowestRevenue : [],
        highMaintenanceLowUsage: Array.isArray(payload?.topPerformers?.highMaintenanceLowUsage)
          ? payload.topPerformers.highMaintenanceLowUsage
          : [],
      });
      setBranchComparison(Array.isArray(payload?.branchComparison) ? payload.branchComparison : []);
      setCustomerInsights(Array.isArray(payload?.customerInsights) ? payload.customerInsights : []);
      setCustomerSegments(payload?.customerSegments || {
        vipCustomers: { count: 0, customers: [] },
        highRiskCustomers: { count: 0, customers: [] },
        frequentRenters: { count: 0, customers: [] },
        oneTimeUsers: { count: 0, customers: [] },
        distribution: [],
        thresholds: {},
      });
      setRepeatMetrics(payload?.repeatMetrics || {
        activeCustomers: 0,
        repeatCustomers: 0,
        oneTimeCustomers: 0,
        repeatBookingRatePercent: 0,
        averageTimeBetweenBookingsHours: 0,
        retentionRatePercent: 0,
      });
      setAdminPerformance(Array.isArray(payload?.adminPerformance) ? payload.adminPerformance : []);
      setPickupHeatmap(Array.isArray(payload?.pickupHeatmap) ? payload.pickupHeatmap : []);
      setDropHeatmap(Array.isArray(payload?.dropHeatmap) ? payload.dropHeatmap : []);
      setAreaRevenueStats(Array.isArray(payload?.areaRevenueStats) ? payload.areaRevenueStats : []);
      setAreaOverdueStats(Array.isArray(payload?.areaOverdueStats) ? payload.areaOverdueStats : []);
      setPeakTimeByArea(Array.isArray(payload?.peakTimeByArea) ? payload.peakTimeByArea : []);
      setGeoStrategicInsights(payload?.geoStrategicInsights || {
        topHighDemandAreas: [],
        topHighLateAreas: [],
        mostProfitableArea: null,
        peakHourByBranch: [],
      });
      setHistoricalDemand(payload?.historicalDemand || {
        historyWindow: null,
        bookingsPerDay: [],
        bookingsPerWeekday: [],
        bookingsPerHour: [],
        revenuePerDay: [],
        branchBookingVolume: [],
        vehicleCategoryDemand: [],
        monthlyBookingVolume: [],
      });
      setDemandForecast(Array.isArray(payload?.demandForecast) ? payload.demandForecast : []);
      setHighDemandDays(Array.isArray(payload?.highDemandDays) ? payload.highDemandDays : []);
      setPredictedPeakHours(Array.isArray(payload?.predictedPeakHours) ? payload.predictedPeakHours : []);
      setFleetRiskAlerts(Array.isArray(payload?.fleetRiskAlerts) ? payload.fleetRiskAlerts : []);
      setVehicleDemandPrediction(Array.isArray(payload?.vehicleDemandPrediction) ? payload.vehicleDemandPrediction : []);
      setPredictiveInsights(payload?.predictiveInsights || {
        mostDemandedCategory: null,
        underutilizedVehicles: [],
        recommendedActions: [],
        baseline: null,
      });
      setSelectedGeoPointKey('');
      setTimezone(String(payload?.timezone || browserTimezone || 'UTC'));
      setSortType(String(payload?.fleetSortType || nextSortType || 'bookings'));
      setCustomerSortType(String(payload?.customerSortType || nextCustomerSortType || 'highestRevenue'));

      setResolvedRange({
        rangeKey: String(payload?.range?.rangeKey || nextRangeKey || 'last30days'),
        label: String(payload?.range?.label || ''),
        fromDate: payload?.range?.fromDate || null,
        toDate: payload?.range?.toDate || null,
        isCustom: Boolean(payload?.range?.isCustom),
      });
      setRangeKey(String(payload?.range?.rangeKey || nextRangeKey || 'last30days'));

      const serverSelectedBranchId = String(payload?.selectedBranchId || '');
      if (serverSelectedBranchId !== nextSelectedBranchId) {
        setSelectedBranchId(serverSelectedBranchId);
      }

      if (nextRangeKey === 'custom') {
        if (nextCustomStartDate) setCustomStartDate(nextCustomStartDate);
        if (nextCustomEndDate) setCustomEndDate(nextCustomEndDate);
      } else {
        setCustomStartDate('');
        setCustomEndDate('');
      }
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load analytics dashboard'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics({ rangeKey: 'last30days' });
  }, []);

  const showFinancialSection = Boolean(roleView.canViewFinancial);
  const showFleetSection = Boolean(roleView.canViewFleet);

  const summaryCards = useMemo(() => {
    const cards = [];

    if (showFinancialSection) {
      cards.push({
        title: 'Total Revenue',
        value: `${currency}${safeNumber(summary.totalRevenue)}`,
        tone: 'border-emerald-200 bg-emerald-50/60 text-emerald-700',
      });
      cards.push({
        title: 'Subscription Revenue',
        value: `${currency}${safeNumber(summary.subscriptionRevenue)}`,
        tone: 'border-cyan-200 bg-cyan-50/60 text-cyan-700',
      });
      cards.push({
        title: 'Active Subscribers',
        value: safeNumber(summary.activeSubscribersCount),
        tone: 'border-indigo-200 bg-indigo-50/60 text-indigo-700',
      });
      cards.push({
        title: 'Churn Rate',
        value: `${safeNumber(summary.churnRatePercent)}%`,
        tone: 'border-orange-200 bg-orange-50/60 text-orange-700',
      });
      cards.push({
        title: 'Revenue / Subscriber',
        value: `${currency}${safeNumber(summary.revenuePerSubscriber)}`,
        tone: 'border-teal-200 bg-teal-50/60 text-teal-700',
      });
    }

    if (showFleetSection) {
      cards.push({
        title: 'Active Rentals',
        value: safeNumber(summary.activeRentalsCount),
        tone: 'border-blue-200 bg-blue-50/60 text-blue-700',
      });
      cards.push({
        title: 'Overdue Rentals',
        value: safeNumber(summary.overdueRentalsCount),
        tone: 'border-red-200 bg-red-50/60 text-red-700',
      });
    }

    if (showFinancialSection) {
      cards.push({
        title: 'Refund Total',
        value: `${currency}${safeNumber(summary.totalRefundAmount)}`,
        tone: 'border-amber-200 bg-amber-50/60 text-amber-700',
      });
      cards.push({
        title: 'Dynamic Revenue Lift',
        value: `${currency}${safeNumber(summary.dynamicRevenueContribution)}`,
        tone: 'border-lime-200 bg-lime-50/60 text-lime-700',
      });
      cards.push({
        title: 'Avg Price Adjustment',
        value: `${safeNumber(summary.priceAdjustmentImpact)}%`,
        tone: 'border-fuchsia-200 bg-fuchsia-50/60 text-fuchsia-700',
      });
    }

    if (showFleetSection) {
      cards.push({
        title: 'Fleet Utilization',
        value: `${safeNumber(summary.fleetUtilizationPercent)}%`,
        tone: 'border-violet-200 bg-violet-50/60 text-violet-700',
      });
      cards.push({
        title: 'Maintenance Cost',
        value: `${currency}${safeNumber(summary.totalMaintenanceCost)}`,
        tone: 'border-slate-200 bg-slate-100/70 text-slate-700',
      });
    }

    return cards;
  }, [currency, showFinancialSection, showFleetSection, summary]);

  const dailyRevenueTrendData = useMemo(
    () =>
      (Array.isArray(trendData?.dailyRevenue) ? trendData.dailyRevenue : []).map((row) => ({
        date: String(row?.date || ''),
        baseRevenue: safeNumber(row?.baseRevenue),
        lateFeeRevenue: safeNumber(row?.lateFeeRevenue),
        damageRevenue: safeNumber(row?.damageRevenue),
        refundAmount: safeNumber(row?.refundAmount),
        totalRevenue: safeNumber(row?.totalRevenue),
        bookingCount: safeNumber(row?.bookingCount),
      })),
    [trendData?.dailyRevenue],
  );

  const monthlyRevenueTrendData = useMemo(
    () =>
      (Array.isArray(trendData?.monthlyRevenue) ? trendData.monthlyRevenue : []).map((row) => ({
        monthKey: String(row?.monthKey || ''),
        label: String(row?.label || toMonthLabel(row?.monthKey, 'N/A')),
        baseRevenue: safeNumber(row?.baseRevenue),
        lateFeeRevenue: safeNumber(row?.lateFeeRevenue),
        damageRevenue: safeNumber(row?.damageRevenue),
        totalRevenue: safeNumber(row?.totalRevenue),
        bookingCount: safeNumber(row?.bookingCount),
      })),
    [trendData?.monthlyRevenue],
  );

  const dailyLateTrendData = useMemo(
    () =>
      (Array.isArray(trendData?.dailyLateTrend) ? trendData.dailyLateTrend : []).map((row) => ({
        date: String(row?.date || ''),
        completedCount: safeNumber(row?.completedCount),
        overdueCount: safeNumber(row?.overdueCount),
        totalLateHours: safeNumber(row?.totalLateHours),
        totalLateFee: safeNumber(row?.totalLateFee),
        averageLateHours: safeNumber(row?.averageLateHours),
        overduePercentage: safeNumber(row?.overduePercentage),
      })),
    [trendData?.dailyLateTrend],
  );

  const overduePercentageTrendData = useMemo(
    () =>
      (Array.isArray(trendData?.overduePercentageTrend) ? trendData.overduePercentageTrend : []).map((row) => ({
        date: String(row?.date || ''),
        overduePercentage: safeNumber(row?.overduePercentage),
      })),
    [trendData?.overduePercentageTrend],
  );

  const lateSummary = useMemo(
    () => ({
      completedCount: safeNumber(trendData?.lateSummary?.completedCount),
      overdueCount: safeNumber(trendData?.lateSummary?.overdueCount),
      totalLateFee: safeNumber(trendData?.lateSummary?.totalLateFee),
      averageLateHours: safeNumber(trendData?.lateSummary?.averageLateHours),
      overduePercentage: safeNumber(trendData?.lateSummary?.overduePercentage),
    }),
    [trendData?.lateSummary],
  );

  const latestMonthlySnapshot = useMemo(() => {
    if (!monthlyRevenueTrendData.length) {
      return {
        label: 'N/A',
        totalRevenue: 0,
        lateFeeRevenue: 0,
        bookingCount: 0,
      };
    }

    const latest = monthlyRevenueTrendData[monthlyRevenueTrendData.length - 1];
    return {
      label: latest.label || toMonthLabel(latest.monthKey, 'N/A'),
      totalRevenue: safeNumber(latest.totalRevenue),
      lateFeeRevenue: safeNumber(latest.lateFeeRevenue),
      bookingCount: safeNumber(latest.bookingCount),
    };
  }, [monthlyRevenueTrendData]);

  const rankedMostRentedCars = useMemo(
    () =>
      (Array.isArray(mostRentedCars) ? mostRentedCars : []).map((row, index) => ({
        rank: index + 1,
        carId: String(row?.carId || ''),
        carName: String(row?.carName || 'Unknown Car'),
        brand: String(row?.brand || ''),
        model: String(row?.model || ''),
        registrationNumber: String(row?.registrationNumber || ''),
        totalBookings: safeNumber(row?.totalBookings),
        totalRevenueGenerated: safeNumber(row?.totalRevenueGenerated),
        totalLateFeeGenerated: safeNumber(row?.totalLateFeeGenerated),
        totalDamageCostCollected: safeNumber(row?.totalDamageCostCollected),
        totalRentalHours: safeNumber(row?.totalRentalHours),
        averageRentalDurationHours: safeNumber(row?.averageRentalDurationHours),
        overdueRatePercent: safeNumber(row?.overdueRatePercent),
        utilizationPercent: safeNumber(row?.utilizationPercent),
      })),
    [mostRentedCars],
  );

  const maxMostRentedRevenue = useMemo(
    () =>
      rankedMostRentedCars.reduce(
        (maxValue, row) => (safeNumber(row.totalRevenueGenerated) > maxValue ? safeNumber(row.totalRevenueGenerated) : maxValue),
        0,
      ),
    [rankedMostRentedCars],
  );

  const utilizationRows = useMemo(
    () =>
      (Array.isArray(utilizationStats) ? utilizationStats : []).map((row, index) => ({
        rank: index + 1,
        carId: String(row?.carId || ''),
        carName: String(row?.carName || 'Unknown Car'),
        branchName: String(row?.branchName || 'Unassigned'),
        utilizationPercent: safeNumber(row?.utilizationPercent),
        idleTimePercent: safeNumber(row?.idleTimePercent),
        totalTripsCompleted: safeNumber(row?.totalTripsCompleted),
        totalBookings: safeNumber(row?.totalBookings),
        totalRevenueGenerated: safeNumber(row?.totalRevenueGenerated),
        revenuePerTrip: safeNumber(row?.revenuePerTrip),
        revenuePerRentalHour: safeNumber(row?.revenuePerRentalHour),
        maintenanceCostInRange: safeNumber(row?.maintenanceCostInRange),
      })),
    [utilizationStats],
  );

  const branchComparisonRows = useMemo(
    () =>
      (Array.isArray(branchComparison) ? branchComparison : []).map((row) => ({
        branchId: String(row?.branchId || ''),
        branchName: String(row?.branchName || 'Unassigned'),
        branchCode: String(row?.branchCode || ''),
        totalRevenue: safeNumber(row?.totalRevenue),
        averageUtilizationPercent: safeNumber(row?.averageUtilizationPercent),
        averageLateRatePercent: safeNumber(row?.averageLateRatePercent),
        currentBookings: safeNumber(row?.currentBookings),
        previousBookings: safeNumber(row?.previousBookings),
        bookingGrowthPercent: safeNumber(row?.bookingGrowthPercent),
      })),
    [branchComparison],
  );

  const topPerformerSections = useMemo(
    () => [
      {
        key: 'highestRevenue',
        title: 'Top 5 Revenue Cars',
        rows: Array.isArray(topPerformers?.highestRevenue) ? topPerformers.highestRevenue : [],
        valueLabel: 'Revenue',
        valueFormatter: (row) => `${currency}${safeNumber(row?.totalRevenueGenerated)}`,
        tone: 'border-emerald-200 bg-emerald-50/60',
      },
      {
        key: 'mostBookings',
        title: 'Top 5 Most Booked',
        rows: Array.isArray(topPerformers?.mostBookings) ? topPerformers.mostBookings : [],
        valueLabel: 'Bookings',
        valueFormatter: (row) => safeNumber(row?.totalBookings),
        tone: 'border-blue-200 bg-blue-50/60',
      },
      {
        key: 'highestLateFeeContribution',
        title: 'Top 5 Late Fee Contributors',
        rows: Array.isArray(topPerformers?.highestLateFeeContribution)
          ? topPerformers.highestLateFeeContribution
          : [],
        valueLabel: 'Late Fee',
        valueFormatter: (row) => `${currency}${safeNumber(row?.totalLateFeeGenerated)}`,
        tone: 'border-amber-200 bg-amber-50/60',
      },
      {
        key: 'lowestUtilization',
        title: 'Bottom 5 Utilization',
        rows: Array.isArray(topPerformers?.lowestUtilization) ? topPerformers.lowestUtilization : [],
        valueLabel: 'Utilization',
        valueFormatter: (row) => `${safeNumber(row?.utilizationPercent)}%`,
        tone: 'border-slate-200 bg-slate-100/70',
      },
      {
        key: 'lowestRevenue',
        title: 'Bottom 5 Revenue',
        rows: Array.isArray(topPerformers?.lowestRevenue) ? topPerformers.lowestRevenue : [],
        valueLabel: 'Revenue',
        valueFormatter: (row) => `${currency}${safeNumber(row?.totalRevenueGenerated)}`,
        tone: 'border-rose-200 bg-rose-50/70',
      },
      {
        key: 'highMaintenanceLowUsage',
        title: 'High Maintenance, Low Usage',
        rows: Array.isArray(topPerformers?.highMaintenanceLowUsage) ? topPerformers.highMaintenanceLowUsage : [],
        valueLabel: 'Maintenance',
        valueFormatter: (row) => `${currency}${safeNumber(row?.maintenanceCostInRange)}`,
        tone: 'border-orange-200 bg-orange-50/70',
      },
    ],
    [currency, topPerformers],
  );

  const customerInsightRows = useMemo(
    () =>
      (Array.isArray(customerInsights) ? customerInsights : []).map((row, index) => ({
        rank: index + 1,
        customerId: String(row?.customerId || ''),
        customerName: String(row?.customerName || 'Unknown Customer'),
        email: String(row?.email || ''),
        totalBookings: safeNumber(row?.totalBookings),
        totalRevenueGenerated: safeNumber(row?.totalRevenueGenerated),
        totalLateHours: safeNumber(row?.totalLateHours),
        totalLateFees: safeNumber(row?.totalLateFees),
        totalRefundsReceived: safeNumber(row?.totalRefundsReceived),
        cancellationRatePercent: safeNumber(row?.cancellationRatePercent),
        averageRentalDurationHours: safeNumber(row?.averageRentalDurationHours),
        lifetimeValue: safeNumber(row?.lifetimeValue),
        overdueFrequencyPercent: safeNumber(row?.overdueFrequencyPercent),
        lateRiskScore: safeNumber(row?.lateRiskScore),
      })),
    [customerInsights],
  );

  const customerSegmentDistribution = useMemo(
    () =>
      (Array.isArray(customerSegments?.distribution) ? customerSegments.distribution : []).map((entry) => ({
        key: String(entry?.key || ''),
        label: String(entry?.label || ''),
        count: safeNumber(entry?.count),
        sharePercent: safeNumber(entry?.sharePercent),
      })),
    [customerSegments],
  );

  const adminPerformanceRows = useMemo(
    () =>
      (Array.isArray(adminPerformance) ? adminPerformance : []).map((row, index) => ({
        rank: index + 1,
        adminId: String(row?.adminId || ''),
        adminName: String(row?.adminName || 'Staff'),
        email: String(row?.email || ''),
        role: String(row?.role || ''),
        totalBookingsManaged: safeNumber(row?.totalBookingsManaged),
        totalRefundsProcessed: safeNumber(row?.totalRefundsProcessed),
        totalRevenueHandled: safeNumber(row?.totalRevenueHandled),
        averageBookingProcessingTimeHours: safeNumber(row?.averageBookingProcessingTimeHours),
        numberOfDriverAssignments: safeNumber(row?.numberOfDriverAssignments),
        numberOfMaintenanceRecordsAdded: safeNumber(row?.numberOfMaintenanceRecordsAdded),
        damageInspectionsConducted: safeNumber(row?.damageInspectionsConducted),
        refundApprovalRatePercent: safeNumber(row?.refundApprovalRatePercent),
        averageTimeToConfirmBookingHours: safeNumber(row?.averageTimeToConfirmBookingHours),
        inspectionCompletionTimeHours: safeNumber(row?.inspectionCompletionTimeHours),
        driverAllocationSpeedHours: safeNumber(row?.driverAllocationSpeedHours),
      })),
    [adminPerformance],
  );

  const maxCustomerRevenue = useMemo(
    () =>
      customerInsightRows.reduce(
        (maxValue, row) => (row.totalRevenueGenerated > maxValue ? row.totalRevenueGenerated : maxValue),
        0,
      ),
    [customerInsightRows],
  );

  const maxAdminRevenueHandled = useMemo(
    () =>
      adminPerformanceRows.reduce(
        (maxValue, row) => (row.totalRevenueHandled > maxValue ? row.totalRevenueHandled : maxValue),
        0,
      ),
    [adminPerformanceRows],
  );

  const pickupHeatPoints = useMemo(
    () =>
      (Array.isArray(pickupHeatmap) ? pickupHeatmap : []).map((row, index) => ({
        key: `pickup-${index}-${safeNumber(row?.latitude)}-${safeNumber(row?.longitude)}`,
        latitude: safeNumber(row?.latitude),
        longitude: safeNumber(row?.longitude),
        value: safeNumber(row?.bookingCount),
        label: `Pickup Area ${index + 1}`,
        address: String(row?.sampleAddress || ''),
        meta: row,
      })),
    [pickupHeatmap],
  );

  const dropHeatPoints = useMemo(
    () =>
      (Array.isArray(dropHeatmap) ? dropHeatmap : []).map((row, index) => ({
        key: `drop-${index}-${safeNumber(row?.latitude)}-${safeNumber(row?.longitude)}`,
        latitude: safeNumber(row?.latitude),
        longitude: safeNumber(row?.longitude),
        value: safeNumber(row?.bookingCount),
        label: `Drop Area ${index + 1}`,
        address: String(row?.sampleAddress || ''),
        meta: row,
      })),
    [dropHeatmap],
  );

  const revenueAreaPoints = useMemo(
    () =>
      (Array.isArray(areaRevenueStats) ? areaRevenueStats : []).map((row, index) => ({
        key: `rev-${index}-${safeNumber(row?.latitude)}-${safeNumber(row?.longitude)}-${String(row?.branchId || '')}`,
        latitude: safeNumber(row?.latitude),
        longitude: safeNumber(row?.longitude),
        value: safeNumber(row?.totalRevenue),
        label: `${String(row?.branchName || 'Area')} Revenue`,
        address: String(row?.sampleAddress || ''),
        meta: row,
      })),
    [areaRevenueStats],
  );

  const overdueAreaPoints = useMemo(
    () =>
      (Array.isArray(areaOverdueStats) ? areaOverdueStats : []).map((row, index) => ({
        key: `late-${index}-${safeNumber(row?.latitude)}-${safeNumber(row?.longitude)}-${String(row?.branchId || '')}`,
        latitude: safeNumber(row?.latitude),
        longitude: safeNumber(row?.longitude),
        value: safeNumber(row?.overdueCount),
        label: `${String(row?.branchName || 'Area')} Overdue`,
        address: String(row?.sampleAddress || ''),
        meta: row,
      })),
    [areaOverdueStats],
  );

  const geoOverlayConfig = useMemo(() => {
    if (geoOverlayType === 'drop') {
      return {
        title: 'Drop Heatmap',
        subtitle: 'Booking drop-off density by clustered coordinates.',
        points: dropHeatPoints,
        pointColor: '#0EA5E9',
        valueLabel: 'Drop Count',
        valueFormatter: (value) => safeNumber(value),
      };
    }

    if (geoOverlayType === 'revenue') {
      return {
        title: 'Revenue Map',
        subtitle: 'Revenue concentration by pickup area clusters.',
        points: revenueAreaPoints,
        pointColor: '#16A34A',
        valueLabel: 'Revenue',
        valueFormatter: (value) => `${currency}${safeNumber(value)}`,
      };
    }

    if (geoOverlayType === 'overdue') {
      return {
        title: 'Overdue Density',
        subtitle: 'Overdue booking clusters based on pickup areas.',
        points: overdueAreaPoints,
        pointColor: '#DC2626',
        valueLabel: 'Overdue Count',
        valueFormatter: (value) => safeNumber(value),
      };
    }

    return {
      title: 'Pickup Heatmap',
      subtitle: 'Booking pickup density by clustered coordinates.',
      points: pickupHeatPoints,
      pointColor: '#2563EB',
      valueLabel: 'Pickup Count',
      valueFormatter: (value) => safeNumber(value),
    };
  }, [currency, dropHeatPoints, geoOverlayType, overdueAreaPoints, pickupHeatPoints, revenueAreaPoints]);

  const topDemandAreas = useMemo(
    () => (Array.isArray(geoStrategicInsights?.topHighDemandAreas) ? geoStrategicInsights.topHighDemandAreas : []),
    [geoStrategicInsights],
  );

  const topLateAreas = useMemo(
    () => (Array.isArray(geoStrategicInsights?.topHighLateAreas) ? geoStrategicInsights.topHighLateAreas : []),
    [geoStrategicInsights],
  );

  const peakHourByBranch = useMemo(
    () => (Array.isArray(geoStrategicInsights?.peakHourByBranch) ? geoStrategicInsights.peakHourByBranch : []),
    [geoStrategicInsights],
  );

  const predictiveForecastRows = useMemo(
    () =>
      (Array.isArray(demandForecast) ? demandForecast : []).map((row) => ({
        date: String(row?.date || ''),
        dayLabel: String(row?.dayLabel || ''),
        predictedBookings: safeNumber(row?.predictedBookings),
        predictedRevenue: safeNumber(row?.predictedRevenue),
        forecastMultiplier: safeNumber(row?.forecastMultiplier),
        highDemandDay: Boolean(row?.highDemandDay),
      })),
    [demandForecast],
  );

  const predictivePeakHourRows = useMemo(
    () =>
      (Array.isArray(predictedPeakHours) ? predictedPeakHours : []).map((row) => ({
        date: String(row?.date || ''),
        dayLabel: String(row?.dayLabel || ''),
        hours: Array.isArray(row?.hours) ? row.hours : [],
      })),
    [predictedPeakHours],
  );

  const predictiveVehicleDemandRows = useMemo(
    () =>
      (Array.isArray(vehicleDemandPrediction) ? vehicleDemandPrediction : []).map((row) => ({
        category: String(row?.category || 'Unknown'),
        predictedWeeklyBookings: safeNumber(row?.predictedWeeklyBookings),
        predictedWeeklyRevenue: safeNumber(row?.predictedWeeklyRevenue),
        predictedSharePercent: safeNumber(row?.predictedSharePercent),
      })),
    [vehicleDemandPrediction],
  );

  const predictiveTotals = useMemo(
    () => ({
      forecastBookings: predictiveForecastRows.reduce((sum, row) => sum + safeNumber(row.predictedBookings), 0),
      forecastRevenue: predictiveForecastRows.reduce((sum, row) => sum + safeNumber(row.predictedRevenue), 0),
      highDemandCount: (Array.isArray(highDemandDays) ? highDemandDays : []).length,
      fleetRiskCount: (Array.isArray(fleetRiskAlerts) ? fleetRiskAlerts : []).length,
    }),
    [fleetRiskAlerts, highDemandDays, predictiveForecastRows],
  );

  const predictiveHistoryWindowLabel = useMemo(() => {
    const fromDate = historicalDemand?.historyWindow?.fromDate;
    const toDate = historicalDemand?.historyWindow?.toDate;
    if (!fromDate || !toDate) return '';
    return `${toDateLabel(fromDate)} - ${toDateLabel(toDate)}`;
  }, [historicalDemand]);

  const applyCustomRange = () => {
    if (!customStartDate || !customEndDate) {
      setErrorMsg('Select both custom start date and end date.');
      return;
    }
    if (new Date(customStartDate).getTime() > new Date(customEndDate).getTime()) {
      setErrorMsg('Custom start date cannot be after end date.');
      return;
    }

    setErrorMsg('');
    loadAnalytics({
      rangeKey: 'custom',
      sortType,
      customerSortType,
      customStartDate,
      customEndDate,
      selectedBranchId,
    });
  };

  const onRangeChange = (nextRangeKey) => {
    setRangeKey(nextRangeKey);
    if (nextRangeKey === 'custom') return;
    setErrorMsg('');
    loadAnalytics({
      rangeKey: nextRangeKey,
      sortType,
      customerSortType,
      selectedBranchId,
    });
  };

  const onBranchChange = (nextBranchId) => {
    setSelectedBranchId(nextBranchId);
    loadAnalytics({
      rangeKey,
      sortType,
      customerSortType,
      selectedBranchId: nextBranchId,
      customStartDate,
      customEndDate,
    });
  };

  const onSortTypeChange = (nextSortType) => {
    setSortType(nextSortType);
    loadAnalytics({
      rangeKey,
      sortType: nextSortType,
      customerSortType,
      selectedBranchId,
      customStartDate,
      customEndDate,
    });
  };

  const onCustomerSortTypeChange = (nextSortType) => {
    setCustomerSortType(nextSortType);
    loadAnalytics({
      rangeKey,
      sortType,
      customerSortType: nextSortType,
      selectedBranchId,
      customStartDate,
      customEndDate,
    });
  };

  return (
    <div className="admin-section-page px-4 pt-6 pb-8 md:px-10 md:pt-10 md:pb-10 w-full">
      <Title
        title="Analytics Dashboard"
        subTitle="Centralized business intelligence view for revenue, rentals, fleet utilization, refunds, and maintenance."
      />

      {errorMsg ? <p className="mt-4 text-sm text-red-500">{errorMsg}</p> : null}

      <div className="mt-5 max-w-6xl rounded-2xl border border-borderColor bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            {RANGE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => onRangeChange(option.key)}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  rangeKey === option.key
                    ? 'border-primary bg-primary text-white'
                    : 'border-borderColor bg-white text-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <select
              value={sortType}
              onChange={(event) => onSortTypeChange(event.target.value)}
              className="rounded-lg border border-borderColor bg-white px-3 py-2 text-xs"
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={customerSortType}
              onChange={(event) => onCustomerSortTypeChange(event.target.value)}
              className="rounded-lg border border-borderColor bg-white px-3 py-2 text-xs"
            >
              {CUSTOMER_SORT_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              value={selectedBranchId}
              onChange={(event) => onBranchChange(event.target.value)}
              className="rounded-lg border border-borderColor bg-white px-3 py-2 text-xs"
            >
              <option value="">All Branches</option>
              {branches.map((branch) => (
                <option key={branch._id} value={branch._id}>
                  {branch.branchName}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {ANALYTICS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                activeTab === tab.key
                  ? 'border-primary bg-primary text-white'
                  : 'border-borderColor bg-white text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === 'geo' ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {GEO_OVERLAY_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  setGeoOverlayType(option.key);
                  setSelectedGeoPointKey('');
                }}
                className={`rounded-lg border px-3 py-2 text-xs font-medium ${
                  geoOverlayType === option.key
                    ? 'border-primary bg-primary text-white'
                    : 'border-borderColor bg-white text-gray-700'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}

        {rangeKey === 'custom' ? (
          <div className="mt-3 grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
            <input
              type="date"
              value={customStartDate}
              onChange={(event) => setCustomStartDate(event.target.value)}
              className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            />
            <input
              type="date"
              value={customEndDate}
              onChange={(event) => setCustomEndDate(event.target.value)}
              className="rounded-lg border border-borderColor bg-white px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={applyCustomRange}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              Apply Range
            </button>
          </div>
        ) : null}

        <p className="mt-3 text-xs text-gray-500">
          Range: {resolvedRange.label || 'N/A'} ({toDateLabel(resolvedRange.fromDate)} - {toDateLabel(resolvedRange.toDate)})
        </p>
        <p className="mt-1 text-xs text-gray-400">Timezone: {timezone}</p>
      </div>

      {loading ? (
        <div className="mt-6 rounded-xl border border-borderColor bg-white p-8 text-center text-sm text-gray-500">
          Loading analytics...
        </div>
      ) : (
        <>
          {activeTab === 'overview' ? (
            <>
              <div className="mt-6 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 max-w-6xl">
            {summaryCards.map((card) => (
              <div key={card.title} className={`rounded-xl border p-4 shadow-sm ${card.tone}`}>
                <p className="text-xs uppercase tracking-wide">{card.title}</p>
                <p className="mt-2 text-2xl font-semibold">{card.value}</p>
              </div>
            ))}
              </div>

          <div className="mt-6 grid grid-cols-1 xl:grid-cols-2 gap-5 max-w-6xl">
            {showFinancialSection ? (
              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800">Financial Breakdown</h3>
                <p className="text-sm text-gray-500">Revenue composition with late fees, damage recovery, and refund deduction.</p>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-lg bg-light px-3 py-2">
                    <span className="text-gray-600">Revenue (Base)</span>
                    <span className="font-semibold text-gray-800">
                      {currency}
                      {safeNumber(financialBreakdown?.baseRevenue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-light px-3 py-2">
                    <span className="text-gray-600">Late Fee Revenue</span>
                    <span className="font-semibold text-gray-800">
                      {currency}
                      {safeNumber(financialBreakdown?.lateFeeRevenue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-light px-3 py-2">
                    <span className="text-gray-600">Damage Revenue</span>
                    <span className="font-semibold text-gray-800">
                      {currency}
                      {safeNumber(financialBreakdown?.damageRevenue)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-lime-50 px-3 py-2">
                    <span className="text-lime-700">Dynamic Revenue Lift</span>
                    <span className="font-semibold text-lime-700">
                      +{currency}
                      {safeNumber(financialBreakdown?.dynamicRevenueContribution)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-fuchsia-50 px-3 py-2">
                    <span className="text-fuchsia-700">Avg Dynamic Adjustment</span>
                    <span className="font-semibold text-fuchsia-700">
                      {safeNumber(financialBreakdown?.priceAdjustmentImpact)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 rounded-lg bg-blue-50 px-3 py-2 text-xs">
                    <div>
                      <p className="text-blue-700">Dynamic Revenue</p>
                      <p className="font-semibold text-blue-800">
                        {currency}
                        {safeNumber(financialBreakdown?.dynamicVsManualRevenue?.dynamicRevenue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-blue-700">Manual Revenue</p>
                      <p className="font-semibold text-blue-800">
                        {currency}
                        {safeNumber(financialBreakdown?.dynamicVsManualRevenue?.manualRevenue)}
                      </p>
                    </div>
                    <div>
                      <p className="text-blue-700">Base Revenue</p>
                      <p className="font-semibold text-blue-800">
                        {currency}
                        {safeNumber(financialBreakdown?.dynamicVsManualRevenue?.baseRevenue)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-red-50 px-3 py-2">
                    <span className="text-red-700">Refund Deduction</span>
                    <span className="font-semibold text-red-700">
                      -{currency}
                      {safeNumber(financialBreakdown?.refundDeduction)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-2">
                    <span className="font-medium text-emerald-700">Net Revenue</span>
                    <span className="font-semibold text-emerald-700">
                      {currency}
                      {safeNumber(financialBreakdown?.netRevenue)}
                    </span>
                  </div>
                </div>
              </div>
            ) : null}

            {showFleetSection ? (
              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800">Fleet Metrics</h3>
                <p className="text-sm text-gray-500">Operational health based on current fleet state and rental load.</p>

                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between rounded-lg bg-light px-3 py-2">
                    <span className="text-gray-600">Total Bookings</span>
                    <span className="font-semibold text-gray-800">{safeNumber(summary.totalBookings)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-light px-3 py-2">
                    <span className="text-gray-600">Cancelled Bookings</span>
                    <span className="font-semibold text-gray-800">{safeNumber(summary.cancelledBookings)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-light px-3 py-2">
                    <span className="text-gray-600">Rented Vehicles</span>
                    <span className="font-semibold text-gray-800">{safeNumber(fleetMeta?.rentedVehicles)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-light px-3 py-2">
                    <span className="text-gray-600">Active Vehicles</span>
                    <span className="font-semibold text-gray-800">{safeNumber(fleetMeta?.activeVehicles)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-blue-50 px-3 py-2">
                    <span className="font-medium text-blue-700">Fleet Utilization</span>
                    <span className="font-semibold text-blue-700">
                      {safeNumber(summary.fleetUtilizationPercent)}%
                    </span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          {showFinancialSection ? (
            <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Revenue Trend</h3>
                  <p className="text-sm text-gray-500">
                    Daily and monthly revenue trend with base, late, damage, and refund impact.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 min-w-[240px]">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs">
                    <p className="text-emerald-700/80">Latest Month</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-800">{latestMonthlySnapshot.label}</p>
                  </div>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
                    <p className="text-blue-700/80">Monthly Revenue</p>
                    <p className="mt-1 text-sm font-semibold text-blue-800">
                      {currency}
                      {safeNumber(latestMonthlySnapshot.totalRevenue)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-xs">
                    <p className="text-violet-700/80">Monthly Bookings</p>
                    <p className="mt-1 text-sm font-semibold text-violet-800">
                      {safeNumber(latestMonthlySnapshot.bookingCount)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-gray-700">Daily Revenue (Net)</h4>
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                    <TrendLineChart
                      title="Daily Revenue"
                      data={dailyRevenueTrendData}
                      xKey="date"
                      xLabelFormatter={toShortDateLabel}
                      yValueFormatter={(value) => `${currency}${toCompactMetric(value)}`}
                      lines={[
                        { key: 'totalRevenue', label: 'Net Revenue', color: '#0EA5E9' },
                        { key: 'baseRevenue', label: 'Base Revenue', color: '#16A34A' },
                      ]}
                    />
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-700">Daily Revenue Mix</h4>
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                    <StackedBarTrendChart
                      title="Daily Revenue Mix"
                      data={dailyRevenueTrendData}
                      xKey="date"
                      xLabelFormatter={toShortDateLabel}
                      yValueFormatter={(value) => `${currency}${toCompactMetric(value)}`}
                      bars={[
                        { key: 'baseRevenue', label: 'Base', color: '#1D4ED8' },
                        { key: 'lateFeeRevenue', label: 'Late Fee', color: '#D97706' },
                        { key: 'damageRevenue', label: 'Damage', color: '#DC2626' },
                      ]}
                    />
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-semibold text-gray-700">Monthly Revenue (Last 12 Months)</h4>
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                    <TrendLineChart
                      title="Monthly Revenue"
                      data={monthlyRevenueTrendData}
                      xKey="label"
                      xLabelFormatter={(value) => String(value || 'N/A')}
                      yValueFormatter={(value) => `${currency}${toCompactMetric(value)}`}
                      lines={[
                        { key: 'totalRevenue', label: 'Total Revenue', color: '#2563EB' },
                        { key: 'lateFeeRevenue', label: 'Late Fee', color: '#F59E0B' },
                      ]}
                    />
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {showFleetSection ? (
            <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Late Trend</h3>
                  <p className="text-sm text-gray-500">
                    Overdue volume, late fee trend, and delay behavior for completed rentals.
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs">
                    <p className="text-blue-700/80">Avg Late Hours</p>
                    <p className="mt-1 text-sm font-semibold text-blue-800">{lateSummary.averageLateHours}h</p>
                  </div>
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                    <p className="text-amber-700/80">Overdue %</p>
                    <p className="mt-1 text-sm font-semibold text-amber-800">{lateSummary.overduePercentage}%</p>
                  </div>
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs">
                    <p className="text-red-700/80">Overdue Rentals</p>
                    <p className="mt-1 text-sm font-semibold text-red-800">{lateSummary.overdueCount}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-slate-100 px-3 py-2 text-xs">
                    <p className="text-slate-700/80">Completed Rentals</p>
                    <p className="mt-1 text-sm font-semibold text-slate-800">{lateSummary.completedCount}</p>
                  </div>
                </div>
              </div>

              <div className="mt-5 space-y-6">
                <div>
                  <h4 className="text-sm font-semibold text-gray-700">Daily Overdue Count</h4>
                  <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                    <TrendLineChart
                      title="Daily Overdue Count"
                      data={dailyLateTrendData}
                      xKey="date"
                      xLabelFormatter={toShortDateLabel}
                      yValueFormatter={toCompactMetric}
                      lines={[
                        { key: 'overdueCount', label: 'Overdue Bookings', color: '#DC2626' },
                        { key: 'completedCount', label: 'Completed Bookings', color: '#16A34A' },
                      ]}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700">Daily Late Fee Trend</h4>
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                      <BarTrendChart
                        title="Late Fee Trend"
                        data={dailyLateTrendData}
                        barKey="totalLateFee"
                        barLabel="Late Fee"
                        barColor="#B45309"
                        xKey="date"
                        xLabelFormatter={toShortDateLabel}
                        yValueFormatter={(value) => `${currency}${toCompactMetric(value)}`}
                      />
                    </div>
                  </div>

                  <div>
                    <h4 className="text-sm font-semibold text-gray-700">Daily Overdue Percentage</h4>
                    <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                      <TrendLineChart
                        title="Overdue Percentage Trend"
                        data={overduePercentageTrendData}
                        xKey="date"
                        xLabelFormatter={toShortDateLabel}
                        yValueFormatter={(value) => `${safeNumber(value)}%`}
                        lines={[{ key: 'overduePercentage', label: 'Overdue %', color: '#7C3AED' }]}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {(showFleetSection || showFinancialSection) ? (
            <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-800">Top Performers</h3>
              <p className="text-sm text-gray-500">Top and bottom vehicle cohorts based on bookings, revenue, utilization, and maintenance load.</p>

              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {topPerformerSections.map((section) => (
                  <div key={section.key} className={`rounded-xl border p-4 ${section.tone}`}>
                    <h4 className="text-sm font-semibold text-gray-800">{section.title}</h4>
                    <ul className="mt-3 space-y-2 text-xs">
                      {section.rows.length ? (
                        section.rows.slice(0, 5).map((row, index) => (
                          <li key={`${section.key}-${row?.carId || row?.carName || index}`} className="rounded-lg bg-white/70 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-gray-700 truncate">
                                {index + 1}. {String(row?.carName || 'Unknown Car')}
                              </span>
                              <span className="font-semibold text-gray-800">
                                {section.valueFormatter(row)}
                              </span>
                            </div>
                          </li>
                        ))
                      ) : (
                        <li className="rounded-lg bg-white/70 px-3 py-2 text-gray-500">No data available</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {showFleetSection ? (
            <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800">Fleet Performance Panel</h3>
                  <p className="text-sm text-gray-500">
                    Per-car utilization intelligence, trip productivity, and most rented ranking in the selected window.
                  </p>
                </div>
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  Sort: {sortType === 'revenue' ? 'Highest Revenue' : 'Most Bookings'}
                </div>
              </div>

              <div className="mt-4 overflow-x-auto rounded-xl border border-borderColor">
                <table className="min-w-[980px] w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                      <th className="px-3 py-3">Rank</th>
                      <th className="px-3 py-3">Car</th>
                      <th className="px-3 py-3">Bookings</th>
                      <th className="px-3 py-3">Revenue</th>
                      <th className="px-3 py-3">Late Fee</th>
                      <th className="px-3 py-3">Damage</th>
                      <th className="px-3 py-3">Rental Hours</th>
                      <th className="px-3 py-3">Avg Duration</th>
                      <th className="px-3 py-3">Overdue Rate</th>
                      <th className="px-3 py-3">Utilization</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankedMostRentedCars.length ? (
                      rankedMostRentedCars.map((row) => (
                        <tr key={row.carId || `${row.rank}-${row.carName}`} className="border-t border-borderColor align-top">
                          <td className="px-3 py-3 font-semibold text-gray-700">#{row.rank}</td>
                          <td className="px-3 py-3">
                            <p className="font-semibold text-gray-800">{row.carName}</p>
                            <p className="text-xs text-gray-500">{row.brand} {row.model}</p>
                          </td>
                          <td className="px-3 py-3 text-gray-700">{row.totalBookings}</td>
                          <td className="px-3 py-3">
                            <p className="font-medium text-gray-800">{currency}{row.totalRevenueGenerated}</p>
                            <div className="mt-1 w-24 rounded-full bg-slate-200 h-1.5 overflow-hidden">
                              <div
                                className="h-1.5 rounded-full bg-emerald-600"
                                style={{
                                  width: `${maxMostRentedRevenue > 0
                                    ? Math.min((safeNumber(row.totalRevenueGenerated) / maxMostRentedRevenue) * 100, 100)
                                    : 0}%`,
                                }}
                              />
                            </div>
                          </td>
                          <td className="px-3 py-3 text-amber-700">{currency}{row.totalLateFeeGenerated}</td>
                          <td className="px-3 py-3 text-rose-700">{currency}{row.totalDamageCostCollected}</td>
                          <td className="px-3 py-3 text-gray-700">{formatHours(row.totalRentalHours)}</td>
                          <td className="px-3 py-3 text-gray-700">{formatHours(row.averageRentalDurationHours)}</td>
                          <td className="px-3 py-3 text-gray-700">{row.overdueRatePercent}%</td>
                          <td className="px-3 py-3">
                            <div className="w-28 rounded-full bg-slate-200 h-2 overflow-hidden">
                              <div
                                className="h-2 bg-blue-600 rounded-full"
                                style={{ width: `${Math.min(Math.max(row.utilizationPercent, 0), 100)}%` }}
                              />
                            </div>
                            <p className="mt-1 text-xs text-gray-600">{row.utilizationPercent}%</p>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={10} className="px-3 py-8 text-center text-sm text-gray-500">
                          No rented car analytics available in this range.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="mt-5">
                <h4 className="text-sm font-semibold text-gray-700">Utilization Intelligence</h4>
                <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {utilizationRows.slice(0, 10).map((row) => (
                    <div key={`util-${row.carId || row.rank}`} className="rounded-xl border border-borderColor p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-gray-800">{row.carName}</p>
                        <span className="text-xs text-gray-500">{row.branchName}</span>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
                        <span>Utilization {row.utilizationPercent}%</span>
                        <span>Idle {row.idleTimePercent}%</span>
                      </div>
                      <div className="mt-1 h-2 rounded-full bg-slate-200 overflow-hidden">
                        <div
                          className="h-2 rounded-full bg-emerald-600"
                          style={{ width: `${Math.min(Math.max(row.utilizationPercent, 0), 100)}%` }}
                        />
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-600">
                        <p>Trips: <span className="font-medium text-gray-800">{row.totalTripsCompleted}</span></p>
                        <p>Bookings: <span className="font-medium text-gray-800">{row.totalBookings}</span></p>
                        <p>Rev/Trip: <span className="font-medium text-gray-800">{currency}{row.revenuePerTrip}</span></p>
                        <p>Rev/Hour: <span className="font-medium text-gray-800">{currency}{row.revenuePerRentalHour}</span></p>
                      </div>
                    </div>
                  ))}
                  {!utilizationRows.length ? (
                    <div className="rounded-xl border border-dashed border-slate-300 p-6 text-sm text-gray-500">
                      No utilization records found for selected filters.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

              {roleView.role === 'SuperAdmin' ? (
                <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-800">Branch Comparison</h3>
              <p className="text-sm text-gray-500">
                SuperAdmin view of branch revenue, average utilization, late rate, and booking growth.
              </p>

              <div className="mt-4 overflow-x-auto rounded-xl border border-borderColor">
                <table className="min-w-[760px] w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                      <th className="px-3 py-3">Branch</th>
                      <th className="px-3 py-3">Revenue</th>
                      <th className="px-3 py-3">Avg Utilization</th>
                      <th className="px-3 py-3">Avg Late Rate</th>
                      <th className="px-3 py-3">Current Bookings</th>
                      <th className="px-3 py-3">Previous Bookings</th>
                      <th className="px-3 py-3">Growth</th>
                    </tr>
                  </thead>
                  <tbody>
                    {branchComparisonRows.length ? (
                      branchComparisonRows.map((row) => (
                        <tr key={row.branchId || row.branchName} className="border-t border-borderColor">
                          <td className="px-3 py-3">
                            <p className="font-semibold text-gray-800">{row.branchName}</p>
                            <p className="text-xs text-gray-500">{row.branchCode || 'N/A'}</p>
                          </td>
                          <td className="px-3 py-3 font-medium text-gray-800">{currency}{row.totalRevenue}</td>
                          <td className="px-3 py-3 text-gray-700">{row.averageUtilizationPercent}%</td>
                          <td className="px-3 py-3 text-gray-700">{row.averageLateRatePercent}%</td>
                          <td className="px-3 py-3 text-gray-700">{row.currentBookings}</td>
                          <td className="px-3 py-3 text-gray-700">{row.previousBookings}</td>
                          <td className={`px-3 py-3 font-semibold ${row.bookingGrowthPercent >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {row.bookingGrowthPercent}%
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500">
                          Branch comparison is not available for the selected filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                </div>
              ) : null}
            </>
          ) : null}

          {activeTab === 'predictive' ? (
            <div className="mt-6 max-w-6xl space-y-5">
              {(showFleetSection || showFinancialSection) ? (
                <>
                  <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                    <h3 className="text-lg font-semibold text-gray-800">Predictive Intelligence</h3>
                    <p className="text-sm text-gray-500">
                      Rule-based demand forecast for next 7 days using weekday baseline, seasonality, and branch trend factors.
                    </p>
                    {predictiveHistoryWindowLabel ? (
                      <p className="mt-1 text-xs text-gray-400">Historical window: {predictiveHistoryWindowLabel}</p>
                    ) : null}

                    <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                      <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                        <p className="text-xs text-blue-700/80">Forecast Bookings (7d)</p>
                        <p className="mt-1 text-xl font-semibold text-blue-800">{safeNumber(predictiveTotals.forecastBookings)}</p>
                      </div>
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                        <p className="text-xs text-emerald-700/80">Forecast Revenue (7d)</p>
                        <p className="mt-1 text-xl font-semibold text-emerald-800">
                          {currency}{safeNumber(predictiveTotals.forecastRevenue)}
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs text-amber-700/80">High Demand Days</p>
                        <p className="mt-1 text-xl font-semibold text-amber-800">{safeNumber(predictiveTotals.highDemandCount)}</p>
                      </div>
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                        <p className="text-xs text-rose-700/80">Fleet Risk Alerts</p>
                        <p className="mt-1 text-xl font-semibold text-rose-800">{safeNumber(predictiveTotals.fleetRiskCount)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700">Forecast Trend (Next 7 Days)</h4>
                    <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-5">
                      <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                        <TrendLineChart
                          title="Predicted Bookings"
                          data={predictiveForecastRows}
                          xKey="date"
                          xLabelFormatter={toShortDateLabel}
                          yValueFormatter={toCompactMetric}
                          lines={[{ key: 'predictedBookings', label: 'Predicted Bookings', color: '#2563EB' }]}
                        />
                      </div>
                      <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3">
                        <BarTrendChart
                          title="Predicted Revenue"
                          data={predictiveForecastRows}
                          barKey="predictedRevenue"
                          barLabel="Predicted Revenue"
                          barColor="#059669"
                          xKey="date"
                          xLabelFormatter={toShortDateLabel}
                          yValueFormatter={(value) => `${currency}${toCompactMetric(value)}`}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                    <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                      <h4 className="text-sm font-semibold text-gray-700">High Demand Warnings</h4>
                      <div className="mt-3 space-y-2">
                        {highDemandDays.length ? (
                          highDemandDays.map((row) => (
                            <div key={`high-demand-${row?.date}`} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                              <p className="font-medium text-amber-800">{String(row?.dayLabel || 'Day')} ({String(row?.date || 'N/A')})</p>
                              <p className="text-amber-700">
                                Forecast: {safeNumber(row?.predictedBookings)} bookings
                                (threshold {safeNumber(row?.threshold)})
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-gray-500">
                            No high-demand day detected for this forecast cycle.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                      <h4 className="text-sm font-semibold text-gray-700">Fleet Shortage Risk</h4>
                      <div className="mt-3 space-y-2">
                        {fleetRiskAlerts.length ? (
                          fleetRiskAlerts.slice(0, 8).map((alert, index) => (
                            <div key={`fleet-risk-${alert?.date}-${alert?.branchId || index}`} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs">
                              <p className="font-medium text-rose-800">
                                {String(alert?.branchName || 'All Branches')} - {String(alert?.date || 'N/A')}
                              </p>
                              <p className="text-rose-700">
                                Forecast {safeNumber(alert?.predictedBookings)} vs available {safeNumber(alert?.availableFleet)}
                                (shortage {safeNumber(alert?.shortageCount)})
                              </p>
                            </div>
                          ))
                        ) : (
                          <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-gray-500">
                            No fleet shortage risk detected from current forecast.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700">Predicted Peak Hours</h4>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                      {predictivePeakHourRows.length ? (
                        predictivePeakHourRows.map((row) => (
                          <div key={`peak-hour-${row.date}`} className="rounded-xl border border-borderColor p-3">
                            <p className="font-medium text-gray-800">{row.dayLabel} ({toShortDateLabel(row.date)})</p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {(Array.isArray(row.hours) ? row.hours : []).length ? (
                                row.hours.map((hourEntry, hourIndex) => (
                                  <span key={`hour-${row.date}-${hourIndex}`} className="rounded-full bg-blue-100 px-2 py-1 text-xs text-blue-700">
                                    {String(hourEntry?.hourLabel || 'N/A')} ({safeNumber(hourEntry?.sharePercent)}%)
                                  </span>
                                ))
                              ) : (
                                <span className="text-xs text-gray-500">No peak-hour signal</span>
                              )}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-3 text-sm text-gray-500">
                          Peak hour forecast is unavailable for selected filters.
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                    <h4 className="text-sm font-semibold text-gray-700">Vehicle Demand Forecast</h4>
                    <div className="mt-3 overflow-x-auto rounded-xl border border-borderColor">
                      <table className="min-w-[620px] w-full text-sm">
                        <thead className="bg-slate-100">
                          <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                            <th className="px-3 py-3">Category</th>
                            <th className="px-3 py-3">Predicted Weekly Bookings</th>
                            <th className="px-3 py-3">Predicted Weekly Revenue</th>
                            <th className="px-3 py-3">Demand Share</th>
                          </tr>
                        </thead>
                        <tbody>
                          {predictiveVehicleDemandRows.length ? (
                            predictiveVehicleDemandRows.map((row) => (
                              <tr key={`vehicle-forecast-${row.category}`} className="border-t border-borderColor">
                                <td className="px-3 py-3 text-gray-800 font-medium">{row.category}</td>
                                <td className="px-3 py-3 text-gray-700">{row.predictedWeeklyBookings}</td>
                                <td className="px-3 py-3 text-gray-700">{currency}{row.predictedWeeklyRevenue}</td>
                                <td className="px-3 py-3 text-gray-700">{row.predictedSharePercent}%</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={4} className="px-3 py-8 text-center text-sm text-gray-500">
                                No vehicle demand prediction available for selected filters.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    <div className="mt-4 grid grid-cols-1 xl:grid-cols-2 gap-4">
                      <div className="rounded-xl border border-slate-200 p-4">
                        <h5 className="text-sm font-semibold text-gray-700">Recommended Actions</h5>
                        <ul className="mt-2 space-y-2 text-xs">
                          {Array.isArray(predictiveInsights?.recommendedActions) && predictiveInsights.recommendedActions.length ? (
                            predictiveInsights.recommendedActions.map((item, index) => (
                              <li key={`predictive-action-${index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-gray-700">
                                {String(item?.message || '')}
                              </li>
                            ))
                          ) : (
                            <li className="rounded-lg bg-slate-50 px-3 py-2 text-gray-500">No recommendation available.</li>
                          )}
                        </ul>
                      </div>
                      <div className="rounded-xl border border-slate-200 p-4">
                        <h5 className="text-sm font-semibold text-gray-700">Underutilized Vehicles</h5>
                        <ul className="mt-2 space-y-2 text-xs">
                          {Array.isArray(predictiveInsights?.underutilizedVehicles) && predictiveInsights.underutilizedVehicles.length ? (
                            predictiveInsights.underutilizedVehicles.slice(0, 8).map((car, index) => (
                              <li key={`underutilized-${car?.carId || index}`} className="rounded-lg bg-slate-50 px-3 py-2 text-gray-700">
                                {String(car?.carName || 'Unknown Car')} ({safeNumber(car?.recentBookingCount)} bookings, {String(car?.branchName || 'Unassigned')})
                              </li>
                            ))
                          ) : (
                            <li className="rounded-lg bg-slate-50 px-3 py-2 text-gray-500">No underutilized vehicle signal.</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-borderColor bg-white p-6 text-sm text-gray-500 shadow-sm">
                  Predictive intelligence data is not available for your current role permissions.
                </div>
              )}
            </div>
          ) : null}

          {activeTab === 'customer' ? (
            <div className="mt-6 max-w-6xl space-y-5">
              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800">Customer Intelligence Panel</h3>
                <p className="text-sm text-gray-500">
                  Behavioral customer analytics with segmentation, repeat trends, and risk indicators.
                </p>

                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <p className="text-xs text-blue-700/80">Active Customers</p>
                    <p className="mt-1 text-xl font-semibold text-blue-800">{safeNumber(repeatMetrics?.activeCustomers)}</p>
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
                    <p className="text-xs text-emerald-700/80">Repeat Booking Rate</p>
                    <p className="mt-1 text-xl font-semibold text-emerald-800">{safeNumber(repeatMetrics?.repeatBookingRatePercent)}%</p>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
                    <p className="text-xs text-amber-700/80">Retention Rate</p>
                    <p className="mt-1 text-xl font-semibold text-amber-800">{safeNumber(repeatMetrics?.retentionRatePercent)}%</p>
                  </div>
                  <div className="rounded-xl border border-violet-200 bg-violet-50 p-3">
                    <p className="text-xs text-violet-700/80">Avg Gap Between Bookings</p>
                    <p className="mt-1 text-xl font-semibold text-violet-800">{toHourDurationLabel(repeatMetrics?.averageTimeBetweenBookingsHours)}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700">Customer Segments</h4>
                <div className="mt-3 space-y-3">
                  {customerSegmentDistribution.length ? (
                    customerSegmentDistribution.map((segment) => (
                      <div key={segment.key} className="rounded-lg border border-borderColor p-3">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <p className="font-medium text-gray-800">{segment.label}</p>
                          <p className="text-gray-600">
                            {segment.count} ({segment.sharePercent}%)
                          </p>
                        </div>
                        <div className="mt-2 h-2 rounded-full bg-slate-200 overflow-hidden">
                          <div
                            className="h-2 rounded-full bg-primary"
                            style={{ width: `${Math.min(Math.max(segment.sharePercent, 0), 100)}%` }}
                          />
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-gray-500">
                      Segment distribution is not available for selected filters.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700">Ranked Customers</h4>
                <p className="text-xs text-gray-500">Sort: {CUSTOMER_SORT_OPTIONS.find((option) => option.key === customerSortType)?.label || 'Highest Revenue'}</p>

                <div className="mt-3 overflow-x-auto rounded-xl border border-borderColor">
                  <table className="min-w-[1180px] w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                        <th className="px-3 py-3">Rank</th>
                        <th className="px-3 py-3">Customer</th>
                        <th className="px-3 py-3">Bookings</th>
                        <th className="px-3 py-3">Revenue</th>
                        <th className="px-3 py-3">Late Hours</th>
                        <th className="px-3 py-3">Late Fees</th>
                        <th className="px-3 py-3">Refunds</th>
                        <th className="px-3 py-3">Cancellation</th>
                        <th className="px-3 py-3">Overdue Freq</th>
                        <th className="px-3 py-3">Avg Duration</th>
                        <th className="px-3 py-3">LTV</th>
                        <th className="px-3 py-3">Late Risk</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerInsightRows.length ? (
                        customerInsightRows.map((row) => (
                          <tr key={row.customerId || `${row.rank}-${row.customerName}`} className="border-t border-borderColor align-top">
                            <td className="px-3 py-3 font-semibold text-gray-700">#{row.rank}</td>
                            <td className="px-3 py-3">
                              <p className="font-semibold text-gray-800">{row.customerName}</p>
                              <p className="text-xs text-gray-500">{row.email || 'N/A'}</p>
                            </td>
                            <td className="px-3 py-3 text-gray-700">{row.totalBookings}</td>
                            <td className="px-3 py-3">
                              <p className="font-medium text-gray-800">{currency}{row.totalRevenueGenerated}</p>
                              <div className="mt-1 w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                <div
                                  className="h-1.5 rounded-full bg-emerald-600"
                                  style={{
                                    width: `${maxCustomerRevenue > 0
                                      ? Math.min((safeNumber(row.totalRevenueGenerated) / maxCustomerRevenue) * 100, 100)
                                      : 0}%`,
                                  }}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-3 text-gray-700">{row.totalLateHours}</td>
                            <td className="px-3 py-3 text-amber-700">{currency}{row.totalLateFees}</td>
                            <td className="px-3 py-3 text-blue-700">{currency}{row.totalRefundsReceived}</td>
                            <td className="px-3 py-3 text-gray-700">{row.cancellationRatePercent}%</td>
                            <td className="px-3 py-3 text-gray-700">{row.overdueFrequencyPercent}%</td>
                            <td className="px-3 py-3 text-gray-700">{toHourDurationLabel(row.averageRentalDurationHours)}</td>
                            <td className="px-3 py-3 font-medium text-gray-800">{currency}{row.lifetimeValue}</td>
                            <td className="px-3 py-3">
                              <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                                row.lateRiskScore >= 60
                                  ? 'bg-red-100 text-red-700'
                                  : row.lateRiskScore >= 35
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-emerald-100 text-emerald-700'
                              }`}>
                                {row.lateRiskScore}
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={12} className="px-3 py-8 text-center text-sm text-gray-500">
                            No customer behavior records available for selected filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'admin' ? (
            <div className="mt-6 max-w-6xl space-y-5">
              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800">Admin Performance Panel</h3>
                <p className="text-sm text-gray-500">
                  Operational performance by staff for booking handling, refunds, inspections, maintenance, and dispatch efficiency.
                </p>
              </div>

              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700">Performance Comparison</h4>
                <div className="mt-3 overflow-x-auto rounded-xl border border-borderColor">
                  <table className="min-w-[1320px] w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                        <th className="px-3 py-3">Admin</th>
                        <th className="px-3 py-3">Role</th>
                        <th className="px-3 py-3">Bookings Managed</th>
                        <th className="px-3 py-3">Revenue Handled</th>
                        <th className="px-3 py-3">Refunds</th>
                        <th className="px-3 py-3">Refund Approval</th>
                        <th className="px-3 py-3">Booking Processing</th>
                        <th className="px-3 py-3">Confirm Time</th>
                        <th className="px-3 py-3">Inspection Completion</th>
                        <th className="px-3 py-3">Driver Allocation</th>
                        <th className="px-3 py-3">Driver Assignments</th>
                        <th className="px-3 py-3">Maintenance Added</th>
                        <th className="px-3 py-3">Damage Inspections</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminPerformanceRows.length ? (
                        adminPerformanceRows.map((row) => (
                          <tr key={row.adminId || `${row.rank}-${row.adminName}`} className="border-t border-borderColor align-top">
                            <td className="px-3 py-3">
                              <p className="font-semibold text-gray-800">{row.adminName}</p>
                              <p className="text-xs text-gray-500">{row.email || 'N/A'}</p>
                            </td>
                            <td className="px-3 py-3 text-gray-700">{row.role}</td>
                            <td className="px-3 py-3 text-gray-700">{row.totalBookingsManaged}</td>
                            <td className="px-3 py-3">
                              <p className="font-medium text-gray-800">{currency}{row.totalRevenueHandled}</p>
                              <div className="mt-1 w-24 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                <div
                                  className="h-1.5 rounded-full bg-blue-600"
                                  style={{
                                    width: `${maxAdminRevenueHandled > 0
                                      ? Math.min((safeNumber(row.totalRevenueHandled) / maxAdminRevenueHandled) * 100, 100)
                                      : 0}%`,
                                  }}
                                />
                              </div>
                            </td>
                            <td className="px-3 py-3 text-amber-700">{row.totalRefundsProcessed}</td>
                            <td className="px-3 py-3">
                              <span className={`rounded-full px-2 py-1 text-xs font-medium ${
                                row.refundApprovalRatePercent >= 80
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : row.refundApprovalRatePercent >= 50
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-rose-100 text-rose-700'
                              }`}>
                                {row.refundApprovalRatePercent}%
                              </span>
                            </td>
                            <td className="px-3 py-3 text-gray-700">{toHourDurationLabel(row.averageBookingProcessingTimeHours)}</td>
                            <td className="px-3 py-3 text-gray-700">{toHourDurationLabel(row.averageTimeToConfirmBookingHours)}</td>
                            <td className="px-3 py-3 text-gray-700">{toHourDurationLabel(row.inspectionCompletionTimeHours)}</td>
                            <td className="px-3 py-3 text-gray-700">{toHourDurationLabel(row.driverAllocationSpeedHours)}</td>
                            <td className="px-3 py-3 text-gray-700">{row.numberOfDriverAssignments}</td>
                            <td className="px-3 py-3 text-gray-700">{row.numberOfMaintenanceRecordsAdded}</td>
                            <td className="px-3 py-3 text-gray-700">{row.damageInspectionsConducted}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={13} className="px-3 py-8 text-center text-sm text-gray-500">
                            No admin performance records available for selected filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === 'geo' ? (
            <div className="mt-6 max-w-6xl space-y-5">
              <GeoHeatmapMap
                title={geoOverlayConfig.title}
                subtitle={geoOverlayConfig.subtitle}
                points={geoOverlayConfig.points}
                pointColor={geoOverlayConfig.pointColor}
                valueLabel={geoOverlayConfig.valueLabel}
                valueFormatter={geoOverlayConfig.valueFormatter}
                selectedPointKey={selectedGeoPointKey}
                onSelectPoint={(point) => {
                  setSelectedGeoPointKey((prev) => (prev === point?.key ? '' : String(point?.key || '')));
                }}
              />

              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-800">Strategic Geographic Insights</h3>
                <p className="text-sm text-gray-500">
                  High-demand clusters, high-late zones, most profitable area, and peak hour behavior.
                </p>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4">
                    <h4 className="text-sm font-semibold text-blue-800">Top 3 High Demand Areas</h4>
                    <ul className="mt-2 space-y-2 text-xs">
                      {topDemandAreas.length ? (
                        topDemandAreas.slice(0, 3).map((area, index) => (
                          <li key={`demand-${index}`} className="rounded-lg bg-white/80 px-3 py-2">
                            <p className="font-medium text-gray-800">
                              {safeNumber(area?.latitude).toFixed(3)}, {safeNumber(area?.longitude).toFixed(3)}
                            </p>
                            <p className="text-gray-600">
                              Bookings: {safeNumber(area?.bookingCount)} | Revenue: {currency}{safeNumber(area?.totalRevenue)}
                            </p>
                          </li>
                        ))
                      ) : (
                        <li className="rounded-lg bg-white/80 px-3 py-2 text-gray-500">No demand area data</li>
                      )}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-red-200 bg-red-50/70 p-4">
                    <h4 className="text-sm font-semibold text-red-800">Top 3 High Late Areas</h4>
                    <ul className="mt-2 space-y-2 text-xs">
                      {topLateAreas.length ? (
                        topLateAreas.slice(0, 3).map((area, index) => (
                          <li key={`late-${index}`} className="rounded-lg bg-white/80 px-3 py-2">
                            <p className="font-medium text-gray-800">
                              {safeNumber(area?.latitude).toFixed(3)}, {safeNumber(area?.longitude).toFixed(3)}
                            </p>
                            <p className="text-gray-600">
                              Overdue: {safeNumber(area?.overdueCount)} ({safeNumber(area?.overdueRatePercent)}%) | Late Hrs: {safeNumber(area?.totalLateHours)}
                            </p>
                          </li>
                        ))
                      ) : (
                        <li className="rounded-lg bg-white/80 px-3 py-2 text-gray-500">No late area data</li>
                      )}
                    </ul>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                    <h4 className="text-sm font-semibold text-emerald-800">Most Profitable Area</h4>
                    {geoStrategicInsights?.mostProfitableArea ? (
                      <div className="mt-2 rounded-lg bg-white/80 px-3 py-3 text-xs">
                        <p className="font-medium text-gray-800">
                          {safeNumber(geoStrategicInsights.mostProfitableArea?.latitude).toFixed(3)}, {safeNumber(geoStrategicInsights.mostProfitableArea?.longitude).toFixed(3)}
                        </p>
                        <p className="text-gray-600">
                          Revenue: {currency}{safeNumber(geoStrategicInsights.mostProfitableArea?.totalRevenue)}
                        </p>
                        <p className="text-gray-600">
                          Bookings: {safeNumber(geoStrategicInsights.mostProfitableArea?.bookingCount)}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-gray-500">No profitable area available</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-4">
                    <h4 className="text-sm font-semibold text-violet-800">Peak Hour per Branch</h4>
                    <ul className="mt-2 space-y-2 text-xs">
                      {peakHourByBranch.length ? (
                        peakHourByBranch.slice(0, 8).map((entry, index) => (
                          <li key={`branch-peak-${index}`} className="rounded-lg bg-white/80 px-3 py-2">
                            <p className="font-medium text-gray-800">
                              {String(entry?.branchName || 'Unassigned')}
                            </p>
                            <p className="text-gray-600">
                              Peak: {String(entry?.peakHourLabel || 'N/A')} | Bookings: {safeNumber(entry?.bookingCount)}
                            </p>
                          </li>
                        ))
                      ) : (
                        <li className="rounded-lg bg-white/80 px-3 py-2 text-gray-500">No branch peak-hour data</li>
                      )}
                    </ul>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-borderColor bg-white p-5 shadow-sm">
                <h4 className="text-sm font-semibold text-gray-700">Peak Time by Area</h4>
                <div className="mt-3 overflow-x-auto rounded-xl border border-borderColor">
                  <table className="min-w-[980px] w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr className="text-left text-xs uppercase tracking-wide text-slate-600">
                        <th className="px-3 py-3">Area</th>
                        <th className="px-3 py-3">Branch</th>
                        <th className="px-3 py-3">Peak Hour</th>
                        <th className="px-3 py-3">Peak Day</th>
                        <th className="px-3 py-3">Peak Hour Bookings</th>
                        <th className="px-3 py-3">Revenue</th>
                        <th className="px-3 py-3">Overdue Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {peakTimeByArea.length ? (
                        peakTimeByArea.slice(0, 20).map((area, index) => (
                          <tr key={`peak-area-${index}`} className="border-t border-borderColor">
                            <td className="px-3 py-3 text-gray-700">
                              {safeNumber(area?.latitude).toFixed(3)}, {safeNumber(area?.longitude).toFixed(3)}
                            </td>
                            <td className="px-3 py-3 text-gray-700">{String(area?.branchName || 'Unassigned')}</td>
                            <td className="px-3 py-3 text-gray-700">{String(area?.peakHourLabel || 'N/A')}</td>
                            <td className="px-3 py-3 text-gray-700">{String(area?.peakDayLabel || 'N/A')}</td>
                            <td className="px-3 py-3 text-gray-700">{safeNumber(area?.peakHourBookingCount)}</td>
                            <td className="px-3 py-3 text-gray-700">{currency}{safeNumber(area?.totalRevenue)}</td>
                            <td className="px-3 py-3 text-gray-700">{safeNumber(area?.overdueRatePercent)}%</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={7} className="px-3 py-8 text-center text-sm text-gray-500">
                            No geographic peak-time data available for selected filters.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
};

export default AnalyticsDashboard;
