/**
 * MovieCard.jsx – Card component for browsing movies in the catalog
 */
import { useState } from 'react';
import { PosterPlaceholder } from '../../components/PosterPlaceholder';
import styles from './MovieCard.module.css';

// Slugify helper to map movie titles to extracted poster assets
const POSTER_MAP = {
  'The Last Orbit': '/posters/the-last-orbit.jpg',
  'Where Tides Return': '/posters/where-tides-return.jpg',
  'Neon After Midnight': '/posters/neon-after-midnight.jpg',
  'The Sunday Garden': '/posters/the-sunday-garden.jpg',
  'Beyond the Ridge': '/posters/beyond-the-ridge.jpg',
};

export function MovieCard({ movie, isSelected, onSelect }) {
  const [imageError, setImageError] = useState(false);
  const posterSrc = POSTER_MAP[movie.title];

  return (
    <div
      className={`${styles.card} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(movie)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(movie);
        }
      }}
      aria-pressed={isSelected}
    >
      <div className={styles.posterWrapper}>
        {posterSrc && !imageError ? (
          <img
            src={posterSrc}
            alt={`${movie.title} poster`}
            className={styles.posterImg}
            onError={() => setImageError(true)}
            loading="lazy"
          />
        ) : (
          <PosterPlaceholder
            title={movie.title}
            certificate={movie.certificate}
            durationMin={movie.durationMin}
            id={movie.id}
          />
        )}
        {isSelected && <div className={styles.selectedBadge}>Viewing Shows</div>}
      </div>

      <div className={styles.info}>
        <h3 className={styles.title}>{movie.title}</h3>
        <p className={styles.metaRow}>
          <span className={styles.certBadge}>{movie.certificate}</span>
          <span className={styles.separator}>·</span>
          <span className={styles.languages}>{movie.languages?.join(', ')}</span>
        </p>
        <p className={styles.genres}>{movie.genres?.join(' · ')}</p>
      </div>
    </div>
  );
}
