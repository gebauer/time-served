/**
 * Daily seal selection (BUILD_V1 §5): around midday, every unsealed past day
 * `< today` becomes an immutable `DailyStat` upload. This module is the pure
 * selection/marking half; the scheduler, upload and retry policy are J10's.
 *
 * Decision #1 (docs/CONTRACT_CHANGES.md): sealing is UNCONDITIONAL. No check
 * for open sessions — a multi-day open session has its earlier days sealed
 * with whatever the buckets hold (usually zero), and that time is lost.
 *
 * Gap days: a day with no sessions never got a bucket row, so
 * `findUnsealedBefore` cannot see it. The J10 scheduler should call
 * `ensureZeroBuckets` for the elapsed dates first so such days are sealed as
 * zero rather than silently skipped (this is exactly what makes decision #1
 * hold for days spanned by a still-open session).
 */
import type { DayBucketRepository } from '../../data/Repositories';
import type { DailyStat, EpochMs, LocalDate, UserId } from '../types';

export interface SealArgs {
  /** Today in the user's LOCAL zone; only days strictly before it are sealed. */
  readonly today: LocalDate;
  readonly userId: UserId;
  /** Stamp written into every produced DailyStat (usually clock.now()). */
  readonly sealedAt: EpochMs;
}

/**
 * The `DailyStat` uploads for every unsealed day `< today`, ascending by date.
 * Pure selection — nothing is written. Idempotent: already-sealed days are
 * never selected again, so after `markSealed` a second call returns `[]`.
 */
export async function selectDaysToSeal(
  dayBuckets: DayBucketRepository,
  args: SealArgs,
): Promise<DailyStat[]> {
  const unsealed = await dayBuckets.findUnsealedBefore(args.today);
  return unsealed
    .filter((bucket) => bucket.sealedAt === undefined && bucket.date < args.today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((bucket) => ({
      userId: args.userId,
      date: bucket.date,
      dayLockSec: bucket.dayLockSec,
      nightLockSec: bucket.nightLockSec,
      sealedAt: args.sealedAt,
    }));
}

/**
 * Mark the given dates sealed (call ONLY after the upload succeeded — J10).
 * From then on the dates drop out of selection and recompute skips them.
 */
export async function markSealed(
  dayBuckets: DayBucketRepository,
  dates: readonly LocalDate[],
  sealedAt: EpochMs,
): Promise<void> {
  for (const date of dates) {
    await dayBuckets.markSealed(date, sealedAt);
  }
}

/**
 * Create a zero bucket for every date that has none, so session-less (or
 * open-session-spanned) days participate in sealing. Existing rows — sealed
 * or not — are left untouched. Returns the dates actually created.
 */
export async function ensureZeroBuckets(
  dayBuckets: DayBucketRepository,
  dates: readonly LocalDate[],
): Promise<LocalDate[]> {
  const created: LocalDate[] = [];
  for (const date of dates) {
    if ((await dayBuckets.get(date)) !== undefined) continue;
    await dayBuckets.upsert({ date, dayLockSec: 0, nightLockSec: 0, dirty: false });
    created.push(date);
  }
  return created;
}
