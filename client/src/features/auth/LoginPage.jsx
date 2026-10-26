/**
 * LoginPage.jsx – User login form matching Figma Page 9
 */
import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/apiClient';
import styles from './AuthForm.module.css';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const redirectPath = location.state?.from?.pathname || '/';

  const isEmailValid = /\S+@\S+\.\S+/.test(email.trim());

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both your email address and password.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/login', {
        email: email.trim().toLowerCase(),
        password,
      });
      login(res.token, res.user);
      navigate(redirectPath, { replace: true });
    } catch (err) {
      setErrorMessage(
        err.message || 'Your email or password does not match. Check your details and try again.'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.splitWrapper}>
      {/* Left Column: Visual Storytelling */}
      <div className={styles.artColumn}>
        <div className={styles.artOverlay}>
          <div className={styles.artContent}>
            <span className={styles.artBadge}>PARALLELLOCK CINEMA</span>
            <h2 className={styles.artTitle}>Your next story starts here.</h2>
            <p className={styles.artTagline}>
              Save your tickets. Return to your favourite seats.
            </p>
          </div>
        </div>
      </div>

      {/* Right Column: Form Card */}
      <div className={styles.formColumn}>
        <div className={styles.cardHeader}>
          <h1 className={styles.formTitle}>Welcome back.</h1>
          <p className={styles.formSubtitle}>Log in to hold seats and book tickets.</p>
        </div>

        {errorMessage && (
          <div className={styles.alertBox} role="alert">
            <span className={styles.alertIcon}>!</span>
            <div className={styles.alertText}>
              <strong>We couldn't log you in</strong>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.fieldGroup}>
            <label htmlFor="login-email" className={styles.label}>
              Email address
            </label>
            <input
              id="login-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              placeholder="aanya@example.com"
              autoComplete="email"
              required
            />
            {email.length > 0 && isEmailValid && (
              <span className={styles.fieldSuccess}>✓ Email format looks good</span>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="login-password" className={styles.label}>
              Password
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.input}
                placeholder="Enter your password"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={styles.togglePassBtn}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading ? 'Logging in...' : 'Log in'}
          </button>
        </form>

        <div className={styles.footerGroup}>
          <p className={styles.switchAuthText}>
            New to ParallelLock?{' '}
            <Link to="/register" className={styles.authLink}>
              Create an account →
            </Link>
          </p>
          <p className={styles.disclaimerText}>
            You can browse films and seat maps without logging in.
          </p>
        </div>
      </div>
    </div>
  );
}
