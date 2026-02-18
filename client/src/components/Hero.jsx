import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assets } from '../assets/assets';
import ScrollReveal from './ui/ScrollReveal';
import TypingText from './ui/TypingText';
import useNotify from '../hooks/useNotify';
import { getCarFilterOptions } from '../services/carService';

const Hero = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const [selectedState, setSelectedState] = useState('');
  const [selectedCity, setSelectedCity] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [returnDate, setReturnDate] = useState('');
  const [stateOptions, setStateOptions] = useState([]);
  const [cityOptionsByState, setCityOptionsByState] = useState({});
  const [loadingFilters, setLoadingFilters] = useState(true);

  const cityOptions = selectedState
    ? cityOptionsByState[selectedState] || []
    : [];
  const fieldShellClass =
    'group rounded-xl border border-slate-200 bg-slate-50/85 px-3.5 py-2.5 transition-all duration-200 focus-within:border-primary focus-within:bg-white focus-within:shadow-[0_0_0_3px_rgba(37,99,235,0.14)]';
  const inputClass =
    'mt-1.5 w-full border-0 bg-transparent p-0 text-[15px] font-medium text-slate-800 outline-none ring-0 focus:ring-0';

  useEffect(() => {
    let cancelled = false;

    const loadFilterOptions = async () => {
      try {
        setLoadingFilters(true);
        const options = await getCarFilterOptions();
        if (cancelled) return;
        setStateOptions(Array.isArray(options.states) ? options.states : []);
        setCityOptionsByState(
          options.citiesByState && typeof options.citiesByState === 'object' ? options.citiesByState : {},
        );
      } catch {
        if (cancelled) return;
        setStateOptions([]);
        setCityOptionsByState({});
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
    if (!selectedState) {
      setSelectedCity('');
      return;
    }

    const allowedCities = cityOptionsByState[selectedState] || [];
    if (selectedCity && !allowedCities.includes(selectedCity)) {
      setSelectedCity('');
    }
  }, [selectedState, selectedCity, cityOptionsByState]);

  const handleSearch = (e) => {
    e.preventDefault();
    if (loadingFilters) {
      notify.error('Locations are loading. Please wait.');
      return;
    }
    if (!selectedState || !selectedCity || !pickupDate || !returnDate) {
      notify.error('Please fill all fields');
      return;
    }
    if (new Date(returnDate).getTime() < new Date(pickupDate).getTime()) {
      notify.error('Return date must be after pickup date');
      return;
    }

    const params = new URLSearchParams();
    params.set('state', selectedState);
    params.set('city', selectedCity);
    params.set('location', selectedCity);
    params.set('q', `${selectedState} ${selectedCity}`);
    params.set('pickupDate', pickupDate);
    params.set('returnDate', returnDate);

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
              Book instantly, negotiate up to 3 rounds, and pay a dynamic advance (20% to 30%) based on your final
              booking amount.
            </p>

            <form
              onSubmit={handleSearch}
              className="mt-8 rounded-2xl border border-slate-200 bg-white p-4 md:p-5 shadow-[0_16px_38px_rgba(15,23,42,0.08)]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <p className="text-sm font-semibold text-slate-800">Find Cars by State, City, and Date</p>
                <span className="inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700">
                  Fast Smart Filters
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                <div className={fieldShellClass}>
                  <label className="text-[11px] uppercase tracking-[0.11em] text-slate-500">State</label>
                  <select
                    required
                    value={selectedState}
                    onChange={(e) => setSelectedState(e.target.value)}
                    className={inputClass}
                    disabled={loadingFilters || stateOptions.length === 0}
                  >
                    <option value="">
                      {loadingFilters ? 'Loading states...' : stateOptions.length ? 'Select state' : 'No states available'}
                    </option>
                    {stateOptions.map((state) => (
                      <option value={state} key={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={fieldShellClass}>
                  <label className="text-[11px] uppercase tracking-[0.11em] text-slate-500">City</label>
                  <select
                    required
                    value={selectedCity}
                    onChange={(e) => setSelectedCity(e.target.value)}
                    className={inputClass}
                    disabled={loadingFilters || !selectedState || cityOptions.length === 0}
                  >
                    <option value="">
                      {!selectedState
                        ? 'Select state first'
                        : loadingFilters
                        ? 'Loading cities...'
                        : cityOptions.length
                        ? 'Select city'
                        : 'No cities available'}
                    </option>
                    {cityOptions.map((city) => (
                      <option value={city} key={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={fieldShellClass}>
                  <label className="text-[11px] uppercase tracking-[0.11em] text-slate-500">Pickup Date</label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>

                <div className={fieldShellClass}>
                  <label className="text-[11px] uppercase tracking-[0.11em] text-slate-500">Return Date</label>
                  <input
                    type="date"
                    min={pickupDate || new Date().toISOString().split('T')[0]}
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className={inputClass}
                    required
                  />
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button className="w-full sm:w-auto px-6 py-3 rounded-xl bg-primary hover:bg-primary-dull text-white font-semibold flex items-center justify-center gap-2 min-w-44 hover:shadow-lg">
                  <img src={assets.search_icon} alt="search" className="w-4 h-4 brightness-300" />
                  Search Cars
                </button>
              </div>
            </form>

            <div className="mt-4 grid grid-cols-3 gap-3 max-w-xl">
              <div className="rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Advance</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">20% - 30%</p>
              </div>
              <div className="rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Negotiation</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">3 Rounds</p>
              </div>
              <div className="rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Coverage</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">State + City Filters</p>
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
