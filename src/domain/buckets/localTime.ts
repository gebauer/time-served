/**
 * Local-time math on top of the Intl API — no date libraries, no native deps
 * (JOBS.md J2). Node 24 / Hermes ship full ICU, so IANA zone lookups work on
 * plain Node, which is where all domain tests run.
 *
 * Instants are UTC epoch ms (`EpochMs`); wall-clock values exist only inside
 * this module and at the conversion helpers below.
 */
import type { EpochMs, LocalDate } from '../types';

/** Wall-clock parts of an instant in some IANA zone. `month`/`day` are 1-based. */
export interface LocalParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

/** Calendar date triple (no time-of-day, no zone). */
export interface CalendarDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

// Intl.DateTimeFormat construction is expensive; cache one per zone.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Wall-clock parts of `ms` in `timeZone`. Sub-second precision is dropped. */
export function localParts(ms: EpochMs, timeZone: string): LocalParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const read = (type: Intl.DateTimeFormatPart['type']): number => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) {
      throw new Error(`Intl returned no '${type}' part for zone '${timeZone}'`);
    }
    return Number(part.value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

/** `YYYY-MM-DD` for a calendar day triple. */
export function localDateFromParts(day: CalendarDay): LocalDate {
  const mm = String(day.month).padStart(2, '0');
  const dd = String(day.day).padStart(2, '0');
  return `${day.year}-${mm}-${dd}` as LocalDate;
}

/** The LOCAL calendar date the instant `ms` falls on in `timeZone`. */
export function localDateOf(ms: EpochMs, timeZone: string): LocalDate {
  return localDateFromParts(localParts(ms, timeZone));
}

/** Parse `YYYY-MM-DD` back into a calendar day triple. */
export function parseLocalDate(date: LocalDate): CalendarDay {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) throw new Error(`Invalid LocalDate: '${date}'`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** Pure calendar arithmetic (proleptic Gregorian, zone-independent). */
export function addCalendarDays(day: CalendarDay, days: number): CalendarDay {
  const shifted = new Date(Date.UTC(day.year, day.month - 1, day.day + days));
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** `date` shifted by `days` calendar days. */
export function addDaysToLocalDate(date: LocalDate, days: number): LocalDate {
  return localDateFromParts(addCalendarDays(parseLocalDate(date), days));
}

/** All dates from `from` to `to`, inclusive, ascending. Empty if `from > to`. */
export function enumerateLocalDates(from: LocalDate, to: LocalDate): LocalDate[] {
  const dates: LocalDate[] = [];
  let cursor = from;
  while (cursor <= to) {
    dates.push(cursor);
    cursor = addDaysToLocalDate(cursor, 1);
  }
  return dates;
}

/**
 * Zone offset at instant `ms`, in ms, such that `wall-clock-as-UTC = ms + offset`.
 */
function zoneOffsetMs(timeZone: string, ms: EpochMs): number {
  const p = localParts(ms, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

/**
 * Instant for a wall-clock time in `timeZone` (two-pass offset resolution).
 *
 * DST caveats, by design (BUILD_V1 §5 slicing tolerates both):
 * - a NONEXISTENT wall time (spring-forward gap) resolves to a nearby valid
 *   instant — callers that walk boundaries must guard with `> t`;
 * - an AMBIGUOUS wall time (fall-back repeat) resolves to one of the two
 *   occurrences deterministically. Either is a valid slicing point.
 */
export function wallTimeToEpoch(
  timeZone: string,
  day: CalendarDay,
  hour = 0,
  minute = 0,
  second = 0,
): EpochMs {
  const wallAsUtc = Date.UTC(day.year, day.month - 1, day.day, hour, minute, second);
  const firstGuess = wallAsUtc - zoneOffsetMs(timeZone, wallAsUtc);
  return wallAsUtc - zoneOffsetMs(timeZone, firstGuess);
}
