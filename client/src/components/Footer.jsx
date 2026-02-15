import React from 'react';
import { NavLink } from 'react-router-dom';
import { assets } from '../assets/assets';

const Footer = () => {
  const linkClass = ({ isActive }) =>
    isActive ? 'text-primary font-medium' : 'hover:text-primary';

  return (
    <footer className="px-4 sm:px-6 md:px-10 lg:px-16 xl:px-24 mt-20 md:mt-28 text-sm text-slate-600">
      <div className="max-w-330 mx-auto rounded-3xl border border-borderColor bg-linear-to-b from-slate-50 to-white p-6 md:p-8 lg:p-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-8 pb-8 border-b border-borderColor">
          <div>
            <img src={assets.logo} alt="logo" className="h-8 md:h-9" />
            <p className="max-w-80 mt-3">
              Book with confidence, negotiate fairly, and pay securely with a transparent car-rental workflow.
            </p>
            <div className="flex items-center gap-3 mt-6">
              <a
                href="https://facebook.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Facebook"
                className="hover:-translate-y-1 transition-transform"
              >
                <img src={assets.facebook_logo} alt="facebook" className="w-5 h-5" />
              </a>
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noreferrer"
                aria-label="Instagram"
                className="hover:-translate-y-1 transition-transform"
              >
                <img src={assets.instagram_logo} alt="instagram" className="w-5 h-5" />
              </a>
              <a
                href="https://x.com"
                target="_blank"
                rel="noreferrer"
                aria-label="X"
                className="hover:-translate-y-1 transition-transform"
              >
                <img src={assets.twitter_logo} alt="x" className="w-5 h-5" />
              </a>
              <a
                href="mailto:support@carrental.com"
                aria-label="Email support"
                className="hover:-translate-y-1 transition-transform"
              >
                <img src={assets.gmail_logo} alt="email" className="w-5 h-5" />
              </a>
            </div>
          </div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 uppercase tracking-wide">Quick Links</h2>
            <ul className="mt-3 flex flex-col gap-2">
              <li>
                <NavLink to="/" className={linkClass}>
                  Home
                </NavLink>
              </li>
              <li>
                <NavLink to="/cars" className={linkClass}>
                  Browse Cars
                </NavLink>
              </li>
              <li>
                <a href="/#contact" className="hover:text-primary">
                  Contact Us
                </a>
              </li>
              <li>
                <NavLink to="/help-center" className={linkClass}>
                  Help Center
                </NavLink>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 uppercase tracking-wide">Resources</h2>
            <ul className="mt-3 flex flex-col gap-2">
              <li>
                <NavLink to="/terms" className={linkClass}>
                  Terms of Service
                </NavLink>
              </li>
              <li>
                <NavLink to="/privacy" className={linkClass}>
                  Privacy Policy
                </NavLink>
              </li>
              <li>
                <NavLink to="/insurance" className={linkClass}>
                  Insurance
                </NavLink>
              </li>
              <li>
                <NavLink to="/cookies" className={linkClass}>
                  Cookies
                </NavLink>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="text-base font-semibold text-slate-800 uppercase tracking-wide">Contact</h2>
            <ul className="mt-3 flex flex-col gap-2">
              <li>
                <a
                  href="https://maps.google.com/?q=123+Luxury+Drive+San+Francisco+CA+99809"
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-primary"
                >
                  123 Luxury Drive, San Francisco, CA 99809
                </a>
              </li>
              <li>
                <a href="tel:+14155550199" className="hover:text-primary">
                  +1 (415) 555-0199
                </a>
              </li>
              <li>
                <a href="mailto:support@carrental.com" className="hover:text-primary">
                  support@carrental.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="pt-5 flex flex-col md:flex-row gap-3 items-center justify-between">
          <p>&copy; {new Date().getFullYear()} CarRental. All rights reserved.</p>
          <ul className="flex items-center gap-4">
            <li>
              <NavLink to="/privacy" className={linkClass}>
                Privacy
              </NavLink>
            </li>
            <li>|</li>
            <li>
              <NavLink to="/terms" className={linkClass}>
                Terms
              </NavLink>
            </li>
            <li>|</li>
            <li>
              <NavLink to="/cookies" className={linkClass}>
                Cookies
              </NavLink>
            </li>
          </ul>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
