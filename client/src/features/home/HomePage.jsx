/**
 * HomePage.jsx – Browse catalog, interactive filters, hero banner, date picker & showtimes
 */
import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useOutletContext } from 'react-router-dom';
import { useFetch } from '../../hooks/useFetch';
import { api } from '../../lib/apiClient';
import { MovieCard } from './MovieCard';
import { ShowPill } from './ShowPill';
import { SeatCountModal } from '../../components/SeatCountModal';
import { formatShowDate } from '../../lib/format';
import { ErrorBanner } from '../../components/ErrorBanner';
import styles from './HomePage.module.css';

const LANGUAGES = ['All languages', 'Hindi', 'English', 'Punjabi', 'Malayalam'];
const GENRES = ['All genres', 'Adventure', 'Drama', 'Sci-fi', 'Thriller', 'Romance'];

export function HomePage() {
  const navigate = useNavigate();
  const outletContext = useOutletContext();
  const searchQuery = outletContext?.searchQuery || '';
  const { data: moviesData, loading: moviesLoading, error: moviesError } = useFetch('/movies');

  const [selectedMovie, setSelectedMovie] = useState(null);
  const [selectedLanguage, setSelectedLanguage] = useState('All languages');
  const [selectedGenre, setSelectedGenre] = useState('All genres');

  const [showsData, setShowsData] = useState(null);
  const [showsLoading, setShowsLoading] = useState(false);
  const [showsError, setShowsError] = useState(null);
  const [selectedDate, setSelectedDate] = useState(null);

  // Seat count modal state
  const [modalShow, setModalShow] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Filter movies based on language, genre, and search query
  const filteredMovies = useMemo(() => {
    if (!moviesData?.movies) return [];
    return moviesData.movies.filter((movie) => {
      // Search query filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = movie.title.toLowerCase().includes(q);
        const matchesGenre = movie.genres?.some((g) => g.toLowerCase().includes(q));
        if (!matchesTitle && !matchesGenre) return false;
      }

      // Language filter
      if (selectedLanguage !== 'All languages') {
        if (!movie.languages?.includes(selectedLanguage)) return false;
      }

      // Genre filter
      if (selectedGenre !== 'All genres') {
        if (!movie.genres?.includes(selectedGenre)) return false;
      }

      return true;
    });
  }, [moviesData, searchQuery, selectedLanguage, selectedGenre]);

  // Auto-select the first movie when movies load
  useEffect(() => {
    if (moviesData?.movies?.length > 0 && !selectedMovie) {
      handleSelectMovie(moviesData.movies[0]);
    }
  }, [moviesData]);

  const handleSelectMovie = async (movie) => {
    setSelectedMovie(movie);
    setShowsLoading(true);
    setShowsError(null);
    try {
      const data = await api.get(`/movies/${movie.id}/shows`);
      setShowsData(data);
      // Default to first available date
      if (data?.days?.length > 0) {
        setSelectedDate(data.days[0].date);
      } else {
        setSelectedDate(null);
      }
    } catch (err) {
      setShowsError(err.message || 'Failed to load showtimes.');
    } finally {
      setShowsLoading(false);
    }
  };

  const handleShowPillClick = (show, theater) => {
    setModalShow({
      ...show,
      theaterName: theater.name,
      screenNumber: show.screenNumber || 2,
    });
    setIsModalOpen(true);
  };

  const handleConfirmSeats = (seatCount) => {
    if (modalShow) {
      setIsModalOpen(false);
      navigate(`/shows/${modalShow.id}/seats?count=${seatCount}`);
    }
  };

  // Helper to format date pill items: SUN / 25 / OCT
  const parseDatePill = (dateStr) => {
    const d = new Date(dateStr + 'T00:00:00+05:30');
    const dayName = d.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
    const dayNum = d.toLocaleDateString('en-IN', { day: '2-digit', timeZone: 'Asia/Kolkata' });
    const month = d.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' }).toUpperCase();
    return { dayName, dayNum, month };
  };

  // Get active day theaters
  const activeDayGroup = showsData?.days?.find((d) => d.date === selectedDate) || showsData?.days?.[0];

  return (
    <div className={styles.container}>
      {/* Hero Banner – Figma Page 1 Feature Card */}
      <section className={styles.heroBanner}>
        <div className={styles.heroContent}>
          <span className={styles.heroEyebrow}>THIS WEEK'S BIG-SCREEN ESCAPE</span>
          <h1 className={styles.heroTitle}>The Last Orbit</h1>
          <p className={styles.heroTagline}>One last signal. A universe to cross.</p>
          <p className={styles.heroMeta}>UA 13+ · 2h 18m · Sci-fi / Adventure</p>
          <button
            type="button"
            className={styles.heroBtn}
            onClick={() => {
              const target = moviesData?.movies?.find((m) => m.title === 'The Last Orbit');
              if (target) handleSelectMovie(target);
              document.getElementById('showtimes')?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Explore & book →
          </button>
        </div>
        <div className={styles.heroPosterWrap}>
          <img
            src="/posters/the-last-orbit.jpg"
            alt="The Last Orbit Featured Banner"
            className={styles.heroPoster}
          />
        </div>
      </section>

      {/* Movies Catalog Section */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <h2 className={styles.sectionTitle}>Now showing</h2>
            <p className={styles.sectionSubtitle}>
              Stories worth stepping out for in Chandigarh.
            </p>
          </div>
          <span className={styles.movieCounter}>
            {filteredMovies.length} movies · All cinemas
          </span>
        </div>

        {/* Filter Chips Bar */}
        <div className={styles.filterBar}>
          <div className={styles.filterRow}>
            <span className={styles.filterLabel}>Language:</span>
            <div className={styles.chipGroup}>
              {LANGUAGES.map((lang) => (
                <button
                  key={lang}
                  type="button"
                  className={`${styles.chip} ${selectedLanguage === lang ? styles.chipActive : ''}`}
                  onClick={() => setSelectedLanguage(lang)}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.filterRow}>
            <span className={styles.filterLabel}>Genre:</span>
            <div className={styles.chipGroup}>
              {GENRES.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  className={`${styles.chip} ${selectedGenre === genre ? styles.chipActive : ''}`}
                  onClick={() => setSelectedGenre(genre)}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        </div>

        <ErrorBanner error={moviesError} />

        {moviesLoading && (
          <div className={styles.loadingWrapper}>
            <div className={styles.spinner} />
            <p>Loading movies...</p>
          </div>
        )}

        {filteredMovies.length > 0 ? (
          <div className={styles.moviesGrid}>
            {filteredMovies.map((movie) => (
              <MovieCard
                key={movie.id}
                movie={movie}
                isSelected={selectedMovie?.id === movie.id}
                onSelect={(m) => {
                  handleSelectMovie(m);
                  document.getElementById('showtimes')?.scrollIntoView({ behavior: 'smooth' });
                }}
              />
            ))}
          </div>
        ) : (
          !moviesLoading && (
            <div className={styles.emptyResults}>
              <p>No movies match your selected filters.</p>
              <button
                type="button"
                className={styles.resetBtn}
                onClick={() => {
                  setSelectedLanguage('All languages');
                  setSelectedGenre('All genres');
                }}
              >
                Reset filters
              </button>
            </div>
          )
        )}
      </section>

      {/* Showtimes Section – Figma Page 3 & 4 */}
      {selectedMovie && (
        <section className={styles.showsSection} id="showtimes">
          {/* Booking Stepper */}
          <div className={styles.stepper}>
            <div className={`${styles.step} ${styles.stepActive}`}>
              <span className={styles.stepNum}>1</span>
              <span className={styles.stepText}>Show</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={styles.step}>
              <span className={styles.stepNum}>2</span>
              <span className={styles.stepText}>Seats</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={styles.step}>
              <span className={styles.stepNum}>3</span>
              <span className={styles.stepText}>Payment</span>
            </div>
            <div className={styles.stepDivider} />
            <div className={styles.step}>
              <span className={styles.stepNum}>4</span>
              <span className={styles.stepText}>Ticket</span>
            </div>
          </div>

          <div className={styles.showsHeader}>
            <div>
              <span className={styles.showsEyebrow}>CHANDIGARH / SHOWTIMES</span>
              <h2 className={styles.selectedTitle}>{selectedMovie.title}</h2>
              <p className={styles.movieMeta}>
                {selectedMovie.certificate} · {selectedMovie.durationMin}m ·{' '}
                {selectedMovie.genres?.join(', ')}
              </p>
            </div>
          </div>

          <ErrorBanner error={showsError} />

          {/* Date Selector Row */}
          {showsData?.days?.length > 0 && (
            <div className={styles.dateSelectorRow}>
              {showsData.days.map((dayGroup) => {
                const { dayName, dayNum, month } = parseDatePill(dayGroup.date);
                const isActive = selectedDate === dayGroup.date;
                return (
                  <button
                    key={dayGroup.date}
                    type="button"
                    className={`${styles.datePill} ${isActive ? styles.datePillActive : ''}`}
                    onClick={() => setSelectedDate(dayGroup.date)}
                  >
                    <span className={styles.pillDayName}>{dayName}</span>
                    <span className={styles.pillDayNum}>{dayNum}</span>
                    <span className={styles.pillMonth}>{month}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Availability Legend */}
          <div className={styles.legendBar}>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotPlenty}`}>○</span>
              <span>Plenty available</span>
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotFilling}`}>!</span>
              <span>Filling fast</span>
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotAlmost}`}>!</span>
              <span>Almost full</span>
            </div>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.dotSold}`}>×</span>
              <span>Sold out</span>
            </div>
          </div>

          {showsLoading ? (
            <div className={styles.loadingWrapper}>
              <div className={styles.spinner} />
              <p>Checking available shows...</p>
            </div>
          ) : activeDayGroup?.theaters?.length > 0 ? (
            <div className={styles.theatersList}>
              {activeDayGroup.theaters.map((theater) => (
                <div key={theater.id} className={styles.theaterCard}>
                  <div className={styles.theaterHeader}>
                    <div>
                      <h3 className={styles.theaterName}>{theater.name}</h3>
                      <p className={styles.theaterAddress}>
                        {theater.address}, {theater.city}
                      </p>
                    </div>
                    <span className={styles.venueInfoLink}>Venue info ↗</span>
                  </div>

                  <div className={styles.pillsGrid}>
                    {theater.shows.map((show) => (
                      <ShowPill
                        key={show.id}
                        show={show}
                        onSelect={(s) => handleShowPillClick(s, theater)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyShows}>
              <p>No upcoming shows scheduled for this title on the selected date.</p>
            </div>
          )}
        </section>
      )}

      {/* Seat Quantity Modal */}
      <SeatCountModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        show={modalShow}
        movie={selectedMovie}
        onConfirm={handleConfirmSeats}
      />
    </div>
  );
}
