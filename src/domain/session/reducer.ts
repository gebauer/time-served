/**
 * Session state machine (BUILD_V1 §6) as a PURE reducer.
 *
 * `reduce` never touches storage or the runtime — it returns the next state
 * plus a list of declarative `Effect`s that the engine (`engine.ts`) executes
 * in array order, awaiting each. Two ordering rules matter:
 *
 * 1. THE invariant (CLAUDE.md §3): on ARMED + CHARGING_STARTED the reducer
 *    emits `PERSIST_OPEN_SESSION` as the FIRST (and only) effect, so
 *    `started_at` hits the repository before anything else can happen.
 * 2. On close, `CLOSE_SESSION` precedes `RECOMPUTE_BUCKETS` precedes
 *    `STOP_RUNTIME` — buckets rebuild from the closed row, and liveness is
 *    released last.
 *
 * ARM_TIMEOUT is consumed here but SCHEDULED by the wiring (J9): the reducer
 * never sets timers. A stale ARM_TIMEOUT arriving outside ARMED is ignored.
 *
 * Timestamps come from the events themselves (adapters stamp `at` at the
 * source); ids come from the injected `IdSource`, so `reduce` is deterministic
 * under test.
 */
import type {
  BoxId,
  DomainEvent,
  EpochMs,
  IdSource,
  SessionEndReason,
  SessionId,
  SessionState,
} from '../types';

// ---------------------------------------------------------------------------
// Effects — declarative descriptions the engine executes
// ---------------------------------------------------------------------------

export type Effect =
  /** THE invariant write: SessionRepository.createOpen, awaited before all else. */
  | {
      readonly type: 'PERSIST_OPEN_SESSION';
      readonly sessionId: SessionId;
      readonly boxId: BoxId;
      readonly startedAt: EpochMs;
    }
  /** SessionRepository.recordHeartbeat — last_charging_at watermark. */
  | { readonly type: 'RECORD_HEARTBEAT'; readonly sessionId: SessionId; readonly at: EpochMs }
  /** SessionRepository.close. */
  | {
      readonly type: 'CLOSE_SESSION';
      readonly sessionId: SessionId;
      readonly endedAt: EpochMs;
      readonly endReason: SessionEndReason;
    }
  /** Rebuild day_buckets for the local dates touched by [fromMs, toMs]. */
  | { readonly type: 'RECOMPUTE_BUCKETS'; readonly fromMs: EpochMs; readonly toMs: EpochMs }
  /**
   * ARMED ended without a session. Nothing was persisted in ARMED (BUILD_V1
   * §6), so this is informational (log/UI toast) — the engine treats it as a
   * no-op on storage.
   */
  | { readonly type: 'DISCARD'; readonly boxId: BoxId }
  /**
   * Start/refresh platform liveness (Android FGS). Carries the boxId; the
   * engine resolves the box label for the notification. Idempotent per the
   * SessionRuntime contract — re-arming emits it again with the new box.
   */
  | { readonly type: 'START_RUNTIME'; readonly boxId: BoxId }
  | { readonly type: 'STOP_RUNTIME' }
  /** Run reconciliation (reconcile.ts) — emitted for APP_RESUMED in any state. */
  | { readonly type: 'RECONCILE'; readonly at: EpochMs };

export interface Transition {
  readonly state: SessionState;
  readonly effects: readonly Effect[];
}

const IDLE: SessionState = { kind: 'IDLE' };

function unchanged(state: SessionState): Transition {
  return { state, effects: [] };
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function reduce(
  state: SessionState,
  event: DomainEvent,
  ids: IdSource,
): Transition {
  switch (event.type) {
    case 'TAG_READ': {
      if (state.kind === 'IDLE' || state.kind === 'ARMED') {
        // IDLE → arm; ARMED → re-arm (switch box or refresh the timeout on
        // the same box). START_RUNTIME again so the notification follows.
        return {
          state: { kind: 'ARMED', boxId: event.boxId, armedAt: event.at },
          effects: [{ type: 'START_RUNTIME', boxId: event.boxId }],
        };
      }
      // ACTIVE: a session is running — re-reading a tag (same box or another)
      // must not restart or switch anything. Ignore.
      return unchanged(state);
    }

    case 'CHARGING_STARTED': {
      if (state.kind !== 'ARMED') return unchanged(state); // no box context → no count
      // reason: designated creation point of a SessionId from the injected IdSource
      const sessionId = ids.newId() as SessionId;
      return {
        state: {
          kind: 'ACTIVE',
          boxId: state.boxId,
          sessionId,
          startedAt: event.at,
        },
        // PERSIST_OPEN_SESSION MUST be effects[0] — CLAUDE.md §3.
        effects: [
          {
            type: 'PERSIST_OPEN_SESSION',
            sessionId,
            boxId: state.boxId,
            startedAt: event.at,
          },
        ],
      };
    }

    case 'CHARGING_HEARTBEAT': {
      if (state.kind !== 'ACTIVE') return unchanged(state);
      return {
        state,
        effects: [{ type: 'RECORD_HEARTBEAT', sessionId: state.sessionId, at: event.at }],
      };
    }

    case 'CHARGING_STOPPED': {
      if (state.kind !== 'ACTIVE') return unchanged(state);
      return {
        state: IDLE,
        effects: [
          {
            type: 'CLOSE_SESSION',
            sessionId: state.sessionId,
            endedAt: event.at,
            endReason: 'unplug',
          },
          { type: 'RECOMPUTE_BUCKETS', fromMs: state.startedAt, toMs: event.at },
          { type: 'STOP_RUNTIME' },
        ],
      };
    }

    case 'ARM_TIMEOUT': {
      if (state.kind !== 'ARMED') return unchanged(state); // stale timer
      return {
        state: IDLE,
        effects: [{ type: 'DISCARD', boxId: state.boxId }, { type: 'STOP_RUNTIME' }],
      };
    }

    case 'APP_RESUMED':
      // Any state: reconcile (BUILD_V1 §7). The machine state itself does not
      // change here; the engine transitions ACTIVE → IDLE if reconciliation
      // closed the very session the machine believed was running.
      return { state, effects: [{ type: 'RECONCILE', at: event.at }] };
  }
}
