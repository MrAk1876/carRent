import React, { useMemo, useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import useNotify from '../../../hooks/useNotify';

const statusBadge = (status) => {
  switch (status) {
    case 'pending':
      return 'bg-yellow-100 text-yellow-700';
    case 'countered':
      return 'bg-blue-100 text-blue-700';
    case 'accepted':
      return 'bg-green-100 text-green-700';
    case 'rejected':
      return 'bg-red-100 text-red-700';
    case 'expired':
      return 'bg-gray-200 text-gray-700';
    default:
      return 'bg-gray-200 text-gray-700';
  }
};

const UserOfferList = ({ offers, onRefresh }) => {
  const currency = import.meta.env.VITE_CURRENCY;
  const notify = useNotify();
  const [counterById, setCounterById] = useState({});
  const [messageById, setMessageById] = useState({});
  const [loadingId, setLoadingId] = useState('');

  const sortedOffers = useMemo(() => {
    return [...offers].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [offers]);

  const respond = async (offerId, action) => {
    try {
      setLoadingId(offerId);
      const payload = { action };
      if (action === 'counter') {
        payload.offeredPrice = Number(counterById[offerId]);
        payload.message = messageById[offerId] || '';
      }

      await API.put(`/offers/${offerId}/respond`, payload);
      if (onRefresh) onRefresh();
      notify.success('Offer response submitted');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to update offer'));
    } finally {
      setLoadingId('');
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">My Offers</h2>

      {sortedOffers.length === 0 && (
        <p className="text-sm text-gray-500">No offers yet. Create one from car details page.</p>
      )}

      {sortedOffers.map((offer) => (
        <div key={offer._id} className="border rounded-xl p-4 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">
                {offer.car?.brand} {offer.car?.model}
              </p>
              <p className="text-xs text-gray-500">
                {offer.fromDate?.split('T')[0]} to {offer.toDate?.split('T')[0]}
              </p>
            </div>
            <span className={`px-3 py-1 text-xs rounded-full ${statusBadge(offer.status)}`}>{offer.status}</span>
          </div>

          <div className="mt-3 text-sm text-gray-600 space-y-1">
            <p>
              Original: {currency}
              {offer.originalPrice}
            </p>
            <p>
              Your Offer: {currency}
              {offer.offeredPrice}
            </p>
            {offer.counterPrice ? (
              <p>
                Admin Counter: {currency}
                {offer.counterPrice}
              </p>
            ) : null}
            <p>Attempts: {offer.offerCount}/3</p>
            {offer.message ? <p>Note: {offer.message}</p> : null}
          </div>

          {offer.status === 'countered' && (
            <div className="mt-3 space-y-2">
              {offer.offerCount < 3 ? (
                <div className="grid md:grid-cols-2 gap-2">
                  <input
                    type="number"
                    value={counterById[offer._id] || ''}
                    onChange={(e) => setCounterById((prev) => ({ ...prev, [offer._id]: e.target.value }))}
                    placeholder="Your new counter offer"
                    className="border border-borderColor rounded px-3 py-2"
                  />
                  <input
                    type="text"
                    value={messageById[offer._id] || ''}
                    onChange={(e) => setMessageById((prev) => ({ ...prev, [offer._id]: e.target.value }))}
                    placeholder="Optional message"
                    className="border border-borderColor rounded px-3 py-2"
                  />
                </div>
              ) : (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                  Final counter price received. You can only accept or reject now.
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                <button
                  disabled={loadingId === offer._id}
                  onClick={() => respond(offer._id, 'accept')}
                  className="bg-green-600 text-white px-3 py-1 rounded text-sm"
                >
                  Accept Counter
                </button>
                {offer.offerCount < 3 && (
                  <button
                    disabled={loadingId === offer._id}
                    onClick={() => respond(offer._id, 'counter')}
                    className="bg-yellow-500 text-white px-3 py-1 rounded text-sm"
                  >
                    Counter Back
                  </button>
                )}
                <button
                  disabled={loadingId === offer._id}
                  onClick={() => respond(offer._id, 'reject')}
                  className="bg-red-500 text-white px-3 py-1 rounded text-sm"
                >
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default UserOfferList;
