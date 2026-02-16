import React, { useEffect, useState } from 'react';
import { assets, menuLinks } from '../assets/assets';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { isAdmin, isLoggedIn } from '../utils/auth';

const desktopLinkClass = ({ isActive }) =>
  `px-3 py-2 rounded-lg text-sm transition-all ${
    isActive ? 'bg-primary/12 text-primary font-medium' : 'text-slate-600 hover:text-primary hover:bg-primary/7'
  }`;

const mobileLinkClass = ({ isActive }) =>
  `w-full px-3 py-2.5 rounded-lg text-sm transition-all ${
    isActive ? 'bg-primary/12 text-primary font-medium' : 'text-slate-600 hover:bg-slate-100'
  }`;

const actionClass =
  'px-4 py-2 rounded-lg text-sm font-medium border border-transparent transition-all';

const Navbar = ({ setShowLogin }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [searchText, setSearchText] = useState('');

  const loggedIn = isLoggedIn();
  const admin = isAdmin();
  const onHomePage = location.pathname === '/';
  const visibleMenuLinks = admin
    ? menuLinks.filter((link) => link.path === '/' || link.path === '/cars')
    : menuLinks;

  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (location.pathname !== '/cars') {
      setSearchText('');
      return;
    }
    const query = new URLSearchParams(location.search).get('q') || '';
    setSearchText(query);
  }, [location.pathname, location.search]);

  const submitSearch = (event) => {
    event.preventDefault();
    const query = searchText.trim();
    navigate(query ? `/cars?q=${encodeURIComponent(query)}` : '/cars');
    setOpen(false);
  };

  const goOwner = () => {
    navigate('/owner');
    setOpen(false);
  };

  const goProfile = () => {
    navigate('/my-profile');
    setOpen(false);
  };

  const logout = () => {
    setOpen(false);
    localStorage.clear();
    window.location.reload();
  };

  const openLogin = () => {
    setShowLogin(true);
    setOpen(false);
  };

  const isProtectedPath = (path) =>
    path === '/my-bookings' || path === '/my-rental-status' || path === '/my-profile';

  const handleNavLinkClick = (event, path) => {
    if (isProtectedPath(path) && !loggedIn) {
      event.preventDefault();
      openLogin();
      return;
    }
    setOpen(false);
  };

  return (
    <header
      className={`sticky top-0 z-40 border-b border-borderColor backdrop-blur-md ${
        onHomePage ? 'bg-slate-50/95' : 'bg-white/95'
      }`}
    >
      <div className="max-w-330 mx-auto h-16 px-4 sm:px-6 md:px-8 xl:px-10 flex items-center gap-3">
        <Link to="/" className="shrink-0">
          <img src={assets.logo} alt="logo" className="h-7 sm:h-8" />
        </Link>

        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          {visibleMenuLinks.map((link) => (
            <NavLink
              key={link.path}
              to={link.path}
              className={desktopLinkClass}
              onClick={(event) => handleNavLinkClick(event, link.path)}
            >
              {link.name}
            </NavLink>
          ))}
        </nav>

        {!admin && (
          <form
            onSubmit={submitSearch}
            className="hidden lg:flex items-center gap-2 ml-auto border border-borderColor rounded-full px-3 py-1.5 bg-white min-w-55 max-w-75 w-full"
          >
            <input
              type="text"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search cars..."
              className="w-full text-sm bg-transparent outline-none placeholder:text-slate-400"
            />
            <button type="submit" className="shrink-0 opacity-70 hover:opacity-100" aria-label="Search cars">
              <img src={assets.search_icon} alt="" className="w-4 h-4" />
            </button>
          </form>
        )}

        <div className="hidden md:flex items-center gap-2 lg:gap-3">
          {admin && (
            <button
              onClick={goOwner}
              className={`${actionClass} text-slate-700 hover:text-primary hover:bg-primary/8`}
            >
              Dashboard
            </button>
          )}

          {loggedIn ? (
            <>
              {!admin && (
                <button
                  onClick={goProfile}
                  className={`${actionClass} text-slate-700 hover:text-primary hover:bg-primary/8`}
                >
                  My Profile
                </button>
              )}
              <button
                onClick={logout}
                className={`${actionClass} border-slate-300 text-slate-700 hover:bg-red-50 hover:text-red-600 hover:border-red-200`}
              >
                Logout
              </button>
            </>
          ) : (
            <button
              onClick={openLogin}
              className={`${actionClass} bg-primary text-white hover:bg-primary-dull shadow-sm hover:shadow-md`}
            >
              Login
            </button>
          )}
        </div>

        <button
          type="button"
          className="md:hidden ml-auto p-2 rounded-lg border border-borderColor bg-white"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
        >
          <img src={open ? assets.close_icon : assets.menu_icon} alt="" className="w-5 h-5" />
        </button>
      </div>

      {open && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="md:hidden fixed inset-0 top-16 bg-slate-900/30 z-40"
          onClick={() => setOpen(false)}
        />
      )}

      <div
        className={`md:hidden fixed top-16 inset-x-0 h-[calc(100dvh-64px)] border-t border-borderColor z-50 transition-all duration-300 ${
          onHomePage ? 'bg-slate-50' : 'bg-white'
        } ${open ? 'translate-y-0 opacity-100 pointer-events-auto' : '-translate-y-2 opacity-0 pointer-events-none'}`}
      >
        <div className="max-w-330 mx-auto h-full overflow-y-auto px-4 py-4">
          {!admin && (
            <form onSubmit={submitSearch} className="flex items-center gap-2 border border-borderColor rounded-full px-3 py-2 bg-white">
              <input
                type="text"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search cars..."
                className="w-full text-sm bg-transparent outline-none placeholder:text-slate-400"
              />
              <button type="submit" className="shrink-0 opacity-70 hover:opacity-100" aria-label="Search cars">
                <img src={assets.search_icon} alt="" className="w-4 h-4" />
              </button>
            </form>
          )}

          <nav className="mt-4 flex flex-col gap-1.5">
            {visibleMenuLinks.map((link) => (
              <NavLink
                key={link.path}
                to={link.path}
                className={mobileLinkClass}
                onClick={(event) => handleNavLinkClick(event, link.path)}
              >
                {link.name}
              </NavLink>
            ))}
          </nav>

          <div className="mt-4 pt-4 border-t border-borderColor flex flex-col gap-2">
            {admin && (
              <button
                onClick={goOwner}
                className={`${actionClass} text-slate-700 hover:bg-primary/8 text-left`}
              >
                Dashboard
              </button>
            )}

            {loggedIn ? (
              <>
                {!admin && (
                  <button
                    onClick={goProfile}
                    className={`${actionClass} text-slate-700 hover:bg-primary/8 text-left`}
                  >
                    My Profile
                  </button>
                )}
                <button
                  onClick={logout}
                  className={`${actionClass} border-slate-300 text-slate-700 hover:bg-red-50 hover:text-red-600 hover:border-red-200 text-left`}
                >
                  Logout
                </button>
              </>
            ) : (
              <button
                onClick={openLogin}
                className={`${actionClass} bg-primary text-white hover:bg-primary-dull`}
              >
                Login
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
