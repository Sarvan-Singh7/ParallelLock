/**
 * TicketCard.jsx – Confirmed Ticket presentation matching Figma Page 7
 */
import { Link } from 'react-router-dom';
import { formatShowDate, formatShowTime } from '../../lib/format';
import styles from './TicketCard.module.css';

export function TicketCard({ booking }) {
  const {
    id,
    status,
    totalPaise,
    movieTitle,
    movieCertificate,
    movieLanguages,
    movieDurationMin,
    theaterName,
    theaterAddress,
    theaterCity,
    screenNumber,
    startsAt,
    format,
    seats = [],
  } = booking;

  const refCode = `PL-26-${String(id).padStart(5, '0')}`;
  const seatNames = seats.map((s) => `${s.row}${s.number}`).join(', ');
  const tier = seats[0]?.tier || 'GOLD';

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={styles.ticketWrapper}>
      {/* Stepper matching Figma Page 7 */}
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
        <div className={`${styles.step} ${styles.stepDone}`}>
          <span className={styles.stepNum}>✓</span>
          <span className={styles.stepText}>Payment</span>
        </div>
        <div className={styles.stepDivider} />
        <div className={`${styles.step} ${styles.stepActive}`}>
          <span className={styles.stepNum}>4</span>
          <span className={styles.stepText}>Ticket</span>
        </div>
      </div>

      <div className={styles.celebrationHeader}>
        <span className={styles.brandName}>ParallelLock</span>
        <h1 className={styles.celebrationTitle}>You're going to the movies.</h1>
        <p className={styles.celebrationSubtitle}>
          Your demo booking is confirmed. Let the countdown to showtime begin.
        </p>
      </div>

      {/* The Printable Ticket Card */}
      <div className={styles.ticketCard} id="printable-ticket">
        {/* Ticket Header */}
        <div className={styles.cardTop}>
          <div className={styles.refGroup}>
            <span className={styles.refLabel}>BOOKING REF</span>
            <span className={styles.refCode}>{refCode}</span>
          </div>
          <span className={styles.confirmedBadge}>✓ Confirmed · Demo</span>
        </div>

        {/* Film & Cinema Info */}
        <div className={styles.cardBody}>
          <h2 className={styles.movieTitle}>{movieTitle}</h2>
          <p className={styles.movieDetails}>
            {movieCertificate} · {movieLanguages?.join(', ') || 'Hindi'} · {format} · {movieDurationMin || 138}m
          </p>

          <div className={styles.venueInfo}>
            <p className={styles.theaterName}>{theaterName}</p>
            <p className={styles.theaterAddress}>
              {theaterAddress}, {theaterCity} · Screen {screenNumber}
            </p>
          </div>

          <div className={styles.specGrid}>
            <div className={styles.specItem}>
              <span className={styles.specLabel}>DATE & TIME</span>
              <span className={styles.specValue}>{formatShowDate(startsAt)}</span>
              <span className={styles.specTime}>{formatShowTime(startsAt)} IST</span>
            </div>

            <div className={styles.specItem}>
              <span className={styles.specLabel}>{tier} · {seats.length} SEATS</span>
              <span className={styles.specSeats}>{seatNames}</span>
            </div>
          </div>

          {/* QR Code Demo Placeholder */}
          <div className={styles.qrSection}>
            <div className={styles.qrCodeBox}>
              <div className={styles.qrGraphic} />
              <span className={styles.qrTag}>DEMO QR</span>
            </div>
            <div className={styles.qrText}>
              <strong>Non-scannable demo ticket</strong>
              <p>
                QR placeholder only. This fictional booking is not valid for cinema entry. No
                real payment was made.
              </p>
            </div>
          </div>

          {/* Total Price */}
          <div className={styles.totalRow}>
            <div className={styles.priceBreakdown}>
              <span className={styles.totalLabel}>DEMO TOTAL</span>
              <span className={styles.totalCalc}>
                {seats.length} × ₹{((totalPaise / seats.length) / 100).toFixed(2)}
              </span>
            </div>
            <span className={styles.totalAmount}>₹{(totalPaise / 100).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {/* Ticket Actions */}
      <div className={styles.actionsBar}>
        <button type="button" onClick={handlePrint} className={styles.printBtn}>
          🖨️ Print ticket
        </button>
        <Link to="/my-bookings" className={styles.bookingsBtn}>
          My bookings →
        </Link>
      </div>

      <p className={styles.footnote}>Find this ticket anytime in My bookings.</p>
    </div>
  );
}
