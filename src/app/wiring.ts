/**
 * Generic wiring helpers for the composition root — engine handle with change
 * subscription, change notifier, dev offset clock, uuid source, and the
 * adapter→engine event plumbing. Pure TS; no native imports, so J9 can keep
 * all of this and swap only the adapter INSTANCES in services.ts.
 */
import type { SessionEngine } from '../domain/session';
import type {
  BoxId,
  Clock,
  DomainEvent,
  EpochMs,
  IdSource,
  SessionState,
} from '../domain/types';
import type { Repositories } from '../data/Repositories';
import type { PowerStateProvider } from '../platform/PowerStateProvider';
import type { TagPayload, TagReader } from '../platform/TagReader';
import type { ChangeNotifier, EngineHandle } from '../ui/services/AppServicesContext';

// ---------------------------------------------------------------------------
// Change notifier
// ---------------------------------------------------------------------------

export function createChangeNotifier(): ChangeNotifier {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify() {
      for (const listener of [...listeners]) listener();
    },
  };
}

// ---------------------------------------------------------------------------
// Clock & ids
// ---------------------------------------------------------------------------

/** System clock plus an adjustable offset — the dev harness time-travel knob. */
export class OffsetClock implements Clock {
  private offsetMs = 0;
  now(): EpochMs {
    return Date.now() + this.offsetMs;
  }
  advance(ms: number): void {
    this.offsetMs += ms;
  }
  reset(): void {
    this.offsetMs = 0;
  }
  get offset(): number {
    return this.offsetMs;
  }
}

/** UUID v4 via Math.random — sufficient for local ids (CLAUDE.md §7). */
export function createUuidSource(): IdSource {
  return {
    newId(): string {
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.floor(Math.random() * 16);
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Engine handle — dispatch queue + change subscription for the UI
// ---------------------------------------------------------------------------

export function createEngineHandle(
  engine: SessionEngine,
  events: ChangeNotifier,
): EngineHandle {
  const listeners = new Set<(state: SessionState) => void>();
  return {
    getState: () => engine.getState(),
    async dispatch(event: DomainEvent): Promise<SessionState> {
      const state = await engine.dispatch(event);
      for (const listener of [...listeners]) listener(state);
      // Any dispatch may have touched sessions/buckets — wake the query hooks.
      events.notify();
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter → engine plumbing
// ---------------------------------------------------------------------------

export interface WireAdaptersOptions {
  readonly engine: EngineHandle;
  readonly tagReader: TagReader;
  readonly power: PowerStateProvider;
  readonly repositories: Repositories;
  readonly clock: Clock;
  /** Read live so Settings changes apply without rewiring. */
  readonly armTimeoutSec: () => number;
}

/**
 * Subscribes the platform seams to the engine:
 * - power events map 1:1 onto domain events (CONTRACT_CHANGES.md #7);
 * - tag payloads resolve against the boxes table; an unknown-but-valid tag
 *   auto-creates an `origin='foreign'` box (provisional §9.2 wiring — J9 owns
 *   the final decision incl. the info notification);
 * - ARM_TIMEOUT is scheduled here (the reducer never sets timers): entering
 *   ARMED starts a one-shot timer, leaving ARMED clears it. This is the arm
 *   window timer, NOT a session-measuring clock (CLAUDE.md §3 still holds:
 *   sessions derive from persisted timestamps only).
 */
export function wireAdapters(options: WireAdaptersOptions): () => void {
  const { engine, tagReader, power, repositories, clock } = options;

  const unsubscribePower = power.subscribe((event) => {
    void engine.dispatch({ type: event.type, at: event.at });
  });

  const unsubscribeTags = tagReader.subscribe((payload: TagPayload) => {
    void (async () => {
      // reason: the payload's box UUID is the BoxId by construction (§9.1)
      const boxId = payload.boxUuid as BoxId;
      const known = await repositories.boxes.get(boxId);
      if (known === undefined) {
        await repositories.boxes.create({
          id: boxId,
          label: payload.label ?? 'Unbekannte Box',
          countMode: 'charging',
          origin: 'foreign',
        });
      }
      await engine.dispatch({ type: 'TAG_READ', boxId, at: clock.now() });
    })();
  });

  let armTimer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribeState = engine.subscribe((state) => {
    if (armTimer !== undefined) {
      clearTimeout(armTimer);
      armTimer = undefined;
    }
    if (state.kind === 'ARMED') {
      armTimer = setTimeout(() => {
        armTimer = undefined;
        void engine.dispatch({ type: 'ARM_TIMEOUT', at: clock.now() });
      }, options.armTimeoutSec() * 1000);
    }
  });

  return () => {
    unsubscribePower();
    unsubscribeTags();
    unsubscribeState();
    if (armTimer !== undefined) clearTimeout(armTimer);
  };
}
