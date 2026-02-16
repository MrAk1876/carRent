import React, { useEffect, useState } from 'react';
import API, { getErrorMessage } from '../api';
import Title from '../components/Title';
import LiveLateFeeSummary from '../components/ui/LiveLateFeeSummary';
import LiveStageCountdown from '../components/ui/LiveStageCountdown';
import UserOfferList from '../features/offers/components/UserOfferList';
import useNotify from '../hooks/useNotify';
import {
  calculateAdvanceBreakdown,
  getNormalizedStatusKey,
  isAdvancePaidStatus,
  isCancelledBookingStatus,
  isConfirmedBookingStatus,
  isFullyPaidStatus,
  resolveAdvancePaid,
  resolveAdvanceRequired,
  resolveDropDateTime,
  resolveFinalAmount,
  resolveLateFee,
  resolveLateHours,
  resolveHourlyLateRate,
  resolvePickupDateTime,
  resolveRentalStage,
  resolveRemainingAmount,
} from '../utils/payment';

const MyBookings = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const notify = useNotify();
  const [bookings, setBookings] = useState([]);
  const [requests, setRequests] = useState([]);
  const [offers, setOffers] = useState([]);
  const [requestPaymentMethodById, setRequestPaymentMethodById] = useState({});
  const [bookingBargainById, setBookingBargainById] = useState({});
  const [reviewsByBookingId, setReviewsByBookingId] = useState({});
  const [reviewDraftByBookingId, setReviewDraftByBookingId] = useState({});
  const [reviewEditDraftByBookingId, setReviewEditDraftByBookingId] = useState({});
  const [editingReviewByBookingId, setEditingReviewByBookingId] = useState({});
  const [loadingActionId, setLoadingActionId] = useState('');
  const [reviewLoadingId, setReviewLoadingId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [offersError, setOffersError] = useState('');
  const [reviewsError, setReviewsError] = useState('');

  const getStatusBadge = (status) => {
    const normalizedStatus = getNormalizedStatusKey(status);
    if (['PENDING', 'PENDINGPAYMENT'].includes(normalizedStatus)) return 'bg-yellow-100 text-yellow-800';
    if (['APPROVED', 'CONFIRMED', 'ACCEPTED', 'COMPLETED'].includes(normalizedStatus)) {
      return 'bg-green-100 text-green-800';
    }
    if (['REJECTED', 'CANCELLED', 'CANCELLEDBYUSER'].includes(normalizedStatus)) {
      return 'bg-red-100 text-red-800';
    }
    return 'bg-gray-200 text-gray-700';
  };

  const getPaymentLabel = (value) => {
    const normalized = String(value || '').toUpperCase();
    if (!normalized || normalized === 'NONE') return 'Not selected';
    if (normalized === 'NETBANKING') return 'Net Banking';
    return normalized;
  };

  const formatDateTimeLabel = (value) => {
    if (!value) return 'N/A';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return 'N/A';
    return parsed.toLocaleString();
  };

  const fetchBookings = async () => {
    try {
      setLoading(true);
      setError('');
      setOffersError('');
      setReviewsError('');

      const [dashboardResult, offersResult, reviewsResult] = await Promise.allSettled([
        API.get('/user/dashboard'),
        API.get('/offers/my'),
        API.get('/reviews/my'),
      ]);

      if (dashboardResult.status === 'fulfilled') {
        setBookings(dashboardResult.value.data.bookings || []);
        setRequests(dashboardResult.value.data.requests || []);
      } else {
        setError('Failed to load booking data');
        setBookings([]);
        setRequests([]);
      }

      if (offersResult.status === 'fulfilled') {
        setOffers(offersResult.value.data || []);
      } else {
        setOffers([]);
        setOffersError('Offer negotiations could not be loaded right now.');
      }

      if (reviewsResult.status === 'fulfilled') {
        const byBookingId = {};
        for (const review of reviewsResult.value.data || []) {
          const bookingId =
            typeof review.booking === 'string' ? review.booking : review.booking?._id;
          if (bookingId) {
            byBookingId[bookingId] = review;
          }
        }
        setReviewsByBookingId(byBookingId);
      } else {
        setReviewsByBookingId({});
        setReviewsError('Reviews could not be loaded right now.');
      }
    } catch {
      setError('Failed to load booking data');
      setBookings([]);
      setRequests([]);
      setReviewsByBookingId({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBookings();
  }, []);

  const allItems = [
    ...requests.map((r) => ({ ...r, type: 'request' })),
    ...bookings.map((b) => ({ ...b, type: 'booking' })),
  ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  const toDayKey = (value) => {
    if (!value) return '';
    const asString = String(value);
    if (asString.includes('T')) return asString.split('T')[0];
    return asString;
  };

  const getEntityId = (entity) => {
    if (!entity) return '';
    if (typeof entity === 'string') return entity;
    return entity._id || '';
  };

  // Avoid showing the same finalized negotiation twice:
  // once in "My Offers" and again as request/booking cards.
  const visibleOffers = offers.filter((offer) => {
    if (offer.status !== 'accepted') return true;

    const offerCarId = getEntityId(offer.car);
    const offerFrom = toDayKey(offer.fromDate);
    const offerTo = toDayKey(offer.toDate);

    const hasMatchingRequestOrBooking = allItems.some((item) => {
      const itemCarId = getEntityId(item.car);
      const itemFrom = toDayKey(item.fromDate);
      const itemTo = toDayKey(item.toDate);
      return itemCarId === offerCarId && itemFrom === offerFrom && itemTo === offerTo;
    });

    return !hasMatchingRequestOrBooking;
  });

  const isNegotiableBooking = (item) =>
    item.type === 'booking' && item.tripStatus !== 'completed' && !isCancelledBookingStatus(item.bookingStatus);

  const submitBookingBargain = async (bookingId) => {
    const offeredPrice = Number(bookingBargainById[bookingId]);
    if (!Number.isFinite(offeredPrice) || offeredPrice <= 0) {
      notify.error('Enter a valid offered price');
      return;
    }

    try {
      setLoadingActionId(bookingId);
      await API.put(`/bookings/${bookingId}/bargain`, { offeredPrice });
      setBookingBargainById((prev) => ({ ...prev, [bookingId]: '' }));
      await fetchBookings();
      notify.success('Bargain submitted successfully');
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Failed to submit bargain'));
    } finally {
      setLoadingActionId('');
    }
  };

  const respondToBookingCounter = async (bookingId, action) => {
    try {
      setLoadingActionId(bookingId);
      await API.put(`/bookings/${bookingId}/counter-response`, { action });
      await fetchBookings();
      notify.success('Response submitted successfully');
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Failed to submit response'));
    } finally {
      setLoadingActionId('');
    }
  };

  const payRequestAdvance = async (requestId) => {
    const paymentMethod = requestPaymentMethodById[requestId] || 'CARD';
    try {
      setLoadingActionId(requestId);
      await API.put(`/requests/${requestId}/pay-advance`, { paymentMethod });
      await fetchBookings();
      notify.success('Advance payment recorded');
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Failed to record payment'));
    } finally {
      setLoadingActionId('');
    }
  };

  const canReviewBooking = (item) => {
    if (item.type !== 'booking') return false;
    const normalizedBookingStatus = getNormalizedStatusKey(item.bookingStatus);
    if (!isConfirmedBookingStatus(item.bookingStatus) && normalizedBookingStatus !== 'COMPLETED') return false;
    if (item.tripStatus === 'completed' || item.tripStatus === 'active' || item.tripStatus === 'upcoming') {
      return !reviewsByBookingId[item._id];
    }
    return false;
  };

  const submitReview = async (bookingId) => {
    const draft = reviewDraftByBookingId[bookingId] || { rating: '5', comment: '' };
    const rating = Number(draft.rating);
    const comment = String(draft.comment || '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      notify.error('Please select a valid rating between 1 and 5');
      return;
    }

    if (comment.length < 3) {
      notify.error('Please enter at least 3 characters for review comment');
      return;
    }

    try {
      setReviewLoadingId(bookingId);
      await API.post('/reviews', { bookingId, rating, comment });
      setReviewDraftByBookingId((prev) => ({ ...prev, [bookingId]: { rating: '5', comment: '' } }));
      await fetchBookings();
      notify.success('Review submitted successfully');
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Failed to submit review'));
    } finally {
      setReviewLoadingId('');
    }
  };

  const startReviewEdit = (bookingId) => {
    const review = reviewsByBookingId[bookingId];
    if (!review) return;

    setEditingReviewByBookingId((prev) => ({ ...prev, [bookingId]: true }));
    setReviewEditDraftByBookingId((prev) => ({
      ...prev,
      [bookingId]: {
        rating: String(review.rating || 5),
        comment: review.comment || '',
      },
    }));
  };

  const cancelReviewEdit = (bookingId) => {
    setEditingReviewByBookingId((prev) => ({ ...prev, [bookingId]: false }));
  };

  const updateReview = async (bookingId) => {
    const review = reviewsByBookingId[bookingId];
    const draft = reviewEditDraftByBookingId[bookingId] || {
      rating: String(review?.rating || 5),
      comment: review?.comment || '',
    };

    const rating = Number(draft.rating);
    const comment = String(draft.comment || '').trim();

    if (!review?._id) {
      notify.error('Review not found');
      return;
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      notify.error('Please select a valid rating between 1 and 5');
      return;
    }

    if (comment.length < 3) {
      notify.error('Please enter at least 3 characters for review comment');
      return;
    }

    try {
      setReviewLoadingId(bookingId);
      await API.put(`/reviews/${review._id}`, { rating, comment });
      setEditingReviewByBookingId((prev) => ({ ...prev, [bookingId]: false }));
      await fetchBookings();
      notify.success('Review updated successfully');
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Failed to update review'));
    } finally {
      setReviewLoadingId('');
    }
  };

  const deleteReview = async (bookingId) => {
    const review = reviewsByBookingId[bookingId];
    if (!review?._id) {
      notify.error('Review not found');
      return;
    }

    if (!window.confirm('Delete this review?')) return;

    try {
      setReviewLoadingId(bookingId);
      await API.delete(`/reviews/${review._id}`);
      setEditingReviewByBookingId((prev) => ({ ...prev, [bookingId]: false }));
      await fetchBookings();
      notify.success('Review deleted successfully');
    } catch (apiError) {
      notify.error(getErrorMessage(apiError, 'Failed to delete review'));
    } finally {
      setReviewLoadingId('');
    }
  };

  return (
    <div className="px-6 md:px-16 lg:px-24 xl:px-32 mt-16 max-w-7xl space-y-8">
      <Title title="My Bookings" subTitle="Track your rentals and negotiation offers" align="left" />

      {error && <p className="text-center text-red-500 mt-6">{error}</p>}

      <UserOfferList offers={visibleOffers} onRefresh={fetchBookings} />
      {offersError && <p className="text-sm text-amber-600">{offersError}</p>}
      {reviewsError && <p className="text-sm text-amber-600">{reviewsError}</p>}

      <div className="space-y-6">
        {loading && <p className="text-center text-gray-500 mt-6">Loading your bookings...</p>}

        {!loading && allItems.length === 0 && <p className="text-center text-gray-500 mt-6">You have no bookings yet.</p>}

        {allItems.map((item) => {
          const finalAmount = resolveFinalAmount(item);
          const fallbackBreakdown = calculateAdvanceBreakdown(finalAmount);
          const advanceRatePercent = Math.round(fallbackBreakdown.advanceRate * 100);
          const advanceRequired = resolveAdvanceRequired(item) || fallbackBreakdown.advanceRequired;
          const advancePaid = resolveAdvancePaid(item);
          const remainingAmount = resolveRemainingAmount(item);
          const lateHours = resolveLateHours(item);
          const lateFee = resolveLateFee(item);
          const hourlyLateRate = resolveHourlyLateRate(item);
          const pickupDateTime = resolvePickupDateTime(item);
          const dropDateTime = resolveDropDateTime(item);
          const gracePeriodHours = Number.isFinite(Number(item?.gracePeriodHours))
            ? Math.max(Number(item?.gracePeriodHours), 0)
            : 1;
          const rentalStage = resolveRentalStage(item) || 'PendingPayment';
          const fullPaymentAmount = Math.max(Number(item?.fullPaymentAmount || 0), 0);
          const finalInvoiceAmount = Number((finalAmount + lateFee).toFixed(2));
          const totalPaidAmount = isFullyPaidStatus(item?.paymentStatus)
            ? Number(((Math.max(advancePaid, 0) + fullPaymentAmount) || finalInvoiceAmount).toFixed(2))
            : Number((Math.max(advancePaid, 0)).toFixed(2));
          const rentalStageClass =
            rentalStage === 'Overdue'
              ? 'bg-red-100 text-red-700'
              : rentalStage === 'Active'
              ? 'bg-emerald-100 text-emerald-700'
              : rentalStage === 'Completed'
              ? 'bg-gray-200 text-gray-700'
              : 'bg-blue-100 text-blue-700';
          const rentalStageTone =
            rentalStage === 'Overdue'
              ? 'text-red-700'
              : rentalStage === 'Active'
              ? 'text-emerald-700'
              : rentalStage === 'Completed'
              ? 'text-gray-600'
              : 'text-blue-700';

          return (
            <div key={item._id} className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6 border rounded-xl bg-white shadow hover:shadow-lg transition">
              <div className="h-40 overflow-hidden rounded">
                <img src={item.car?.image} alt="car" className="w-full h-full object-cover" />
              </div>

              <div className="md:col-span-2">
                <h2 className="font-semibold text-lg">
                  {item.car?.brand} {item.car?.model}
                </h2>

                <p className="text-gray-500">
                  {item.car?.year} - {item.car?.category} - {item.car?.transmission}
                </p>

                <p className="mt-2 text-sm">Pickup: {formatDateTimeLabel(pickupDateTime)}</p>
                <p className="text-sm">Drop: {formatDateTimeLabel(dropDateTime)}</p>

                <p className="text-sm text-gray-500 mt-1">Location: {item.car?.location}</p>
                <span className="text-xs text-gray-400">{item.type === 'booking' ? 'Booking' : 'Booking Request'}</span>
              </div>

              <div className="flex flex-col items-end justify-between">
                <div className="flex gap-2">
                  {item.type === 'booking' && (
                    <span className={`px-3 py-1 text-xs rounded-full ${getStatusBadge(item.bookingStatus)}`}>
                      {item.bookingStatus}
                    </span>
                  )}

                  <span
                    className={`px-3 py-1 text-xs rounded-full ${
                      item.tripStatus === 'active'
                        ? 'bg-green-100 text-green-800'
                        : item.tripStatus === 'completed'
                        ? 'bg-gray-200 text-gray-700'
                        : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {item.type === 'booking' ? item.tripStatus || 'upcoming' : item.status}
                  </span>

                  {item.type === 'booking' ? (
                    <span className={`px-3 py-1 text-xs rounded-full ${rentalStageClass}`}>
                      {rentalStage === 'Overdue' ? <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-600 mr-1 animate-pulse" /> : null}
                      {rentalStage}
                    </span>
                  ) : null}
                </div>

                {item.type === 'booking' ? (
                  <LiveStageCountdown
                    stage={rentalStage}
                    pickupDateTime={pickupDateTime}
                    dropDateTime={dropDateTime}
                    gracePeriodHours={gracePeriodHours}
                    className={`mt-1 text-xs ${rentalStageTone}`}
                  />
                ) : (
                  <p className="mt-1 text-xs text-amber-700">Advance payment pending</p>
                )}

                {item.type === 'booking' && rentalStage === 'Overdue' ? (
                  <div className="mt-2 w-full rounded-md border border-red-300 bg-red-50 px-2 py-1 text-[11px] text-red-700 text-right animate-pulse">
                    Overdue rental: live late fee active
                  </div>
                ) : null}

              {item.bargain ? (
                <p className="text-sm mt-1 text-gray-500">
                  Negotiation: <span className="font-medium">{item.bargain.status}</span>
                </p>
              ) : null}

              {item.type === 'booking' && item.bargain?.adminCounterPrice ? (
                <p className="text-sm mt-1 text-gray-500">
                  Admin Counter: <span className="font-medium">{currency}{item.bargain.adminCounterPrice}</span>
                </p>
              ) : null}

              {item.type === 'booking' && item.bargain ? (
                <p className="text-xs text-gray-400 mt-1">Attempts: {item.bargain.userAttempts || 0}/3</p>
              ) : null}

              {item.type === 'booking' && (
                <p className="text-xl font-bold text-primary">
                  {currency}
                  {finalAmount}
                </p>
              )}

              {item.type === 'request' && (
                <div className="w-full mt-2 p-2 rounded border border-borderColor bg-light text-xs text-gray-600 space-y-1">
                  <p>
                    Final Amount:{' '}
                    <span className="font-semibold">
                      {currency}
                      {finalAmount}
                    </span>
                  </p>
                  <p>
                    Advance Due ({advanceRatePercent}%):{' '}
                    <span className="font-semibold">
                      {currency}
                      {advanceRequired}
                    </span>
                  </p>
                  <p>
                    Remaining After Advance:{' '}
                    <span className="font-semibold">
                      {currency}
                      {remainingAmount}
                    </span>
                  </p>
                  <p>
                    Payment Status: <span className="font-semibold">{item.paymentStatus || 'Unpaid'}</span>
                  </p>
                  <p>
                    Payment Method: <span className="font-semibold">{getPaymentLabel(item.paymentMethod)}</span>
                  </p>
                </div>
              )}

              {item.type === 'booking' && (
                <div className="w-full mt-2 p-2 rounded border border-borderColor bg-light text-xs text-gray-600 space-y-1">
                  <p>
                    Payment Status: <span className="font-semibold">{item.paymentStatus || 'Unpaid'}</span>
                  </p>
                  <p>
                    Final Amount:{' '}
                    <span className="font-semibold">
                      {currency}
                      {finalAmount}
                    </span>
                  </p>
                  <p>
                    Advance Paid:{' '}
                    <span className="font-semibold">
                      {currency}
                      {advancePaid || advanceRequired}
                    </span>
                  </p>
                  <p>
                    Remaining:{' '}
                    <span className="font-semibold">
                      {currency}
                      {remainingAmount}
                    </span>
                  </p>
                  <LiveLateFeeSummary
                    stage={rentalStage}
                    dropDateTime={dropDateTime}
                    gracePeriodHours={gracePeriodHours}
                    lateHours={lateHours}
                    lateFee={lateFee}
                    hourlyLateRate={hourlyLateRate}
                    finalAmount={finalAmount}
                    advancePaid={advancePaid || advanceRequired}
                    currency={currency}
                    highlight={rentalStage === 'Overdue'}
                  />

                  {rentalStage === 'Completed' ? (
                    <div className="mt-2 rounded-lg border border-borderColor bg-white p-2 space-y-1">
                      <p>
                        Total Paid:{' '}
                        <span className="font-semibold">
                          {currency}
                          {totalPaidAmount}
                        </span>
                      </p>
                      <p>
                        Late Hours: <span className="font-semibold">{lateHours}</span>
                      </p>
                      <p>
                        Final Invoice:{' '}
                        <span className="font-semibold">
                          {currency}
                          {finalInvoiceAmount}
                        </span>
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              {item.type === 'booking' && reviewsByBookingId[item._id] && (
                <div className="w-full mt-2 p-2 rounded border border-borderColor bg-light">
                  {!editingReviewByBookingId[item._id] ? (
                    <>
                      <p className="text-xs font-medium text-gray-700">
                        Your Review: {reviewsByBookingId[item._id].rating}/5
                      </p>
                      <p className="text-xs text-gray-500 mt-1">"{reviewsByBookingId[item._id].comment}"</p>
                      <div className="mt-2 flex gap-2 justify-end">
                        <button
                          disabled={reviewLoadingId === item._id}
                          onClick={() => startReviewEdit(item._id)}
                          className="bg-blue-600 text-white px-2 py-1 rounded text-xs"
                        >
                          Edit
                        </button>
                        <button
                          disabled={reviewLoadingId === item._id}
                          onClick={() => deleteReview(item._id)}
                          className="bg-red-500 text-white px-2 py-1 rounded text-xs"
                        >
                          Delete
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <select
                        value={reviewEditDraftByBookingId[item._id]?.rating || String(reviewsByBookingId[item._id].rating || 5)}
                        onChange={(e) =>
                          setReviewEditDraftByBookingId((prev) => ({
                            ...prev,
                            [item._id]: {
                              rating: e.target.value,
                              comment: prev[item._id]?.comment ?? reviewsByBookingId[item._id].comment ?? '',
                            },
                          }))
                        }
                        className="border border-borderColor rounded px-2 py-1 text-xs w-full"
                      >
                        <option value="5">5 - Excellent</option>
                        <option value="4">4 - Very Good</option>
                        <option value="3">3 - Good</option>
                        <option value="2">2 - Fair</option>
                        <option value="1">1 - Poor</option>
                      </select>
                      <textarea
                        rows={2}
                        value={reviewEditDraftByBookingId[item._id]?.comment ?? reviewsByBookingId[item._id].comment ?? ''}
                        onChange={(e) =>
                          setReviewEditDraftByBookingId((prev) => ({
                            ...prev,
                            [item._id]: {
                              rating: prev[item._id]?.rating ?? String(reviewsByBookingId[item._id].rating || 5),
                              comment: e.target.value,
                            },
                          }))
                        }
                        className="border border-borderColor rounded px-2 py-1 text-xs w-full"
                      />
                      <div className="mt-2 flex gap-2 justify-end">
                        <button
                          disabled={reviewLoadingId === item._id}
                          onClick={() => updateReview(item._id)}
                          className="bg-green-600 text-white px-2 py-1 rounded text-xs"
                        >
                          Save
                        </button>
                        <button
                          disabled={reviewLoadingId === item._id}
                          onClick={() => cancelReviewEdit(item._id)}
                          className="bg-gray-500 text-white px-2 py-1 rounded text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {canReviewBooking(item) && (
                <div className="w-full mt-2 p-2 rounded border border-borderColor space-y-2">
                  <p className="text-xs font-medium text-gray-700">Rate this car</p>
                  <select
                    value={reviewDraftByBookingId[item._id]?.rating || '5'}
                    onChange={(e) =>
                      setReviewDraftByBookingId((prev) => ({
                        ...prev,
                        [item._id]: {
                          rating: e.target.value,
                          comment: prev[item._id]?.comment || '',
                        },
                      }))
                    }
                    className="border border-borderColor rounded px-2 py-1 text-xs w-full"
                  >
                    <option value="5">5 - Excellent</option>
                    <option value="4">4 - Very Good</option>
                    <option value="3">3 - Good</option>
                    <option value="2">2 - Fair</option>
                    <option value="1">1 - Poor</option>
                  </select>
                  <textarea
                    rows={2}
                    value={reviewDraftByBookingId[item._id]?.comment || ''}
                    onChange={(e) =>
                      setReviewDraftByBookingId((prev) => ({
                        ...prev,
                        [item._id]: {
                          rating: prev[item._id]?.rating || '5',
                          comment: e.target.value,
                        },
                      }))
                    }
                    placeholder="Share your experience"
                    className="border border-borderColor rounded px-2 py-1 text-xs w-full"
                  />
                  <button
                    disabled={reviewLoadingId === item._id}
                    onClick={() => submitReview(item._id)}
                    className="bg-black text-white px-3 py-1 rounded text-xs"
                  >
                    {reviewLoadingId === item._id ? 'Submitting...' : 'Submit Review'}
                  </button>
                </div>
              )}

              {item.type === 'booking' &&
                isNegotiableBooking(item) &&
                item.bargain &&
                !['LOCKED', 'ADMIN_COUNTERED', 'ACCEPTED'].includes(item.bargain.status) && (
                  <div className="w-full mt-2 space-y-2">
                    <input
                      type="number"
                      placeholder="Offer a new price"
                      value={bookingBargainById[item._id] || ''}
                      onChange={(e) => setBookingBargainById((prev) => ({ ...prev, [item._id]: e.target.value }))}
                      className="border border-borderColor px-3 py-2 rounded w-full text-sm"
                    />
                    <button
                      disabled={loadingActionId === item._id}
                      onClick={() => submitBookingBargain(item._id)}
                      className="bg-yellow-500 text-white px-4 py-1 rounded text-sm"
                    >
                      {loadingActionId === item._id ? 'Submitting...' : 'Submit Bargain'}
                    </button>
                  </div>
                )}

              {item.type === 'booking' &&
                isNegotiableBooking(item) &&
                item.bargain?.status === 'ADMIN_COUNTERED' && (
                  <div className="w-full mt-2 flex gap-2 justify-end">
                    <button
                      disabled={loadingActionId === item._id}
                      onClick={() => respondToBookingCounter(item._id, 'accept')}
                      className="bg-green-600 text-white px-3 py-1 rounded text-sm"
                    >
                      Accept Counter
                    </button>
                    <button
                      disabled={loadingActionId === item._id}
                      onClick={() => respondToBookingCounter(item._id, 'reject')}
                      className="bg-red-500 text-white px-3 py-1 rounded text-sm"
                    >
                      Reject Counter
                    </button>
                  </div>
                )}

              {item.type === 'request' && item.status === 'pending' && (
                <div className="w-full mt-2 space-y-2">
                  {!isAdvancePaidStatus(item.paymentStatus) ? (
                    <>
                      <select
                        value={requestPaymentMethodById[item._id] || 'CARD'}
                        onChange={(e) =>
                          setRequestPaymentMethodById((prev) => ({
                            ...prev,
                            [item._id]: e.target.value,
                          }))
                        }
                        className="border border-borderColor rounded px-2 py-2 text-xs w-full"
                      >
                        <option value="CARD">Card</option>
                        <option value="UPI">UPI</option>
                        <option value="NETBANKING">Net Banking</option>
                        <option value="CASH">Cash</option>
                      </select>
                      <button
                        disabled={loadingActionId === item._id}
                        onClick={() => payRequestAdvance(item._id)}
                        className="bg-green-600 text-white px-4 py-1 rounded text-sm"
                      >
                        {loadingActionId === item._id ? 'Processing...' : 'Pay Advance'}
                      </button>
                    </>
                  ) : (
                    <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1">
                      Advance paid. Booking confirmation is in progress.
                    </p>
                  )}

                <button
                  onClick={async () => {
                    if (!window.confirm('Cancel request?')) return;
                    try {
                      await API.delete(`/user/requests/${item._id}`);
                      await fetchBookings();
                      notify.success('Request cancelled successfully');
                    } catch (apiError) {
                      notify.error(getErrorMessage(apiError, 'Failed to cancel request'));
                    }
                  }}
                  className="bg-red-500 text-white px-4 py-1 rounded text-sm"
                >
                  Cancel
                </button>
                </div>
              )}

              {item.type === 'booking' &&
                resolveRentalStage(item) === 'Scheduled' &&
                !isCancelledBookingStatus(item.bookingStatus) && (
                <button
                  onClick={async () => {
                    if (!window.confirm('Cancel booking?')) return;
                    try {
                      await API.delete(`/user/bookings/${item._id}`);
                      await fetchBookings();
                      notify.success('Booking cancelled successfully');
                    } catch (apiError) {
                      notify.error(getErrorMessage(apiError, 'Failed to cancel booking'));
                    }
                  }}
                  className="bg-red-500 text-white px-4 py-1 rounded text-sm"
                >
                  Cancel Booking
                </button>
              )}
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default MyBookings;

