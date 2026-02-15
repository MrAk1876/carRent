import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const PAGE_CONTENT = {
  '/help-center': {
    title: 'Help Center',
    intro:
      'Need help with booking, payments, or negotiations? Use these quick support notes before contacting our team.',
    points: [
      'Booking requests are reviewed by admin after advance payment.',
      'Negotiation supports up to 3 rounds for eligible listings.',
      'Advance payment may be refundable if admin rejects your request.',
      'Use My Bookings to track status, counters, and payment progress.',
    ],
  },
  '/terms': {
    title: 'Terms of Service',
    intro:
      'By using CarRental, you agree to provide accurate information, follow rental rules, and complete payments on time.',
    points: [
      'Users must provide valid identity and payment information.',
      'Owners/admin may reject or cancel bookings that violate platform policy.',
      'Damage, misuse, or delayed return may incur additional charges.',
      'Repeated abuse of negotiation or payment flow may result in account restrictions.',
    ],
  },
  '/privacy': {
    title: 'Privacy Policy',
    intro:
      'We collect only the data needed to process bookings, support requests, and improve service quality.',
    points: [
      'Profile details are used for booking verification and communication.',
      'Payment and booking metadata are used to prevent fraud.',
      'We do not sell your personal data to third parties.',
      'You can request account update or deletion via support.',
    ],
  },
  '/insurance': {
    title: 'Insurance & Coverage',
    intro:
      'Coverage rules may vary by car, city, and trip type. Always review listing details before payment.',
    points: [
      'Basic damage and liability terms apply based on booking policy.',
      'Users are responsible for violations, penalties, and prohibited use.',
      'Admin may request additional verification before approval.',
      'Support can help clarify coverage questions before confirmation.',
    ],
  },
  '/cookies': {
    title: 'Cookie Policy',
    intro:
      'Cookies help us keep sessions secure, remember preferences, and improve performance.',
    points: [
      'Essential cookies are required for login and protected routes.',
      'Analytics cookies help us improve load speed and usability.',
      'You can control cookies from browser settings anytime.',
      'Disabling essential cookies may affect booking features.',
    ],
  },
};

const StaticInfoPage = () => {
  const location = useLocation();
  const content = PAGE_CONTENT[location.pathname] || PAGE_CONTENT['/help-center'];

  return (
    <main className="px-4 md:px-8 xl:px-10 py-12">
      <div className="max-w-240 mx-auto rounded-2xl border border-borderColor bg-white p-6 md:p-8 shadow-sm">
        <p className="text-xs uppercase tracking-wide text-slate-500">Information</p>
        <h1 className="mt-2 text-3xl md:text-4xl font-semibold text-slate-900">{content.title}</h1>
        <p className="mt-4 text-slate-600">{content.intro}</p>

        <ul className="mt-5 space-y-3 text-slate-700">
          {content.points.map((point) => (
            <li key={point} className="flex items-start gap-2">
              <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <div className="mt-7 flex flex-wrap items-center gap-3">
          <Link to="/cars" className="px-4 py-2 rounded-lg bg-primary text-white hover:bg-primary-dull">
            Browse Cars
          </Link>
          <a href="/#contact" className="px-4 py-2 rounded-lg border border-borderColor hover:bg-light">
            Contact Support
          </a>
        </div>
      </div>
    </main>
  );
};

export default StaticInfoPage;
