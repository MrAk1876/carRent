import React from 'react';

const Newsletter = () => {
  return (
    <section className="px-4 md:px-8 xl:px-10 pt-4 pb-20">
      <div className="max-w-245 mx-auto rounded-3xl border border-borderColor bg-linear-to-r from-blue-50 via-white to-cyan-50 p-6 md:p-9 text-center">
        <h2 className="text-3xl md:text-4xl font-semibold text-slate-900">Never Miss a Deal</h2>
        <p className="text-sm md:text-base text-slate-600 mt-3">
          Get notified about new arrivals, limited-time discounts, and negotiation-ready offers.
        </p>

        <form className="mt-7 max-w-2xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2">
          <input
            className="border border-borderColor rounded-lg px-4 py-3 outline-none text-gray-700 bg-white"
            type="email"
            placeholder="Enter your email"
            required
          />
          <button
            type="submit"
            className="px-8 py-3 text-white bg-primary hover:bg-primary-dull transition-all rounded-lg font-medium"
          >
            Subscribe
          </button>
        </form>
      </div>
    </section>
  );
};

export default Newsletter;
