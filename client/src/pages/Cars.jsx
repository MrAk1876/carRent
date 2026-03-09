import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assets } from '../assets/assets';
import CarCard from '../components/CarCard';
import LocationSelector from '../components/LocationSelector';
import ScrollReveal from '../components/ui/ScrollReveal';
import SkeletonCard from '../components/ui/SkeletonCard';
import { getUser } from '../utils/auth';
import { getCarFilterOptions, getLocationAwareCars } from '../services/carService';
import {
  buildLocationSelectionPayload,
  findLocationOption,
  loadSavedLocationSelection,
  saveLocationSelection,
} from '../services/locationSelectionService';

const SORT_OPTIONS = [
  { label: 'Recommended', value: 'recommended' },
  { label: 'Price: Low to High', value: 'price_asc' },
  { label: 'Price: High to Low', value: 'price_desc' },
  { label: 'Newest', value: 'newest' },
  { label: 'Name: A to Z', value: 'name_asc' },
];
const CARS_PER_PAGE = 9;

const normalize = (value) => String(value || '').toLowerCase().trim();
const normalizeText = (value) => String(value || '').trim();
const resolveFleetStatus = (car) => {
  const normalized = String(car?.fleetStatus || '').trim();
  if (normalized) return normalized;
  return car?.isAvailable ? 'Available' : 'Inactive';
};
const getBranch = (car) => (car?.branchId && typeof car.branchId === 'object' ? car.branchId : null);
const getLocation = (car) => (car?.locationId && typeof car.locationId === 'object' ? car.locationId : null);
const getCarStateId = (car) => String(getBranch(car)?.stateId?._id || getBranch(car)?.stateId || car?.stateId || '').trim();
const getCarCityId = (car) => String(getBranch(car)?.cityId?._id || getBranch(car)?.cityId || car?.cityId || '').trim();
const getCarLocationId = (car) => String(getLocation(car)?._id || car?.locationId || '').trim();
const getCarState = (car) =>
  normalizeText(getLocation(car)?.stateId?.name || getBranch(car)?.stateId?.name || getBranch(car)?.state || car?.state);
const getCarCity = (car) =>
  normalizeText(getLocation(car)?.cityId?.name || getBranch(car)?.cityId?.name || getBranch(car)?.city || car?.city || car?.location);
const getCarLocation = (car) =>
  normalizeText(getLocation(car)?.name || car?.location || getCarCity(car));
