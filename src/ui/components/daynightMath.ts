/**
 * Pure segment math for the DayNightBar — extracted so it is unit-testable on
 * plain Node (JOBS.md J8 testing rule: pure component logic gets vitest tests).
 */

export const SECONDS_PER_DAY = 24 * 3600;

export interface BarSegments {
  /** Fraction of the track width for the day segment, 0..1. */
  readonly dayFraction: number;
  /** Fraction of the track width for the night segment, 0..1. */
  readonly nightFraction: number;
  /** Remaining track fraction, 0..1. day + night + rest === 1 (±ε). */
  readonly restFraction: number;
  /** True when there is nothing to show (both totals 0). */
  readonly empty: boolean;
}

/**
 * Compute segment fractions. Negative inputs clamp to 0. If day+night exceeds
 * `maxSec` (possible with an overfull scale or maxSec < 24h), both segments are
 * scaled down proportionally so the bar never overflows — correct at 0 and at
 * a full 24h (day+night === maxSec → restFraction 0).
 */
export function computeBarSegments(
  dayLockSec: number,
  nightLockSec: number,
  maxSec: number = SECONDS_PER_DAY,
): BarSegments {
  const day = Math.max(0, dayLockSec);
  const night = Math.max(0, nightLockSec);
  const max = Math.max(1, maxSec);
  const total = day + night;
  if (total <= 0) {
    return { dayFraction: 0, nightFraction: 0, restFraction: 1, empty: true };
  }
  const scale = total > max ? max / total : 1;
  const dayFraction = (day * scale) / max;
  const nightFraction = (night * scale) / max;
  return {
    dayFraction,
    nightFraction,
    restFraction: Math.max(0, 1 - dayFraction - nightFraction),
    empty: false,
  };
}
