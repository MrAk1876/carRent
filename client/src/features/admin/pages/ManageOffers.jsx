import React from 'react';
import Title from '../components/Title';
import AdminOfferList from '../../offers/components/AdminOfferList';

const ManageOffers = () => {
  return (
    <div className="px-4 pt-10 md:px-10 pb-10 w-full">
      <Title
        title="Manage Offers"
        subTitle="Review negotiation offers, counter prices, accept, reject, and auto-expire after the limit."
      />

      <div className="mt-6 max-w-6xl rounded-2xl border border-borderColor bg-linear-to-r from-primary/5 via-white to-cyan-50 p-5 md:p-6">
        <p className="text-xs uppercase tracking-wide text-gray-500">Negotiation Desk</p>
        <h2 className="text-xl md:text-2xl font-semibold text-gray-800 mt-1">Offer Moderation Panel</h2>
        <p className="text-sm text-gray-500 mt-2">
          Review user offers, counter with precision, and close negotiations fast without losing context.
        </p>
      </div>

      <div className="mt-6">
        <AdminOfferList />
      </div>
    </div>
  );
};

export default ManageOffers;
