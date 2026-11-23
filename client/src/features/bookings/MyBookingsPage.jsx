/**
 * MyBookingsPage.jsx – Milestone 7 User bookings list matching Figma Page 8
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/apiClient';
import { adaptBooking } from '../../lib/adapters';
import { formatShowDate, formatShowTime } from '../../lib/format';
import { ErrorBanner } from '../../components/ErrorBanner';
import styles from './MyBookingsPage.module.css';

export function MyBookingsPage() {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('UPCOMING');

  useEffect(() => {
    const fetchBookings = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await api.get('/me/bookings');
        const adapted = (data.bookings || []).map((b) => adaptBooking(b));
        setBookings(adapted);
      } catch (err) {
        setError(err.message || 'Could not load your bookings.');
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, []);

  const now = new Date();
  const activeHolds = bookings.filter(
    (b) =>
      (b.displayStatus === 'ACTIVE_HOLD' || b.displayStatus === 'PROCESSING_PAYMENT') &&
      b.holdExpiresAt &&
      new Date(b.holdExpiresAt) > now
  );
  const confirmedBookings = bookings.filter((b) => b.status === 'CONFIRMED');
  const pastOrAttemptBookings = bookings.filter(
    (b) =>
      b.status === 'EXPIRED' ||
      b.status === 'CANCELLED' ||
      b.status === 'REFUND_PENDING' ||
      b.status === 'REFUNDED' ||
      (b.status === 'CREATED' && (!b.holdExpiresAt || new Date(b.holdExpiresAt) <= now))
  );

  const displayedConfirmed =
    activeTab === 'UPCOMING'
      ? confirmedBookings.filter((b) => new Date(b.startsAt) >= now)
      : confirmedBookings;

  return (
    <div className={styles.container}>
      {/* Page Header matching Figma Page 8 */}
      <div className={styles.header}>
        <span className={styles.eyebrow}>YOUR ACCOUNT</span>
        <h1 className={styles.title}>My bookings</h1>
        <p className={styles.subtitle}>
          Your next big-screen escape, and the bookings behind it.
        </p>
      </div>

      <ErrorBanner error={error} />

      {/* Tabs */}
      <div className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'UPCOMING' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('UPCOMING')}
        >
          Upcoming ({confirmedBookings.length})
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${activeTab === 'ALL' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('ALL')}
        >
          All ({bookings.length})
        </button>
      </div>

      {loading && (
        <div className={styles.loadingWrapper}>
          <div className={styles.spinner} />
          <p>Loading your booking history...</p>
        </div>
      )}

      {/* Active Holds Section */}
      {!loading && activeHolds.length > 0 && (
        <section style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
            <span style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--color-primary, #4338ca)' }}>
              Active Holds ({activeHolds.length})
            </span>
            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              Seats held temporarily — complete payment before expiry
            </span>
          </div>
          <div className={styles.ticketsList}>
            {activeHolds.map((b) => (
              <div key={b.id} className={styles.bookingCard} style={{ borderLeft: '4px solid #f59e0b' }}>
                <div className={styles.cardHeader}>
                  <span className={styles.refCode}>{b.ref} · {b.displayStatus === 'PROCESSING_PAYMENT' ? 'Payment in flight' : 'Hold'}</span>
                  {b.displayStatus === 'PROCESSING_PAYMENT' ? (
                    <span style={{ color: '#2563eb', fontWeight: 600, fontSize: '0.875rem' }}>💳 Processing payment...</span>
                  ) : (
                    <span style={{ color: '#d97706', fontWeight: 600, fontSize: '0.875rem' }}>⏱ In progress</span>
                  )}
                </div>
                <div className={styles.cardBody}>
                  <div className={styles.movieSection}>
                    <h2 className={styles.movieTitle}>{b.movieTitle}</h2>
                    <p className={styles.movieMeta}>
                      {b.movieLanguages?.join(', ') || 'Hindi'} · {b.format} · {b.theaterName} (Screen {b.screenNumber})
                    </p>
                  </div>
                  <div className={styles.footerRow}>
                    <span className={styles.seatsInfo}>
                      {b.seats?.map((s) => s.label).join(', ')} · ₹{(b.totalPaise / 100).toFixed(2)}
                    </span>
                    <Link to={`/checkout/${b.id}`} className={styles.viewTicketBtn}>
                      {b.displayStatus === 'PROCESSING_PAYMENT' ? 'View status →' : 'Complete checkout →'}
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Confirmed Tickets List */}
      {!loading && displayedConfirmed.length > 0 ? (
        <div className={styles.ticketsList}>
          {displayedConfirmed.map((b) => {
            const refCode = b.ref;
            const seatNames = b.seats?.map((s) => s.label || `${s.row}${s.number}`).join(', ');
            const tier = b.seats?.[0]?.tier || 'Gold';

            return (
              <div key={b.id} className={styles.bookingCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.refCode}>{refCode} · Demo</span>
                  <span className={styles.confirmedBadge}>✓ Confirmed</span>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.movieSection}>
                    <h2 className={styles.movieTitle}>{b.movieTitle}</h2>
                    <p className={styles.movieMeta}>
                      {b.movieLanguages?.join(', ') || 'Hindi'} · {b.format} · {b.movieCertificate}
                    </p>
                  </div>

                  <div className={styles.timeSection}>
                    <p className={styles.dateTime}>
                      {formatShowDate(b.startsAt)} · {formatShowTime(b.startsAt)} IST
                    </p>
                    <p className={styles.venue}>
                      {b.theaterName} · Screen {b.screenNumber}
                    </p>
                  </div>

                  <div className={styles.footerRow}>
                    <span className={styles.seatsInfo}>
                      {tier} · {seatNames} · ₹{(b.totalPaise / 100).toFixed(2)}
                    </span>
                    <Link to={`/checkout/${b.id}`} className={styles.viewTicketBtn}>
                      View ticket →
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        !loading && (
          <div className={styles.emptyState}>
            <p>No confirmed upcoming tickets.</p>
            <Link to="/" className={styles.browseBtn}>
              Browse now showing movies →
            </Link>
          </div>
        )
      )}

      {/* Earlier Booking Attempts Section matching Figma Page 8 */}
      {!loading && pastOrAttemptBookings.length > 0 && (
        <section className={styles.attemptsSection}>
          <div className={styles.attemptsHeader}>
            <h3 className={styles.attemptsTitle}>Earlier booking attempts</h3>
            <p className={styles.attemptsDesc}>
              These attempts are not tickets. No demo payment was completed.
            </p>
          </div>

          <div className={styles.attemptsList}>
            {pastOrAttemptBookings.map((b) => {
              const refCode = b.ref;
              const isExpired = b.status === 'EXPIRED';

              return (
                <div key={b.id} className={styles.attemptCard}>
                  <div className={styles.attemptTop}>
                    <span className={styles.attemptFilm}>
                      {b.movieTitle} · {formatShowDate(b.startsAt)} · {formatShowTime(b.startsAt)}
                    </span>
                    <div className={styles.badgeGroup}>
                      <span className={styles.notPaidBadge}>Not paid</span>
                      {isExpired ? (
                        <span className={styles.expiredBadge}>◷ Expired</span>
                      ) : (
                        <span className={styles.releasedBadge}>× Released</span>
                      )}
                    </div>
                  </div>

                  <p className={styles.attemptSub}>
                    {refCode} · {b.theaterName} · Screen {b.screenNumber}
                  </p>
                  <p className={styles.attemptExplanation}>
                    {isExpired
                      ? 'The hold ended before payment.'
                      : 'You released the hold before payment.'}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
