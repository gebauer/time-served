/**
 * Pure history/session-edit logic, extracted from the hooks so it is testable
 * on plain Node (JOBS.md J8 testing rule).
 */
import { localDateOf } from '../../domain/buckets';
import type { EpochMs, LocalDate, Session } from '../../domain/types';

/** A closed session prepared for display, assigned to the day it STARTED. */
export interface HistorySession {
  readonly session: Session;
  readonly startedAt: EpochMs;
  readonly endedAt: EpochMs;
  readonly durationSec: number;
}

/**
 * Group closed sessions by the LOCAL date of their start. Sessions missing
 * either endpoint (defensive: open/discarded rows) are dropped. Within a day,
 * newest first.
 */
export function groupSessionsByStartDay(
  sessions: readonly Session[],
  timeZone: string,
): Map<LocalDate, HistorySession[]> {
  const byDay = new Map<LocalDate, HistorySession[]>();
  for (const session of sessions) {
    if (session.status !== 'closed') continue;
    if (session.startedAt === undefined || session.endedAt === undefined) continue;
    const date = localDateOf(session.startedAt, timeZone);
    const entry: HistorySession = {
      session,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationSec: Math.max(0, Math.round((session.endedAt - session.startedAt) / 1000)),
    };
    const list = byDay.get(date);
    if (list === undefined) byDay.set(date, [entry]);
    else list.push(entry);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) => b.startedAt - a.startedAt);
  }
  return byDay;
}

/**
 * Validate a manual session edit (History, unsealed days only): both endpoints
 * required, start strictly before end, no negative shift below epoch 0.
 */
export function isValidSessionEdit(startedAt: EpochMs, endedAt: EpochMs): boolean {
  return startedAt >= 0 && startedAt < endedAt;
}
