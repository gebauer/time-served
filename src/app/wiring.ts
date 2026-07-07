/**
 * Wiring helpers for the composition root (J8 scaffold, finalized by J9) —
 * engine handle with change subscription, change notifier, dev offset clock,
 * uuid source, and the adapter→engine event plumbing: §9.2 tag resolution,
 * ARM_TIMEOUT scheduling, 1:1 power mapping, and the exclusive wizard
 * TagWriter gate. Pure TS; no native imports — everything here is unit-tested
 * on plain Node (wiring.test.ts). The adapter INSTANCES and the APP_RESUMED /
 * launch-by-tag hooks (native APIs) live in services.ts.
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
import type { BoxRepository, Repositories } from '../data/Repositories';
import type { PowerStateProvider } from '../platform/PowerStateProvider';
import type {
  TagPayload,
  TagReader,
  TagWriteResult,
  TagWriter,
} from '../platform/TagReader';
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
// Tag payload → TAG_READ (BUILD_V1 §9.2 step 2 — the no-dialog path)
// ---------------------------------------------------------------------------

export interface TagPayloadHandlerOptions {
  readonly engine: Pick<EngineHandle, 'dispatch'>;
  readonly boxes: BoxRepository;
  readonly clock: Clock;
  /**
   * Optional §9.2 one-shot info hook, fired AFTER a foreign box was auto-created
   * ("Neue Box ‚<label>' erkannt"). Called fire-and-forget and never awaited —
   * it can never delay or fail the TAG_READ flow. The composition root passes
   * the local-notification implementation (src/app/notifications.ts).
   */
  readonly onForeignBoxCreated?: (label: string) => void;
}

/** Fallback label for a foreign tag whose text record is missing/empty. */
export const UNKNOWN_BOX_LABEL = 'Unbekannte Box';

/**
 * Resolve one parsed tag payload against the local `boxes` table and dispatch
 * TAG_READ (§9.2): a known UUID dispatches directly; an unknown-but-valid one
 * first auto-creates a local box from the tag's own label with
 * `origin='foreign'` — no dialog, the name is already on the tag.
 *
 * Because a TAG_READ only ever originates from a foreground read (NFC needs an
 * unlocked, visible screen — CLAUDE.md §4; the launch-by-tag intent has just
 * foregrounded the activity), the engine's START_RUNTIME effect always runs
 * while the app is foreground, which is what makes the FGS start legal.
 */
export function createTagPayloadHandler(
  options: TagPayloadHandlerOptions,
): (payload: TagPayload) => Promise<void> {
  return async (payload: TagPayload) => {
    // reason: the payload's box UUID is the BoxId by construction (§9.1)
    const boxId = payload.boxUuid as BoxId;
    const known = await options.boxes.get(boxId);
    if (known === undefined) {
      const label =
        payload.label !== undefined && payload.label !== '' ? payload.label : UNKNOWN_BOX_LABEL;
      await options.boxes.create({
        id: boxId,
        label,
        countMode: 'charging',
        origin: 'foreign',
      });
      // §9.2 one-shot info notification — fire-and-forget, never blocks TAG_READ.
      try {
        options.onForeignBoxCreated?.(label);
      } catch {
        // Informational only; a throwing hook must not break the session flow.
      }
    }
    await options.engine.dispatch({ type: 'TAG_READ', boxId, at: options.clock.now() });
  };
}

// ---------------------------------------------------------------------------
// ARM_TIMEOUT scheduling (BUILD_V1 §6 — the reducer never sets timers)
// ---------------------------------------------------------------------------

export interface ArmTimeoutSchedulerOptions {
  readonly engine: Pick<EngineHandle, 'getState' | 'dispatch'>;
  readonly clock: Clock;
  /** Read live at schedule time so Settings changes apply to the next arm. */
  readonly armTimeoutSec: () => number;
  /** Injectable timers for tests; default global setTimeout/clearTimeout. */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
}

export interface ArmTimeoutScheduler {
  /** Feed every post-dispatch machine state (engine.subscribe) into this. */
  onState(state: SessionState): void;
  dispose(): void;
}

/**
 * One-shot arm-window timer keyed on the ARMED instance `(boxId, armedAt)`:
 * entering ARMED schedules, re-arming (fresh `armedAt` by reducer construction)
 * cancels + reschedules, leaving ARMED cancels. Repeated dispatches that leave
 * the SAME ARMED instance in place (e.g. an ignored heartbeat) do NOT reset the
 * window. When the timer fires it re-checks the live machine state and stays
 * silent unless the exact same ARMED instance is still current — a stale timer
 * can never kill a newer arm window (and the reducer ignores stale ARM_TIMEOUT
 * anyway).
 *
 * This is the arm-window timer, NOT a session-measuring clock — CLAUDE.md §3
 * still holds: session durations derive from persisted timestamps only.
 */
