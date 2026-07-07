/**
 * Reconciliation (BUILD_V1 §7) — the mandatory safety net, run on every
 * APP_RESUMED. Because `started_at` is persisted the instant a session starts
 * (CLAUDE.md §3), a killed process / missed unplug costs precision, never the
 * session:
 *
 *   for each open session:
 *     still charging AND its box is the currently armed/active box → keep;
 *     otherwise → close with ended_at = last_charging_at ?? started_at,
 *     end_reason = 'reconciled'.
 *   then recompute dirty buckets.
 *
 * Pure over the repository interfaces + an injected `isCharging` probe — this
 * is the mechanism iOS relies on entirely (no FGS there).
 */
import type { DayBucketRepository, SessionRepository } from '../../data/Repositories';
import { localDatesInRange, recomputeDates, type RecomputeResult } from '../buckets';
import type { BucketConfig, Clock, LocalDate, Session, SessionState } from '../types';

export interface ReconcileDeps {
  readonly sessions: SessionRepository;
  readonly dayBuckets: DayBucketRepository;
  /** Platform probe (PowerStateProvider behind the seam), injected. */
  readonly isCharging: () => Promise<boolean>;
  readonly clock: Clock;
  readonly bucketConfig: BucketConfig;
}

export interface ReconcileResult {
  /** Sessions closed with end_reason='reconciled' (post-close shape). */
  readonly closed: readonly Session[];
  /** Open sessions left running (still charging in the current box). */
  readonly kept: readonly Session[];
  readonly buckets: RecomputeResult;
}

export async function reconcile(
  machineState: SessionState,
  deps: ReconcileDeps,
): Promise<ReconcileResult> {
  const open = await deps.sessions.findOpen();
  const charging = open.length > 0 ? await deps.isCharging() : false;
  const currentBoxId =
    machineState.kind === 'ARMED' || machineState.kind === 'ACTIVE'
      ? machineState.boxId
      : undefined;

  const closed: Session[] = [];
  const kept: Session[] = [];
  const dirtyDates = new Set<LocalDate>();

  for (const session of open) {
    if (charging && currentBoxId !== undefined && session.boxId === currentBoxId) {
      kept.push(session); // really still running
      continue;
    }
    // Missed unplug: bound the loss to the last known charging moment.
    // (createdAt is a defensive fallback — an open row always has startedAt.)
    const lastKnown = session.lastChargingAt ?? session.startedAt ?? session.createdAt;
    const endedAt = Math.max(lastKnown, session.startedAt ?? lastKnown);
    await deps.sessions.close(session.id, { endedAt, endReason: 'reconciled' });
    closed.push({
      ...session,
      status: 'closed',
      endedAt,
      endReason: 'reconciled',
      updatedAt: deps.clock.now(),
    });
    const fromMs = session.startedAt ?? endedAt;
    for (const date of localDatesInRange(fromMs, endedAt, deps.bucketConfig.timeZone)) {
      dirtyDates.add(date);
    }
  }

  if (dirtyDates.size > 0) {
    await deps.dayBuckets.markDirty([...dirtyDates]);
  }
  // Recompute everything dirty — the dates just closed plus any leftovers from
  // earlier crashes. Sealed dates are skipped inside (immutable).
  const alreadyDirty = await deps.dayBuckets.findDirty();
  const buckets = await recomputeDates(
    { sessions: deps.sessions, dayBuckets: deps.dayBuckets },
    deps.bucketConfig,
    [...dirtyDates, ...alreadyDirty.map((bucket) => bucket.date)],
  );

  return { closed, kept, buckets };
}
