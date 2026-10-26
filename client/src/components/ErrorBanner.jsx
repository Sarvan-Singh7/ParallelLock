/**
 * ErrorBanner.jsx – Displays user-facing error messages
 */
import styles from './ErrorBanner.module.css';

export function ErrorBanner({ error, type = 'error', onDismiss }) {
  if (!error) return null;

  const message = typeof error === 'string' ? error : (error.message || 'An error occurred.');
  const isWarning = type === 'warning';

  return (
    <div
      className={`${styles.banner} ${isWarning ? styles.warning : styles.error}`}
      role="alert"
    >
      <div className={styles.icon}>{isWarning ? '⚠️' : '❌'}</div>
      <div className={styles.message}>{message}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className={styles.closeBtn}
          aria-label="Dismiss error"
        >
          ×
        </button>
      )}
    </div>
  );
}
