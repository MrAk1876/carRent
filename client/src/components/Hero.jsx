import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assets } from '../assets/assets';
import ScrollReveal from './ui/ScrollReveal';
import TypingText from './ui/TypingText';
import useNotify from '../hooks/useNotify';
import { getCarFilterOptions } from '../services/carService';
import LocationSelector from './LocationSelector';
import {
  buildLocationSelectionPayload,
  findLocationOption,
  loadPreferredLocationSelection,
  loadUserDefaultLocationSelection,
  saveLocationSelection,
} from '../services/locationSelectionService';

const Hero = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const [selectedStateId, setSelectedStateId] = useState('');
  const [selectedCityId, setSelectedCityId] = useState('');
  const [selectedLocationId, setSelectedLocationId] = useState('');
  const [stateOptions, setStateOptions] = useState([]);
  const [cityOptionsByStateId, setCityOptionsByStateId] = useState({});
  const [locationsByCityId, setLocationsByCityId] = useState({});
  const [loadingFilters, setLoadingFilters] = useState(true);
  const [locationHydrated, setLocationHydrated] = useState(false);

  const selectedStateOption = useMemo(
    () => stateOptions.find((state) => String(state?._id || '') === String(selectedStateId || '')) || null,
    [stateOptions, selectedStateId],
  );
  const cityOptions = useMemo(
    () => (selectedStateId ? cityOptionsByStateId[selectedStateId] || [] : []),
    [selectedStateId, cityOptionsByStateId],
  );
  const selectedCityOption = useMemo(
    () => cityOptions.find((city) => String(city?._id || '') === String(selectedCityId || '')) || null,
    [cityOptions, selectedCityId],
  );
  const locationOptions = useMemo(
    () => (selectedCityId ? locationsByCityId[selectedCityId] || [] : []),
    [locationsByCityId, selectedCityId],
  );
  const selectedLocationOption = useMemo(
    () =>
      locationOptions.find((location) => String(location?._id || '') === String(selectedLocationId || '')) || null,
    [locationOptions, selectedLocationId],
  );
  const fieldShellClass =
    'hero-search-field group rounded-xl border border-slate-200 bg-slate-50/85 px-3.5 py-2.5 transition-all duration-200 focus-within:border-primary focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]';
  const inputClass =
    'hero-search-input mt-1.5 w-full border-0 bg-transparent p-0 text-[15px] font-medium text-slate-800 outline-none ring-0 focus:ring-0';

  useEffect(() => {
    let cancelled = false;

    const loadFilterOptions = async () => {
      try {
        setLoadingFilters(true);
        const options = await getCarFilterOptions();
        if (cancelled) return;
        setStateOptions(Array.isArray(options.stateOptions) ? options.stateOptions : []);
        setCityOptionsByStateId(
          options.citiesByStateId && typeof options.citiesByStateId === 'object' ? options.citiesByStateId : {},
        );
        setLocationsByCityId(
          options.locationsByCityId && typeof options.locationsByCityId === 'object' ? options.locationsByCityId : {},
        );
      } catch {
        if (cancelled) return;
        setStateOptions([]);
        setCityOptionsByStateId({});
        setLocationsByCityId({});
      } finally {
        if (!cancelled) {
          setLoadingFilters(false);
        }
      }
    };

    loadFilterOptions();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!stateOptions.length || locationHydrated) return;
    const preferredSelection = loadPreferredLocationSelection();
    let savedState = findLocationOption(stateOptions, {
      id: preferredSelection.stateId,
      name: preferredSelection.stateName,
    });
    let savedSelection = preferredSelection;

    if (!savedState?._id) {
      const userDefaultSelection = loadUserDefaultLocationSelection();
      savedSelection = userDefaultSelection;
      savedState = findLocationOption(stateOptions, {
        id: userDefaultSelection.stateId,
        name: userDefaultSelection.stateName,
      });
    }

    if (savedState?._id) {
      setSelectedStateId(String(savedState._id));
      const savedCities = cityOptionsByStateId[String(savedState._id)] || [];
      const savedCity = findLocationOption(savedCities, {
        id: savedSelection.cityId,
        name: savedSelection.cityName,
      });
      if (savedCity?._id) {
        setSelectedCityId(String(savedCity._id));
        const savedLocations = locationsByCityId[String(savedCity._id)] || [];
        const savedLocation = findLocationOption(savedLocations, {
          id: savedSelection.locationId,
          name: savedSelection.locationName,
        });
        if (savedLocation?._id) {
          setSelectedLocationId(String(savedLocation._id));
        }
      }
    }
    setLocationHydrated(true);
  }, [stateOptions, cityOptionsByStateId, locationsByCityId, locationHydrated]);

  useEffect(() => {
    if (!selectedStateId) {
      setSelectedCityId('');
      setSelectedLocationId('');
      return;
    }

    const allowedCities = cityOptionsByStateId[selectedStateId] || [];
    if (
      selectedCityId &&
      !allowedCities.some((city) => String(city?._id || '') === String(selectedCityId))
    ) {
      setSelectedCityId('');
      setSelectedLocationId('');
    }
  }, [selectedStateId, selectedCityId, cityOptionsByStateId]);

  useEffect(() => {
    if (!selectedCityId) {
      setSelectedLocationId('');
      return;
    }

    const allowedLocations = locationsByCityId[selectedCityId] || [];
    if (
      selectedLocationId &&
      !allowedLocations.some((location) => String(location?._id || '') === String(selectedLocationId))
    ) {
      setSelectedLocationId('');
    }
  }, [locationsByCityId, selectedCityId, selectedLocationId]);

  const handleStateChange = (nextStateId) => {
    setSelectedStateId(nextStateId);
    setSelectedCityId('');
    setSelectedLocationId('');
  };

  const handleCityChange = (nextCityId) => {
    setSelectedCityId(nextCityId);
    setSelectedLocationId('');
  };

  const handleLocationChange = (nextLocationId) => {
    setSelectedLocationId(nextLocationId);
  };

  const handleSearch = (e) => {
    e.preventDefault();
    if (loadingFilters) {
      notify.error('Locations are loading. Please wait.');
      return;
    }
    if (!selectedStateOption || !selectedCityOption || !selectedLocationOption) {
      notify.error('Please fill all fields');
      return;
    }

    const params = new URLSearchParams();
    params.set('stateId', selectedStateOption._id);
    params.set('cityId', selectedCityOption._id);
    params.set('locationId', selectedLocationOption._id);
    params.set('state', selectedStateOption.name);
    params.set('city', selectedCityOption.name);
    params.set('locationName', selectedLocationOption.name);

    saveLocationSelection(
      buildLocationSelectionPayload({
        stateOption: selectedStateOption,
        cityOption: selectedCityOption,
        locationOption: selectedLocationOption,
      }),
    );
    navigate(`/cars?${params.toString()}`);
    window.scrollTo(0, 0);
  };

  return (
    <section className="relative overflow-hidden bg-linear-to-b from-slate-100 via-[#f5f8ff] to-white">
      <div className="absolute -top-40 -left-30 w-105 h-105 bg-primary/15 rounded-full blur-3xl" />
      <div className="absolute top-10 -right-30 w-110 h-110 bg-cyan-200/40 rounded-full blur-3xl" />

      <div className="relative max-w-330 mx-auto px-4 md:px-8 xl:px-10 pt-16 pb-16 md:pb-20">
        <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-8 xl:gap-10 items-center">
          <ScrollReveal direction="left">
            <p className="inline-flex items-center gap-2 text-xs md:text-sm px-4 py-1.5 rounded-full border border-borderColor bg-white/90 text-gray-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Premium Fleet - Negotiation Enabled
            </p>

            <h1 className="mt-5 text-4xl md:text-5xl xl:text-[62px] font-semibold leading-[1.06] tracking-tight text-slate-900 max-w-[15ch]">
              Drive the Right Car
              <span className="block text-primary mt-2 min-h-[1.2em]">
                <TypingText
                  words={['At the Right Price', 'With Smart Negotiation', 'Without Hidden Surprises']}
                  className="align-top"
                />
              </span>
            </h1>

            <p className="mt-5 text-base md:text-lg text-slate-600 max-w-2xl">
              Book instantly, send one negotiation offer, and pay a dynamic advance (20% to 30%) based on your final
              booking amount.
            </p>

            <form
              onSubmit={handleSearch}
              className="hero-search-card mt-8 rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-[0_16px_38px_rgba(15,23,42,0.08)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <p className="hero-search-title text-sm font-semibold text-slate-800">
                  Find Cars by Pickup Location
                </p>
                <span className="hero-search-badge inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                  Fast Smart Filters
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
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
                  required
                  wrapperClassName="contents"
                  itemClassName={fieldShellClass}
                  labelClassName="hero-search-label text-[11px] uppercase tracking-[0.11em] text-slate-500"
                  selectClassName={inputClass}
                  statePlaceholder="Select state"
                  cityPlaceholder="Select city"
                  locationPlaceholder="Select pickup location"
                />
              </div>

              <div className="mt-4 flex justify-end">
                <button className="w-full sm:w-auto px-6 py-3 rounded-xl bg-primary hover:bg-primary-dull text-white font-semibold flex items-center justify-center gap-2 min-w-44 hover:shadow-lg">
                  <img src={assets.search_icon} alt="search" className="w-4 h-4 brightness-300" />
                  Search Cars
                </button>
              </div>
            </form>

            <div className="mt-4 grid grid-cols-3 gap-3 max-w-xl">
              <div className="hero-search-meta-card rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Advance</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">20% - 30%</p>
              </div>
              <div className="hero-search-meta-card rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Negotiation</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">1 User Offer</p>
              </div>
              <div className="hero-search-meta-card rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Coverage</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">State + City + Pickup Location</p>
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal className="w-full" direction="right" delay={90}>
            <div className="relative mx-auto max-w-147.5 rounded-[28px] border border-borderColor bg-white/85 backdrop-blur p-4 md:p-6 shadow-[0_16px_44px_rgba(37,99,235,0.16)]">
              <div className="absolute top-5 right-5 text-[11px] px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                Dynamic Advance
              </div>
              <img
                src={assets.banner_car_image}
                alt="hero-car"
                className="w-full h-auto max-h-105 object-contain"
              />
            </div>
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
};

export default Hero;
