/**
 * Day-bucket recompute (BUILD_V1 §5): `day_buckets` is a derived cache,
 * rebuilt per date from the CLOSED sessions overlapping that local day.
 *
 * Sealed buckets are IMMUTABLE (BUILD_V1 §3, docs/CONTRACT_CHANGES.md #1):
 * a sealed date is never rewritten — it is skipped and reported in
 * `skippedSealed`. Its `dirty` flag (if any) is deliberately left alone;
 * clearing it would require an upsert, and sealed rows are never written.
 */
import type { DayBucketRepository, SessionRepository } from '../../data/Repositories';
import type { BucketConfig, EpochMs, LocalDate } from '../types';
import { addCalendarDays, parseLocalDate, wallTimeToEpoch } from './localTime';
import { localDatesInRange, splitInterval } from './split';

/** The two stores bucket recompute touches (subset of `Repositories`). */
export interface BucketStores {
  readonly sessions: SessionRepository;
  readonly dayBuckets: DayBucketRepository;
}

export interface RecomputeResult {
  /** Dates whose bucket was rebuilt (dirty flag cleared). */
  readonly recomputed: readonly LocalDate[];
  /** Dates skipped because they are sealed (immutable — never rewritten). */
  readonly skippedSealed: readonly LocalDate[];
}

/**
 * Rebuild the buckets for the given dates from closed sessions. Duplicates are
 * ignored; sealed dates are skipped. This is the core both entry points share.
 */
export async function recomputeDates(
  stores: BucketStores,
  config: BucketConfig,
  dates: readonly LocalDate[],
): Promise<RecomputeResult> {
  const recomputed: LocalDate[] = [];
  const skippedSealed: LocalDate[] = [];

  for (const date of [...new Set(dates)].sort()) {
    const existing = await stores.dayBuckets.get(date);
    if (existing?.sealedAt !== undefined) {
      skippedSealed.push(date);
      continue;
    }

    const day = parseLocalDate(date);
    const dayFrom = wallTimeToEpoch(config.timeZone, day, 0);
    const dayTo = wallTimeToEpoch(config.timeZone, addCalendarDays(day, 1), 0);

    let dayMs = 0;
    let nightMs = 0;
    for (const session of await stores.sessions.findOverlapping(dayFrom, dayTo)) {
      // Only closed sessions with both endpoints contribute (open sessions are
      // recomputed when they close — CONTRACT_CHANGES.md #1).
      if (session.status !== 'closed') continue;
      if (session.startedAt === undefined || session.endedAt === undefined) continue;
      for (const slice of splitInterval(session.startedAt, session.endedAt, config)) {
        if (slice.date !== date) continue;
        if (slice.category === 'day') dayMs += slice.ms;
        else nightMs += slice.ms;
      }
    }

    await stores.dayBuckets.upsert({
      date,
      dayLockSec: Math.round(dayMs / 1000),
      nightLockSec: Math.round(nightMs / 1000),
      dirty: false,
    });
    recomputed.push(date);
  }

  return { recomputed, skippedSealed };
}

/** Rebuild every bucket currently flagged dirty (BUILD_V1 §7 last step). */
export async function recomputeDirtyBuckets(
  stores: BucketStores,
  config: BucketConfig,
): Promise<RecomputeResult> {
  const dirty = await stores.dayBuckets.findDirty();
  return recomputeDates(stores, config, dirty.map((bucket) => bucket.date));
}

/**
 * Mark every local date touched by `[fromMs, toMs]` dirty, then rebuild those
 * dates plus anything else already dirty. Used after a session closes: the
 * range is the session's `[startedAt, endedAt]`. Marking first means a crash
 * mid-recompute leaves the dates flagged for the next run.
 */
export async function recomputeRange(
  stores: BucketStores,
  config: BucketConfig,
  fromMs: EpochMs,
  toMs: EpochMs,
): Promise<RecomputeResult> {
  const dates = localDatesInRange(fromMs, toMs, config.timeZone);
  await stores.dayBuckets.markDirty(dates);
  const dirty = await stores.dayBuckets.findDirty();
  return recomputeDates(stores, config, [...dates, ...dirty.map((bucket) => bucket.date)]);
}
