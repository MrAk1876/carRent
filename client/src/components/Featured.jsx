import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assets } from '../assets/assets';
import { getLocationAwareCars } from '../services/carService';
import { getUser } from '../utils/auth';
import CarCard from './CarCard';
import ScrollReveal from './ui/ScrollReveal';
import SkeletonCard from './ui/SkeletonCard';

const Featured = () => {
  const navigate = useNavigate();
  const [localCars, setLocalCars] = useState([]);
  const [fallbackCars, setFallbackCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');
  const currentUser = getUser();

  useEffect(() => {
    const fetchFeaturedCars = async () => {
      try {
        setLoading(true);
        const inventory = await getLocationAwareCars({
          userLocation: {
            stateId: currentUser?.stateId,
            cityId: currentUser?.cityId,
            locationId: currentUser?.locationId,
            stateName: currentUser?.stateName,
            cityName: currentUser?.cityName,
            locationName: currentUser?.locationName,
          },
        });
        setLocalCars((inventory.localCars || []).slice(0, 6));
        setFallbackCars((inventory.fallbackCars || []).slice(0, 6));
        setErrorMsg('');
      } catch {
        setLocalCars([]);
        setFallbackCars([]);
        setErrorMsg('Failed to load featured cars');
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedCars();
  }, [
    currentUser?.cityId,
    currentUser?.cityName,
    currentUser?.locationId,
    currentUser?.locationName,
    currentUser?.stateId,
    currentUser?.stateName,
  ]);

  const visibleCars = localCars.length > 0 ? localCars : fallbackCars;
  const showFallbackSection = localCars.length > 0 && fallbackCars.length > 0;

  return (
    <section className="py-20 px-4 md:px-8 xl:px-10">
      <div className="max-w-330 mx-auto">
        <ScrollReveal>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <p className="inline-flex px-3 py-1 rounded-full text-xs bg-primary/10 text-primary font-medium">
                Live Inventory
              </p>
              <h2 className="mt-3 text-3xl md:text-4xl font-semibold text-slate-900">Featured Vehicles</h2>
              <p className="mt-2 text-slate-600 max-w-2xl">
                Cars from your city appear first. Other-city cars are shown only when local inventory is limited.
              </p>
            </div>

            <button
              onClick={() => {
                navigate('/cars');
                window.scrollTo(0, 0);
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-borderColor hover:bg-light text-sm font-medium w-max transition-all hover:shadow-sm"
            >
              Browse All Cars <img src={assets.arrow_icon} alt="arrow" className="w-4 h-4" />
            </button>
          </div>
        </ScrollReveal>

        {errorMsg ? <p className="text-sm text-red-500 mt-6">{errorMsg}</p> : null}

        {loading ? (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonCard key={`featured-skeleton-${index}`} />
            ))}
          </div>
        ) : visibleCars.length === 0 && !errorMsg ? (
          <p className="text-sm text-gray-500 mt-8">No cars available right now.</p>
        ) : (
          <>
            <div className="mt-8 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  {localCars.length > 0 ? 'Cars in your location' : 'Cars currently available'}
                </p>
                <p className="text-sm text-slate-500">
                  {localCars.length > 0
                    ? 'Pickup locations from your default pickup area.'
                    : 'Your pickup location has limited inventory, so fallback cars are shown below.'}
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
              {visibleCars.map((car, index) => (
                <ScrollReveal key={car._id} delay={index * 70} once direction="up">
                  <CarCard car={car} />
                </ScrollReveal>
              ))}
            </div>

            {showFallbackSection ? (
              <div className="mt-10">
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
                  <p className="text-sm font-semibold text-amber-900">Other-city fallback inventory</p>
                  <p className="mt-1 text-sm text-amber-800">
                    These cars are outside your default pickup location and are clearly labeled before booking.
                  </p>
                </div>
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
                  {fallbackCars.map((car, index) => (
                    <ScrollReveal key={`fallback-${car._id}`} delay={index * 70} once direction="up">
                      <CarCard car={car} />
                    </ScrollReveal>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
};

export default Featured;
