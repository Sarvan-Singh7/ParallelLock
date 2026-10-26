/**
 * SeatCountModal.jsx – Seat quantity selector matching Figma Page 4
 */
import { useState } from 'react';
import { formatShowTime, formatShowDate } from '../lib/format';
import styles from './SeatCountModal.module.css';

export function SeatCountModal({ isOpen, onClose, show, movie, onConfirm }) {
  const [selectedCount, setSelectedCount] = useState(2);

  if (!isOpen || !show) return null;

  const handleSelect = (count) => {
    setSelectedCount(count);
  };

  const handleProceed = () => {
    onConfirm(selectedCount);
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close modal"
        >
          ✕
        </button>

        <h3 className={styles.title}>How many seats?</h3>

        <div className={styles.showDetails}>
          <p className={styles.theaterLine}>
            {show.theaterName || 'Aster Cinema · Sector 17'} · Screen {show.screenNumber || 2}
          </p>
          <p className={styles.timeLine}>
            {formatShowDate(show.startsAt)} · {formatShowTime(show.startsAt)} · {show.format}
          </p>
        </div>

        {/* 1 - 6 seat selector */}
        <div className={styles.countGrid}>
          {[1, 2, 3, 4, 5, 6].map((count) => (
            <button
              key={count}
              type="button"
              className={`${styles.countBtn} ${selectedCount === count ? styles.countBtnActive : ''}`}
              onClick={() => handleSelect(count)}
            >
              {count}
            </button>
          ))}
        </div>

        <p className={styles.hint}>Choose 1 – 6 seats. You'll pick their location next.</p>

        <button
          type="button"
          className={styles.proceedBtn}
          onClick={handleProceed}
        >
          Select seats
        </button>
      </div>
    </div>
  );
}