const uniqueSorted = (values = []) =>
  [...new Set((values || []).map((value) => normalizeText(value)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
const normalizeId = (value) => String(value || '').trim();

const resolveLocationSelection = ({
  desiredSelection,
  stateOptions = [],
  citiesByStateId = {},
  locationsByCityId = {},
}) => {
  const stateOption = findLocationOption(stateOptions, {
    id: desiredSelection?.stateId,
    name: desiredSelection?.stateName,
  });

  if (!stateOption?._id) {
    return {
      stateId: '',
      stateName: '',
      cityId: '',
      cityName: '',
    };
  }

  const cityOption = findLocationOption(citiesByStateId[stateOption._id] || [], {
    id: desiredSelection?.cityId,
    name: desiredSelection?.cityName,
  });

  const locationOption = findLocationOption(locationsByCityId[cityOption?._id] || [], {
    id: desiredSelection?.locationId,
    name: desiredSelection?.locationName,
  });

  return buildLocationSelectionPayload({
    stateOption,
    cityOption,
    locationOption,
  });
};

const Cars = () => {
  const [searchParams] = useSearchParams();
  const querySearch = searchParams.get('q') || '';
  const queryCategory = searchParams.get('category') || 'all';
  const queryStateId = searchParams.get('stateId') || '';
  const queryCityId = searchParams.get('cityId') || '';
  const queryLocationId = searchParams.get('locationId') || '';
  const queryState = searchParams.get('state') || '';
  const queryCity = searchParams.get('city') || searchParams.get('location') || '';
  const queryLocationName =
    searchParams.get('locationName') || searchParams.get('pickupLocation') || searchParams.get('location') || '';
  const querySort = searchParams.get('sort') || 'recommended';
  const queryAvailableOnly = searchParams.get('available') === '1';
  const queryAllStates = searchParams.get('allStates') === '1';
  const hasLocationQuery = Boolean(
    queryAllStates || queryStateId || queryCityId || queryLocationId || queryState || queryCity || queryLocationName,
  );

  const [search, setSearch] = useState(querySearch);
  const [selectedCategory, setSelectedCategory] = useState(queryCategory);
  const [selectedStateId, setSelectedStateId] = useState(queryStateId);
  const [selectedCityId, setSelectedCityId] = useState(queryCityId);
  const [selectedLocationId, setSelectedLocationId] = useState(queryLocationId);
  const [selectedStateName, setSelectedStateName] = useState(queryState);
  const [selectedCityName, setSelectedCityName] = useState(queryCity);
  const [selectedLocationName, setSelectedLocationName] = useState(queryLocationName);
  const [locationMode, setLocationMode] = useState(queryAllStates ? 'all' : 'default');
  const [sortBy, setSortBy] = useState(querySort);
  const [availableOnly, setAvailableOnly] = useState(queryAvailableOnly);
  const [currentPage, setCurrentPage] = useState(1);
  const [locationReady, setLocationReady] = useState(false);

  const [cars, setCars] = useState([]);
  const [localCars, setLocalCars] = useState([]);
  const [fallbackCars, setFallbackCars] = useState([]);
  const [filterOptions, setFilterOptions] = useState({
    states: [],
    cities: [],
    locations: [],
    citiesByState: {},
    stateOptions: [],
    cityOptions: [],
    locationOptions: [],
    citiesByStateId: {},
    locationsByCityId: {},
  });
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentUser = useMemo(() => getUser(), []);
  const userLocation = useMemo(
    () => ({
      stateId: currentUser?.stateId || '',
      cityId: currentUser?.cityId || '',
      locationId: currentUser?.locationId || '',
      stateName: currentUser?.stateName || '',
      cityName: currentUser?.cityName || '',
      locationName: currentUser?.locationName || '',
    }),
    [
      currentUser?.cityId,
      currentUser?.cityName,
      currentUser?.locationId,
      currentUser?.locationName,
      currentUser?.stateId,
      currentUser?.stateName,
    ],
  );
  const userHasDefaultLocation = useMemo(
    () => Boolean(normalizeId(userLocation.stateId) && normalizeId(userLocation.cityId) && normalizeId(userLocation.locationId)),
    [userLocation.cityId, userLocation.locationId, userLocation.stateId],
  );

  const stateOptions = useMemo(
    () => (Array.isArray(filterOptions.stateOptions) ? filterOptions.stateOptions : []),
    [filterOptions.stateOptions],
  );
  const selectedStateOption = useMemo(
    () => stateOptions.find((state) => String(state?._id || '') === String(selectedStateId || '')) || null,
    [stateOptions, selectedStateId],
  );
  const cityOptions = useMemo(() => {
    if (selectedStateId) {
      return Array.isArray(filterOptions.citiesByStateId?.[selectedStateId])
        ? filterOptions.citiesByStateId[selectedStateId]
        : [];
    }
    return Array.isArray(filterOptions.cityOptions) ? filterOptions.cityOptions : [];
  }, [filterOptions.citiesByStateId, filterOptions.cityOptions, selectedStateId]);
  const selectedCityOption = useMemo(
    () => cityOptions.find((city) => String(city?._id || '') === String(selectedCityId || '')) || null,
    [cityOptions, selectedCityId],
  );
  const locationOptions = useMemo(
    () =>
      selectedCityId && Array.isArray(filterOptions.locationsByCityId?.[selectedCityId])
        ? filterOptions.locationsByCityId[selectedCityId]
        : [],
    [filterOptions.locationsByCityId, selectedCityId],
  );
  const selectedLocationOption = useMemo(
    () =>
      locationOptions.find((location) => String(location?._id || '') === String(selectedLocationId || '')) || null,
    [locationOptions, selectedLocationId],
  );
  const resolvedStateName = useMemo(
    () => String(selectedStateName || selectedStateOption?.name || '').trim(),
    [selectedStateName, selectedStateOption],
  );
  const resolvedCityName = useMemo(
    () => String(selectedCityName || selectedCityOption?.name || '').trim(),
    [selectedCityName, selectedCityOption],
  );
  const resolvedLocationName = useMemo(
    () => String(selectedLocationName || selectedLocationOption?.name || '').trim(),
    [selectedLocationName, selectedLocationOption],
  );
  const inventoryScopeLabel = useMemo(() => {
    if (locationMode === 'default' && userLocation.locationName) {
      return `${userLocation.locationName}, ${userLocation.cityName}, ${userLocation.stateName}`
        .replace(/,\s*$/, '')
        .replace(/^,\s*/, '');
    }
    if (resolvedStateName && resolvedCityName && resolvedLocationName) {
      return `${resolvedLocationName}, ${resolvedCityName}, ${resolvedStateName}`;
    }
    if (resolvedStateName && resolvedCityName) return `${resolvedCityName}, ${resolvedStateName}`;
    if (resolvedStateName) return `All cities in ${resolvedStateName}`;
    return 'All states and cities';
  }, [
    locationMode,
    resolvedCityName,
    resolvedLocationName,
    resolvedStateName,
    userLocation.cityName,
    userLocation.locationName,
    userLocation.stateName,
  ]);

  const loadFilterOptions = useCallback(async () => {
    try {
      setLoadingFilters(true);
      const options = await getCarFilterOptions();
      setFilterOptions({
        states: Array.isArray(options?.states) ? options.states : [],
        cities: Array.isArray(options?.cities) ? options.cities : [],
        citiesByState:
          options?.citiesByState && typeof options.citiesByState === 'object' ? options.citiesByState : {},
        stateOptions: Array.isArray(options?.stateOptions) ? options.stateOptions : [],
        cityOptions: Array.isArray(options?.cityOptions) ? options.cityOptions : [],
        locationOptions: Array.isArray(options?.locationOptions) ? options.locationOptions : [],
        citiesByStateId:
          options?.citiesByStateId && typeof options.citiesByStateId === 'object' ? options.citiesByStateId : {},
        locationsByCityId:
          options?.locationsByCityId && typeof options?.locationsByCityId === 'object'
            ? options.locationsByCityId
            : {},
      });
    } catch {
      setFilterOptions({
        states: [],
        cities: [],
        citiesByState: {},
        stateOptions: [],
        cityOptions: [],
        locationOptions: [],
        citiesByStateId: {},
        locationsByCityId: {},
      });
    } finally {
      setLoadingFilters(false);
    }
  }, []);

  useEffect(() => {
    loadFilterOptions();
  }, [loadFilterOptions]);

  useEffect(() => {
    if (loadingFilters || locationReady) return;

    if (queryAllStates) {
      setLocationMode('all');
      setSelectedStateId('');
      setSelectedStateName('');
      setSelectedCityId('');
      setSelectedCityName('');
      setLocationReady(true);
      return;
    }

    const hasExplicitLocationQuery = Boolean(queryStateId || queryCityId || queryState || queryCity);
    const desiredSelection = hasExplicitLocationQuery
      ? {
          stateId: queryStateId,
          cityId: queryCityId,
          locationId: queryLocationId,
          stateName: queryState,
          cityName: queryCity,
          locationName: queryLocationName,
        }
      : userHasDefaultLocation
        ? userLocation
        : currentUser?._id
          ? {}
          : loadSavedLocationSelection();

    const resolvedSelection = resolveLocationSelection({
      desiredSelection,
      stateOptions,
      citiesByStateId: filterOptions.citiesByStateId,
      locationsByCityId: filterOptions.locationsByCityId,
    });

    setLocationMode(hasExplicitLocationQuery ? 'manual' : userHasDefaultLocation ? 'default' : 'all');
    setSelectedStateId(resolvedSelection.stateId);
    setSelectedStateName(resolvedSelection.stateName);
    setSelectedCityId(resolvedSelection.cityId);
    setSelectedCityName(resolvedSelection.cityName);
    setSelectedLocationId(resolvedSelection.locationId);
    setSelectedLocationName(resolvedSelection.locationName);
    setLocationReady(true);
  }, [
    currentUser?._id,
    filterOptions.citiesByStateId,
    loadingFilters,
    locationReady,
    queryAllStates,
    queryCity,
    queryCityId,
    queryLocationId,
    queryLocationName,
    queryState,
    queryStateId,
    filterOptions.locationsByCityId,
    stateOptions,
    userHasDefaultLocation,
    userLocation,
  ]);

  useEffect(() => {
    setSearch((previous) => (previous === querySearch ? previous : querySearch));
    setSelectedCategory((previous) => (previous === queryCategory ? previous : queryCategory));
    setSortBy((previous) => (previous === querySort ? previous : querySort));
    setAvailableOnly((previous) => (previous === queryAvailableOnly ? previous : queryAvailableOnly));

    if (!locationReady) return;
    if (!hasLocationQuery) return;

    if (queryAllStates) {
      if (locationMode !== 'all') setLocationMode('all');
      if (selectedStateId !== '') setSelectedStateId('');
      if (selectedStateName !== '') setSelectedStateName('');
      if (selectedCityId !== '') setSelectedCityId('');
      if (selectedCityName !== '') setSelectedCityName('');
      if (selectedLocationId !== '') setSelectedLocationId('');
      if (selectedLocationName !== '') setSelectedLocationName('');
      return;
    }

    const resolvedSelection = resolveLocationSelection({
      desiredSelection: {
        stateId: queryStateId,
        cityId: queryCityId,
        locationId: queryLocationId,
        stateName: queryState,
        cityName: queryCity,
        locationName: queryLocationName,
      },
      stateOptions,
      citiesByStateId: filterOptions.citiesByStateId,
      locationsByCityId: filterOptions.locationsByCityId,
    });

    if (locationMode !== 'manual') setLocationMode('manual');
    if (resolvedSelection.stateId !== selectedStateId) setSelectedStateId(resolvedSelection.stateId);
    if (resolvedSelection.stateName !== selectedStateName) setSelectedStateName(resolvedSelection.stateName);
    if (resolvedSelection.cityId !== selectedCityId) setSelectedCityId(resolvedSelection.cityId);
    if (resolvedSelection.cityName !== selectedCityName) setSelectedCityName(resolvedSelection.cityName);
    if (resolvedSelection.locationId !== selectedLocationId) setSelectedLocationId(resolvedSelection.locationId);
    if (resolvedSelection.locationName !== selectedLocationName) setSelectedLocationName(resolvedSelection.locationName);
  }, [
    querySearch,
    queryCategory,
    querySort,
    queryAvailableOnly,
    queryStateId,
    queryCityId,
    queryState,
    queryCity,
    queryAllStates,
    hasLocationQuery,
    locationReady,
    locationMode,
    queryLocationId,
    queryLocationName,
    stateOptions,
    filterOptions.citiesByStateId,
    filterOptions.locationsByCityId,
    selectedCityId,
    selectedCityName,
    selectedLocationId,
    selectedLocationName,
    selectedStateId,
    selectedStateName,
  ]);

  useEffect(() => {
    if (!selectedStateId) {
      if (selectedCityId) setSelectedCityId('');
      if (selectedCityName) setSelectedCityName('');
      if (selectedLocationId) setSelectedLocationId('');
      if (selectedLocationName) setSelectedLocationName('');
      return;
    }

    const availableCities = Array.isArray(filterOptions.citiesByStateId?.[selectedStateId])
      ? filterOptions.citiesByStateId[selectedStateId]
      : [];

    if (
      selectedCityId &&
      !availableCities.some((city) => String(city?._id || '') === String(selectedCityId))
    ) {
      setSelectedCityId('');
      setSelectedCityName('');
      setSelectedLocationId('');
      setSelectedLocationName('');
    }
  }, [selectedCityId, selectedCityName, selectedLocationId, selectedLocationName, selectedStateId, filterOptions.citiesByStateId]);

  useEffect(() => {
    if (!selectedCityId) {
      if (selectedLocationId) setSelectedLocationId('');
      if (selectedLocationName) setSelectedLocationName('');
      return;
    }

    const availableLocations = Array.isArray(filterOptions.locationsByCityId?.[selectedCityId])
      ? filterOptions.locationsByCityId[selectedCityId]
      : [];

    if (
      selectedLocationId &&
      !availableLocations.some((location) => String(location?._id || '') === String(selectedLocationId))
    ) {
      setSelectedLocationId('');
      setSelectedLocationName('');
    }
  }, [filterOptions.locationsByCityId, selectedCityId, selectedLocationId, selectedLocationName]);

  useEffect(() => {
    if (selectedStateOption && selectedCityOption && selectedLocationOption) {
      saveLocationSelection(
        buildLocationSelectionPayload({
          stateOption: selectedStateOption,
          cityOption: selectedCityOption,
          locationOption: selectedLocationOption,
        }),
      );
    }
  }, [selectedStateOption, selectedCityOption, selectedLocationOption]);

  const fetchCars = useCallback(async () => {
    if (!locationReady) return;

    try {
      setLoading(true);
      setError('');
      const inventory = await getLocationAwareCars({
        userLocation,
        selectedStateId: locationMode === 'default' ? '' : selectedStateId,
        selectedCityId: locationMode === 'default' ? '' : selectedCityId,
        selectedLocationId: locationMode === 'default' ? '' : selectedLocationId,
        allStates: locationMode === 'all',
      });
      setLocalCars(Array.isArray(inventory?.localCars) ? inventory.localCars : []);
      setFallbackCars(Array.isArray(inventory?.fallbackCars) ? inventory.fallbackCars : []);
      setCars(Array.isArray(inventory?.cars) ? inventory.cars : []);
    } catch {
      setLocalCars([]);
      setFallbackCars([]);
      setCars([]);
      setError('Failed to load cars. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [locationMode, locationReady, selectedCityId, selectedLocationId, selectedStateId, userLocation]);

  useEffect(() => {
    fetchCars();
  }, [fetchCars]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedCategory, selectedCityId, selectedLocationId, selectedStateId, sortBy, availableOnly]);

  const categoryOptions = useMemo(() => {
    return [...new Set(cars.map((car) => String(car.category || '').trim()).filter(Boolean))];
  }, [cars]);

  const sortCars = useCallback((result = []) => {
    const nextCars = [...result];
    nextCars.sort((left, right) => {
      if (sortBy === 'price_asc') return Number(left.pricePerDay || 0) - Number(right.pricePerDay || 0);
      if (sortBy === 'price_desc') return Number(right.pricePerDay || 0) - Number(left.pricePerDay || 0);
      if (sortBy === 'newest') {
        return new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime();
      }
      if (sortBy === 'name_asc') {
        return `${left.brand || ''} ${left.model || ''}`.localeCompare(`${right.brand || ''} ${right.model || ''}`);
      }

      const leftAvailable = resolveFleetStatus(left) === 'Available';
      const rightAvailable = resolveFleetStatus(right) === 'Available';
      if (leftAvailable !== rightAvailable) {
        return leftAvailable ? -1 : 1;
      }
      return Number(left.pricePerDay || 0) - Number(right.pricePerDay || 0);
    });
    return nextCars;
  }, [sortBy]);

  const filterCarGroup = useCallback((carGroup = []) => {
    const query = normalize(search);
    const queryTokens = query.split(/\s+/).filter(Boolean);

    const result = carGroup.filter((car) => {
      const branch = getBranch(car);
      const searchSource = [
        car.name,
        car.brand,
        car.model,
        car.category,
        getCarState(car),
        getCarCity(car),
        getCarLocation(car),
        branch?.branchName,
        branch?.address,
        car.transmission,
        car.fuel_type,
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');

      const matchesSearch = queryTokens.length === 0 || queryTokens.every((token) => searchSource.includes(token));
      const matchesCategory = selectedCategory === 'all' || car.category === selectedCategory;
      const matchesAvailability = !availableOnly || resolveFleetStatus(car) === 'Available';
      return matchesSearch && matchesCategory && matchesAvailability;
    });

    return sortCars(result);
  }, [availableOnly, search, selectedCategory, sortCars]);

  const filteredLocalCars = useMemo(() => filterCarGroup(localCars), [filterCarGroup, localCars]);
  const filteredFallbackCars = useMemo(() => filterCarGroup(fallbackCars), [fallbackCars, filterCarGroup]);
  const filteredCars = useMemo(
    () => [...filteredLocalCars, ...filteredFallbackCars],
    [filteredFallbackCars, filteredLocalCars],
  );

  const totalCars = cars.length;
  const availableCars = useMemo(() => cars.filter((car) => resolveFleetStatus(car) === 'Available').length, [cars]);
  const fallbackCount = filteredFallbackCars.length;
  const localCount = filteredLocalCars.length;
  const cityCount = Array.isArray(filterOptions.cityOptions) ? filterOptions.cityOptions.length : 0;
  const stateCount = stateOptions.length;
  const totalPages = Math.max(1, Math.ceil(filteredCars.length / CARS_PER_PAGE));
  const pageStartIndex = (currentPage - 1) * CARS_PER_PAGE;
  const paginatedCars = filteredCars.slice(pageStartIndex, pageStartIndex + CARS_PER_PAGE);
  const visibleStart = filteredCars.length === 0 ? 0 : pageStartIndex + 1;
  const visibleEnd = Math.min(pageStartIndex + CARS_PER_PAGE, filteredCars.length);
  const pageNumbers = useMemo(() => {
    const maxVisibleButtons = 5;
    let start = Math.max(1, currentPage - 2);
    let end = Math.min(totalPages, start + maxVisibleButtons - 1);
    start = Math.max(1, end - maxVisibleButtons + 1);
    return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
  }, [currentPage, totalPages]);

  const hasActiveFilters = Boolean(search.trim()) || selectedCategory !== 'all' || availableOnly || sortBy !== 'recommended';

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const handleStateChange = (nextStateId) => {
    const nextState = findLocationOption(stateOptions, { id: nextStateId });
    if (!nextStateId) {
      setLocationMode('all');
      setSelectedStateId('');
      setSelectedStateName('');
      setSelectedCityId('');
      setSelectedCityName('');
      setSelectedLocationId('');
      setSelectedLocationName('');
      return;
    }
    setLocationMode('manual');
    setSelectedStateId(String(nextState?._id || ''));
    setSelectedStateName(String(nextState?.name || ''));
    if (selectedCityId) setSelectedCityId('');
    if (selectedCityName) setSelectedCityName('');
    if (selectedLocationId) setSelectedLocationId('');
    if (selectedLocationName) setSelectedLocationName('');
  };

  const handleCityChange = (nextCityId) => {
    const nextCity = findLocationOption(cityOptions, { id: nextCityId });
    if (!nextCityId) {
      setLocationMode(selectedStateId ? 'manual' : 'all');
      setSelectedCityId('');
      setSelectedCityName('');
      setSelectedLocationId('');
      setSelectedLocationName('');
      return;
    }
    setLocationMode('manual');
    setSelectedCityId(String(nextCity?._id || ''));
    setSelectedCityName(String(nextCity?.name || ''));
    setSelectedLocationId('');
    setSelectedLocationName('');
    if (nextCity?.stateId && String(nextCity.stateId) !== String(selectedStateId || '')) {
      const nextState = findLocationOption(stateOptions, { id: nextCity.stateId });
      setSelectedStateId(String(nextState?._id || nextCity.stateId || ''));
      setSelectedStateName(String(nextState?.name || nextCity?.stateName || ''));
    }
  };

  const handleLocationChange = (nextLocationId) => {
    const nextLocation = findLocationOption(locationOptions, { id: nextLocationId });
    if (!nextLocationId) {
      setSelectedLocationId('');
      setSelectedLocationName('');
      return;
    }
    setLocationMode('manual');
    setSelectedLocationId(String(nextLocation?._id || ''));
    setSelectedLocationName(String(nextLocation?.name || ''));
  };

  const clearFilters = () => {
    setSearch('');
    setSelectedCategory('all');
    setSortBy('recommended');
    setAvailableOnly(false);
    setCurrentPage(1);
  };

  return (
    <main className="pb-14">
      <section className="relative overflow-hidden border-b border-borderColor bg-linear-to-b from-slate-100 via-blue-50/70 to-white">
        <div className="absolute -top-20 -left-20 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute top-6 right-0 h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl" />

        <div className="relative max-w-330 mx-auto px-4 md:px-8 xl:px-10 pt-14 pb-10">
          <ScrollReveal>
            <div className="text-center">
              <p className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-white border border-borderColor text-slate-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Live inventory with city-based pickup
              </p>

              <h1 className="mt-4 text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">Available Cars</h1>

              <p className="mt-3 text-slate-600 max-w-3xl mx-auto">
                Browse live inventory for your selected city and view the exact pickup branch before you book.
              </p>

              <div className="mt-5 flex flex-wrap justify-center gap-3 text-sm">
                <div className="px-3.5 py-2 rounded-xl border border-borderColor bg-white">
                  <p className="text-slate-500 text-xs">Total Cars</p>
                  <p className="font-semibold text-slate-800">{totalCars}</p>
                </div>
                <div className="px-3.5 py-2 rounded-xl border border-borderColor bg-white">
                  <p className="text-slate-500 text-xs">Available Now</p>
                  <p className="font-semibold text-emerald-700">{availableCars}</p>
                </div>
                <div className="px-3.5 py-2 rounded-xl border border-borderColor bg-white">
                  <p className="text-slate-500 text-xs">States</p>
                  <p className="font-semibold text-slate-800">{stateCount}</p>
                </div>
                <div className="px-3.5 py-2 rounded-xl border border-borderColor bg-white">
                  <p className="text-slate-500 text-xs">Cities</p>
                  <p className="font-semibold text-slate-800">{cityCount}</p>
                </div>
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={90}>
            <div className="mt-7 rounded-2xl border border-borderColor bg-white/90 backdrop-blur p-4 md:p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr_0.9fr] gap-3">
                <label className="relative block">
                  <span className="sr-only">Search cars</span>
                  <img src={assets.search_icon} alt="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-75" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by make, model, branch, fuel..."
                    className="w-full border border-borderColor rounded-lg h-11 pl-10 pr-3 text-sm outline-none"
                  />
                </label>

                <select
                  value={selectedCategory}
                  onChange={(event) => setSelectedCategory(event.target.value)}
                  className="border border-borderColor rounded-lg h-11 px-3 text-sm outline-none bg-white"
                >
                  <option value="all">All categories</option>
                  {categoryOptions.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>

                <LocationSelector
                  stateOptions={stateOptions}
                  cityOptions={cityOptions}
                  locationOptions={locationOptions}
                  selectedStateId={selectedStateId}
                  selectedCityId={selectedCityId}
                  selectedLocationId={selectedLocationId}
                  onStateChange={handleStateChange}
                  onCityChange={handleCityChange}
                  onLocationChange={handleLocationChange}
                  loading={loadingFilters}
                  allowAll
                  wrapperClassName="contents"
                  itemClassName=""
                  labelClassName="sr-only"
                  selectClassName="border border-borderColor rounded-lg h-11 px-3 text-sm outline-none bg-white w-full"
                  statePlaceholder="Select state"
                  cityPlaceholder="Select city"
                  locationPlaceholder="Select pickup location"
                />

                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                  className="border border-borderColor rounded-lg h-11 px-3 text-sm outline-none bg-white"
                >
                  {SORT_OPTIONS.map((option) => (
                    <option value={option.value} key={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                  <input
                    type="checkbox"
                    checked={availableOnly}
                    onChange={(event) => setAvailableOnly(event.target.checked)}
                    className="h-4 w-4 accent-primary"
                  />
                  Show available cars only
                </label>

                {hasActiveFilters ? (
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="text-sm px-3.5 py-1.5 rounded-lg border border-borderColor text-slate-700 hover:bg-light"
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>

              {currentUser?._id &&
              !userHasDefaultLocation &&
              !selectedStateId &&
              !selectedCityId &&
              !selectedLocationId &&
              !hasLocationQuery ? (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Your default pickup location is not set. Showing all available cars until you set a default state,
                  city, and pickup location in your profile.
                </div>
              ) : locationMode === 'default' && userHasDefaultLocation ? (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  Showing cars from your default location <span className="font-semibold">{inventoryScopeLabel}</span>.
                  {fallbackCount > 0 ? ` ${fallbackCount} fallback car(s) are shown below.` : ''}
                </div>
              ) : selectedLocationName ? (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  Viewing inventory for <span className="font-semibold">{selectedLocationName}</span>
                  {selectedCityName ? `, ${selectedCityName}` : ''}
                  {selectedStateName ? `, ${selectedStateName}` : ''}.
                </div>
              ) : selectedCityName ? (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  Viewing inventory for <span className="font-semibold">{selectedCityName}</span>
                  {selectedStateName ? `, ${selectedStateName}` : ''}.
                </div>
              ) : selectedStateName ? (
                <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  Viewing all available cars in <span className="font-semibold">{selectedStateName}</span>.
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  Viewing all available cars across all states. Select a state or city to narrow pickup locations.
                </div>
              )}
            </div>
          </ScrollReveal>
        </div>
      </section>

      <section className="max-w-330 mx-auto px-4 md:px-8 xl:px-10 pt-9">
        {loading ? (
          <div>
            <div className="h-4 w-36 bg-slate-200 rounded animate-pulse" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
              {Array.from({ length: 9 }).map((_, index) => (
                <SkeletonCard key={`car-skeleton-${index}`} />
              ))}
            </div>
          </div>
        ) : null}

        {!loading && error ? (
          <div className="max-w-xl mx-auto rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
            <p className="text-red-700 font-medium">{error}</p>
            <button
              type="button"
              onClick={fetchCars}
              className="mt-4 px-5 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
            >
              Retry
            </button>
          </div>
        ) : null}

        {!loading && !error ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              {filteredCars.length > 0 ? (
                <p className="text-slate-600 text-sm md:text-base">
                  Showing <span className="font-semibold text-slate-800">{visibleStart}-{visibleEnd}</span> of{' '}
                  <span className="font-semibold text-slate-800">{filteredCars.length}</span> car(s)
                </p>
              ) : (
                <p className="text-slate-600 text-sm md:text-base">
                  Showing <span className="font-semibold text-slate-800">0</span> car(s)
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm text-slate-500">Scope: {inventoryScopeLabel}</p>
                <p className="text-sm text-slate-500">Local: {localCount}</p>
                <p className="text-sm text-slate-500">Fallback: {fallbackCount}</p>
                {search.trim() ? <p className="text-sm text-slate-500">Search: "{search.trim()}"</p> : null}
              </div>
            </div>

            {filteredCars.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-borderColor bg-white p-8 text-center">
                <h3 className="text-lg font-semibold text-slate-800">No cars match these filters</h3>
                <p className="text-sm text-slate-500 mt-2">
                  Try changing the city, category, availability, or search text.
                </p>
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-4 px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-dull"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mt-6">
                  {paginatedCars.map((car, index) => (
                    <ScrollReveal key={car._id} delay={Math.min(index * 45, 220)} direction="up">
                      <CarCard car={car} />
                    </ScrollReveal>
                  ))}
                </div>

                {filteredCars.length > CARS_PER_PAGE ? (
                  <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <p className="text-sm text-slate-500">
                      Page {currentPage} of {totalPages}
                    </p>

                    <div className="flex items-center flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        className={`px-3 py-1.5 rounded-lg border text-sm ${
                          currentPage === 1
                            ? 'border-borderColor text-slate-300 cursor-not-allowed'
                            : 'border-borderColor text-slate-700 hover:bg-light'
                        }`}
                      >
                        Prev
                      </button>

                      {pageNumbers.map((pageNumber) => (
                        <button
                          type="button"
                          key={pageNumber}
                          onClick={() => setCurrentPage(pageNumber)}
                          className={`min-w-9 px-3 py-1.5 rounded-lg border text-sm ${
                            pageNumber === currentPage
                              ? 'bg-primary text-white border-primary'
                              : 'border-borderColor text-slate-700 hover:bg-light'
                          }`}
                        >
                          {pageNumber}
                        </button>
                      ))}

                      <button
                        type="button"
                        onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        className={`px-3 py-1.5 rounded-lg border text-sm ${
                          currentPage === totalPages
                            ? 'border-borderColor text-slate-300 cursor-not-allowed'
                            : 'border-borderColor text-slate-700 hover:bg-light'
                        }`}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </section>
    </main>
  );
};

export default Cars;
