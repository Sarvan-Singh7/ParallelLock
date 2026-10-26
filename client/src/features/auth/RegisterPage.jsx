/**
 * RegisterPage.jsx – User registration form matching Figma Page 10
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api } from '../../lib/apiClient';
import styles from './AuthForm.module.css';

export function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);
  const [loading, setLoading] = useState(false);

  const { login } = useAuth();
  const navigate = useNavigate();

  const isEmailValid = /\S+@\S+\.\S+/.test(email.trim());
  const isPasswordLongEnough = password.length >= 8;
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!name.trim()) {
      setErrorMessage('Please provide your full name.');
      return;
    }
    if (!isEmailValid) {
      setErrorMessage('Please enter a valid email address, like aanya@example.com.');
      return;
    }
    if (!isPasswordLongEnough) {
      setErrorMessage('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match. Please re-enter your password.');
      return;
    }

    setLoading(true);
    try {
      const res = await api.post('/auth/register', {
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password,
      });
      login(res.token, res.user);
      navigate('/', { replace: true });
    } catch (err) {
      setErrorMessage(err.message || 'Could not create account. Please check your details.');
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
            <h2 className={styles.artTitle}>Make room for movie nights.</h2>
            <p className={styles.artTagline}>
              One account for your bookings and tickets.
            </p>
          </div>
        </div>
      </div>

      {/* Right Column: Form Card */}
      <div className={styles.formColumn}>
        <div className={styles.cardHeader}>
          <h1 className={styles.formTitle}>Join ParallelLock.</h1>
          <p className={styles.formSubtitle}>Create your account to book your next show.</p>
        </div>

        {errorMessage && (
          <div className={styles.alertBox} role="alert">
            <span className={styles.alertIcon}>!</span>
            <div className={styles.alertText}>
              <strong>A couple of details need a second look</strong>
              <p>{errorMessage}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className={styles.form} noValidate>
          <div className={styles.fieldGroup}>
            <label htmlFor="reg-name" className={styles.label}>
              Full name
            </label>
            <input
              id="reg-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={styles.input}
              placeholder="Aanya Kapoor"
              autoComplete="name"
              required
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="reg-email" className={styles.label}>
              Email address
            </label>
            <input
              id="reg-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={styles.input}
              placeholder="aanya@example.com"
              autoComplete="email"
              required
            />
            {email.length > 0 && !isEmailValid && (
              <span className={styles.fieldError}>
                ! Enter a complete email, like aanya@example.com
              </span>
            )}
            {email.length > 0 && isEmailValid && (
              <span className={styles.fieldSuccess}>✓ Email format looks good</span>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="reg-password" className={styles.label}>
              Password
            </label>
            <div className={styles.inputWrapper}>
              <input
                id="reg-password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={styles.input}
                placeholder="At least 8 characters"
                autoComplete="new-password"
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
            {password.length > 0 && !isPasswordLongEnough && (
              <span className={styles.fieldError}>! Use at least 8 characters</span>
            )}
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="reg-confirm" className={styles.label}>
              Confirm password
            </label>
            <input
              id="reg-confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={styles.input}
              placeholder="Re-enter your chosen password"
              autoComplete="new-password"
              required
            />
            {confirmPassword.length > 0 && !passwordsMatch && (
              <span className={styles.fieldError}>! Passwords do not match</span>
            )}
          </div>

          <button type="submit" disabled={loading} className={styles.submitBtn}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <div className={styles.footerGroup}>
          <p className={styles.switchAuthText}>
            Already have an account?{' '}
            <Link to="/login" className={styles.authLink}>
              Log in →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
