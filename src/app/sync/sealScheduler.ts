/**
 * Daily seal pipeline (BUILD_V1 §5, JOBS.md J10) — pure orchestration around
 * J2's seal functions. Trigger wiring (app launch / AppState / midday timer)
 * lives in sealTriggers.ts so this module stays Node-testable.
 *
 * Pipeline per run:
 *   1. Zero-fill gap days (ensureZeroBuckets) between the persisted fill
 *      watermark and yesterday, so session-less days seal as 0 instead of
 *      being skipped (decision #1: sealing is unconditional).
 *   2. selectDaysToSeal — every unsealed day < today, NEVER today.
 *   3. Upload each day to `daily_stats` (direct collection create). Mark the
 *      local bucket sealed ONLY on server confirmation; a duplicate 400 is
 *      idempotent recovery ("already on the server") and also marks sealed.
 *   4. Any transport failure leaves the remaining days unsealed — the next
 *      trigger retries. Nothing is ever retried into a duplicate because the
 *      server's (user_id, date) unique index is the source of truth.
 *
 * Sync toggle semantics (BUILD_V1 §5: sealed == uploaded): with sync OFF the
 * run is a full no-op — days stay UNSEALED and locally editable indefinitely;
 * nothing is "sealed locally". Turning sync back on seals + uploads the
 * backlog on the next trigger.
 */
import {
  addDaysToLocalDate,
  enumerateLocalDates,
  ensureZeroBuckets,
  localDateOf,
  markSealed,
  selectDaysToSeal,
} from '../../domain/buckets';
import type { Clock, DailyStat, LocalDate, UserId } from '../../domain/types';
import type { DayBucketRepository } from '../../data/Repositories';
import type { SecureKeyValueStore } from '../../data/secure/SecureKeyValueStore';

/** Secure-store key: latest LocalDate that zero-fill has covered (decision #10). */
const FILL_WATERMARK_KEY = 'ts.sync.sealfill';

/** Zero-fill never fabricates more than this many days back (feed cap is 400). */
const MAX_FILL_DAYS = 400;

export type UploadOutcome = 'created' | 'duplicate';

export interface SealRunResult {
  readonly status: 'ran' | 'sync-off' | 'auth-unavailable';
  /** Days uploaded fresh this run. */
  readonly uploaded: number;
  /** Days recovered idempotently (server already had them). */
  readonly alreadySealed: number;
  /** Days that failed to upload and stay unsealed (retried next trigger). */
  readonly failed: number;
  /** Gap days created as zero buckets this run. */
  readonly zeroFilled: number;
}

export interface SealSchedulerDeps {
  readonly dayBuckets: DayBucketRepository;
  readonly kv: SecureKeyValueStore;
  readonly clock: Clock;
  /** Re-read per run — the device zone can change. */
  readonly timeZone: () => string;
  readonly syncEnabled: () => boolean;
  /** Device auth — throws when offline/unregistered (run is retried later). */
  readonly getUserId: () => Promise<UserId>;
  /**
   * Upload ONE sealed day. Returns 'duplicate' for the server's 400 on the
   * (user_id, date) unique index; throws on transport/auth failure.
   */
  readonly upload: (stat: DailyStat) => Promise<UploadOutcome>;
}

export interface SealScheduler {
  /** Run the full pipeline once. Never throws — failures land in the result. */
  runOnce(): Promise<SealRunResult>;
}

const LOCAL_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function createSealScheduler(deps: SealSchedulerDeps): SealScheduler {
  let running: Promise<SealRunResult> | undefined;

  async function readWatermark(): Promise<LocalDate | undefined> {
    const raw = await deps.kv.get(FILL_WATERMARK_KEY);
    return raw !== null && LOCAL_DATE_RE.test(raw) ? (raw as LocalDate) : undefined;
  }

  /**
   * Dates needing a zero bucket: from the day after the watermark through
   * yesterday. First run anchors on the earliest unsealed bucket (days before
   * the app existed are not fabricated).
   */
  async function zeroFill(today: LocalDate, yesterday: LocalDate): Promise<number> {
    let watermark = await readWatermark();
    if (watermark === undefined) {
      const unsealed = await deps.dayBuckets.findUnsealedBefore(today);
      watermark =
        unsealed.length > 0
          ? addDaysToLocalDate(
              unsealed.reduce((min, b) => (b.date < min ? b.date : min), unsealed[0].date),
              -1,
            )
          : yesterday;
    }
    const capFloor = addDaysToLocalDate(today, -MAX_FILL_DAYS);
    const from = addDaysToLocalDate(watermark < capFloor ? capFloor : watermark, 1);
    let created = 0;
    if (from <= yesterday) {
      created = (
        await ensureZeroBuckets(deps.dayBuckets, enumerateLocalDates(from, yesterday))
      ).length;
    }
    await deps.kv.set(FILL_WATERMARK_KEY, yesterday);
    return created;
  }

  async function run(): Promise<SealRunResult> {
    const none = { uploaded: 0, alreadySealed: 0, failed: 0, zeroFilled: 0 };
    if (!deps.syncEnabled()) {
      // Sync off: no zero-fill, no seal, no upload — days stay editable.
      return { status: 'sync-off', ...none };
    }

    const now = deps.clock.now();
    const today = localDateOf(now, deps.timeZone());
    const yesterday = addDaysToLocalDate(today, -1);
    const zeroFilled = await zeroFill(today, yesterday);

    let userId: UserId;
    try {
      userId = await deps.getUserId();
    } catch {
      return { status: 'auth-unavailable', ...none, zeroFilled };
    }

    const toSeal = await selectDaysToSeal(deps.dayBuckets, {
      today,
      userId,
      sealedAt: now,
    });

    let uploaded = 0;
    let alreadySealed = 0;
    let failed = 0;
    for (const stat of toSeal) {
      // Defense in depth for "never upload today" (selectDaysToSeal already
      // filters `< today`).
      if (stat.date >= today) continue;
      let outcome: UploadOutcome;
      try {
        outcome = await deps.upload(stat);
      } catch {
        // Transport/auth failure — leave this and the remaining days
        // unsealed; the next trigger retries.
        failed = toSeal.length - uploaded - alreadySealed;
        break;
      }
      await markSealed(deps.dayBuckets, [stat.date], now);
      if (outcome === 'created') uploaded += 1;
      else alreadySealed += 1;
    }

    return { status: 'ran', uploaded, alreadySealed, failed, zeroFilled };
  }

  return {
    runOnce() {
      // Single-flight: overlapping triggers share one run.
      running ??= run()
        .catch((): SealRunResult => ({
          // Unexpected local failure (e.g. storage) — swallow, retry later.
          status: 'auth-unavailable',
          uploaded: 0,
          alreadySealed: 0,
          failed: 0,
          zeroFilled: 0,
        }))
        .finally(() => {
          running = undefined;
        });
      return running;
    },
  };
}
