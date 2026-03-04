import React from 'react';
import { assets } from '../../../assets/assets';
import { getUser } from '../../../utils/auth';
import { useLocation, useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle, IconButton } from '@mui/material';
import NotificationBell from '../../../components/notifications/NotificationBell';
import AdminMessagingDashboard from '../../../components/admin/AdminMessagingDashboard';

const NavbarOwner = ({ onMenuClick, isSidebarOpen }) => {
  const user = getUser();
  const navigate = useNavigate();
  const location = useLocation();
  const [chatOpen, setChatOpen] = React.useState(false);
  const [lastSelectedUserId, setLastSelectedUserId] = React.useState('');

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

  const openChatDialog = (event) => {
    const trigger = event?.currentTarget;
    if (trigger && typeof trigger.blur === 'function') {
      trigger.blur();
    }
    if (document?.activeElement && typeof document.activeElement.blur === 'function') {
      document.activeElement.blur();
    }
    window.requestAnimationFrame(() => {
      setChatOpen(true);
    });
  };

  return (
    <div className="flex items-center justify-between gap-2 px-2.5 sm:px-6 md:px-10 py-2.5 sm:py-3.5 text-gray-500 border-b border-borderColor relative bg-white/95 backdrop-blur">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={isSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-controls="owner-sidebar"
          aria-expanded={Boolean(isSidebarOpen)}
          className="inline-flex lg:hidden h-10 w-10 items-center justify-center rounded-lg border border-borderColor bg-white text-slate-700"
        >
          {isSidebarOpen ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" d="M6 6l12 12M18 6l-12 12" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
              <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          )}
        </button>

        <Link to="/" className="app-logo-shell">
          <img src={assets.logo} alt="logo" className="h-6 w-auto sm:h-8" />
        </Link>
      </div>

      <div className="flex items-center justify-end gap-1.5 sm:gap-3 min-w-0">
        <NotificationBell size="small" />
        <button
          type="button"
          onClick={openChatDialog}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-borderColor text-slate-700 transition-all hover:bg-primary/8 hover:text-primary sm:h-auto sm:w-auto sm:px-3 sm:py-1.5"
          title="Chat"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4">
            <path strokeLinecap="round" strokeLinejoin="round" d="M8 10.5h8M8 14h4.6M5 6.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9.8L5 21v-2.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" />
          </svg>
          <span className="hidden sm:inline text-sm">Chat</span>
        </button>
        <p className="hidden lg:block truncate max-w-65">
          Welcome, {`${user?.firstName || ''} ${user?.lastName || ''}`.trim() || 'Owner'}
        </p>
        <button
          onClick={logout}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-300 text-red-500 transition-all hover:bg-red-50 sm:h-auto sm:w-auto sm:px-3 sm:py-1.5"
          title="Logout"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-4 w-4 sm:hidden">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 17l5-5-5-5M20 12H9M9 4h-2a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2" />
          </svg>
          <span className="hidden sm:inline text-sm">Logout</span>
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
        <DialogTitle
          sx={{
            py: 1,
            px: 1.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 700 }}>Admin Chat</span>
          <IconButton size="small" onClick={() => setChatOpen(false)} aria-label="Close chat dialog">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: { xs: 1, sm: 1.5 } }}>
          <AdminMessagingDashboard
            initialSelectedUserId={lastSelectedUserId}
            onSelectedUserIdChange={setLastSelectedUserId}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default NavbarOwner;
