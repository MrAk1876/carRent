import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { assets } from '../assets/assets';
import { isLoggedIn } from '../utils/auth';
import MakeOfferForm from '../features/offers/components/MakeOfferForm';
import InlineSpinner from '../components/ui/InlineSpinner';
import ScrollReveal from '../components/ui/ScrollReveal';
import { getErrorMessage } from '../api';
import { getCarById } from '../services/carService';
import { getCarReviews } from '../services/reviewService';
import { createBookingRequest } from '../services/requestService';

const parseCarFeatures = (features) => {
  const parsed = [];

  for (const item of features || []) {
    if (Array.isArray(item)) {
      parsed.push(...item);
      continue;
    }

    if (typeof item !== 'string') continue;

    try {
      const maybeArray = JSON.parse(item);
      if (Array.isArray(maybeArray)) {
        parsed.push(...maybeArray);
      } else {
        parsed.push(item);
      }
    } catch {
      parsed.push(item);
    }
  }

  return [...new Set(parsed.map((value) => String(value).trim()).filter(Boolean))];
};

const calculateBookingDays = (startDate, endDate) => {
  if (!startDate || !endDate) return 0;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  const diffMs = end - start;
  if (diffMs < 0) return 0;

  return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
};

const ReviewSkeleton = () => (
  <div className="rounded-lg border border-borderColor bg-light/50 p-3 animate-pulse">
    <div className="flex items-center justify-between gap-2">
      <div className="space-y-2">
        <div className="h-3 w-28 rounded bg-slate-200" />
        <div className="h-2.5 w-20 rounded bg-slate-200" />
      </div>
      <div className="h-4 w-20 rounded bg-slate-200" />
    </div>
    <div className="mt-3 h-3 w-full rounded bg-slate-200" />
    <div className="mt-2 h-3 w-3/4 rounded bg-slate-200" />
  </div>
);

const CarDetailSkeleton = () => (
  <div className="px-4 md:px-10 lg:px-16 xl:px-24 mt-14 mb-16 animate-pulse">
    <div className="h-5 w-32 rounded bg-slate-200" />
    <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_1fr] gap-8 mt-6">
      <div className="space-y-6">
        <div className="rounded-2xl border border-borderColor bg-white p-4">
          <div className="h-95 rounded-xl bg-slate-200" />
        </div>
        <div className="rounded-2xl border border-borderColor bg-white p-6 space-y-3">
          <div className="h-8 w-56 rounded bg-slate-200" />
          <div className="h-4 w-36 rounded bg-slate-200" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={`meta-skeleton-${index}`} className="h-20 rounded bg-slate-200" />
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-borderColor bg-white p-6">
        <div className="h-8 w-32 rounded bg-slate-200" />
        <div className="h-4 w-44 rounded bg-slate-200 mt-2" />
        <div className="h-28 rounded bg-slate-200 mt-5" />
        <div className="h-11 rounded bg-slate-200 mt-5" />
        <div className="h-11 rounded bg-slate-200 mt-3" />
        <div className="h-11 rounded bg-slate-200 mt-5" />
      </div>
    </div>
  </div>
);

