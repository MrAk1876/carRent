import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { assets } from '../assets/assets';
import CarCard from '../components/CarCard';
import ScrollReveal from '../components/ui/ScrollReveal';
import SkeletonCard from '../components/ui/SkeletonCard';
import { getCars } from '../services/carService';

const SORT_OPTIONS = [
  { label: 'Recommended', value: 'recommended' },
  { label: 'Price: Low to High', value: 'price_asc' },
  { label: 'Price: High to Low', value: 'price_desc' },
  { label: 'Newest', value: 'newest' },
  { label: 'Name: A to Z', value: 'name_asc' },
];
const CARS_PER_PAGE = 9;

const normalize = (value) => String(value || '').toLowerCase().trim();
const resolveFleetStatus = (car) => {
  const normalized = String(car?.fleetStatus || '').trim();
  if (normalized) return normalized;
  return car?.isAvailable ? 'Available' : 'Inactive';
};

const Cars = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const querySearch = searchParams.get('q') || '';
  const [search, setSearch] = useState(querySearch);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedLocation, setSelectedLocation] = useState('all');
  const [sortBy, setSortBy] = useState('recommended');
  const [availableOnly, setAvailableOnly] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchCars = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const list = await getCars();
      setCars(Array.isArray(list) ? list : []);
    } catch {
      setCars([]);
      setError('Failed to load cars. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCars();
  }, [fetchCars]);

  useEffect(() => {
    setSearch((previous) => (previous === querySearch ? previous : querySearch));
  }, [querySearch]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, selectedCategory, selectedLocation, sortBy, availableOnly]);

  const categoryOptions = useMemo(() => {
    return [...new Set(cars.map((car) => String(car.category || '').trim()).filter(Boolean))];
  }, [cars]);

  const locationOptions = useMemo(() => {
    return [...new Set(cars.map((car) => String(car.location || '').trim()).filter(Boolean))];
  }, [cars]);

  const filteredCars = useMemo(() => {
    const query = normalize(search);

    const result = cars.filter((car) => {
      const searchSource = [
        car.name,
        car.brand,
        car.model,
        car.category,
        car.location,
        car.transmission,
        car.fuel_type,
      ]
        .map((item) => String(item || '').toLowerCase())
        .join(' ');

      const matchesSearch = !query || searchSource.includes(query);
      const matchesCategory = selectedCategory === 'all' || car.category === selectedCategory;
      const matchesLocation = selectedLocation === 'all' || car.location === selectedLocation;
      const matchesAvailability = !availableOnly || resolveFleetStatus(car) === 'Available';

      return matchesSearch && matchesCategory && matchesLocation && matchesAvailability;
    });

    result.sort((left, right) => {
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

    return result;
  }, [availableOnly, cars, search, selectedCategory, selectedLocation, sortBy]);

  const totalCars = cars.length;
  const availableCars = useMemo(() => cars.filter((car) => resolveFleetStatus(car) === 'Available').length, [cars]);
  const cityCount = locationOptions.length;
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

  const hasActiveFilters =
    Boolean(search.trim()) || selectedCategory !== 'all' || selectedLocation !== 'all' || availableOnly;

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const clearFilters = () => {
    setSearch('');
    setSelectedCategory('all');
    setSelectedLocation('all');
    setSortBy('recommended');
    setAvailableOnly(false);
    setCurrentPage(1);
    setSearchParams({});
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
                Live inventory with negotiation
              </p>

              <h1 className="mt-4 text-4xl md:text-5xl font-semibold tracking-tight text-slate-900">Available Cars</h1>

              <p className="mt-3 text-slate-600 max-w-3xl mx-auto">
                Find your next rental with smart price negotiation and dynamic advance payment based on final price.
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
                  <p className="text-slate-500 text-xs">Cities</p>
                  <p className="font-semibold text-slate-800">{cityCount}</p>
                </div>
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal delay={90}>
            <div className="mt-7 rounded-2xl border border-borderColor bg-white/90 backdrop-blur p-4 md:p-5 shadow-[0_12px_28px_rgba(15,23,42,0.08)]">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.3fr_0.8fr_0.8fr_0.9fr] gap-3">
                <label className="relative block">
                  <span className="sr-only">Search cars</span>
                  <img src={assets.search_icon} alt="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-75" />
                  <input
                    type="text"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search by make, model, location, fuel..."
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

                <select
                  value={selectedLocation}
                  onChange={(event) => setSelectedLocation(event.target.value)}
                  className="border border-borderColor rounded-lg h-11 px-3 text-sm outline-none bg-white"
                >
                  <option value="all">All locations</option>
                  {locationOptions.map((option) => (
                    <option value={option} key={option}>
                      {option}
                    </option>
                  ))}
                </select>

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

        {!loading && !error && (
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
              {search.trim() ? <p className="text-sm text-slate-500">Search: "{search.trim()}"</p> : null}
            </div>

            {filteredCars.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-borderColor bg-white p-8 text-center">
                <h3 className="text-lg font-semibold text-slate-800">No cars match these filters</h3>
                <p className="text-sm text-slate-500 mt-2">Try changing search text, location, or category.</p>
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
        )}
      </section>
    </main>
  );
};

export default Cars;
