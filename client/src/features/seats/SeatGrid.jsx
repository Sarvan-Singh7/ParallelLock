/**
 * SeatGrid.jsx – Seat grid layout with screen indicator, aisles, and tiers
 */
import { useMemo } from 'react';
import { Seat } from './Seat';
import styles from './SeatGrid.module.css';

export function SeatGrid({ seats, selectedSeats, onToggleSeat }) {
  const selectedSeatIds = useMemo(
    () => new Set(selectedSeats.map((s) => s.id)),
    [selectedSeats]
  );

  // Group seats by tier, then by row
  const tiers = useMemo(() => {
    const tierMap = {};

    seats.forEach((seat) => {
      if (!tierMap[seat.tier]) {
        tierMap[seat.tier] = {
          tier: seat.tier,
          pricePaise: seat.pricePaise,
          rows: {},
        };
      }
      if (!tierMap[seat.tier].rows[seat.row]) {
        tierMap[seat.tier].rows[seat.row] = [];
      }
      tierMap[seat.tier].rows[seat.row].push(seat);
    });

    // Ensure rows are sorted within each tier
    Object.values(tierMap).forEach((t) => {
      Object.keys(t.rows).forEach((rowKey) => {
        t.rows[rowKey].sort((a, b) => a.number - b.number);
      });
    });

    // Standard order: GOLD first, then SILVER
    const order = ['GOLD', 'SILVER'];
    return order.filter((k) => tierMap[k]).map((k) => tierMap[k]);
  }, [seats]);

  return (
    <div className={styles.gridContainer}>
      {/* Screen Indicator matching Figma */}
      <div className={styles.screenArea}>
        <div className={styles.screenCurve} />
        <span className={styles.screenText}>ALL EYES THIS WAY</span>
      </div>

      {/* Tier Sections */}
      <div className={styles.tiersWrapper}>
        {tiers.map((tierData) => (
          <div key={tierData.tier} className={styles.tierSection}>
            <div className={styles.tierHeader}>
              <span className={styles.tierName}>{tierData.tier}</span>
              <span className={styles.tierDot}>·</span>
              <span className={styles.tierPrice}>
                ₹{(tierData.pricePaise / 100).toFixed(2)}
              </span>
            </div>

            <div className={styles.rowsList}>
              {Object.entries(tierData.rows).map(([rowLetter, rowSeats]) => (
                <div key={rowLetter} className={styles.seatRow}>
                  <span className={styles.rowLabel}>{rowLetter}</span>

                  <div className={styles.seatsBlock}>
                    {/* Aisle 1: Seats 1 - 4 */}
                    <div className={styles.aisleGroup}>
                      {rowSeats
                        .filter((s) => s.number <= 4)
                        .map((seat) => (
                          <Seat
                            key={seat.id}
                            seat={seat}
                            isSelected={selectedSeatIds.has(seat.id)}
                            onToggle={onToggleSeat}
                          />
                        ))}
                    </div>

                    {/* Aisle 2: Seats 5 - 8 */}
                    <div className={styles.aisleGroup}>
                      {rowSeats
                        .filter((s) => s.number >= 5 && s.number <= 8)
                        .map((seat) => (
                          <Seat
                            key={seat.id}
                            seat={seat}
                            isSelected={selectedSeatIds.has(seat.id)}
                            onToggle={onToggleSeat}
                          />
                        ))}
                    </div>

                    {/* Aisle 3: Seats 9 - 12 */}
                    <div className={styles.aisleGroup}>
                      {rowSeats
                        .filter((s) => s.number >= 9)
                        .map((seat) => (
                          <Seat
                            key={seat.id}
                            seat={seat}
                            isSelected={selectedSeatIds.has(seat.id)}
                            onToggle={onToggleSeat}
                          />
                        ))}
                    </div>
                  </div>

                  <span className={styles.rowLabel}>{rowLetter}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
