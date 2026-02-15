import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import { assets } from '../../../assets/assets';
import Title from '../components/Title';

const ManageReviews = () => {
  const [reviews, setReviews] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState('');
  const [editId, setEditId] = useState('');
  const [draft, setDraft] = useState({ rating: '5', comment: '' });
  const [errorMsg, setErrorMsg] = useState('');

  const loadReviews = async () => {
    try {
      setLoading(true);
      const res = await API.get('/admin/reviews');
      setReviews(Array.isArray(res.data) ? res.data : []);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load reviews'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReviews();
  }, []);

  const startEdit = (review) => {
    setEditId(review._id);
    setDraft({
      rating: String(review.rating || 5),
      comment: review.comment || '',
    });
    setErrorMsg('');
  };

  const saveEdit = async (id) => {
    const rating = Number(draft.rating);
    const comment = String(draft.comment || '').trim();

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      setErrorMsg('Rating must be between 1 and 5.');
      return;
    }
    if (comment.length < 3) {
      setErrorMsg('Comment must be at least 3 characters.');
      return;
    }

    try {
      setLoadingId(id);
      await API.put(`/admin/reviews/${id}`, { rating, comment });
      setEditId('');
      await loadReviews();
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to update review'));
    } finally {
      setLoadingId('');
    }
  };

  const removeReview = async (id) => {
    if (!window.confirm('Delete this review?')) return;

    try {
      setLoadingId(id);
      await API.delete(`/admin/reviews/${id}`);
      await loadReviews();
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to delete review'));
    } finally {
      setLoadingId('');
    }
  };

  const filteredReviews = useMemo(() => {
    const searchValue = search.trim().toLowerCase();
    return reviews.filter((review) => {
      if (!searchValue) return true;
      const fullName = `${review.user?.firstName || ''} ${review.user?.lastName || ''}`.trim().toLowerCase();
      const carName = `${review.car?.brand || ''} ${review.car?.model || ''}`.trim().toLowerCase();
      const searchSource = `${fullName} ${carName} ${review.user?.email || ''} ${review.comment || ''}`.toLowerCase();
      return searchSource.includes(searchValue);
    });
  }, [reviews, search]);

  const stats = useMemo(() => {
    const total = reviews.length;
    const lowRatings = reviews.filter((review) => Number(review.rating || 0) <= 2).length;
    const avgRating =
      total > 0
        ? (reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / total).toFixed(1)
        : '0.0';
    const visible = filteredReviews.length;
    return { total, lowRatings, avgRating, visible };
  }, [filteredReviews.length, reviews]);

  const renderStars = (rating) => {
    const safeRating = Math.max(1, Math.min(5, Number(rating) || 0));
    return Array(5)
      .fill(0)
      .map((_, index) => (
        <img
          key={`review-star-${rating}-${index}`}
          src={assets.star_icon}
          alt="star"
          className={`w-4 h-4 ${index < safeRating ? 'opacity-100' : 'opacity-20'}`}
        />
      ));
  };

  return (
    <div className="admin-section-page px-4 pt-6 md:pt-10 md:px-10 pb-8 md:pb-10 w-full">
      <Title title="Manage Reviews" subTitle="View, edit, and moderate all customer reviews from one place." />

      <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-linear-to-r from-primary/5 via-white to-cyan-50 p-5 md:p-6">
        <p className="text-xs uppercase tracking-wide text-gray-500">Moderation</p>
        <h2 className="text-xl md:text-2xl font-semibold text-gray-800 mt-1">Review Control Center</h2>
        <p className="text-sm text-gray-500 mt-2">
          Search feedback quickly, update inaccurate comments, and remove harmful entries.
        </p>
      </div>

      <div className="mt-5 max-w-6xl grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">All Reviews</p>
          <p className="text-xl font-semibold text-gray-800 mt-1">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Visible</p>
          <p className="text-xl font-semibold text-primary mt-1">{stats.visible}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Average</p>
          <p className="text-xl font-semibold text-emerald-600 mt-1">{stats.avgRating}/5</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">Low Ratings</p>
          <p className="text-xl font-semibold text-amber-600 mt-1">{stats.lowRatings}</p>
        </div>
      </div>

      <div className="mt-4 max-w-6xl rounded-xl border border-borderColor bg-white p-3 md:p-4">
        <label className="relative block">
          <img
            src={assets.search_icon}
            alt=""
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-70"
          />
          <input
            placeholder="Search by user, car, email, or comment..."
            className="w-full border border-borderColor rounded-lg h-10 pl-10 pr-3 text-sm outline-none"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>

      {errorMsg ? (
        <p className="mt-4 max-w-6xl rounded-lg border border-red-200 bg-red-50 text-red-600 text-sm px-3 py-2">
          {errorMsg}
        </p>
      ) : null}

      <div className="admin-section-scroll-shell mt-4">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll">
          <div className="max-w-6xl space-y-3">
            {loading ? (
              <div className="snap-start rounded-xl border border-borderColor bg-white p-8 text-center text-gray-500">
                Loading reviews...
              </div>
            ) : null}

            {!loading && filteredReviews.length === 0 ? (
              <div className="snap-start rounded-xl border border-borderColor bg-white p-8 text-center text-gray-500">
                No reviews found.
              </div>
            ) : null}

            {!loading &&
              filteredReviews.map((review) => {
                const isEditing = editId === review._id;
                const isBusy = loadingId === review._id;
                const fullName = `${review.user?.firstName || ''} ${review.user?.lastName || ''}`.trim() || 'User';
                const initials = fullName
                  .split(' ')
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((part) => part[0].toUpperCase())
                  .join('');
                const ratingValue = isEditing ? Number(draft.rating || 5) : Number(review.rating || 0);

                return (
                  <div key={review._id} className="snap-start rounded-xl border border-borderColor bg-white p-4 md:p-5 shadow-sm">
                    <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-full bg-primary/12 text-primary font-semibold flex items-center justify-center">
                          {initials || 'U'}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800">{fullName}</p>
                          <p className="text-xs text-gray-500">{review.user?.email || 'N/A'}</p>
                          <p className="text-sm text-gray-600 mt-1">
                            {review.car?.brand || 'Car'} {review.car?.model || ''}{' '}
                            <span className="text-gray-400">| {review.car?.location || 'Unknown location'}</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">{renderStars(ratingValue)}</div>
                    </div>

                    {isEditing ? (
                      <div className="mt-4 space-y-3">
                        <select
                          value={draft.rating}
                          onChange={(event) => setDraft((prev) => ({ ...prev, rating: event.target.value }))}
                          className="border border-borderColor rounded-lg px-3 py-2 text-sm bg-white"
                        >
                          <option value="5">5 - Excellent</option>
                          <option value="4">4 - Very Good</option>
                          <option value="3">3 - Good</option>
                          <option value="2">2 - Fair</option>
                          <option value="1">1 - Poor</option>
                        </select>

                        <textarea
                          rows={3}
                          value={draft.comment}
                          onChange={(event) => setDraft((prev) => ({ ...prev, comment: event.target.value }))}
                          className="w-full border border-borderColor rounded-lg px-3 py-2 text-sm"
                        />

                        <div className="flex flex-wrap gap-2">
                          <button
                            disabled={isBusy}
                            onClick={() => saveEdit(review._id)}
                            className={`px-3 py-2 rounded-lg text-sm text-white ${
                              isBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-600'
                            }`}
                          >
                            Save
                          </button>
                          <button
                            disabled={isBusy}
                            onClick={() => setEditId('')}
                            className="px-3 py-2 rounded-lg text-sm border border-borderColor hover:bg-light"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4">
                        <p className="text-gray-700 text-sm leading-relaxed">"{review.comment}"</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            disabled={isBusy}
                            onClick={() => startEdit(review)}
                            className="px-3 py-2 rounded-lg text-sm text-white bg-blue-600"
                          >
                            Edit
                          </button>
                          <button
                            disabled={isBusy}
                            onClick={() => removeReview(review._id)}
                            className="px-3 py-2 rounded-lg text-sm text-white bg-red-500"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        </div>
        <span className="admin-section-blur admin-section-blur--bottom" aria-hidden="true" />
      </div>
    </div>
  );
};

export default ManageReviews;
