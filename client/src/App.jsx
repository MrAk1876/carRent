import React, { useEffect, useState } from 'react';
import Navbar from './components/Navbar';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Home from './pages/Home';
import CarDetail from './pages/CarDetail';
import Cars from './pages/Cars';
import MyBookings from './pages/MyBookings';
import MyRentalStatus from './pages/MyRentalStatus';
import SubscriptionPlans from './pages/SubscriptionPlans';
import MySubscription from './pages/MySubscription';
import Footer from './components/Footer';
import Layout from './features/admin/pages/Layout';
import Dashboard from './features/admin/pages/Dashboard';
import AddCar from './features/admin/pages/AddCar';
import ManageCars from './features/admin/pages/ManageCars';
import ManageBooking from './features/admin/pages/ManageBooking';
import Login from './components/Login';
import AdminBookings from './features/admin/pages/AdminBookings';
import ManageUsers from './features/admin/pages/ManageUsers';
import ManageRoles from './features/admin/pages/ManageRoles';
import ManageBranches from './features/admin/pages/ManageBranches';
import UserProfile from './pages/UserProfile';
import AdminProfile from './features/admin/pages/AdminProfile';
import CompleteProfile from './pages/CompleteProfile';
import ManageOffers from './features/admin/pages/ManageOffers';
import ManageReviews from './features/admin/pages/ManageReviews';
import RentalTracking from './features/admin/pages/RentalTracking';
import FleetOverview from './features/admin/pages/FleetOverview';
import ManageDrivers from './features/admin/pages/ManageDrivers';
import AnalyticsDashboard from './features/admin/pages/AnalyticsDashboard';
import PlatformOverview from './features/admin/pages/PlatformOverview';
import StaticInfoPage from './pages/StaticInfoPage';
import API from './api';
import { isLoggedIn, isAdmin, hasPermission, isPlatformSuperAdmin } from './utils/auth';
import { PERMISSIONS } from './utils/rbac';
import { Navigate } from 'react-router-dom';
import MessageCenter from './components/ui/MessageCenter';

const routeTransition = {
  initial: { opacity: 0, y: 14, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.995 },
};
const AnimatedPage = motion.div;

const HEX_COLOR_PATTERN = /^#([0-9A-F]{3}|[0-9A-F]{6})$/i;

const safeColor = (value, fallback) => {
  const candidate = String(value || '').trim();
  return HEX_COLOR_PATTERN.test(candidate) ? candidate : fallback;
};

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

  useEffect(() => {
    let active = true;
    API.get('/tenant/context', { showErrorToast: false })
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
          key={location.pathname}
          variants={routeTransition}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ duration: 0.35, ease: 'easeInOut' }}
        >
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
        </AnimatedPage>
      </AnimatePresence>

      {!isOwnerPath && <Footer />}
    </>
  );
};

export default App;
