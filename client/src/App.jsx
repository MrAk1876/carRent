import React, { Suspense, lazy, useEffect, useState } from 'react';
import Navbar from './components/Navbar';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Footer from './components/Footer';
import Login from './components/Login';
import API from './api';
import { isLoggedIn, isAdmin, hasPermission, isPlatformSuperAdmin } from './utils/auth';
import { PERMISSIONS } from './utils/rbac';
import MessageCenter from './components/ui/MessageCenter';

const Home = lazy(() => import('./pages/Home'));
const CarDetail = lazy(() => import('./pages/CarDetail'));
const Cars = lazy(() => import('./pages/Cars'));
const MyBookings = lazy(() => import('./pages/MyBookings'));
const MyRentalStatus = lazy(() => import('./pages/MyRentalStatus'));
const SubscriptionPlans = lazy(() => import('./pages/SubscriptionPlans'));
const MySubscription = lazy(() => import('./pages/MySubscription'));
const UserProfile = lazy(() => import('./pages/UserProfile'));
const CompleteProfile = lazy(() => import('./pages/CompleteProfile'));
const StaticInfoPage = lazy(() => import('./pages/StaticInfoPage'));

const Layout = lazy(() => import('./features/admin/pages/Layout'));
const Dashboard = lazy(() => import('./features/admin/pages/Dashboard'));
const AddCar = lazy(() => import('./features/admin/pages/AddCar'));
const ManageCars = lazy(() => import('./features/admin/pages/ManageCars'));
const ManageBooking = lazy(() => import('./features/admin/pages/ManageBooking'));
const AdminBookings = lazy(() => import('./features/admin/pages/AdminBookings'));
const ManageUsers = lazy(() => import('./features/admin/pages/ManageUsers'));
const ManageRoles = lazy(() => import('./features/admin/pages/ManageRoles'));
const ManageBranches = lazy(() => import('./features/admin/pages/ManageBranches'));
const AdminProfile = lazy(() => import('./features/admin/pages/AdminProfile'));
const ManageOffers = lazy(() => import('./features/admin/pages/ManageOffers'));
const ManageReviews = lazy(() => import('./features/admin/pages/ManageReviews'));
const RentalTracking = lazy(() => import('./features/admin/pages/RentalTracking'));
const FleetOverview = lazy(() => import('./features/admin/pages/FleetOverview'));
const ManageDrivers = lazy(() => import('./features/admin/pages/ManageDrivers'));
const AnalyticsDashboard = lazy(() => import('./features/admin/pages/AnalyticsDashboard'));
const PlatformOverview = lazy(() => import('./features/admin/pages/PlatformOverview'));

const routeTransition = {
  initial: { opacity: 0, y: 14, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.995 },
};

const staticRouteTransition = {
  initial: { opacity: 1, y: 0, scale: 1 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 1, y: 0, scale: 1 },
};
const AnimatedPage = motion.div;

const HEX_COLOR_PATTERN = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i;

const safeColor = (value, fallback) => {
  const candidate = String(value || '').trim();
  return HEX_COLOR_PATTERN.test(candidate) ? candidate : fallback;
};

const RouteLoader = () => (
  <div className="flex min-h-[40vh] w-full items-center justify-center px-4 text-sm text-slate-500">
    Loading page...
  </div>
);

