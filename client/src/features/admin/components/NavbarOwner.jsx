import React from 'react';
import { assets } from '../../../assets/assets';
import { getUser } from '../../../utils/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import ThemeToggle from '../../../components/ThemeToggle';
import { Dialog, DialogContent } from '@mui/material';
import NotificationBell from '../../../components/notifications/NotificationBell';
import AdminMessagingDashboard from '../../../components/admin/AdminMessagingDashboard';

const NavbarOwner = ({ onMenuClick, isSidebarOpen }) => {
  const user = getUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [chatOpen, setChatOpen] = React.useState(false);

  React.useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.get('chat') !== 'open') return;
    setChatOpen(true);
    query.delete('chat');
    const nextQuery = query.toString();
    navigate(
      {
        pathname: location.pathname,
        search: nextQuery ? `?${nextQuery}` : '',
      },
      { replace: true },
    );
  }, [location.pathname, location.search, navigate]);

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

        <Link to="/" className="app-logo-shell">
          <img src={assets.logo} alt="logo" className="h-7 sm:h-8" />
        </Link>
      </div>

      <div className="flex items-center justify-end gap-2 sm:gap-4 min-w-0">
        <NotificationBell size="small" />
        <button
          type="button"
          onClick={() => setChatOpen(true)}
          className="inline-flex items-center gap-1.5 text-xs sm:text-sm text-slate-700 border border-borderColor px-2.5 sm:px-3 py-1.5 rounded-lg hover:bg-primary/8 hover:text-primary transition-all"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10.5h8M8 14h4.6M5 6.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.8L5 21v-2.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
          </svg>
          Chat
        </button>
        <ThemeToggle />
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

      <Dialog
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        fullWidth
        maxWidth="lg"
        PaperProps={{
          sx: {
            borderRadius: 3,
            overflow: 'hidden',
          },
        }}
      >
        <DialogContent sx={{ p: { xs: 1, sm: 1.5 } }}>
          <AdminMessagingDashboard />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NavbarOwner;
