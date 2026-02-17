import React from 'react';
import { useNavigate } from 'react-router-dom';
import { assets } from '../assets/assets';
import { isAdmin } from '../utils/auth';

const resolveFleetStatus = (car) => {
  const normalized = String(car?.fleetStatus || '').trim();
  if (normalized) return normalized;
  return car?.isAvailable ? 'Available' : 'Inactive';
};

const getFleetBadgeClass = (fleetStatus) => {
  if (fleetStatus === 'Available') return 'bg-primary text-white';
  if (fleetStatus === 'Reserved') return 'bg-amber-500 text-white';
  if (fleetStatus === 'Rented') return 'bg-blue-600 text-white';
  if (fleetStatus === 'Maintenance') return 'bg-orange-500 text-white';
  return 'bg-red-500 text-white';
};

const CarCard = ({ car }) => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const navigate = useNavigate();
  const admin = isAdmin();
  const fleetStatus = resolveFleetStatus(car);
  const canOpenDetails = admin || fleetStatus === 'Available';

  const openDetails = () => {
    if (!canOpenDetails) return;
    navigate(`/car-details/${car._id}`);
    window.scrollTo(0, 0);
  };

  return (
    <div
      onClick={openDetails}
      className={`group rounded-2xl overflow-hidden border border-borderColor bg-white transition-all duration-300 shadow-sm ${
        canOpenDetails
          ? 'hover:-translate-y-1 hover:shadow-xl cursor-pointer'
          : 'opacity-65 cursor-not-allowed'
      }`}
    >
      <div className="relative h-48 overflow-hidden">
        <img
          src={car.image}
          alt="car-img"
          className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
        />

        <div className="absolute top-3 left-3 flex flex-col gap-1">
          <p
            className={`text-[11px] px-2 py-1 rounded-full font-medium ${getFleetBadgeClass(fleetStatus)}`}
          >
            {fleetStatus === 'Available' ? 'Available Now' : fleetStatus}
          </p>
          {fleetStatus === 'Available' ? (
            <p className="text-[11px] px-2 py-1 rounded-full font-medium bg-emerald-600 text-white">Negotiation Open</p>
          ) : (
            <p className="text-[11px] px-2 py-1 rounded-full font-medium bg-slate-500 text-white">Not Bookable</p>
          )}
        </div>

        <div className="absolute right-3 bottom-3 bg-black/80 text-white px-3 py-1.5 rounded-lg">
          <span className="font-semibold">
            {currency}
            {car.pricePerDay}
          </span>
          <span className="text-xs text-white/80"> / day</span>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 leading-tight">
              {car.brand} {car.model}
            </h3>
            <p className="text-xs text-gray-500 mt-1">
              {car.category} | {car.year}
            </p>
          </div>
          <span className="text-[11px] px-2 py-1 rounded-full bg-light border border-borderColor text-gray-600">Dynamic Advance</span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-y-2 text-gray-600">
          <div className="flex items-center text-sm">
            <img src={assets.users_icon} alt="seats" className="h-4 mr-2" />
            <span>{car.seating_capacity} Seats</span>
          </div>
          <div className="flex items-center text-sm">
            <img src={assets.fuel_icon} alt="fuel" className="h-4 mr-2" />
            <span>{car.fuel_type}</span>
          </div>
          <div className="flex items-center text-sm">
            <img src={assets.car_icon} alt="transmission" className="h-4 mr-2" />
            <span>{car.transmission}</span>
          </div>
          <div className="flex items-center text-sm">
            <img src={assets.location_icon} alt="location" className="h-4 mr-2" />
            <span>{car.location}</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CarCard;