const App = () => {
  const [showLogin, setShowLogin] = useState(false);
  const location = useLocation();
  const isOwnerPath = location.pathname.startsWith('/owner') || location.pathname.startsWith('/admin');
  const loggedIn = isLoggedIn();
  const staff = isAdmin();
  const platformSuperAdmin = isPlatformSuperAdmin();
  const can = (permission) => hasPermission(permission);
  const canManageBookings = can(PERMISSIONS.MANAGE_BOOKINGS);
  const canViewBookings = can(PERMISSIONS.VIEW_ALL_BOOKINGS) || can(PERMISSIONS.MANAGE_BOOKINGS);
  const canManageDrivers = can(PERMISSIONS.MANAGE_DRIVERS);
  const canViewPlatform = platformSuperAdmin;
  const canViewFleetOverview =
    can(PERMISSIONS.MANAGE_FLEET) || can(PERMISSIONS.MANAGE_MAINTENANCE) || can(PERMISSIONS.VIEW_ANALYTICS);

  const userPageFallback = staff ? '/owner' : '/';
  const rootTransitionKey = isOwnerPath ? '/owner-shell' : location.pathname;
  const rootTransitionVariants = isOwnerPath ? staticRouteTransition : routeTransition;
  const rootTransitionProps = isOwnerPath ? { duration: 0 } : { duration: 0.35, ease: 'easeInOut' };

  useEffect(() => {
    let active = true;
    API.get('/tenant/context', { showErrorToast: false, cacheTtlMs: 10 * 60 * 1000 })
      .then((response) => {
        if (!active) return;
        const tenant = response?.data?.tenant || {};
        const primaryColor = safeColor(tenant.primaryColor, '#2563eb');
        const secondaryColor = safeColor(tenant.secondaryColor, '#1f58d8');
        document.documentElement.style.setProperty('--color-primary', primaryColor);
        document.documentElement.style.setProperty('--color-primary-dull', secondaryColor);
      })
      .catch(() => {
        if (!active) return;
        document.documentElement.style.setProperty('--color-primary', '#2563eb');
        document.documentElement.style.setProperty('--color-primary-dull', '#1f58d8');
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <>
      <MessageCenter />
      {showLogin && <Login setShowLogin={setShowLogin} />}
      {!isOwnerPath && <Navbar setShowLogin={setShowLogin} />}

      <AnimatePresence mode="wait">
        <AnimatedPage
          key={rootTransitionKey}
          variants={rootTransitionVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={rootTransitionProps}
        >
          <Suspense fallback={<RouteLoader />}>
            <Routes location={location}>
              <Route path="/" element={<Home />} />
              <Route path="/car-details/:id" element={<CarDetail />} />
              <Route path="/cars" element={<Cars />} />
              <Route path="/subscription-plans" element={<SubscriptionPlans />} />
              <Route
                path="/my-bookings"
                element={loggedIn && !staff ? <MyBookings /> : <Navigate to={userPageFallback} replace />}
              />
              <Route
                path="/my-subscription"
                element={loggedIn && !staff ? <MySubscription /> : <Navigate to={userPageFallback} replace />}
              />
              <Route
                path="/my-rental-status"
                element={loggedIn && !staff ? <MyRentalStatus /> : <Navigate to={userPageFallback} replace />}
              />
              <Route
                path="/my-profile"
                element={loggedIn && !staff ? <UserProfile /> : <Navigate to={userPageFallback} replace />}
              />
              <Route
                path="/complete-profile"
                element={loggedIn && !staff ? <CompleteProfile /> : <Navigate to={userPageFallback} replace />}
              />
              <Route path="/help-center" element={<StaticInfoPage />} />
              <Route path="/terms" element={<StaticInfoPage />} />
              <Route path="/privacy" element={<StaticInfoPage />} />
              <Route path="/insurance" element={<StaticInfoPage />} />
              <Route path="/cookies" element={<StaticInfoPage />} />

              <Route path="/owner" element={staff ? <Layout /> : <Navigate to="/" replace />}>
                <Route
                  index
                  element={
                    canViewPlatform
                      ? <Navigate to="/owner/platform-overview" replace />
                      : can(PERMISSIONS.VIEW_ANALYTICS) || canViewBookings
                        ? <Dashboard />
                        : <Navigate to="/owner/profile" replace />
                  }
                />
                <Route
                  path="add-car"
                  element={can(PERMISSIONS.MANAGE_FLEET) ? <AddCar /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="manage-cars"
                  element={can(PERMISSIONS.MANAGE_FLEET) ? <ManageCars /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="manage-bookings"
                  element={canManageBookings ? <ManageBooking /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="offers"
                  element={can(PERMISSIONS.MANAGE_OFFERS) ? <ManageOffers /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="reviews"
                  element={can(PERMISSIONS.MANAGE_REVIEWS) ? <ManageReviews /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="bookings"
                  element={canManageBookings ? <AdminBookings /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="rental-tracking"
                  element={canViewBookings ? <RentalTracking /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="fleet-overview"
                  element={canViewFleetOverview ? <FleetOverview /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="analytics"
                  element={can(PERMISSIONS.VIEW_ANALYTICS) ? <AnalyticsDashboard /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="platform-overview"
                  element={canViewPlatform ? <PlatformOverview /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="drivers"
                  element={canManageDrivers ? <ManageDrivers /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="users"
                  element={can(PERMISSIONS.MANAGE_USERS) ? <ManageUsers /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="manage-roles"
                  element={can(PERMISSIONS.MANAGE_ROLES) ? <ManageRoles /> : <Navigate to="/owner/profile" replace />}
                />
                <Route
                  path="branches"
                  element={can(PERMISSIONS.MANAGE_ROLES) ? <ManageBranches /> : <Navigate to="/owner/profile" replace />}
                />
                <Route path="profile" element={<AdminProfile />} />
              </Route>

              <Route
                path="/admin/rental-tracking"
                element={staff ? <Navigate to="/owner/rental-tracking" replace /> : <Navigate to="/" replace />}
              />
              <Route
                path="/admin/fleet-overview"
                element={staff ? <Navigate to="/owner/fleet-overview" replace /> : <Navigate to="/" replace />}
              />
              <Route
                path="/admin/analytics"
                element={staff ? <Navigate to="/owner/analytics" replace /> : <Navigate to="/" replace />}
              />
              <Route
                path="/admin/drivers"
                element={staff ? <Navigate to="/owner/drivers" replace /> : <Navigate to="/" replace />}
              />
              <Route
                path="/admin/manage-roles"
                element={staff ? <Navigate to="/owner/manage-roles" replace /> : <Navigate to="/" replace />}
              />
              <Route
                path="/admin/branches"
                element={staff ? <Navigate to="/owner/branches" replace /> : <Navigate to="/" replace />}
              />
              <Route
                path="/platform/overview"
                element={
                  staff
                    ? canViewPlatform
                      ? <Navigate to="/owner/platform-overview" replace />
                      : <Navigate to="/owner" replace />
                    : <Navigate to="/" replace />
                }
              />
            </Routes>
          </Suspense>
        </AnimatedPage>
      </AnimatePresence>

      {!isOwnerPath && <Footer />}
    </>
  );
};

export default App;
