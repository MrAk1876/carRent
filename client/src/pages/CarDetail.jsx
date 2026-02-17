import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { assets } from '../assets/assets';
import { isAdmin, isLoggedIn } from '../utils/auth';
import MakeOfferForm from '../features/offers/components/MakeOfferForm';
import InlineSpinner from '../components/ui/InlineSpinner';
import ScrollReveal from '../components/ui/ScrollReveal';
import { getErrorMessage } from '../api';
import { getCarById } from '../services/carService';
import { getCarReviews } from '../services/reviewService';
import { createBookingRequest } from '../services/requestService';
import useNotify from '../hooks/useNotify';
import {
  calculateAdvanceBreakdown,
  calculateTimeBasedRentalAmount,
  getRentalDurationHours,
} from '../utils/payment';
import { getMySubscription } from '../services/subscriptionService';

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

const resolveFleetStatus = (car) => {
  const normalized = String(car?.fleetStatus || '').trim();
  if (normalized) return normalized;
  return car?.isAvailable ? 'Available' : 'Inactive';
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const PAST_TOLERANCE_MS = 60 * 1000;
const DEFAULT_PICKUP_BUFFER_MINUTES = 5;
const TIME_HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const TIME_MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const TIME_PERIODS = ['AM', 'PM'];

const toLocalDateInputValue = (date = new Date()) => {
  const timezoneAdjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return timezoneAdjusted.toISOString().slice(0, 10);
};

const to12HourParts = (date = new Date()) => {
  const hours24 = date.getHours();
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;

  return {
    hour: String(hours12).padStart(2, '0'),
    minute: String(date.getMinutes()).padStart(2, '0'),
    period,
  };
};

const getFutureRoundedDate = (bufferMinutes = DEFAULT_PICKUP_BUFFER_MINUTES) => {
  const date = new Date();
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + Math.max(Number(bufferMinutes || 0), 0));
  return date;
};

const getDefaultTimeParts = () => to12HourParts(getFutureRoundedDate());

const to24HourValue = (hourValue, minuteValue, periodValue) => {
  const hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return '';
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return '';

  let normalizedHour = hour % 12;
  if (String(periodValue).toUpperCase() === 'PM') {
    normalizedHour += 12;
  }

  return `${String(normalizedHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

const buildIsoDateTime = (dateValue, hourValue, minuteValue, periodValue) => {
  if (!dateValue) return '';
  const normalized24Hour = to24HourValue(hourValue, minuteValue, periodValue);
  if (!normalized24Hour) return '';

  const parsed = new Date(`${dateValue}T${normalized24Hour}:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString();
};

const roundCurrency = (value) => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return 0;
  return Number(numericValue.toFixed(2));
};

