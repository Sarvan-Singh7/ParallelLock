/**
 * catalog.service.js – Business logic for movies and shows catalog
 */
import { catalogRepo } from './catalog.repo.js';
import { errors } from '../../common/errors.js';

function computeAvailability(freeSeats, totalSeats) {
  if (totalSeats === 0 || freeSeats === 0) {
    return 'SOLD_OUT';
  }
  const ratio = freeSeats / totalSeats;
  if (ratio < 0.2) {
    return 'ALMOST_FULL';
  }
  if (ratio < 0.5) {
    return 'FILLING_FAST';
  }
  return 'PLENTY';
}

function formatMovie(m) {
  // Format releaseDate as YYYY-MM-DD
  const releaseDate = m.release_date instanceof Date
    ? m.release_date.toISOString().split('T')[0]
    : String(m.release_date).split('T')[0];

  return {
    id: String(m.id),
    title: m.title,
    synopsis: m.synopsis,
    durationMin: m.duration_min,
    certificate: m.certificate,
    languages: m.languages,
    genres: m.genres,
    posterUrl: m.poster_url,
    releaseDate,
  };
}

export const catalogService = {
  async getMovies() {
    const rows = await catalogRepo.listMovies();
    return {
      movies: rows.map(formatMovie),
    };
  },

  async getMovieShows(movieId) {
    const movie = await catalogRepo.findMovieById(movieId);
    if (!movie) {
      throw errors.notFound('Movie not found.');
    }

    const showRows = await catalogRepo.listShowsForMovie(movieId);

    // Group shows by day (dateStr), then by theater
    const daysMap = new Map(); // dateStr -> Map<theaterId, { theater, shows: [] }>

    for (const r of showRows) {
      const dateStr = r.show_date;
      if (!daysMap.has(dateStr)) {
        daysMap.set(dateStr, new Map());
      }
      const theatersMap = daysMap.get(dateStr);
      const tId = String(r.theater_id);

      if (!theatersMap.has(tId)) {
        theatersMap.set(tId, {
          id: tId,
          name: r.theater_name,
          address: r.theater_address,
          city: r.theater_city,
          shows: [],
        });
      }

      const totalSeats = Number(r.total_seats);
      const freeSeats = Number(r.free_seats);
      const availability = computeAvailability(freeSeats, totalSeats);

      theatersMap.get(tId).shows.push({
        id: String(r.show_id),
        startsAt: r.starts_at instanceof Date ? r.starts_at.toISOString() : new Date(r.starts_at).toISOString(),
        screenName: r.screen_name,
        format: r.format,
        language: r.language,
        totalSeats,
        freeSeats,
        availability,
      });
    }

    const days = [];
    for (const [date, theatersMap] of daysMap.entries()) {
      days.push({
        date,
        theaters: Array.from(theatersMap.values()),
      });
    }

    return {
      movie: formatMovie(movie),
      days,
    };
  },
};
