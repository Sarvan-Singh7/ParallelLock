/**
 * SeatPage.jsx – Milestone 6 Interactive Seat Selection Page
 */
import { useEffect, useReducer, useState, useCallback } from 'react';
import { useParams, useSearchParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { api } from '../../lib/apiClient';
import { useAuth } from '../../context/AuthContext';
import { usePolling } from '../../hooks/usePolling';
import { seatReducer, initialState } from './seatReducer';
import { SeatGrid } from './SeatGrid';
import { Legend } from './Legend';
import { StickyBar } from './StickyBar';
import { ErrorBanner } from '../../components/ErrorBanner';
import { formatShowDate, formatShowTime } from '../../lib/format';
import styles from './SeatPage.module.css';

export function SeatPage() {
  const { showId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();

  const countParam = parseInt(searchParams.get('count'), 10) || 2;
  const targetCount = Math.max(1, Math.min(6, countParam));

  const [state, dispatch] = useReducer(seatReducer, {
    ...initialState,
    maxSeats: targetCount,
  });

  const [seatsData, setSeatsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sync maxSeats if searchParam changes
  useEffect(() => {
    dispatch({ type: 'SET_MAX_SEATS', payload: targetCount });
  }, [targetCount]);

  // Fetch seat map
  const fetchSeats = useCallback(async (isInitial = false) => {
    if (isInitial) setLoading(true);
    try {
      const data = await api.get(`/shows/${showId}/seats`);
      setSeatsData(data);

      // Check if any selected seat became unavailable during background refresh
      if (data?.seats) {
        const availableIds = data.seats
          .filter((s) => s.status === 'AVAILABLE' || s.status === 'MINE')
          .map((s) => s.id);
        dispatch({ type: 'REMOVE_UNAVAILABLE', payload: availableIds });
      }
    } catch (err) {
      if (isInitial) {
        setError(err.message || 'Failed to load seat layout.');
      }
    } finally {
      if (isInitial) setLoading(false);
    }
  }, [showId]);

  useEffect(() => {
    fetchSeats(true);
  }, [fetchSeats]);

  // Background polling every 5 seconds to update seat availability
  usePolling(() => {
    fetchSeats(false);
  }, 5000, !isSubmitting);

  // Handle seat toggle
  const handleToggleSeat = (seat) => {
    setError(null);
    dispatch({ type: 'TOGGLE', payload: seat });
  };

  // Submit hold request (Row-Level Locking guarantee)
  const handleHoldSeats = async () => {
    if (state.selectedSeats.length === 0) return;

    // Must be logged in to hold seats
    if (!isAuthenticated) {
      navigate('/login', { state: { from: location } });
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const seatIds = state.selectedSeats.map((s) => s.id);
      const res = await api.post(`/shows/${showId}/holds`, { seatIds });

      // Hold acquired! Redirect to checkout
      navigate(`/checkout/${res.booking.id}`);
    } catch (err) {
      // If 409 Conflict: another user held/bought the seats in the exact same millisecond
      if (err.status === 409) {
        setError(
          'Someone else just grabbed one of your selected seats! The seat map has been updated. Please choose available seats.'
        );
      } else {
        setError(err.message || 'Failed to hold seats. Please try again.');
      }
      // Re-fetch seats immediately to reflect the updated state
      fetchSeats(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loadingWrapper}>
        <div className={styles.spinner} />
        <p>Loading auditorium seat layout...</p>
      </div>
    );
  }

  const show = seatsData?.show;
  const seats = seatsData?.seats || [];

  return (
    <div className={styles.pageContainer}>
      {/* Stepper matching Figma Page 5 */}
      <div className={styles.stepper}>
        <div className={`${styles.step} ${styles.stepDone}`}>
          <span className={styles.stepNum}>✓</span>
          <span className={styles.stepText}>Show</span>
        </div>
        <div className={styles.stepDivider} />
        <div className={`${styles.step} ${styles.stepActive}`}>
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

      {/* Show Details Header */}
      <div className={styles.headerBar}>
        <div className={styles.showNav}>
          <Link to="/" className={styles.backLink}>
            ← Change show
          </Link>
          <div className={styles.movieHeader}>
            <h1 className={styles.movieTitle}>{show?.movieTitle || 'The Last Orbit'}</h1>
            <span className={styles.ticketCountBadge}>
              {targetCount} {targetCount === 1 ? 'ticket' : 'tickets'}
            </span>
          </div>
          <p className={styles.metaLine}>
            {show?.theaterName || 'Aster Cinema · Sector 17'} · Screen {show?.screenNumber || 2}
            {' / '}
            {show?.startsAt && (
              <>
                {formatShowDate(show.startsAt)} · {formatShowTime(show.startsAt)} · {show.format}
              </>
            )}
          </p>
        </div>
      </div>

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      {/* Interactive Seat Grid */}
      <SeatGrid
        seats={seats}
        selectedSeats={state.selectedSeats}
        onToggleSeat={handleToggleSeat}
      />

      {/* Seat Legend */}
      <Legend />

      {/* Bottom Sticky Summary & Hold CTA */}
      <StickyBar
        selectedSeats={state.selectedSeats}
        maxSeats={state.maxSeats}
        onHold={handleHoldSeats}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