export function createArmTimeoutScheduler(
  options: ArmTimeoutSchedulerOptions,
): ArmTimeoutScheduler {
  const setTimer =
    options.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ??
    ((handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let scheduled: { boxId: BoxId; armedAt: EpochMs; handle: unknown } | undefined;

  function cancel(): void {
    if (scheduled !== undefined) {
      clearTimer(scheduled.handle);
      scheduled = undefined;
    }
  }

  return {
    onState(state: SessionState): void {
      if (state.kind !== 'ARMED') {
        cancel();
        return;
      }
      if (
        scheduled !== undefined &&
        scheduled.boxId === state.boxId &&
        scheduled.armedAt === state.armedAt
      ) {
        return; // same arm window — never extend it
      }
      cancel();
      const key = { boxId: state.boxId, armedAt: state.armedAt };
      const handle = setTimer(() => {
        scheduled = undefined;
        const current = options.engine.getState();
        if (
          current.kind === 'ARMED' &&
          current.boxId === key.boxId &&
          current.armedAt === key.armedAt
        ) {
          void options.engine.dispatch({ type: 'ARM_TIMEOUT', at: options.clock.now() });
        }
      }, options.armTimeoutSec() * 1000);
      scheduled = { ...key, handle };
    },
    dispose: cancel,
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
  /** See TagPayloadHandlerOptions.onForeignBoxCreated. */
  readonly onForeignBoxCreated?: (label: string) => void;
}

/**
 * Subscribes the platform seams to the engine:
 * - power events map 1:1 onto domain events — the provider stream is already
 *   normalized (CONTRACT_CHANGES.md #7), no extra dedupe here;
 * - tag payloads run createTagPayloadHandler (§9.2 resolution above);
 * - ARM_TIMEOUT runs on createArmTimeoutScheduler (above).
 *
 * Returns a disposer. APP_RESUMED is NOT wired here (it needs the native
 * AppState API): the composition root (services.ts) owns it.
 */
export function wireAdapters(options: WireAdaptersOptions): () => void {
  const { engine, tagReader, power, repositories, clock } = options;

  const unsubscribePower = power.subscribe((event) => {
    void engine.dispatch({ type: event.type, at: event.at });
  });

  const handleTagPayload = createTagPayloadHandler({
    engine,
    boxes: repositories.boxes,
    clock,
    onForeignBoxCreated: options.onForeignBoxCreated,
  });
  const unsubscribeTags = tagReader.subscribe((payload: TagPayload) => {
    void handleTagPayload(payload);
  });

  const armScheduler = createArmTimeoutScheduler({
    engine,
    clock,
    armTimeoutSec: options.armTimeoutSec,
  });
  const unsubscribeState = engine.subscribe((state) => {
    armScheduler.onState(state);
  });

  return () => {
    unsubscribePower();
    unsubscribeTags();
    unsubscribeState();
    armScheduler.dispose();
  };
}

// ---------------------------------------------------------------------------
// Wizard write steps vs. passive reader mode (AndroidTagWriter header: "run
// the wizard with the passive AndroidTagReader stopped — J9 wiring")
// ---------------------------------------------------------------------------

/** The start/stop subset of TagReader the exclusive writer needs. */
export type StartStoppable = Pick<TagReader, 'start' | 'stop'>;

/**
 * Wraps a TagWriter so every write step runs with the passive reader stopped:
 * `beginWriteStep` first stops the reader, then starts the inner step; the
 * reader is restarted after `proceed()` settles or on `cancel()`. Restart
 * failures are swallowed (NFC may have been disabled mid-wizard) — the next
 * bootstrap or an explicit UI retry owns recovery.
 */
export function createExclusiveTagWriter(
  inner: TagWriter,
  reader: StartStoppable,
): TagWriter {
  return {
    beginWriteStep(request, onTagState) {
      let innerStep:
        | { proceed: () => Promise<TagWriteResult>; cancel: () => void }
        | undefined;
      let cancelled = false;

      const ready: Promise<void> = reader
        .stop()
        .catch(() => undefined) // stopping must never block the wizard
        .then(() => {
          if (!cancelled) innerStep = inner.beginWriteStep(request, onTagState);
        });
      const restartReader = (): void => {
        void reader.start().catch(() => undefined);
      };

      return {
        async proceed(): Promise<TagWriteResult> {
          await ready;
          if (innerStep === undefined) return { ok: false, error: 'tag-lost' };
          try {
            return await innerStep.proceed();
          } finally {
            restartReader();
          }
        },
        cancel(): void {
          cancelled = true;
          void ready.then(() => {
            innerStep?.cancel();
            restartReader();
          });
        },
      };
    },
  };
}
