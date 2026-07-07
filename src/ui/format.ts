/**
 * Formatting at the UI edge (CLAUDE.md §7) — the ONLY place epoch ms / seconds
 * become display strings. Pure functions, unit-tested on plain Node.
 */
import { localParts, parseLocalDate } from '../domain/buckets';
import type { EpochMs, LocalDate } from '../domain/types';

/** Seconds → "3 Std. 12 Min."; sub-minute → "unter 1 Min."; 0 → "0 Min.". */
export function formatDuration(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  if (sec === 0) return '0 Min.';
  if (sec < 60) return 'unter 1 Min.';
  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  if (hours === 0) return `${minutes} Min.`;
  if (minutes === 0) return `${hours} Std.`;
  return `${hours} Std. ${minutes} Min.`;
}

/** Seconds → "1:04:09" / "4:09" — the live elapsed readout on Home. */
export function formatElapsed(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

/** Seconds → "1:32" countdown (ARMED). Clamps at 0:00. */
export function formatCountdown(totalSec: number): string {
  const sec = Math.max(0, Math.ceil(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Epoch → "21:04" wall-clock time in the given zone. */
export function formatClockTime(at: EpochMs, timeZone: string): string {
  const p = localParts(at, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

const WEEKDAYS = ['So.', 'Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.'] as const;
const MONTHS = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
] as const;

/** `2026-07-06` → "Mo., 6. Juli" (zone-independent calendar math). */
export function formatLocalDate(date: LocalDate): string {
  const d = parseLocalDate(date);
  const weekday = WEEKDAYS[new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay()];
  return `${weekday}, ${d.day}. ${MONTHS[d.month - 1]}`;
}

/** Local hour (0–23) → "08:00". */
export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`;
}
