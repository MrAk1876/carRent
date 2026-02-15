import React from 'react';
import { assets } from '../../../assets/assets';
import { getUser } from '../../../utils/auth';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';

const NavbarOwner = () => {
  const user = getUser();
  const navigate = useNavigate();

  const logout = () => {
    localStorage.clear();
    navigate('/');
    window.location.reload();
  };

  return (
    <div className="flex items-center justify-between gap-3 px-4 sm:px-6 md:px-10 py-4 text-gray-500 border-b border-borderColor relative bg-white/95 backdrop-blur">
      <Link to="/">
        <img src={assets.logo} alt="logo" className="h-7" />
      </Link>
      <div className="flex items-center justify-end gap-2 sm:gap-4 min-w-0">
        <p className="hidden sm:block truncate max-w-65">
          Welcome, {`${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Owner'}
        </p>
        <button
          onClick={logout}
          className="text-xs sm:text-sm text-red-500 border border-red-300 px-2.5 sm:px-3 py-1 rounded-lg hover:bg-red-50 transition-all"
        >
          Logout
        </button>
      </div>
    </div>
  );
};

export default NavbarOwner;
