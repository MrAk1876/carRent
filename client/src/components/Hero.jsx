import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assets, cityList } from '../assets/assets';
import ScrollReveal from './ui/ScrollReveal';
import TypingText from './ui/TypingText';
import useNotify from '../hooks/useNotify';

const Hero = () => {
  const navigate = useNavigate();
  const notify = useNotify();
  const [pickupLocation, setPickupLocation] = useState('');
  const [pickupDate, setPickupDate] = useState('');
  const [returnDate, setReturnDate] = useState('');

  const handleSearch = (e) => {
    e.preventDefault();
    if (!pickupLocation || !pickupDate || !returnDate) {
      notify.error('Please fill all fields');
      return;
    }
    navigate('/cars');
    window.scrollTo(0, 0);
  };

  return (
    <section className="relative overflow-hidden bg-linear-to-b from-slate-100 via-[#f5f8ff] to-white">
      <div className="absolute -top-40 -left-30 w-105 h-105 bg-primary/15 rounded-full blur-3xl" />
      <div className="absolute top-10 -right-30 w-110 h-110 bg-cyan-200/40 rounded-full blur-3xl" />

      <div className="relative max-w-330 mx-auto px-4 md:px-8 xl:px-10 pt-16 pb-16 md:pb-20">
        <div className="grid grid-cols-1 xl:grid-cols-[1.05fr_0.95fr] gap-8 xl:gap-10 items-center">
          <ScrollReveal direction="left">
            <p className="inline-flex items-center gap-2 text-xs md:text-sm px-4 py-1.5 rounded-full border border-borderColor bg-white/90 text-gray-600">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Premium Fleet - Negotiation Enabled
            </p>

            <h1 className="mt-5 text-4xl md:text-5xl xl:text-6xl font-semibold leading-[1.08] tracking-tight text-slate-900">
              Drive the Right Car
              <span className="block text-primary mt-1">
                <TypingText
                  words={['At the Right Price', 'With Smart Negotiation', 'Without Hidden Surprises']}
                />
              </span>
            </h1>

            <p className="mt-5 text-base md:text-lg text-slate-600 max-w-2xl">
              Book instantly, negotiate up to 3 rounds, and pay only 30% advance before final admin
              approval.
            </p>

            <form
              onSubmit={handleSearch}
              className="mt-8 rounded-2xl border border-borderColor bg-white p-4 md:p-5 shadow-[0_14px_35px_rgba(15,23,42,0.08)]"
            >
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-[1.05fr_1fr_1fr_auto] gap-3">
                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-500">Pickup Location</label>
                  <select
                    required
                    value={pickupLocation}
                    onChange={(e) => setPickupLocation(e.target.value)}
                    className="mt-1.5 border border-borderColor rounded-lg px-3 py-2.5 text-sm w-full bg-white"
                  >
                    <option value="">Select location</option>
                    {cityList.map((city) => (
                      <option value={city} key={city}>
                        {city}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-500">Pickup Date</label>
                  <input
                    type="date"
                    min={new Date().toISOString().split('T')[0]}
                    value={pickupDate}
                    onChange={(e) => setPickupDate(e.target.value)}
                    className="mt-1.5 border border-borderColor rounded-lg px-3 py-2.5 text-sm w-full"
                    required
                  />
                </div>

                <div>
                  <label className="text-xs uppercase tracking-wide text-slate-500">Return Date</label>
                  <input
                    type="date"
                    min={pickupDate || new Date().toISOString().split('T')[0]}
                    value={returnDate}
                    onChange={(e) => setReturnDate(e.target.value)}
                    className="mt-1.5 border border-borderColor rounded-lg px-3 py-2.5 text-sm w-full"
                    required
                  />
                </div>

                <button className="xl:self-end mt-1 md:mt-0 px-6 py-2.5 rounded-lg bg-primary hover:bg-primary-dull text-white font-medium flex items-center justify-center gap-2 min-w-42.5 hover:shadow-lg">
                  <img src={assets.search_icon} alt="search" className="w-4 h-4 brightness-300" />
                  Search Cars
                </button>
              </div>
            </form>

            <div className="mt-4 grid grid-cols-3 gap-3 max-w-xl">
              <div className="rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Advance</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">30%</p>
              </div>
              <div className="rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Negotiation</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">3 Rounds</p>
              </div>
              <div className="rounded-xl border border-borderColor bg-white/90 px-3 py-2.5">
                <p className="text-[11px] uppercase tracking-wide text-slate-500">Coverage</p>
                <p className="text-sm font-semibold text-slate-800 mt-0.5">4+ Cities</p>
              </div>
            </div>
          </ScrollReveal>

          <ScrollReveal className="w-full" direction="right" delay={90}>
            <div className="relative mx-auto max-w-147.5 rounded-[28px] border border-borderColor bg-white/85 backdrop-blur p-4 md:p-6 shadow-[0_16px_44px_rgba(37,99,235,0.16)]">
              <div className="absolute top-5 right-5 text-[11px] px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                30% Advance
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