const CarDetail = () => {
  const currency = import.meta.env.VITE_CURRENCY || '$';
  const { id } = useParams();
  const navigate = useNavigate();

  const [car, setCar] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [carLoading, setCarLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [carError, setCarError] = useState('');
  const [reviewsError, setReviewsError] = useState('');

  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [offerSuccessMsg, setOfferSuccessMsg] = useState('');

  const loadDetailData = useCallback(async (isCancelled = () => false) => {
    setCarLoading(true);
    setReviewsLoading(true);
    setCarError('');
    setReviewsError('');

    const [carResult, reviewResult] = await Promise.allSettled([getCarById(id), getCarReviews(id)]);
    if (isCancelled()) return;

    if (carResult.status === 'fulfilled') {
      setCar(carResult.value);
    } else {
      setCar(null);
      setCarError('Failed to load car details. Please try again.');
    }

    if (reviewResult.status === 'fulfilled') {
      setReviews(Array.isArray(reviewResult.value) ? reviewResult.value : []);
    } else {
      setReviews([]);
      setReviewsError('Reviews are not available right now.');
    }

    setCarLoading(false);
    setReviewsLoading(false);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    loadDetailData(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [loadDetailData]);

  const totalDays = useMemo(() => calculateBookingDays(fromDate, toDate), [fromDate, toDate]);
  const totalAmount = useMemo(() => (car ? totalDays * Number(car.pricePerDay || 0) : 0), [car, totalDays]);
  const advanceAmount = useMemo(() => Math.round(totalAmount * 0.3), [totalAmount]);
  const features = useMemo(() => parseCarFeatures(car?.features), [car?.features]);

  const averageRating = useMemo(() => {
    if (!reviews.length) return 0;
    const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    return Number((total / reviews.length).toFixed(1));
  }, [reviews]);

  const handleBooking = async (event) => {
    event.preventDefault();
    setBookingError('');

    if (!fromDate || !toDate) {
      setBookingError('Please select pickup and return dates.');
      return;
    }

    if (!isLoggedIn()) {
      setBookingError('Please log in to continue.');
      return;
    }

    if (new Date(toDate) < new Date(fromDate)) {
      setBookingError('Return date must be same as or after pickup date.');
      return;
    }

    if (!car?._id) {
      setBookingError('Car details are not loaded. Please refresh the page.');
      return;
    }

    try {
      setBookingLoading(true);
      await createBookingRequest({
        carId: car._id,
        fromDate,
        toDate,
      });
      navigate('/my-bookings');
    } catch (error) {
      setBookingError(getErrorMessage(error, 'Booking failed. Please try again.'));
    } finally {
      setBookingLoading(false);
    }
  };

  if (carLoading) return <CarDetailSkeleton />;

  if (!car) {
    return (
      <div className="px-4 md:px-10 lg:px-16 xl:px-24 mt-14 mb-16">
        <div className="max-w-2xl mx-auto rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <h2 className="text-xl font-semibold text-red-700">Unable to load car details</h2>
          <p className="text-sm text-red-600 mt-2">{carError || 'Please try again.'}</p>
          <button
            type="button"
            onClick={loadDetailData}
            className="mt-4 px-5 py-2.5 rounded-lg bg-red-600 text-white hover:bg-red-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 md:px-10 lg:px-16 xl:px-24 mt-14 mb-16">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 mb-6 text-sm text-gray-500 hover:text-gray-700"
      >
        <img src={assets.arrow_icon} alt="arrow" className="rotate-180 opacity-65" />
        Back To All Cars
      </button>

      <div className="grid grid-cols-1 xl:grid-cols-[1.45fr_1fr] gap-8">
        <ScrollReveal direction="left" className="space-y-6">
          <div className="rounded-2xl bg-linear-to-br from-slate-50 via-white to-blue-50 border border-borderColor p-4 md:p-5">
            <img src={car.image} alt="car" className="w-full max-h-107.5 object-cover rounded-xl" />
          </div>

          <div className="rounded-2xl border border-borderColor bg-white p-5 md:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-3xl font-semibold text-gray-900">
                  {car.brand} {car.model}
                </h1>
                <p className="text-gray-500 mt-1">
                  {car.category} | {car.year}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-gray-500">Price / day</p>
                <p className="text-2xl font-semibold text-primary">
                  {currency}
                  {car.pricePerDay}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5">
              <div className="rounded-lg border border-borderColor bg-light px-3 py-4 text-center">
                <img src={assets.users_icon} alt="seats" className="h-5 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">{car.seating_capacity} Seats</p>
              </div>
              <div className="rounded-lg border border-borderColor bg-light px-3 py-4 text-center">
                <img src={assets.fuel_icon} alt="fuel" className="h-5 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">{car.fuel_type}</p>
              </div>
              <div className="rounded-lg border border-borderColor bg-light px-3 py-4 text-center">
                <img src={assets.car_icon} alt="transmission" className="h-5 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">{car.transmission}</p>
              </div>
              <div className="rounded-lg border border-borderColor bg-light px-3 py-4 text-center">
                <img src={assets.location_icon} alt="location" className="h-5 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-700">{car.location}</p>
              </div>
            </div>

            {features.length > 0 ? (
              <div className="mt-6">
                <h2 className="text-lg font-semibold text-gray-800">Car Features</h2>
                <ul className="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-4 mt-3">
                  {features.map((item, index) => (
                    <li key={`${item}-${index}`} className="flex items-center text-sm text-gray-600">
                      <img src={assets.check_icon} alt="check" className="h-4 mr-2" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-borderColor bg-white p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">Customer Reviews</h2>
                <p className="text-sm text-gray-500 mt-1">Real feedback from renters who booked this car.</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500">Average Rating</p>
                <p className="text-xl font-semibold text-primary">{averageRating || 0}/5</p>
                <p className="text-xs text-gray-500">{reviews.length} review(s)</p>
              </div>
            </div>

            {reviewsLoading ? (
              <div className="mt-4 space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <ReviewSkeleton key={`review-skeleton-${index}`} />
                ))}
              </div>
            ) : null}

            {!reviewsLoading && reviewsError ? <p className="text-sm text-amber-600 mt-4">{reviewsError}</p> : null}
            {!reviewsLoading && !reviewsError && reviews.length === 0 ? (
              <p className="text-sm text-gray-500 mt-4">No reviews yet for this car.</p>
            ) : null}

            {!reviewsLoading && reviews.length > 0 ? (
              <div className="mt-4 space-y-3">
                {reviews.slice(0, 6).map((review) => {
                  const firstName = review.user?.firstName || 'Verified';
                  const lastName = review.user?.lastName || 'User';
                  const fullName = `${firstName} ${lastName}`.trim();

                  return (
                    <div key={review._id} className="rounded-lg border border-borderColor p-3 bg-light/40">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-800">{fullName}</p>
                          <p className="text-xs text-gray-500">
                            {review.createdAt ? new Date(review.createdAt).toLocaleDateString() : 'Recently'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: 5 }).map((_, index) => (
                            <img
                              key={`${review._id}-star-${index}`}
                              src={assets.star_icon}
                              alt="star"
                              className={`w-4 h-4 ${index < Number(review.rating || 0) ? 'opacity-100' : 'opacity-25'}`}
                            />
                          ))}
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mt-2">"{review.comment}"</p>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </ScrollReveal>

        <ScrollReveal direction="right" delay={90}>
          <form
            onSubmit={handleBooking}
            className="xl:sticky xl:top-18 h-max rounded-2xl border border-borderColor bg-white p-5 md:p-6 space-y-5 shadow-sm"
          >
            <div className="flex items-end justify-between gap-2 border-b border-borderColor pb-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-500">Your Booking Quote</p>
                <p className="text-3xl font-semibold text-gray-900">
                  {currency} {totalAmount || 0}
                </p>
              </div>
              <p className="text-xs text-gray-500 text-right">
                {car.pricePerDay} / day x {totalDays || 0} day(s)
              </p>
            </div>

            <div className="rounded-lg border border-borderColor bg-light p-4 text-sm">
              <p className="font-medium text-gray-700">Advance Payment Required</p>
              <p className="text-gray-500 mt-1">
                Pay <span className="font-semibold text-gray-700">30%</span> advance before final admin approval.
              </p>
              <p className="text-xs text-gray-400 mt-1">Refundable if admin rejects the booking request.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
              <div>
                <label className="text-sm text-gray-600">Pickup Date</label>
                <input
                  type="date"
                  value={fromDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(event) => {
                    const nextFromDate = event.target.value;
                    setFromDate(nextFromDate);
                    if (toDate && nextFromDate > toDate) setToDate(nextFromDate);
                  }}
                  className="border border-borderColor px-3 py-2 rounded-lg w-full mt-1"
                  required
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">Return Date</label>
                <input
                  type="date"
                  value={toDate}
                  min={fromDate || new Date().toISOString().split('T')[0]}
                  onChange={(event) => setToDate(event.target.value)}
                  disabled={!fromDate}
                  className="border border-borderColor px-3 py-2 rounded-lg w-full mt-1"
                  required
                />
              </div>
            </div>

            {bookingError ? <p className="text-red-500 text-sm">{bookingError}</p> : null}

            <MakeOfferForm
              carId={car._id}
              fromDate={fromDate}
              toDate={toDate}
              originalPrice={totalAmount}
              onSuccess={() => {
                setOfferSuccessMsg('Offer sent successfully. Track it in My Bookings.');
              }}
            />

            {offerSuccessMsg ? <p className="text-green-600 text-xs">{offerSuccessMsg}</p> : null}

            <div className="rounded-lg bg-light border border-borderColor p-4 text-sm space-y-1">
              <p className="flex justify-between">
                <span>Total Amount</span>
                <span>
                  {currency} {totalAmount || 0}
                </span>
              </p>
              <p className="flex justify-between">
                <span>Advance (30%)</span>
                <span>
                  {currency} {advanceAmount || 0}
                </span>
              </p>
            </div>

            <button
              type="submit"
              disabled={bookingLoading}
              className={`w-full py-3 text-white rounded-lg font-medium inline-flex items-center justify-center gap-2 ${
                bookingLoading ? 'bg-gray-400 cursor-not-allowed' : 'bg-primary hover:bg-primary-dull'
              }`}
            >
              {bookingLoading ? (
                <>
                  <InlineSpinner size="sm" className="border-white/40 border-t-white" />
                  Booking...
                </>
              ) : (
                'Book Now'
              )}
            </button>
          </form>
        </ScrollReveal>
      </div>
    </div>
  );
};

export default CarDetail;
