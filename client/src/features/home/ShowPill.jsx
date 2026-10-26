/**
 * ShowPill.jsx – Interactive showtime pill with availability status and icons
 */
import { useNavigate } from 'react-router-dom';
import { formatShowTime } from '../../lib/format';
import styles from './ShowPill.module.css';

const AVAILABILITY_CONFIG = {
  PLENTY: {
    label: 'Available',
    icon: '●',
    className: styles.plenty,
  },
  FILLING_FAST: {
    label: 'Filling fast',
    icon: '!',
    className: styles.fillingFast,
  },
  ALMOST_FULL: {
    label: 'Almost full',
    icon: '!',
    className: styles.almostFull,
  },
  SOLD_OUT: {
    label: 'Sold out',
    icon: '✕',
    className: styles.soldOut,
  },
};

export function ShowPill({ show, onSelect }) {
  const navigate = useNavigate();
  const isSoldOut = show.availability === 'SOLD_OUT';
  const config = AVAILABILITY_CONFIG[show.availability] || AVAILABILITY_CONFIG.PLENTY;

  const handleClick = () => {
    if (!isSoldOut) {
      if (onSelect) {
        onSelect(show);
      } else {
        navigate(`/shows/${show.id}/seats`);
      }
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isSoldOut}
      className={`${styles.pill} ${config.className} ${isSoldOut ? styles.disabled : ''}`}
      aria-label={`${formatShowTime(show.startsAt)}, ${show.format}, ${config.label}`}
    >
      <div className={styles.topRow}>
        <span className={styles.time}>{formatShowTime(show.startsAt)}</span>
        <span className={styles.format}>{show.format}</span>
      </div>
      <div className={styles.bottomRow}>
        <span className={styles.icon} aria-hidden="true">{config.icon}</span>
        <span className={styles.statusText}>{config.label}</span>
      </div>
    </button>
  );
}
