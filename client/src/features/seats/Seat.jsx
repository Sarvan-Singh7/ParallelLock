/**
 * Seat.jsx – Individual interactive seat component
 */
import styles from './Seat.module.css';

export function Seat({ seat, isSelected, onToggle }) {
  const isAvailable = seat.status === 'AVAILABLE';
  const isBlocked = seat.status === 'BLOCKED';
  const isUnavailable = seat.status === 'UNAVAILABLE';
  const isMine = seat.status === 'MINE';

  const handleClick = () => {
    if (isAvailable || isMine) {
      onToggle(seat);
    }
  };

  let seatClass = styles.available;
  let seatContent = seat.number;

  if (isBlocked) {
    seatClass = styles.blocked;
    seatContent = '·';
  } else if (isUnavailable) {
    seatClass = styles.unavailable;
    seatContent = '×';
  } else if (isSelected) {
    seatClass = styles.selected;
    seatContent = '✓';
  }

  const ariaLabel = `Seat ${seat.row}${seat.number}, ${seat.tier} tier, ₹${(seat.pricePaise / 100).toFixed(2)}, ${
    isSelected ? 'Selected' : seat.status.toLowerCase()
  }`;

  return (
    <button
      type="button"
      className={`${styles.seat} ${seatClass}`}
      onClick={handleClick}
      disabled={isBlocked || isUnavailable}
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className={styles.label}>{seatContent}</span>
    </button>
  );
}
