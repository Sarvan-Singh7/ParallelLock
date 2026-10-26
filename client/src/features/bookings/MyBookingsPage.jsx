/**
 * MyBookingsPage.jsx – Milestone 7 User bookings list matching Figma Page 8
 */
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/apiClient';
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
        setBookings(data.bookings || []);
      } catch (err) {
        setError(err.message || 'Could not load your bookings.');
      } finally {
        setLoading(false);
      }
    };

    fetchBookings();
  }, []);

  const confirmedBookings = bookings.filter((b) => b.status === 'CONFIRMED');
  const pastOrAttemptBookings = bookings.filter((b) => b.status !== 'CONFIRMED');

  const displayedConfirmed =
    activeTab === 'UPCOMING'
      ? confirmedBookings.filter((b) => new Date(b.startsAt) >= new Date())
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

      {/* Confirmed Tickets List */}
      {!loading && displayedConfirmed.length > 0 ? (
        <div className={styles.ticketsList}>
          {displayedConfirmed.map((b) => {
            const refCode = `PL-26-${String(b.id).padStart(5, '0')}`;
            const seatNames = b.seats?.map((s) => `${s.row}${s.number}`).join(', ');
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
              const refCode = `PL-26-${String(b.id).padStart(5, '0')}`;
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
