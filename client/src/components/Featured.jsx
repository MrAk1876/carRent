import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { assets } from '../assets/assets';
import { getFeaturedCars } from '../services/carService';
import CarCard from './CarCard';
import ScrollReveal from './ui/ScrollReveal';
import SkeletonCard from './ui/SkeletonCard';

const Featured = () => {
  const navigate = useNavigate();
  const [cars, setCars] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    const fetchFeaturedCars = async () => {
      try {
        setLoading(true);
        const featuredCars = await getFeaturedCars(6);
        setCars(featuredCars);
        setErrorMsg('');
      } catch {
        setCars([]);
        setErrorMsg('Failed to load featured cars');
      } finally {
        setLoading(false);
      }
    };

    fetchFeaturedCars();
  }, []);

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
                Handpicked cars with active availability and negotiation support.
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
        ) : cars.length === 0 && !errorMsg ? (
          <p className="text-sm text-gray-500 mt-8">No featured cars available right now.</p>
        ) : (
          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-6">
            {cars.map((car, index) => (
              <ScrollReveal key={car._id} delay={index * 70} once direction="up">
                <CarCard car={car} />
              </ScrollReveal>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default Featured;
