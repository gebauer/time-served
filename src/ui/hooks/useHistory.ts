/**
 * useHistory(rangeDays) — past days for the History screen: per-day buckets
 * (DayNightBar), sealed flag, and the closed sessions that started on that day.
 */
import {
  addCalendarDays,
  addDaysToLocalDate,
  enumerateLocalDates,
  localDateOf,
  parseLocalDate,
  wallTimeToEpoch,
} from '../../domain/buckets';
import type { BoxId, LocalDate } from '../../domain/types';
import { useAppServices } from '../services/AppServicesContext';
import { groupSessionsByStartDay, type HistorySession } from './historyLogic';
import { useAsyncData } from './useAsyncData';

export interface HistoryDay {
  readonly date: LocalDate;
  readonly dayLockSec: number;
  readonly nightLockSec: number;
  readonly sealed: boolean;
  readonly sessions: readonly HistorySession[];
}

export interface History {
  readonly days: readonly HistoryDay[];
  readonly boxLabels: ReadonlyMap<BoxId, string>;
  readonly reload: () => void;
}

export function useHistory(rangeDays = 30): History | undefined {
  const { repositories, clock, settings } = useAppServices();
  const timeZone = settings.timeZone;
  const today = localDateOf(clock.now(), timeZone);

  const { data, reload } = useAsyncData(async () => {
    const from = addDaysToLocalDate(today, -(rangeDays - 1));
    const fromMs = wallTimeToEpoch(timeZone, parseLocalDate(from), 0);
    const toMs = wallTimeToEpoch(timeZone, addCalendarDays(parseLocalDate(today), 1), 0);

    const [buckets, sessions, boxes] = await Promise.all([
      repositories.dayBuckets.listRange(from, today),
      repositories.sessions.findOverlapping(fromMs, toMs),
      repositories.boxes.list(),
    ]);

    const bucketByDate = new Map(buckets.map((bucket) => [bucket.date, bucket]));
    const sessionsByDay = groupSessionsByStartDay(sessions, timeZone);
    const boxLabels = new Map<BoxId, string>(boxes.map((box) => [box.id, box.label]));

    // Newest first; skip days with neither bucket nor sessions to keep the list dense.
    const days: HistoryDay[] = [];
    for (const date of enumerateLocalDates(from, today).reverse()) {
      const bucket = bucketByDate.get(date);
      const daySessions = sessionsByDay.get(date) ?? [];
      if (bucket === undefined && daySessions.length === 0) continue;
      days.push({
        date,
        dayLockSec: bucket?.dayLockSec ?? 0,
        nightLockSec: bucket?.nightLockSec ?? 0,
        sealed: bucket?.sealedAt !== undefined,
        sessions: daySessions,
      });
    }
    return { days, boxLabels };
  }, [today, rangeDays, timeZone]);

  if (data === undefined) return undefined;
  return { ...data, reload };
}
