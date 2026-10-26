/**
 * StickyBar.jsx – Bottom summary bar for seat selection matching Figma Page 5
 */
import styles from './StickyBar.module.css';

export function StickyBar({ selectedSeats, maxSeats, onHold, isSubmitting }) {
  const selectedCount = selectedSeats.length;
  const totalPricePaise = selectedSeats.reduce((acc, s) => acc + (s.pricePaise || 0), 0);
  const seatNames = selectedSeats.map((s) => `${s.row}${s.number}`).join(', ');

  const isReady = selectedCount > 0;

  return (
    <div className={styles.stickyBar}>
      <div className={styles.container}>
        <div className={styles.infoGroup}>
          <div className={styles.statusLine}>
            <span className={styles.counter}>
              {selectedCount} of {maxSeats} seats selected
            </span>
            <span className={styles.dot}>·</span>
            <span className={styles.badgeNotHeld}>Not held yet</span>
          </div>

          <p className={styles.subtext}>
            {isReady
              ? `Proceed to check availability and hold ${selectedCount === 1 ? 'this seat' : 'both seats'} for payment.`
              : `Tap available seats above to select up to ${maxSeats} tickets.`}
          </p>

          {isReady && (
            <div className={styles.selectionDetails}>
              <span className={styles.seatPills}>{seatNames}</span>
              <span className={styles.dot}>·</span>
              <span className={styles.priceTag}>
                ₹{(totalPricePaise / 100).toFixed(2)}
              </span>
            </div>
          )}
        </div>

        <button
          type="button"
          className={styles.holdBtn}
          onClick={onHold}
          disabled={!isReady || isSubmitting}
        >
          {isSubmitting ? 'Securing seats...' : 'Hold seats & continue →'}
        </button>
      </div>
    </div>
  );
}
