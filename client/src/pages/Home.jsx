import React from 'react';
import Hero from '../components/Hero';
import Featured from '../components/Featured';
import Testimonial from '../components/Testimonial';
import Newsletter from '../components/Newsletter';
import ContactForm from '../components/ContactForm';
import ScrollReveal from '../components/ui/ScrollReveal';

const Home = () => {
  return (
    <main className="bg-white">
      <Hero />

      <ScrollReveal direction="up" delay={30}>
        <section className="px-4 md:px-8 xl:px-10 py-6">
          <div className="max-w-330 mx-auto rounded-2xl border border-borderColor bg-white p-4 md:p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-xl bg-light p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Step 1</p>
              <p className="mt-1 font-semibold text-slate-800">Pick Your Car & Dates</p>
              <p className="text-sm text-slate-600 mt-1">Choose from premium listings with real-time availability.</p>
            </div>
            <div className="rounded-xl bg-light p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Step 2</p>
              <p className="mt-1 font-semibold text-slate-800">Negotiate If Needed</p>
              <p className="text-sm text-slate-600 mt-1">Submit offers with up to 3 rounds in a guided flow.</p>
            </div>
            <div className="rounded-xl bg-light p-4">
              <p className="text-xs uppercase tracking-wide text-slate-500">Step 3</p>
              <p className="mt-1 font-semibold text-slate-800">Pay Dynamic Advance & Confirm</p>
              <p className="text-sm text-slate-600 mt-1">
                Pay 20% to 30% advance by amount slab to lock your booking.
              </p>
            </div>
          </div>
        </section>
      </ScrollReveal>

      <Featured />
      <Testimonial />
      <ContactForm />
      <Newsletter />
    </main>
  );
};

export default Home;
