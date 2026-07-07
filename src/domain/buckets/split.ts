/**
 * Day/night splitter (BUILD_V1 §5).
 *
 * A closed interval of served time `[fromMs, toMs)` is sliced at every LOCAL
 * boundary it crosses — calendar midnight (00:00), `dayStartHour` (default 08)
 * and `nightStartHour` (default 22) — and each slice is attributed to
 * `(localDate, 'day' | 'night')` by its START instant.
 *
 * The slices PARTITION the interval by construction: `sum(slice.ms) ===
 * toMs - fromMs`, exactly, always — including across DST transitions
 * (Europe/Berlin spring-forward = 23h local day, fall-back = 25h). Tests
 * assert this additivity as a property.
 */
import type { BucketCategory, BucketConfig, EpochMs, LocalDate } from '../types';
import {
  addCalendarDays,
  localDateOf,
  localParts,
  wallTimeToEpoch,
} from './localTime';

/** One attributed piece of a session. */
export interface SessionSlice {
  readonly date: LocalDate;
  readonly category: BucketCategory;
  readonly fromMs: EpochMs;
  readonly toMs: EpochMs;
  /** Exact length in ms; `sum` over a split equals the interval length. */
  readonly ms: number;
}

function assertConfig(config: BucketConfig): void {
  const { dayStartHour, nightStartHour } = config;
  if (
    !Number.isInteger(dayStartHour) ||
    !Number.isInteger(nightStartHour) ||
    dayStartHour < 0 ||
    nightStartHour > 23 ||
    dayStartHour >= nightStartHour
  ) {
    throw new Error(
      `Invalid BucketConfig: dayStartHour=${dayStartHour}, nightStartHour=${nightStartHour} ` +
        '(need integers with 0 <= dayStartHour < nightStartHour <= 23)',
    );
  }
}

function boundaryHours(config: BucketConfig): number[] {
  return [...new Set([0, config.dayStartHour, config.nightStartHour])].sort((a, b) => a - b);
}

/**
 * Earliest boundary instant strictly after `t`. Searches today plus the next
 * two calendar days so a boundary erased by a DST gap can never stall the walk.
 */
function nextBoundaryAfter(t: EpochMs, config: BucketConfig): EpochMs {
  const parts = localParts(t, config.timeZone);
  const hours = boundaryHours(config);
  for (let dayOffset = 0; dayOffset <= 2; dayOffset += 1) {
    const day = addCalendarDays(parts, dayOffset);
    let best: EpochMs | undefined;
    for (const hour of hours) {
      const candidate = wallTimeToEpoch(config.timeZone, day, hour);
      if (candidate > t && (best === undefined || candidate < best)) best = candidate;
    }
    if (best !== undefined) return best;
  }
  throw new Error(`No boundary found after ${t} in zone '${config.timeZone}'`);
}

/** Category of the instant `t`: day iff dayStartHour <= localHour < nightStartHour. */
export function categoryAt(t: EpochMs, config: BucketConfig): BucketCategory {
  const { hour } = localParts(t, config.timeZone);
  return hour >= config.dayStartHour && hour < config.nightStartHour ? 'day' : 'night';
}

/**
 * Split `[fromMs, toMs)` into attributed slices. Zero-length input → `[]`.
 * A slice starting exactly ON a boundary belongs to the window the boundary
 * opens (22:00:00 start → night).
 */
export function splitInterval(
  fromMs: EpochMs,
  toMs: EpochMs,
  config: BucketConfig,
): SessionSlice[] {
  assertConfig(config);
  if (toMs < fromMs) {
    throw new Error(`splitInterval: toMs (${toMs}) before fromMs (${fromMs})`);
  }
  const slices: SessionSlice[] = [];
  let t = fromMs;
  while (t < toMs) {
    const boundary = nextBoundaryAfter(t, config);
    const sliceEnd = Math.min(boundary, toMs);
    slices.push({
      date: localDateOf(t, config.timeZone),
      category: categoryAt(t, config),
      fromMs: t,
      toMs: sliceEnd,
      ms: sliceEnd - t,
    });
    t = sliceEnd;
  }
  return slices;
}

/**
 * All LOCAL dates the interval `[fromMs, toMs)` touches, ascending. A
 * zero-length interval still yields its single date (a reconciled zero-length
 * session must still mark its day dirty).
 */
export function localDatesInRange(
  fromMs: EpochMs,
  toMs: EpochMs,
  timeZone: string,
): LocalDate[] {
  if (toMs < fromMs) {
    throw new Error(`localDatesInRange: toMs (${toMs}) before fromMs (${fromMs})`);
  }
  const dates: LocalDate[] = [];
  let t = fromMs;
  for (;;) {
    const date = localDateOf(t, timeZone);
    if (dates[dates.length - 1] !== date) dates.push(date);
    const nextDay = addCalendarDays(localParts(t, timeZone), 1);
    const nextMidnight = wallTimeToEpoch(timeZone, nextDay, 0);
    if (nextMidnight <= t) {
      throw new Error(`Non-advancing midnight after ${t} in zone '${timeZone}'`);
    }
    if (nextMidnight >= toMs) return dates;
    t = nextMidnight;
  }
}