const calculateSubscriptionPreview = ({
  baseAmount = 0,
  pickupDateTimeIso,
  dropDateTimeIso,
  remainingRentalHours = 0,
}) => {
  const safeBaseAmount = roundCurrency(baseAmount);
  const rentalHours = Math.max(Number(getRentalDurationHours(pickupDateTimeIso, dropDateTimeIso) || 0), 0);
  const availableHours = Math.max(Number(remainingRentalHours || 0), 0);
  if (safeBaseAmount <= 0 || rentalHours <= 0) {
    return {
      rentalHours,
      availableHours,
      coveredHours: 0,
      coverageAmount: 0,
      extraAmount: safeBaseAmount,
    };
  }

  const coveredHours = Math.min(availableHours, rentalHours);
  const coverageRatio = coveredHours / rentalHours;
  const coverageAmount = roundCurrency(safeBaseAmount * coverageRatio);
  const extraAmount = roundCurrency(Math.max(safeBaseAmount - coverageAmount, 0));

  return {
    rentalHours: Number(rentalHours.toFixed(2)),
    availableHours: Number(availableHours.toFixed(2)),
    coveredHours: Number(coveredHours.toFixed(2)),
    coverageAmount,
    extraAmount,
  };
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
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const { id } = useParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const admin = isAdmin();

  const [car, setCar] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [carLoading, setCarLoading] = useState(true);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [carError, setCarError] = useState('');
  const [reviewsError, setReviewsError] = useState('');

  const [pickupDate, setPickupDate] = useState('');
  const [pickupHour, setPickupHour] = useState(() => getDefaultTimeParts().hour);
  const [pickupMinute, setPickupMinute] = useState(() => getDefaultTimeParts().minute);
  const [pickupPeriod, setPickupPeriod] = useState(() => getDefaultTimeParts().period);
  const [dropDate, setDropDate] = useState('');
  const [dropHour, setDropHour] = useState(() => getDefaultTimeParts().hour);
  const [dropMinute, setDropMinute] = useState(() => getDefaultTimeParts().minute);
  const [dropPeriod, setDropPeriod] = useState(() => getDefaultTimeParts().period);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState('');
  const [offerSuccessMsg, setOfferSuccessMsg] = useState('');
  const [activeSubscription, setActiveSubscription] = useState(null);
  const [useSubscription, setUseSubscription] = useState(false);

  const loadDetailData = useCallback(async (isCancelled = () => false) => {
    setCarLoading(true);
    setReviewsLoading(true);
    setCarError('');
    setReviewsError('');

    const [carResult, reviewResult, subscriptionResult] = await Promise.allSettled([
      getCarById(id),
      getCarReviews(id),
      isLoggedIn() && !admin ? getMySubscription() : Promise.resolve(null),
    ]);
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

    if (subscriptionResult.status === 'fulfilled') {
      setActiveSubscription(subscriptionResult.value?.activeSubscription || null);
    } else {
      setActiveSubscription(null);
    }

    setCarLoading(false);
    setReviewsLoading(false);
  }, [id, admin]);

  useEffect(() => {
    let cancelled = false;
    loadDetailData(() => cancelled);

    return () => {
      cancelled = true;
    };
  }, [loadDetailData]);

  const todayDate = useMemo(() => toLocalDateInputValue(new Date()), []);
  const pickupDateTimeIso = useMemo(
    () => buildIsoDateTime(pickupDate, pickupHour, pickupMinute, pickupPeriod),
    [pickupDate, pickupHour, pickupMinute, pickupPeriod],
  );
  const dropDateTimeIso = useMemo(
    () => buildIsoDateTime(dropDate, dropHour, dropMinute, dropPeriod),
    [dropDate, dropHour, dropMinute, dropPeriod],
  );

  const { days: totalDays, amount: totalAmount } = useMemo(
    () => calculateTimeBasedRentalAmount(pickupDateTimeIso, dropDateTimeIso, car?.pricePerDay),
    [pickupDateTimeIso, dropDateTimeIso, car?.pricePerDay],
  );
  const subscriptionBranchId = useMemo(() => {
    if (!activeSubscription) return '';
    const planBranch = activeSubscription?.planId?.branchId || activeSubscription?.branchId || null;
    if (!planBranch) return '';
    if (typeof planBranch === 'string') return planBranch;
    return planBranch?._id || '';
  }, [activeSubscription]);
  const carBranchId = useMemo(() => {
    const branch = car?.branchId || null;
    if (!branch) return '';
    if (typeof branch === 'string') return branch;
    return branch?._id || '';
  }, [car]);
  const subscriptionEligibleForCar = useMemo(() => {
    if (!activeSubscription) return false;
    if (!subscriptionBranchId) return true;
    if (!carBranchId) return false;
    return subscriptionBranchId === carBranchId;
  }, [activeSubscription, subscriptionBranchId, carBranchId]);
  const subscriptionPreview = useMemo(
    () =>
      calculateSubscriptionPreview({
        baseAmount: totalAmount,
        pickupDateTimeIso,
        dropDateTimeIso,
        remainingRentalHours: activeSubscription?.remainingRentalHours || 0,
      }),
    [totalAmount, pickupDateTimeIso, dropDateTimeIso, activeSubscription?.remainingRentalHours],
  );
  const effectiveTotalAmount = useMemo(
    () => (useSubscription ? subscriptionPreview.extraAmount : totalAmount),
    [useSubscription, subscriptionPreview.extraAmount, totalAmount],
  );
  const formattedBillableDays = useMemo(() => {
    if (!Number.isFinite(totalDays) || totalDays <= 0) return '0';
    return Number.isInteger(totalDays) ? String(totalDays) : totalDays.toFixed(1);
  }, [totalDays]);
  const carFleetStatus = useMemo(() => resolveFleetStatus(car), [car]);
  const vehicleBookable = carFleetStatus === 'Available';
  const unavailabilityMessage = carFleetStatus === 'Maintenance'
    ? 'Vehicle under maintenance.'
    : 'Vehicle temporarily unavailable.';
  const quoteBreakdown = useMemo(
    () => calculateAdvanceBreakdown(effectiveTotalAmount),
    [effectiveTotalAmount],
  );
  const advancePercent = useMemo(() => Math.round(quoteBreakdown.advanceRate * 100), [quoteBreakdown.advanceRate]);
  const features = useMemo(() => parseCarFeatures(car?.features), [car?.features]);

  const averageRating = useMemo(() => {
    if (!reviews.length) return 0;
    const total = reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0);
    return Number((total / reviews.length).toFixed(1));
  }, [reviews]);

  const handleBooking = async (event) => {
    event.preventDefault();
    setBookingError('');

    if (admin) {
      setBookingError('Admin can view cars but cannot create rental bookings.');
      return;
    }

    if (!vehicleBookable) {
      setBookingError(unavailabilityMessage);
      return;
    }

    if (useSubscription && !activeSubscription) {
      setBookingError('No active subscription found for this booking.');
      return;
    }

    if (useSubscription && !subscriptionEligibleForCar) {
      setBookingError('Your active subscription is not valid for this branch.');
      return;
    }

    if (!pickupDate || !dropDate || !pickupHour || !pickupMinute || !pickupPeriod || !dropHour || !dropMinute || !dropPeriod) {
      setBookingError('Please select pickup and drop date/time.');
      return;
    }

    if (!isLoggedIn()) {
      setBookingError('Please log in to continue.');
      return;
    }

    if (!pickupDateTimeIso || !dropDateTimeIso) {
      setBookingError('Invalid pickup/drop date and time.');
      return;
    }

    const pickupDateTime = new Date(pickupDateTimeIso);
    const dropDateTime = new Date(dropDateTimeIso);

    if (pickupDateTime.getTime() < Date.now() - PAST_TOLERANCE_MS) {
      setBookingError('Pickup date and time cannot be in the past.');
      return;
    }

    if (dropDateTime <= pickupDateTime) {
      setBookingError('Drop date and time must be after pickup date and time.');
      return;
    }

    if (dropDateTime.getTime() - pickupDateTime.getTime() < ONE_HOUR_MS) {
      setBookingError('Minimum rental duration is 1 hour.');
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
        pickupDateTime: pickupDateTimeIso,
        dropDateTime: dropDateTimeIso,
        useSubscription,
      });
      notify.success('Car booked successfully. Complete advance payment from My Bookings.');
      navigate('/my-bookings');
    } catch (error) {
      setBookingError(getErrorMessage(error, 'Booking failed. Please try again.'));
    } finally {
      setBookingLoading(false);
    }
  };

  useEffect(() => {
    if (!activeSubscription || !subscriptionEligibleForCar) {
      setUseSubscription(false);
    }
  }, [activeSubscription, subscriptionEligibleForCar]);

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
                  {currency} {effectiveTotalAmount || 0}
                </p>
              </div>
              <p className="text-xs text-gray-500 text-right">
                {car.pricePerDay} / day x {formattedBillableDays} billed day(s)
              </p>
            </div>

            {!admin && activeSubscription ? (
              <div className={`rounded-lg border p-4 text-sm ${subscriptionEligibleForCar ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-gray-700">
                    Active Subscription: {activeSubscription?.planId?.planName || activeSubscription?.planSnapshot?.planName || 'Plan'}
                  </p>
                  <p className="text-xs text-gray-600">
                    Remaining: {Number(activeSubscription?.remainingRentalHours || 0)}h
                  </p>
                </div>
                {subscriptionEligibleForCar ? (
                  <label className="mt-2 inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={useSubscription}
                      onChange={(event) => setUseSubscription(event.target.checked)}
                    />
                    Use Subscription For This Booking
                  </label>
                ) : (
                  <p className="mt-2 text-xs text-amber-700">
                    This subscription is branch-specific and is not valid for this vehicle.
                  </p>
                )}

                {useSubscription ? (
                  <div className="mt-3 text-xs text-gray-600 space-y-1">
                    <p>Rental Hours: <span className="font-medium">{subscriptionPreview.rentalHours}</span></p>
                    <p>Covered Hours: <span className="font-medium">{subscriptionPreview.coveredHours}</span></p>
                    <p>
                      Coverage Value: <span className="font-medium">{currency}{subscriptionPreview.coverageAmount}</span>
                    </p>
                    <p>
                      Extra Payable: <span className="font-medium">{currency}{subscriptionPreview.extraAmount}</span>
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}

            {!admin && !activeSubscription ? (
              <div className="rounded-lg border border-dashed border-borderColor bg-slate-50 p-3 text-xs text-gray-600">
                No active subscription. You can book now as one-time rental or activate a subscription plan.
                <button
                  type="button"
                  onClick={() => navigate('/subscription-plans')}
                  className="ml-2 text-primary font-medium hover:underline"
                >
                  View Plans
                </button>
              </div>
            ) : null}

            <div className="rounded-lg border border-borderColor bg-light p-4 text-sm">
              <p className="font-medium text-gray-700">Advance Payment Required</p>
              <p className="text-gray-500 mt-1">
                Pay <span className="font-semibold text-gray-700">{advancePercent}%</span> advance to confirm booking.
              </p>
              <p className="text-xs text-gray-400 mt-1">Dynamic advance is calculated from your final quoted amount.</p>
            </div>

            {admin ? (
              <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
                Admin view mode: booking and offer actions are disabled.
              </div>
            ) : null}
            {!admin && !vehicleBookable ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                {unavailabilityMessage}
              </div>
            ) : null}

            <div className="rounded-lg border border-borderColor bg-light p-3 text-xs text-gray-500">
              Time-based billing: 24h = 1 day, under 12h extra = 0.5 day, 12h+ extra = 1 day.
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-1 gap-3">
              <div>
                <label className="text-sm text-gray-600">Pickup Date</label>
                <input
                  type="date"
                  value={pickupDate}
                  min={todayDate}
                  onChange={(event) => {
                    const nextPickupDate = event.target.value;
                    setPickupDate(nextPickupDate);
                    if (dropDate && nextPickupDate > dropDate) {
                      setDropDate(nextPickupDate);
                    }
                  }}
                  className="border border-borderColor px-3 py-2 rounded-lg w-full mt-1"
                  disabled={admin || !vehicleBookable}
                  required
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">Pickup Time (12h)</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <select
                    value={pickupHour}
                    onChange={(event) => setPickupHour(event.target.value)}
                    disabled={admin || !vehicleBookable || !pickupDate}
                    className="border border-borderColor px-2 py-2 rounded-lg w-full"
                  >
                    {TIME_HOURS.map((hour) => (
                      <option key={`pickup-hour-${hour}`} value={hour}>
                        {hour}
                      </option>
                    ))}
                  </select>
                  <select
                    value={pickupMinute}
                    onChange={(event) => setPickupMinute(event.target.value)}
                    disabled={admin || !vehicleBookable || !pickupDate}
                    className="border border-borderColor px-2 py-2 rounded-lg w-full"
                  >
                    {TIME_MINUTES.map((minute) => (
                      <option key={`pickup-minute-${minute}`} value={minute}>
                        {minute}
                      </option>
                    ))}
                  </select>
                  <select
                    value={pickupPeriod}
                    onChange={(event) => setPickupPeriod(event.target.value)}
                    disabled={admin || !vehicleBookable || !pickupDate}
                    className="border border-borderColor px-2 py-2 rounded-lg w-full"
                  >
                    {TIME_PERIODS.map((period) => (
                      <option key={`pickup-period-${period}`} value={period}>
                        {period}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="text-sm text-gray-600">Drop Date</label>
                <input
                  type="date"
                  value={dropDate}
                  min={pickupDate || todayDate}
                  onChange={(event) => setDropDate(event.target.value)}
                  disabled={admin || !vehicleBookable || !pickupDate}
                  className="border border-borderColor px-3 py-2 rounded-lg w-full mt-1"
                  required
                />
              </div>

              <div>
                <label className="text-sm text-gray-600">Drop Time (12h)</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  <select
                    value={dropHour}
                    onChange={(event) => setDropHour(event.target.value)}
                    disabled={admin || !vehicleBookable || !dropDate}
                    className="border border-borderColor px-2 py-2 rounded-lg w-full"
                  >
                    {TIME_HOURS.map((hour) => (
                      <option key={`drop-hour-${hour}`} value={hour}>
                        {hour}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dropMinute}
                    onChange={(event) => setDropMinute(event.target.value)}
                    disabled={admin || !vehicleBookable || !dropDate}
                    className="border border-borderColor px-2 py-2 rounded-lg w-full"
                  >
                    {TIME_MINUTES.map((minute) => (
                      <option key={`drop-minute-${minute}`} value={minute}>
                        {minute}
                      </option>
                    ))}
                  </select>
                  <select
                    value={dropPeriod}
                    onChange={(event) => setDropPeriod(event.target.value)}
                    disabled={admin || !vehicleBookable || !dropDate}
                    className="border border-borderColor px-2 py-2 rounded-lg w-full"
                  >
                    {TIME_PERIODS.map((period) => (
                      <option key={`drop-period-${period}`} value={period}>
                        {period}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {bookingError ? <p className="text-red-500 text-sm">{bookingError}</p> : null}

            {!admin && vehicleBookable ? (
              <MakeOfferForm
                carId={car._id}
                fromDate={pickupDateTimeIso}
                toDate={dropDateTimeIso}
                originalPrice={totalAmount}
                onSuccess={() => {
                  setOfferSuccessMsg('Offer sent successfully. Track it in My Bookings.');
                }}
              />
            ) : admin ? (
              <div className="border border-dashed border-borderColor rounded-lg p-4 bg-slate-50/80">
                <p className="font-medium text-gray-700">Make a Negotiation Offer</p>
                <p className="text-xs text-gray-400 mt-1">
                  Admin can review offers, but cannot create renter offers.
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-3 px-4 py-2 rounded-lg text-white bg-gray-400 cursor-not-allowed"
                >
                  Offer Disabled For Admin
                </button>
              </div>
            ) : (
              <div className="border border-dashed border-amber-200 rounded-lg p-4 bg-amber-50/80">
                <p className="font-medium text-amber-800">Make a Negotiation Offer</p>
                <p className="text-xs text-amber-700 mt-1">
                  {unavailabilityMessage}
                </p>
                <button
                  type="button"
                  disabled
                  className="mt-3 px-4 py-2 rounded-lg text-white bg-gray-400 cursor-not-allowed"
                >
                  {carFleetStatus === 'Maintenance' ? 'Under Maintenance' : 'Offer Unavailable'}
                </button>
              </div>
            )}

            {offerSuccessMsg ? <p className="text-green-600 text-xs">{offerSuccessMsg}</p> : null}

            <div className="rounded-lg bg-light border border-borderColor p-4 text-sm space-y-1">
              <p className="flex justify-between">
                <span>Total Amount</span>
                <span>
                  {currency} {effectiveTotalAmount || 0}
                </span>
              </p>
              {useSubscription ? (
                <p className="flex justify-between text-emerald-700">
                  <span>Subscription Coverage</span>
                  <span>
                    -{currency} {subscriptionPreview.coverageAmount || 0}
                  </span>
                </p>
              ) : null}
              <p className="flex justify-between">
                <span>Advance Required ({advancePercent}%)</span>
                <span>
                  {currency} {quoteBreakdown.advanceRequired || 0}
                </span>
              </p>
              <p className="flex justify-between">
                <span>Remaining Amount</span>
                <span>
                  {currency} {quoteBreakdown.remainingAmount || 0}
                </span>
              </p>
            </div>

            <button
              type="submit"
              disabled={bookingLoading || admin || !vehicleBookable}
              className={`w-full py-3 text-white rounded-lg font-medium inline-flex items-center justify-center gap-2 ${
                bookingLoading || admin || !vehicleBookable
                  ? 'bg-gray-400 cursor-not-allowed'
                  : 'bg-primary hover:bg-primary-dull'
              }`}
            >
              {bookingLoading ? (
                <>
                  <InlineSpinner size="sm" className="border-white/40 border-t-white" />
                  Booking...
                </>
              ) : (
                admin
                  ? 'Booking Disabled For Admin'
                  : !vehicleBookable
                  ? carFleetStatus === 'Maintenance'
                    ? 'Under Maintenance'
                    : 'Vehicle Unavailable'
                  : 'Book Now'
              )}
            </button>
          </form>
        </ScrollReveal>
      </div>
    </div>
  );
};

export default CarDetail;

