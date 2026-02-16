import React, { useState } from 'react';
import API, { getErrorMessage } from '../../../api';
import { isAdmin, isLoggedIn } from '../../../utils/auth';

const ONE_HOUR_MS = 60 * 60 * 1000;
const PAST_TOLERANCE_MS = 60 * 1000;

const validateOfferDateTime = (fromDate, toDate) => {
  if (!fromDate || !toDate) return 'Please select pickup and return date first';

  const pickupDateTime = new Date(fromDate);
  const dropDateTime = new Date(toDate);

  if (Number.isNaN(pickupDateTime.getTime()) || Number.isNaN(dropDateTime.getTime())) {
    return 'Invalid pickup/drop date and time';
  }

  if (pickupDateTime.getTime() < Date.now() - PAST_TOLERANCE_MS) {
    return 'Pickup date and time cannot be in the past';
  }

  if (dropDateTime <= pickupDateTime) {
    return 'Drop date and time must be after pickup date and time';
  }

  if (dropDateTime.getTime() - pickupDateTime.getTime() < ONE_HOUR_MS) {
    return 'Minimum rental duration is 1 hour';
  }

  return '';
};

const MakeOfferForm = ({ carId, fromDate, toDate, originalPrice = 0, onSuccess }) => {
  const currency = import.meta.env.VITE_CURRENCY || '\u20B9';
  const [offeredPrice, setOfferedPrice] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const dateError = validateOfferDateTime(fromDate, toDate);

  const createOffer = async () => {
    if (isAdmin()) {
      setErrorMsg('Admin can view cars but cannot create rental offers');
      return;
    }

    if (!isLoggedIn()) {
      setErrorMsg('Please log in to create an offer');
      return;
    }

    if (dateError) {
      setErrorMsg(dateError);
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
      {!errorMsg && dateError ? <p className="text-amber-600 text-xs mt-2">{dateError}</p> : null}

      <button
        type="button"
        onClick={createOffer}
        disabled={loading || Boolean(dateError)}
        className={`mt-3 px-4 py-2 rounded-lg text-white ${
          loading || dateError ? 'bg-gray-400 cursor-not-allowed' : 'bg-black hover:opacity-90'
        }`}
      >
        {loading ? 'Sending...' : 'Send Offer'}
      </button>
    </div>
  );
};

export default MakeOfferForm;

