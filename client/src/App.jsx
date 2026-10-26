import { useState } from 'react';
import { Routes, Route, Outlet } from 'react-router-dom';
import { Header } from './components/Header';
import { ProtectedRoute } from './components/ProtectedRoute';
import { HomePage } from './features/home/HomePage';
import { LoginPage } from './features/auth/LoginPage';
import { RegisterPage } from './features/auth/RegisterPage';
import { SeatPage } from './features/seats/SeatPage';
import { CheckoutPage } from './features/checkout/CheckoutPage';
import { MyBookingsPage } from './features/bookings/MyBookingsPage';
import { NotFoundPage } from './features/NotFoundPage';

function Layout() {
  const [searchQuery, setSearchQuery] = useState('');

  
  return (
    <div className="app-layout">
      <Header searchQuery={searchQuery} onSearchChange={setSearchQuery} />
      <main className="main-content">
        <Outlet context={{ searchQuery }} />
      </main>
      <footer className="app-footer">
        ParallelLock · A little closer to the big screen. Product concept · Fictional films · Demo bookings
      </footer>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />
        <Route path="shows/:showId/seats" element={<SeatPage />} />

        {/* Protected routes */}
        <Route
          path="checkout/:bookingId"
          element={
            <ProtectedRoute>
              <CheckoutPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="my-bookings"
          element={
            <ProtectedRoute>
              <MyBookingsPage />
            </ProtectedRoute>
          }
        />

        {/* 404 catch-all */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
