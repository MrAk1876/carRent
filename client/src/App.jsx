import React, { useState } from 'react';
import Navbar from './components/Navbar';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import Home from './pages/Home';
import CarDetail from './pages/CarDetail';
import Cars from './pages/Cars';
import MyBookings from './pages/MyBookings';
import MyRentalStatus from './pages/MyRentalStatus';
import Footer from './components/Footer';
import Layout from './features/admin/pages/Layout';
import Dashboard from './features/admin/pages/Dashboard';
import AddCar from './features/admin/pages/AddCar';
import ManageCars from './features/admin/pages/ManageCars';
import ManageBooking from './features/admin/pages/ManageBooking';
import Login from './components/Login';
import AdminBookings from './features/admin/pages/AdminBookings';
import ManageUsers from './features/admin/pages/ManageUsers';
import UserProfile from './pages/UserProfile';
import AdminProfile from './features/admin/pages/AdminProfile';
import CompleteProfile from './pages/CompleteProfile';
import ManageOffers from './features/admin/pages/ManageOffers';
import ManageReviews from './features/admin/pages/ManageReviews';
import RentalTracking from './features/admin/pages/RentalTracking';
import StaticInfoPage from './pages/StaticInfoPage';
import { isLoggedIn, isAdmin } from './utils/auth';
import { Navigate } from 'react-router-dom';
import MessageCenter from './components/ui/MessageCenter';

const routeTransition = {
  initial: { opacity: 0, y: 14, scale: 0.995 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -10, scale: 0.995 },
};
const AnimatedPage = motion.div;

const App = () => {
  const [showLogin, setShowLogin] = useState(false);
  const location = useLocation();
  const isOwnerPath = location.pathname.startsWith('/owner') || location.pathname.startsWith('/admin');
  const loggedIn = isLoggedIn();
  const admin = isAdmin();

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
            <Route
              path="/my-bookings"
              element={loggedIn && !admin ? <MyBookings /> : <Navigate to="/" replace />}
            />
            <Route
              path="/my-rental-status"
              element={loggedIn && !admin ? <MyRentalStatus /> : <Navigate to="/" replace />}
            />
            <Route
              path="/my-profile"
              element={loggedIn && !admin ? <UserProfile /> : <Navigate to="/" replace />}
            />
            <Route
              path="/complete-profile"
              element={loggedIn && !admin ? <CompleteProfile /> : <Navigate to="/" replace />}
            />
            <Route path="/help-center" element={<StaticInfoPage />} />
            <Route path="/terms" element={<StaticInfoPage />} />
            <Route path="/privacy" element={<StaticInfoPage />} />
            <Route path="/insurance" element={<StaticInfoPage />} />
            <Route path="/cookies" element={<StaticInfoPage />} />

            <Route path="/owner" element={admin ? <Layout /> : <Navigate to="/" replace />}>
              <Route index element={<Dashboard />} />
              <Route path="add-car" element={<AddCar />} />
              <Route path="manage-cars" element={<ManageCars />} />
              <Route path="manage-bookings" element={<ManageBooking />} />
              <Route path="offers" element={<ManageOffers />} />
              <Route path="reviews" element={<ManageReviews />} />
              <Route path="bookings" element={<AdminBookings />} />
              <Route path="rental-tracking" element={<RentalTracking />} />
              <Route path="users" element={<ManageUsers />} />
              <Route path="profile" element={<AdminProfile />} />
            </Route>

            <Route
              path="/admin/rental-tracking"
              element={admin ? <Navigate to="/owner/rental-tracking" replace /> : <Navigate to="/" replace />}
            />
          </Routes>
        </AnimatedPage>
      </AnimatePresence>

      {!isOwnerPath && <Footer />}
    </>
  );
};

export default App;
