/**
 * PosterPlaceholder.jsx – Gradient poster placeholder for movies
 */
import styles from './PosterPlaceholder.module.css';

const GRADIENTS = [
  'linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)', // Midnight Deep
  'linear-gradient(135deg, #434343 0%, #000000 100%)', // Noir Dark
  'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)', // Ocean Space
  'linear-gradient(135deg, #373b44 0%, #4286f4 100%)', // Twilight Blue
  'linear-gradient(135deg, #141e30 0%, #243b55 100%)', // Royal Night
];

export function PosterPlaceholder({ title, certificate, durationMin, id = 0 }) {
  const gradient = GRADIENTS[Number(id) % GRADIENTS.length];

  return (
    <div className={styles.poster} style={{ background: gradient }}>
      <div className={styles.topBadge}>
        {certificate && <span className={styles.cert}>{certificate}</span>}
        {durationMin && <span className={styles.duration}>{durationMin}m</span>}
      </div>

      <div className={styles.titleArea}>
        <div className={styles.filmIcon}>🎬</div>
        <h3 className={styles.title}>{title}</h3>
      </div>
    </div>
  );
}
