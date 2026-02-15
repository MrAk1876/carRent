import React, { useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import { isLoggedIn } from '../../../utils/auth';

const MakeOfferForm = ({ carId, fromDate, toDate, originalPrice = 0, onSuccess }) => {
  const currency = import.meta.env.VITE_CURRENCY;
  const [offeredPrice, setOfferedPrice] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const createOffer = async () => {
    if (!isLoggedIn()) {
      setErrorMsg('Please log in to create an offer');
      return;
    }

    if (!fromDate || !toDate) {
      setErrorMsg('Please select pickup and return date first');
      return;
    }

    const price = Number(offeredPrice);
    if (!Number.isFinite(price) || price <= 0) {
      setErrorMsg('Offer price must be a positive number');
      return;
    }

    try {
      setLoading(true);
      setErrorMsg('');

      const res = await API.post('/offers', {
        carId,
        fromDate,
        toDate,
        offeredPrice: price,
        message,
      });

      setOfferedPrice('');
      setMessage('');
      if (onSuccess) onSuccess(res.data.offer);
    } catch (error) {
      setErrorMsg(getErrorMessage(error, 'Failed to submit offer'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-dashed border-borderColor rounded-lg p-4">
      <p className="font-medium text-gray-700">Make a Negotiation Offer</p>
      <p className="text-xs text-gray-400 mt-1">
        Original quote: {currency}
        {originalPrice || 0}. Negotiation supports up to 3 rounds.
      </p>

      <div className="mt-3 space-y-2">
        <input
          type="number"
          value={offeredPrice}
          onChange={(e) => setOfferedPrice(e.target.value)}
          placeholder="Enter your offered total price"
          className="border border-borderColor px-3 py-2 rounded-lg w-full"
        />
        <textarea
          rows={2}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Optional note to admin"
          className="border border-borderColor px-3 py-2 rounded-lg w-full"
        />
      </div>

      {errorMsg && <p className="text-red-500 text-xs mt-2">{errorMsg}</p>}

      <button
        type="button"
        onClick={createOffer}
        disabled={loading}
        className={`mt-3 px-4 py-2 rounded-lg text-white ${
          loading ? 'bg-gray-400 cursor-not-allowed' : 'bg-black hover:opacity-90'
        }`}
      >
        {loading ? 'Sending...' : 'Send Offer'}
      </button>
    </div>
  );
};

export default MakeOfferForm;
