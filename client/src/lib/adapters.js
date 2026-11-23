/**
 * adapters.js – Adapter layer bridging backend API contract and client UI components.
 *
 * Normalizes field names across the application so that UI components have
 * consistent access to:
 * - tier / section
 * - pricePaise / priceCents
 * - label / row / number
 * - ref (real booking reference)
 * - displayStatus ('ACTIVE_HOLD', 'CONFIRMED', etc.)
 */

/**
 * Adapts raw /api/v1/shows/:id/seats API response for SeatPage and SeatGrid.
 */
export function adaptSeatMap(apiData) {
  if (!apiData) {
    return {
      showId: null,
      serverTime: null,
      show: null,
      sections: [],
      seats: [],
      myHold: null,
    };
  }

  // Create lookup map for section prices
  const sectionPriceMap = {};
  (apiData.sections || []).forEach((sec) => {
    sectionPriceMap[sec.name] = Number(sec.priceCents);
  });

  const seats = (apiData.seats || []).map((s) => {
    const row = s.row || (s.label ? s.label.charAt(0) : 'A');
    const number =
      s.seatNumber ||
      (s.label ? parseInt(s.label.slice(1), 10) : null) ||
      Number(s.gridCol) ||
      1;
    const tier = s.section || 'GOLD';
    const priceCents = Number(s.priceCents || sectionPriceMap[tier] || 32000);

    return {
      id: String(s.id),
      row,
      number,
      label: s.label || `${row}${number}`,
      tier,
      section: tier,
      pricePaise: priceCents,
      priceCents,
      gridRow: Number(s.gridRow || 1),
      gridCol: Number(s.gridCol || number),
      status: s.status, // AVAILABLE, MINE, UNAVAILABLE, BLOCKED
    };
  });

  const sections = (apiData.sections || []).map((sec) => ({
    name: sec.name,
    priceCents: Number(sec.priceCents),
    pricePaise: Number(sec.priceCents),
  }));

  return {
    showId: String(apiData.showId || ''),
    serverTime: apiData.serverTime || new Date().toISOString(),
    show: apiData.show || null,
    sections,
    seats,
    myHold: apiData.myHold || null,
  };
}

/**
 * Adapts raw booking object from API for CheckoutPage, TicketCard, and MyBookingsPage.
 */
export function adaptBooking(apiBooking, serverTime = null) {
  if (!apiBooking) return null;

  const totalPaise = Number(apiBooking.totalCents || 0);

  const seats = (apiBooking.seats || []).map((s) => {
    const row = s.row || (s.label ? s.label.charAt(0) : 'A');
    const number =
      s.seatNumber ||
      (s.label ? parseInt(s.label.slice(1), 10) : null) ||
      1;
    const tier = s.section || 'Gold';
    const pricePaise = Number(s.priceCents || 0);

    return {
      ...s,
      id: String(s.id || s.seatId || ''),
      row,
      number,
      label: s.label || `${row}${number}`,
      tier,
      section: tier,
      pricePaise,
      priceCents: pricePaise,
    };
  });

  const status = apiBooking.status || 'CREATED';
  const displayStatus =
    apiBooking.displayStatus ||
    (status === 'CONFIRMED'
      ? 'CONFIRMED'
      : status === 'PAYMENT_PENDING'
      ? 'PROCESSING_PAYMENT'
      : status === 'CREATED'
      ? 'ACTIVE_HOLD'
      : status);

  const isHold =
    displayStatus === 'ACTIVE_HOLD' ||
    displayStatus === 'PROCESSING_PAYMENT' ||
    status === 'CREATED' ||
    status === 'PAYMENT_PENDING';

  return {
    ...apiBooking,
    id: String(apiBooking.id),
    ref: apiBooking.ref || `PL-26-${String(apiBooking.id).padStart(5, '0')}`,
    status,
    displayStatus,
    isHold,
    totalPaise,
    totalCents: totalPaise,
    seats,
    serverTime: serverTime || apiBooking.serverTime || null,
  };
}
