/**
 * Legend.jsx – Seat status legend matching Figma Page 5
 */
import styles from './Legend.module.css';

export function Legend() {
  return (
    <div className={styles.legend}>
      <div className={styles.item}>
        <div className={`${styles.box} ${styles.available}`} />
        <span>Available</span>
      </div>
      <div className={styles.item}>
        <div className={`${styles.box} ${styles.selected}`}>✓</div>
        <span>Selected</span>
      </div>
      <div className={styles.item}>
        <div className={`${styles.box} ${styles.unavailable}`}>×</div>
        <span>Unavailable</span>
      </div>
      <div className={styles.item}>
        <div className={`${styles.box} ${styles.blocked}`}>·</div>
        <span>Blocked</span>
      </div>
    </div>
  );
}
