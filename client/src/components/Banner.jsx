import React from 'react';
import { assets } from '../assets/assets';

const Banner = () => {
  return (
    <div className="flex flex-col-reverse md:flex-row md:items-start items-center justify-between px-5 sm:px-8 md:pl-12 md:pr-10 py-8 md:py-10 bg-linear-to-r from-[#0558FE] to-[#A9CFFF] max-w-6xl mx-3 md:mx-auto rounded-2xl overflow-hidden gap-6 md:gap-8">
      <div className="text-white text-center md:text-left">
        <h2 className="text-2xl sm:text-3xl font-medium">Do You Own a Luxury Car?</h2>
        <p className="mt-2 text-sm sm:text-base">Monetize your vehicle effortlessly by listing it on CarRental.</p>
        <p className="mt-1 max-w-2xl text-white/95 text-sm sm:text-base">
          We take care of insurance, driver verification and secure payments, so you can earn passive income without
          hassle.
        </p>
        <button className="px-6 py-2 bg-white hover:bg-slate-100 transition-all text-primary rounded-lg text-sm mt-4 cursor-pointer">
          List Your Car
        </button>
      </div>

      <img
        src={assets.banner_car_image}
        alt="car"
        className="w-full max-w-90 md:max-w-105 h-auto object-contain"
      />
    </div>
  );
};

export default Banner;
