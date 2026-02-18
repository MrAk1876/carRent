import React, { Suspense, useEffect, useState } from 'react';
import NavbarOwner from '../components/NavbarOwner';
import Sidebar from '../components/Sidebar';
import { Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import '../components/SectionScroll.css';

const SECTION_SCROLL_ROUTES = new Set([
  '/owner',
  '/owner/manage-cars',
  '/owner/manage-bookings',
  '/owner/bookings',
  '/owner/rental-tracking',
  '/owner/analytics',
  '/owner/fleet-overview',
  '/owner/drivers',
  '/owner/users',
  '/owner/offers',
  '/owner/reviews',
  '/owner/manage-roles',
]);

const adminContentTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
};

const AdminContentLoader = () => (
  <div className="flex min-h-[40vh] w-full items-center justify-center px-4 text-sm text-slate-500">
    Loading...
  </div>
);

const Layout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const location = useLocation();
  const useSectionScroll = SECTION_SCROLL_ROUTES.has(location.pathname);

  useEffect(() => {
    setIsSidebarOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 1024) {
        setIsSidebarOpen(false);
      }
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsSidebarOpen(false);
      }
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    if (window.innerWidth >= 1024) {
      document.body.style.overflow = '';
      return;
    }

    document.body.style.overflow = isSidebarOpen ? 'hidden' : '';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isSidebarOpen]);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-50/40">
      <div className="shrink-0">
        <NavbarOwner onMenuClick={() => setIsSidebarOpen(true)} isSidebarOpen={isSidebarOpen} />
      </div>
      <div className="relative flex min-h-0 flex-1">
        <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
        <main
          data-scroll-mode={useSectionScroll ? 'section+full' : 'full'}
          className={`admin-main min-w-0 flex-1 overflow-x-hidden overflow-y-auto ${
            useSectionScroll ? 'admin-main--section' : ''
          }`}
        >
          <Suspense fallback={<AdminContentLoader />}>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                variants={adminContentTransition}
                initial="initial"
                animate="animate"
                exit="exit"
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="min-h-full"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </Suspense>
        </main>
      </div>
    </div>
  );
};

export default Layout;
