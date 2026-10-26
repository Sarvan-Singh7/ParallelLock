/**
 * seats.service.js – Business logic for show seat maps
 */
import { seatsRepo } from './seats.repo.js';
import { errors } from '../../common/errors.js';

export const seatsService = {
  async getShowSeats(showId, userId = null) {
    const show = await seatsRepo.findShowDetails(showId);
    if (!show) {
      throw errors.notFound('Show not found.');
    }

    const [sections, rawSeats, activeHold] = await Promise.all([
      seatsRepo.findSections(show.screen_id),
      seatsRepo.findSeatsWithStatus(showId, show.screen_id, userId),
      seatsRepo.findActiveUserHold(showId, userId),
    ]);

    const seats = rawSeats.map(s => ({
      id: String(s.id),
      row: s.row,
      label: s.label,
      section: s.section,
      gridRow: Number(s.gridRow),
      gridCol: Number(s.gridCol),
      status: s.status,
    }));

    const myHold = activeHold ? {
      bookingId: String(activeHold.id),
      holdExpiresAt: activeHold.hold_expires_at instanceof Date
        ? activeHold.hold_expires_at.toISOString()
        : new Date(activeHold.hold_expires_at).toISOString(),
    } : null;

    return {
      showId: String(showId),
      serverTime: new Date().toISOString(),
      show: {
        movieTitle: show.movie_title,
        theaterName: show.theater_name,
        screenName: show.screen_name,
        startsAt: show.starts_at instanceof Date ? show.starts_at.toISOString() : new Date(show.starts_at).toISOString(),
        language: show.language,
        format: show.format,
      },
      sections: sections.map(sec => ({
        name: sec.name,
        priceCents: Number(sec.price_cents),
      })),
      seats,
      myHold,
    };
  },
};
