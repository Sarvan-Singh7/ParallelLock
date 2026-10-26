/**
 * NotFoundPage.jsx – 404 Missing page
 */
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div
      style={{
        textAlign: 'center',
        padding: '80px 20px',
        maxWidth: '480px',
        margin: '0 auto',
      }}
    >
      <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🎬</div>
      <h1 style={{ fontSize: '2rem', fontWeight: 800, color: 'var(--color-indigo)', marginBottom: '8px' }}>
        404
      </h1>
      <p style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text)', marginBottom: '24px' }}>
        This scene is missing.
      </p>
      <Link
        to="/"
        style={{
          display: 'inline-block',
          backgroundColor: 'var(--color-indigo)',
          color: '#ffffff',
          fontWeight: 600,
          padding: '10px 24px',
          borderRadius: 'var(--radius)',
        }}
      >
        Return to Home
      </Link>
    </div>
  );
}
