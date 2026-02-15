import React, { useEffect, useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import { assets } from '../../../assets/assets';

const STATUS_FILTERS = ['all', 'pending', 'countered', 'accepted', 'rejected', 'expired'];

const badgeClass = (status) => {
  switch (status) {
    case 'pending':
      return 'bg-amber-100 text-amber-700 border-amber-200';
    case 'countered':
      return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'accepted':
      return 'bg-emerald-100 text-emerald-700 border-emerald-200';
    case 'rejected':
      return 'bg-rose-100 text-rose-700 border-rose-200';
    case 'expired':
      return 'bg-slate-200 text-slate-700 border-slate-300';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
};

const formatStatus = (status) => {
  const value = String(status || '').trim();
  if (!value) return 'unknown';
  return value.charAt(0).toUpperCase() + value.slice(1);
};

const AdminOfferList = () => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const [offers, setOffers] = useState([]);
  const [counterPriceById, setCounterPriceById] = useState({});
  const [messageById, setMessageById] = useState({});
  const [loadingId, setLoadingId] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadOffers = async () => {
    try {
      const res = await API.get('/admin/offers');
      setOffers(Array.isArray(res.data) ? res.data : []);
      setErrorMsg('');
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to load offers'));
    }
  };

  useEffect(() => {
    loadOffers();
  }, []);

  const doAction = async (offerId, action) => {
    try {
      setLoadingId(offerId);
      setErrorMsg('');

      if (action === 'counter') {
        const counterPrice = Number(counterPriceById[offerId]);
        if (!Number.isFinite(counterPrice) || counterPrice <= 0) {
          setErrorMsg('Please enter a valid counter price.');
          setLoadingId('');
          return;
        }

        await API.put(`/admin/offers/${offerId}/counter`, {
          counterPrice,
          message: String(messageById[offerId] || '').trim(),
        });
      } else if (action === 'delete') {
        await API.delete(`/admin/offers/${offerId}`);
      } else {
        await API.put(`/admin/offers/${offerId}/${action}`);
      }

      await loadOffers();
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to process offer'));
    } finally {
      setLoadingId('');
    }
  };

  const sortedOffers = useMemo(() => {
    return [...offers].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [offers]);

  const stats = useMemo(() => {
    const total = offers.length;
    const pending = offers.filter((offer) => offer.status === 'pending').length;
    const countered = offers.filter((offer) => offer.status === 'countered').length;
    const accepted = offers.filter((offer) => offer.status === 'accepted').length;
    const closed = offers.filter((offer) => ['rejected', 'expired'].includes(offer.status)).length;
    return { total, pending, countered, accepted, closed };
  }, [offers]);

  const filteredOffers = useMemo(() => {
    const searchValue = search.trim().toLowerCase();

    return sortedOffers.filter((offer) => {
      const statusMatch = statusFilter === 'all' || offer.status === statusFilter;
      if (!statusMatch) return false;

      if (!searchValue) return true;
      const userName = `${offer.user?.firstName || ''} ${offer.user?.lastName || ''}`.toLowerCase();
      const carName = `${offer.car?.brand || ''} ${offer.car?.model || ''}`.toLowerCase();
      const searchSource = `${userName} ${offer.user?.email || ''} ${carName} ${offer.message || ''}`.toLowerCase();
      return searchSource.includes(searchValue);
    });
  }, [search, sortedOffers, statusFilter]);

  const getUserOfferHistory = (offer) => {
    if (Array.isArray(offer.userOfferHistory) && offer.userOfferHistory.length > 0) {
      return offer.userOfferHistory;
    }
    if (Number.isFinite(Number(offer.offeredPrice))) {
      return [Number(offer.offeredPrice)];
    }
    return [];
  };

  return (
    <div className="h-full min-h-0 max-w-6xl flex flex-col gap-4">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Total</p>
          <p className="text-xl font-semibold text-gray-800 mt-1">{stats.total}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Pending</p>
          <p className="text-xl font-semibold text-amber-600 mt-1">{stats.pending}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Countered</p>
          <p className="text-xl font-semibold text-blue-600 mt-1">{stats.countered}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Accepted</p>
          <p className="text-xl font-semibold text-emerald-600 mt-1">{stats.accepted}</p>
        </div>
        <div className="rounded-xl border border-borderColor bg-white p-3">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Closed</p>
          <p className="text-xl font-semibold text-slate-700 mt-1">{stats.closed}</p>
        </div>
      </div>

      <div className="rounded-xl border border-borderColor bg-white p-3 md:p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3">
          <label className="relative block">
            <img
              src={assets.search_icon}
              alt=""
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-70"
            />
            <input
              type="text"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by user, car, email, or note..."
              className="w-full border border-borderColor rounded-lg h-10 pl-10 pr-3 text-sm outline-none"
            />
          </label>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="border border-borderColor rounded-lg h-10 px-3 text-sm bg-white outline-none"
            >
              {STATUS_FILTERS.map((status) => (
                <option value={status} key={status}>
                  {status === 'all' ? 'All status' : formatStatus(status)}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={loadOffers}
              className="h-10 px-4 rounded-lg border border-borderColor text-sm hover:bg-light"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {errorMsg ? (
        <p className="rounded-lg border border-red-200 bg-red-50 text-red-600 text-sm px-3 py-2">{errorMsg}</p>
      ) : null}

      <div className="admin-section-scroll-shell">
        <span className="admin-section-blur admin-section-blur--top" aria-hidden="true" />
        <div className="admin-section-scroll">
          {filteredOffers.length === 0 ? (
            <div className="rounded-xl border border-borderColor bg-white p-8 text-center text-gray-500">
              No offers found for selected filters.
            </div>
          ) : null}

          {filteredOffers.map((offer) => {
            const userName = `${offer.user?.firstName || ''} ${offer.user?.lastName || ''}`.trim() || 'Unknown User';
            const status = String(offer.status || '').toLowerCase();
            const attempts = Number(offer.offerCount || 0);
            const history = getUserOfferHistory(offer);
            const isBusy = loadingId === offer._id;

            return (
              <div key={offer._id} className="snap-start rounded-2xl border border-borderColor bg-white p-4 md:p-5 shadow-sm mb-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-semibold text-gray-800">
                      {offer.car?.brand || 'Car'} {offer.car?.model || ''}
                    </h3>
                    <p className="text-sm text-gray-600 mt-1">
                      User: <span className="font-medium">{userName}</span> ({offer.user?.email || 'N/A'})
                    </p>
                    <p className="text-xs text-gray-500 mt-1">
                      {offer.fromDate?.split('T')[0]} to {offer.toDate?.split('T')[0]}
                    </p>
                  </div>

                  <span className={`px-3 py-1 rounded-full text-xs font-medium border w-max ${badgeClass(status)}`}>
                    {formatStatus(status)}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <div className="rounded-lg bg-light p-3">
                    <p className="text-xs text-gray-500">Original</p>
                    <p className="font-semibold text-gray-800">
                      {currency}
                      {offer.originalPrice}
                    </p>
                  </div>
                  <div className="rounded-lg bg-light p-3">
                    <p className="text-xs text-gray-500">Offered</p>
                    <p className="font-semibold text-gray-800">
                      {currency}
                      {offer.offeredPrice}
                    </p>
                  </div>
                  <div className="rounded-lg bg-light p-3">
                    <p className="text-xs text-gray-500">Counter</p>
                    <p className="font-semibold text-gray-800">
                      {currency}
                      {offer.counterPrice || 0}
                    </p>
                  </div>
                  <div className="rounded-lg bg-light p-3">
                    <p className="text-xs text-gray-500">Attempts</p>
                    <p className="font-semibold text-gray-800">{attempts}/3</p>
                  </div>
                </div>

                {history.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {history.map((amount, index) => (
                      <span
                        key={`${offer._id}-history-${index}`}
                        className="px-2.5 py-1 rounded-full border border-borderColor bg-white text-gray-600"
                      >
                        Round {index + 1}: {currency}
                        {amount}
                      </span>
                    ))}
                  </div>
                ) : null}

                {offer.message ? (
                  <p className="mt-3 text-sm text-gray-600 border border-borderColor rounded-lg px-3 py-2 bg-light/40">
                    <span className="font-medium text-gray-700">Note:</span> {offer.message}
                  </p>
                ) : null}

                {status === 'pending' ? (
                  <div className="mt-4 pt-4 border-t border-borderColor space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <input
                        type="number"
                        value={counterPriceById[offer._id] || ''}
                        onChange={(event) =>
                          setCounterPriceById((prev) => ({ ...prev, [offer._id]: event.target.value }))
                        }
                        placeholder="Counter price"
                        className="border border-borderColor rounded-lg px-3 py-2 text-sm"
                      />
                      <input
                        type="text"
                        value={messageById[offer._id] || ''}
                        onChange={(event) =>
                          setMessageById((prev) => ({ ...prev, [offer._id]: event.target.value }))
                        }
                        placeholder="Optional counter note"
                        className="border border-borderColor rounded-lg px-3 py-2 text-sm"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={isBusy}
                        onClick={() => doAction(offer._id, 'accept')}
                        className={`px-3 py-2 rounded-lg text-sm text-white ${
                          isBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-emerald-600'
                        }`}
                      >
                        Accept
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => doAction(offer._id, 'counter')}
                        className={`px-3 py-2 rounded-lg text-sm text-white ${
                          isBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-amber-500'
                        }`}
                      >
                        Counter
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => doAction(offer._id, 'reject')}
                        className={`px-3 py-2 rounded-lg text-sm text-white ${
                          isBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-500'
                        }`}
                      >
                        Reject
                      </button>
                      <button
                        disabled={isBusy}
                        onClick={() => {
                          if (!window.confirm('Delete this offer?')) return;
                          doAction(offer._id, 'delete');
                        }}
                        className={`px-3 py-2 rounded-lg text-sm text-white ${
                          isBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-slate-800'
                        }`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ) : null}

                {status === 'countered' ? (
                  <div className="mt-4 pt-4 border-t border-borderColor flex flex-wrap gap-2">
                    <button
                      disabled={isBusy}
                      onClick={() => doAction(offer._id, 'reject')}
                      className={`px-3 py-2 rounded-lg text-sm text-white ${
                        isBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-red-500'
                      }`}
                    >
                      Close (Reject)
                    </button>
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        if (!window.confirm('Delete this offer?')) return;
                        doAction(offer._id, 'delete');
                      }}
                      className={`px-3 py-2 rounded-lg text-sm text-white ${
                        isBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-slate-800'
                      }`}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}

                {!['pending', 'countered'].includes(status) ? (
                  <div className="mt-4 pt-4 border-t border-borderColor">
                    <button
                      disabled={isBusy}
                      onClick={() => {
                        if (!window.confirm('Delete this offer?')) return;
                        doAction(offer._id, 'delete');
                      }}
                      className={`px-3 py-2 rounded-lg text-sm text-white ${
                        isBusy ? 'bg-gray-400 cursor-not-allowed' : 'bg-slate-800'
                      }`}
                    >
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
        <span className="admin-section-blur admin-section-blur--bottom" aria-hidden="true" />
      </div>
    </div>
  );
};

export default AdminOfferList;
