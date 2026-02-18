import React, { useState } from 'react';
import API, { getErrorMessage } from '../api';
import useNotify from '../hooks/useNotify';

const Newsletter = () => {
  const notify = useNotify();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event) => {
    event.preventDefault();
    if (submitting) return;

    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      notify.error('Please enter your email address.');
      return;
    }

    try {
      setSubmitting(true);
      const response = await API.post('/contact/newsletter', { email: normalizedEmail });
      notify.success(response?.data?.message || 'Subscribed successfully.');
      setEmail('');
    } catch (error) {
      notify.error(getErrorMessage(error, 'Failed to subscribe. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="px-4 md:px-8 xl:px-10 pt-4 pb-20">
      <div className="max-w-245 mx-auto rounded-3xl border border-borderColor bg-linear-to-r from-blue-50 via-white to-cyan-50 p-6 md:p-9 text-center">
        <h2 className="text-3xl md:text-4xl font-semibold text-slate-900">Never Miss a Deal</h2>
        <p className="text-sm md:text-base text-slate-600 mt-3">
          Get notified about new arrivals, limited-time discounts, and negotiation-ready offers.
        </p>

        <form
          className="mt-7 max-w-2xl mx-auto grid grid-cols-1 md:grid-cols-[1fr_auto] gap-2"
          onSubmit={onSubmit}
        >
          <input
            className="border border-borderColor rounded-lg px-4 py-3 outline-none text-gray-700 bg-white"
            type="email"
            placeholder="Enter your email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            disabled={submitting}
          />
          <button
            type="submit"
            disabled={submitting}
            className={`px-8 py-3 text-white transition-all rounded-lg font-medium ${
              submitting
                ? 'bg-blue-300 cursor-not-allowed'
                : 'bg-primary hover:bg-primary-dull'
            }`}
          >
            {submitting ? 'Subscribing...' : 'Subscribe'}
          </button>
        </form>
      </div>
    </section>
  );
};

export default Newsletter;
