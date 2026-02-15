import React from 'react';
import { assets } from '../../../assets/assets';
import { getUser } from '../../../utils/auth';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

const NavbarOwner = ({ onMenuClick, isSidebarOpen }) => {
  const user = getUser();
  const navigate = useNavigate();

  const logout = () => {
    localStorage.clear();
    navigate('/');
    window.location.reload();
  };

  return (
    <div className="flex items-center justify-between gap-3 px-3 sm:px-6 md:px-10 py-3.5 text-gray-500 border-b border-borderColor relative bg-white/95 backdrop-blur">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label="Open navigation menu"
          aria-controls="owner-sidebar"
          aria-expanded={Boolean(isSidebarOpen)}
          className="inline-flex lg:hidden h-10 w-10 items-center justify-center rounded-lg border border-borderColor bg-white text-slate-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
            <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>

        <Link to="/">
          <img src={assets.logo} alt="logo" className="h-7 sm:h-8" />
        </Link>
      </div>

      <div className="flex items-center justify-end gap-2 sm:gap-4 min-w-0">
        <p className="hidden md:block truncate max-w-65">
          Welcome, {`${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Owner'}
        </p>
        <button
          onClick={logout}
          className="text-xs sm:text-sm text-red-500 border border-red-300 px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-red-50 transition-all"
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default NavbarOwner;
