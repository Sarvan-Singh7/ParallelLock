/**
 * Header.jsx – Navigation header matching Figma design
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import styles from './Header.module.css';

export function Header({ searchQuery, onSearchChange }) {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [showLocationDropdown, setShowLocationDropdown] = useState(false);
  const [selectedCity, setSelectedCity] = useState('Chandigarh');

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Get user initials for avatar
  const getInitials = (name) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((part) => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className={styles.header}>
      <div className={styles.container}>
        {/* Brand Logo & Location */}
        <div className={styles.leftGroup}>
          <Link to="/" className={styles.logo}>
            <span className={styles.brandPrimary}>ParallelLock</span>
            <span className={styles.brandAccent}>|</span>
          </Link>

          <div className={styles.locationWrapper}>
            <button
              type="button"
              className={styles.locationBtn}
              onClick={() => setShowLocationDropdown(!showLocationDropdown)}
              aria-label="Select location"
            >
              <span className={styles.pinIcon}>📍</span>
              <span className={styles.cityName}>{selectedCity}</span>
              <span className={styles.chevron}>▾</span>
            </button>

            {showLocationDropdown && (
              <div className={styles.dropdown}>
                {['Chandigarh', 'Mohali', 'Panchkula'].map((city) => (
                  <button
                    key={city}
                    type="button"
                    className={`${styles.dropdownItem} ${city === selectedCity ? styles.dropdownActive : ''}`}
                    onClick={() => {
                      setSelectedCity(city);
                      setShowLocationDropdown(false);
                    }}
                  >
                    {city}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className={styles.searchContainer}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search movies, cinemas…"
            value={searchQuery || ''}
            onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
            aria-label="Search movies and cinemas"
          />
        </div>

        {/* Right Navigation */}
        <nav className={styles.nav}>
          <Link to="/my-bookings" className={styles.navLink}>
            My bookings
          </Link>

          {isAuthenticated ? (
            <div className={styles.userSection}>
              <div className={styles.avatarPill} title={user?.name}>
                <span className={styles.avatarCircle}>{getInitials(user?.name)}</span>
                <span className={styles.userName}>{user?.name?.split(' ')[0]}</span>
              </div>
              <button
                type="button"
                onClick={handleLogout}
                className={styles.logoutBtn}
                aria-label="Log out"
              >
                Log out
              </button>
            </div>
          ) : (
            <Link to="/login" className={styles.loginBtn}>
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
