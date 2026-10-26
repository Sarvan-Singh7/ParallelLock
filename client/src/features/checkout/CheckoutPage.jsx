/**
 * CheckoutPage.jsx – Milestone 7 Hold Countdown, Payment, and Ticket Confirmation
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../../lib/apiClient';
import { TicketCard } from './TicketCard';
import { ErrorBanner } from '../../components/ErrorBanner';
import { formatShowDate, formatShowTime } from '../../lib/format';
import styles from './CheckoutPage.module.css';

export function CheckoutPage() {
  const { bookingId } = useParams();
  const navigate = useNavigate();

  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isPaying, setIsPaying] = useState(false);
  const [selectedMethod, setSelectedMethod] = useState('MOCK');
  const [remainingSeconds, setRemainingSeconds] = useState(null);

  // Fetch booking details
  const fetchBooking = async () => {
    try {
      setLoading(true);
      const data = await api.get(`/bookings/${bookingId}`);
      setBooking(data.booking);

      if (data.booking?.status === 'HELD' && data.booking?.holdExpiresAt) {
        const diffMs = new Date(data.booking.holdExpiresAt).getTime() - Date.now();
        setRemainingSeconds(Math.max(0, Math.floor(diffMs / 1000)));
      }
    } catch (err) {
      setError(err.message || 'Could not load booking.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBooking();
  }, [bookingId]);

  // Countdown timer effect
  useEffect(() => {
    if (remainingSeconds === null || booking?.status !== 'HELD') return;

    if (remainingSeconds <= 0) {
      setBooking((prev) => (prev ? { ...prev, status: 'EXPIRED' } : prev));
      return;
    }

    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setBooking((b) => (b ? { ...b, status: 'EXPIRED' } : b));
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [remainingSeconds, booking?.status]);

  // Handle Pay CTA
  const handlePayment = async () => {
    setIsPaying(true);
    setError(null);
    try {
      const res = await api.post(`/bookings/${bookingId}/pay`, {
        method: 'MOCK',
        idempotencyKey: `pay-${bookingId}-${Date.now()}`,
      });

      // Update booking with confirmed status and ticket data
      setBooking(res.booking);
    } catch (err) {
      setError(err.message || 'Payment processing failed. Please try again.');
      // Refresh booking in case it expired while paying
      fetchBooking();
    } finally {
      setIsPaying(false);
    }
  };

  // Handle Release Hold
  const handleRelease = async () => {
    try {
      await api.delete(`/bookings/${bookingId}`);
      navigate('/');
    } catch (err) {
      setError(err.message || 'Could not release hold.');
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingWrapper}>
        <div className={styles.spinner} />
        <p>Loading your booking summary...</p>
      </div>
    );
  }

  // If already confirmed, render the verified ticket card
  if (booking?.status === 'CONFIRMED') {
    return <TicketCard booking={booking} />;
  }

  // If expired
  if (booking?.status === 'EXPIRED') {
    return (
      <div className={styles.expiredWrapper}>
        <div className={styles.expiredCard}>
          <span className={styles.expiredIcon}>◷</span>
          <h2 className={styles.expiredTitle}>Hold expired</h2>
          <p className={styles.expiredText}>
            Your 8-minute seat reservation has ended and the seats have been released back to
            other moviegoers.
          </p>
          <Link to="/" className={styles.rebookBtn}>
            Return to movies & select seats →
          </Link>
        </div>
      </div>
    );
  }

  // Format countdown minutes and seconds: MM:SS
  const mins = Math.floor((remainingSeconds || 0) / 60);
  const secs = (remainingSeconds || 0) % 60;
  const timeFormatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const seatNames = booking?.seats?.map((s) => `${s.row}${s.number}`).join(' & ');
  const totalInRupees = (booking?.totalPaise / 100).toFixed(2);

  return (
    <div className={styles.checkoutWrapper}>
      {/* Stepper matching Figma Page 6 */}
      <div className={styles.stepper}>
        <div className={`${styles.step} ${styles.stepDone}`}>
          <span className={styles.stepNum}>✓</span>
          <span className={styles.stepText}>Show</span>
        </div>
        <div className={styles.stepDivider} />
        <div className={`${styles.step} ${styles.stepDone}`}>
          <span className={styles.stepNum}>✓</span>
          <span className={styles.stepText}>Seats</span>
        </div>
        <div className={styles.stepDivider} />
        <div className={`${styles.step} ${styles.stepActive}`}>
          <span className={styles.stepNum}>3</span>
          <span className={styles.stepText}>Payment</span>
        </div>
        <div className={styles.stepDivider} />
        <div className={styles.step}>
          <span className={styles.stepNum}>4</span>
          <span className={styles.stepText}>Ticket</span>
        </div>
      </div>

      <div className={styles.pageHeader}>
        <span className={styles.eyebrow}>YOUR SEATS ARE HELD</span>
        <h1 className={styles.mainTitle}>Make it official.</h1>
        <p className={styles.subtitle}>
          Complete the demo payment before your hold ends.
        </p>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className={styles.layoutGrid}>
        {/* Left Column: Countdown & Payment Methods */}
        <div className={styles.mainColumn}>
          {/* Countdown Timer Card */}
          <div className={styles.timerCard}>
            <div className={styles.timerHeader}>
              <span className={styles.timerNumber}>{timeFormatted}</span>
              <span className={styles.timerBadge}>REMAINING</span>
            </div>
            <p className={styles.timerInfo}>
              <strong>{seatNames}</strong> are held by you
            </p>
            <p className={styles.timerSub}>8-minute hold · Row-level locked in DB</p>
          </div>

          {/* Payment Methods */}
          <div className={styles.paymentSection}>
            <h3 className={styles.sectionTitle}>Choose a payment method</h3>

            <div className={styles.methodList}>
              {/* UPI Option */}
              <div className={`${styles.methodOption} ${styles.methodDisabled}`}>
                <div className={styles.methodHeader}>
                  <span className={styles.methodName}>UPI</span>
                  <span className={styles.plannedBadge}>PLANNED</span>
                </div>
                <p className={styles.methodDesc}>Google Pay, PhonePe, Paytm</p>
              </div>

              {/* Card Option */}
              <div className={`${styles.methodOption} ${styles.methodDisabled}`}>
                <div className={styles.methodHeader}>
                  <span className={styles.methodName}>Credit / Debit Card</span>
                  <span className={styles.plannedBadge}>PLANNED</span>
                </div>
                <p className={styles.methodDesc}>Visa, Mastercard, RuPay</p>
              </div>

              {/* Mock Payment Option */}
              <div
                className={`${styles.methodOption} ${styles.methodActive}`}
                onClick={() => setSelectedMethod('MOCK')}
              >
                <div className={styles.methodHeader}>
                  <span className={styles.methodName}>Mock Payment Gateway</span>
                  <span className={styles.demoBadge}>DEMO ONLY</span>
                </div>
                <p className={styles.methodDesc}>
                  Instant simulated payment with database lock transition.
                </p>
              </div>
            </div>

            <div className={styles.disclaimerBox}>
              <p>
                <strong>A movie night. A mock payment.</strong>
                <br />
                This is a payment demo. No money will be charged and no financial details are
                required.
              </p>
            </div>

            <button
              type="button"
              className={styles.payBtn}
              onClick={handlePayment}
              disabled={isPaying || remainingSeconds <= 0}
            >
              {isPaying ? 'Confirming booking...' : `Pay ₹${totalInRupees} · Demo`}
            </button>

            <button
              type="button"
              className={styles.releaseBtn}
              onClick={handleRelease}
              disabled={isPaying}
            >
              Cancel and release hold
            </button>
          </div>
        </div>

        {/* Right Column: Order Summary Sidebar */}
        <div className={styles.sidebarColumn}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryEyebrow}>YOUR MOVIE NIGHT</span>
            <h2 className={styles.summaryMovieTitle}>{booking?.movieTitle}</h2>
            <p className={styles.summaryMovieMeta}>
              {booking?.movieCertificate} · {booking?.movieLanguages?.join(', ')} · {booking?.format}
            </p>

            <div className={styles.divider} />

            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>CINEMA & SCREEN</span>
              <span className={styles.summaryVal}>
                {booking?.theaterName} · Screen {booking?.screenNumber}
              </span>
              <span className={styles.summarySub}>{booking?.theaterCity}</span>
            </div>

            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>SHOWTIME</span>
              <span className={styles.summaryVal}>{formatShowDate(booking?.startsAt)}</span>
              <span className={styles.summarySub}>{formatShowTime(booking?.startsAt)} IST</span>
            </div>

            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>SEATS ({booking?.seats?.length})</span>
              <div className={styles.seatsBadgeList}>
                {booking?.seats?.map((s) => (
                  <span key={s.id} className={styles.seatBadgeItem}>
                    {s.row}{s.number} · Held by you
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.divider} />

            <div className={styles.totalRow}>
              <span>Total Payable</span>
              <span className={styles.grandTotal}>₹{totalInRupees}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
