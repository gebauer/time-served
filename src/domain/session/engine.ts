/**
 * Session engine — owns the machine state and executes the reducer's effects
 * against the injected ports. This is the exact object the J9 wiring drives:
 * adapters translate native callbacks into `DomainEvent`s and call
 * `engine.dispatch(event)`; nothing else ever mutates session rows
 * (CLAUDE.md §7).
 *
 * Guarantees:
 * - Effects run SEQUENTIALLY in reducer order, each awaited. Since the reducer
 *   emits `PERSIST_OPEN_SESSION` first, `started_at` is durably queued before
 *   any other effect of that transition (CLAUDE.md §3).
 * - If the invariant write itself fails, the engine rolls the machine back to
 *   its previous state and rethrows — there is never an ACTIVE state without a
 *   persisted open row.
 * - `dispatch` calls are serialized on an internal queue, so a burst of events
 *   (heartbeat + unplug + resume) can never interleave their effects.
 * - APP_RESUMED runs reconciliation (reconcile.ts); if it closed the very
 *   session the machine believed ACTIVE, the engine drops to IDLE and stops
 *   the runtime.
 */
import type {
  BoxRepository,
  DayBucketRepository,
  SessionRepository,
} from '../../data/Repositories';
import type { SessionRuntime } from '../../platform/SessionRuntime';
import { recomputeRange } from '../buckets';
import type { BoxId, BucketConfig, Clock, DomainEvent, IdSource, SessionState } from '../types';
import { reconcile } from './reconcile';
import { reduce, type Effect } from './reducer';

export interface SessionEngineDeps {
  readonly sessions: SessionRepository;
  readonly boxes: BoxRepository;
  readonly dayBuckets: DayBucketRepository;
  /** Platform liveness seam (Android FGS; no-op on iOS). */
  readonly runtime: SessionRuntime;
  /** Platform charging probe, used only by reconciliation. */
  readonly isCharging: () => Promise<boolean>;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly bucketConfig: BucketConfig;
}

export interface SessionEngine {
  getState(): SessionState;
  /** Apply one domain event; resolves with the state after all effects ran. */
  dispatch(event: DomainEvent): Promise<SessionState>;
}

const IDLE: SessionState = { kind: 'IDLE' };

export function createSessionEngine(
  deps: SessionEngineDeps,
  initialState: SessionState = IDLE,
): SessionEngine {
  let state = initialState;
  let queue: Promise<unknown> = Promise.resolve();

  async function notificationLabel(boxId: BoxId): Promise<string> {
    const box = await deps.boxes.get(boxId);
    return box?.label ?? String(boxId);
  }

  async function runEffect(effect: Effect): Promise<void> {
    switch (effect.type) {
      case 'PERSIST_OPEN_SESSION':
        await deps.sessions.createOpen({
          id: effect.sessionId,
          boxId: effect.boxId,
          startedAt: effect.startedAt,
        });
        return;
      case 'RECORD_HEARTBEAT':
        await deps.sessions.recordHeartbeat(effect.sessionId, effect.at);
        return;
      case 'CLOSE_SESSION':
        await deps.sessions.close(effect.sessionId, {
          endedAt: effect.endedAt,
          endReason: effect.endReason,
        });
        return;
      case 'RECOMPUTE_BUCKETS':
        await recomputeRange(
          { sessions: deps.sessions, dayBuckets: deps.dayBuckets },
          deps.bucketConfig,
          effect.fromMs,
          effect.toMs,
        );
        return;
      case 'DISCARD':
        // ARMED persisted nothing (BUILD_V1 §6) — nothing to undo.
        return;
      case 'START_RUNTIME':
        await deps.runtime.start({ boxLabel: await notificationLabel(effect.boxId) });
        return;
      case 'STOP_RUNTIME':
        await deps.runtime.stop();
        return;
      case 'RECONCILE': {
        const result = await reconcile(state, {
          sessions: deps.sessions,
          dayBuckets: deps.dayBuckets,
          isCharging: deps.isCharging,
          clock: deps.clock,
          bucketConfig: deps.bucketConfig,
        });
        const current = state;
        if (
          current.kind === 'ACTIVE' &&
          result.closed.some((session) => session.id === current.sessionId)
        ) {
          // The session this machine believed was running is gone.
          state = IDLE;
          await deps.runtime.stop();
        }
        return;
      }
    }
  }

  async function process(event: DomainEvent): Promise<SessionState> {
    const previous = state;
    const transition = reduce(state, event, deps.ids);
    state = transition.state;
    for (const effect of transition.effects) {
      try {
        await runEffect(effect);
      } catch (error) {
        if (effect.type === 'PERSIST_OPEN_SESSION') {
          // Invariant write failed → we must not sit in ACTIVE without a row.
          state = previous;
        }
        throw error;
      }
    }
    return state;
  }

  return {
    getState: () => state,
    dispatch(event: DomainEvent): Promise<SessionState> {
      const run = queue.then(() => process(event));
      queue = run.then(
        () => undefined,
        () => undefined, // a failed dispatch must not wedge the queue
      );
      return run;
    },
  };
}
