import React, { useEffect, useState } from 'react';
import { assets } from '../assets/assets';
import { getPublicReviews } from '../services/reviewService';
import ScrollReveal from './ui/ScrollReveal';
import { resolveImageUrl } from '../utils/image';

const ReviewSkeleton = () => (
  <div className="rounded-xl border border-white/30 bg-white/15 p-5 animate-pulse">
    <div className="flex items-center gap-3">
      <div className="w-11 h-11 rounded-full bg-white/30" />
      <div className="space-y-2">
        <div className="h-3 w-24 bg-white/40 rounded" />
        <div className="h-2.5 w-20 bg-white/25 rounded" />
      </div>
    </div>
    <div className="h-4 w-24 bg-white/35 rounded mt-4" />
    <div className="h-3 w-full bg-white/25 rounded mt-3" />
    <div className="h-3 w-4/5 bg-white/20 rounded mt-2" />
  </div>
);

const Testimonial = () => {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setLoading(true);
        const data = await getPublicReviews(3);
        setReviews(data);
      } catch {
        setReviews([]);
      } finally {
        setLoading(false);
      }
    };

    fetchReviews();
  }, []);

  const renderStars = (rating) => {
    const safeRating = Math.max(1, Math.min(5, Number(rating) || 0));
    return Array(5)
      .fill(0)
      .map((_, idx) => (
        <img
          key={`star-${idx}`}
          src={assets.starIconColored}
          alt="star"
          className={`w-4 h-4 ${idx < safeRating ? 'opacity-100' : 'opacity-25'}`}
        />
      ));
  };

  return (
    <section className="py-20 px-4 md:px-8 xl:px-10">
      <ScrollReveal once>
        <div className="max-w-330 mx-auto rounded-[30px] border border-slate-200 bg-linear-to-br from-slate-900 via-slate-800 to-blue-900 p-6 md:p-8 lg:p-10">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
            <div>
              <p className="inline-flex px-3 py-1 rounded-full text-xs bg-white/15 text-white font-medium">
                Verified Feedback
              </p>
              <h2 className="mt-3 text-3xl md:text-4xl font-semibold text-white">What Our Customers Say</h2>
              <p className="mt-2 text-white/80 max-w-2xl">
                Real reviews from users who completed bookings through CarRental.
              </p>
            </div>
            <div className="text-sm text-white/80">
              {loading ? 'Loading reviews...' : `${reviews.length} review(s) highlighted`}
            </div>
          </div>

          {!loading && reviews.length === 0 ? (
            <div className="mt-8 bg-white/10 border border-white/20 rounded-xl p-6 text-center text-white/90">
              No customer reviews yet. Be the first to share your rental experience.
            </div>
          ) : null}

          <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {loading
              ? Array.from({ length: 3 }).map((_, index) => <ReviewSkeleton key={`review-skeleton-${index}`} />)
              : reviews.map((review, index) => {
                  const fullName = `${review.user?.firstName || 'Verified'} ${
                    review.user?.lastName || 'User'
                  }`.trim();
                  const location = review.user?.address || review.car?.location || 'CarRental User';
                  const image = resolveImageUrl(review.user?.image) || assets.user_profile;
                  return (
                    <ScrollReveal key={review._id} delay={index * 80} direction="up">
                      <div className="rounded-xl border border-white/60 bg-white text-slate-800 p-5 shadow-lg">
                        <div className="flex items-center gap-3">
                          <img
                            src={image}
                            alt={fullName}
                            className="w-11 h-11 rounded-full object-cover border border-borderColor"
                          />
                          <div>
                            <p className="font-semibold">{fullName}</p>
                            <p className="text-xs text-gray-500">{location}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1 mt-3">{renderStars(review.rating)}</div>

                        <p className="text-sm text-gray-600 mt-3">"{review.comment}"</p>

                        {review.car ? (
                          <p className="mt-3 text-xs inline-flex px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                            {review.car.brand} {review.car.model}
                          </p>
                        ) : null}
                      </div>
                    </ScrollReveal>
                  );
                })}
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
};

export default Testimonial;
