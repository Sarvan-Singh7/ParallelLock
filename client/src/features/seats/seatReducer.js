/**
 * seatReducer.js – State management for seat selection grid
 */
export const initialState = {
  selectedSeats: [], // Array of seat objects { id, row, number, tier, pricePaise }
  maxSeats: 2,
};

export function seatReducer(state, action) {
  switch (action.type) {
    case 'SET_MAX_SEATS':
      return {
        ...state,
        maxSeats: action.payload,
        // If current selection exceeds new limit, keep only the latest maxSeats
        selectedSeats: state.selectedSeats.slice(-action.payload),
      };

    case 'TOGGLE': {
      const seat = action.payload;
      const isAlreadySelected = state.selectedSeats.some((s) => s.id === seat.id);

      if (isAlreadySelected) {
        return {
          ...state,
          selectedSeats: state.selectedSeats.filter((s) => s.id !== seat.id),
        };
      }

      // If already at limit, drop the first (oldest) selected seat and add new one
      if (state.selectedSeats.length >= state.maxSeats) {
        return {
          ...state,
          selectedSeats: [...state.selectedSeats.slice(1), seat],
        };
      }

      // Add to selection
      return {
        ...state,
        selectedSeats: [...state.selectedSeats, seat],
      };
    }

    case 'REMOVE_UNAVAILABLE': {
      const availableSeatIds = new Set(action.payload);
      return {
        ...state,
        selectedSeats: state.selectedSeats.filter((s) => availableSeatIds.has(s.id)),
      };
    }

    case 'CLEAR':
      return {
        ...state,
        selectedSeats: [],
      };

    default:
      return state;
  }
}
