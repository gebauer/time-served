/**
 * J9 wiring tests — the pure adapter→engine plumbing on plain Node:
 * tag-payload resolution (§9.2), ARM_TIMEOUT scheduling, the 1:1 power-event
 * mapping through wireAdapters, and the exclusive wizard TagWriter gate.
 */
import { describe, expect, it } from 'vitest';

import { FakeClock, makeInMemoryRepositories } from '../domain/testing/fakes';
import type { BoxId, DomainEvent, EpochMs, SessionState } from '../domain/types';
import { FakePowerStateProvider, FakeTagReader } from '../platform/fakes';
import type {
  TagState,
  TagWriteRequest,
  TagWriteResult,
  TagWriter,
} from '../platform/TagReader';
import type { EngineHandle } from '../ui/services/AppServicesContext';
import {
  createArmTimeoutScheduler,
  createExclusiveTagWriter,
  createTagPayloadHandler,
  UNKNOWN_BOX_LABEL,
  wireAdapters,
} from './wiring';

const BOX_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

/** Recording engine stub — enough EngineHandle for the wiring helpers. */
function makeEngineStub(initial: SessionState = { kind: 'IDLE' }) {
  const dispatched: DomainEvent[] = [];
  const listeners = new Set<(state: SessionState) => void>();
  let state: SessionState = initial;
  const engine: EngineHandle = {
    getState: () => state,
    async dispatch(event: DomainEvent): Promise<SessionState> {
      dispatched.push(event);
      for (const listener of [...listeners]) listener(state);
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  return {
    engine,
    dispatched,
    setState(next: SessionState) {
      state = next;
    },
    emitState(next: SessionState) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

// ---------------------------------------------------------------------------
// createTagPayloadHandler — §9.2 resolution
// ---------------------------------------------------------------------------

describe('createTagPayloadHandler', () => {
  function setup() {
    const clock = new FakeClock(1_000 as EpochMs);
    const repos = makeInMemoryRepositories(clock);
    const stub = makeEngineStub();
    const handle = createTagPayloadHandler({
      engine: stub.engine,
      boxes: repos.boxes,
      clock,
    });
    return { clock, repos, stub, handle };
  }

  it('dispatches TAG_READ for a known box without creating anything', async () => {
    const { repos, stub, handle } = setup();
    await repos.boxes.create({
      id: BOX_UUID as BoxId,
      label: 'Küche',
      countMode: 'charging',
      origin: 'own',
    });

    await handle({ boxUuid: BOX_UUID, label: 'Küche', version: 1 });

    expect(stub.dispatched).toEqual([
      { type: 'TAG_READ', boxId: BOX_UUID, at: 1_000 },
    ]);
    expect(repos.boxes.rows.size).toBe(1);
    expect(repos.boxes.rows.get(BOX_UUID as BoxId)?.origin).toBe('own');
  });

  it('auto-creates an origin=foreign box from the tag label, then TAG_READ (no dialog)', async () => {
    const { repos, stub, handle } = setup();

    await handle({ boxUuid: BOX_UUID, label: 'Büro', version: 1 });

    const created = repos.boxes.rows.get(BOX_UUID as BoxId);
    expect(created).toMatchObject({
      id: BOX_UUID,
      label: 'Büro',
      origin: 'foreign',
      countMode: 'charging',
    });
    expect(stub.dispatched).toEqual([
      { type: 'TAG_READ', boxId: BOX_UUID, at: 1_000 },
    ]);
  });

  it('creates the box BEFORE dispatching (engine can resolve the FGS label)', async () => {
    const clock = new FakeClock(1_000 as EpochMs);
    const log: string[] = [];
    const repos = makeInMemoryRepositories(clock, log);
    const stub = makeEngineStub();
    const original = stub.engine.dispatch.bind(stub.engine);
    const engine: EngineHandle = {
      ...stub.engine,
      dispatch(event) {
        log.push(`dispatch(${event.type})`);
        return original(event);
      },
    };
    const handle = createTagPayloadHandler({ engine, boxes: repos.boxes, clock });

    await handle({ boxUuid: BOX_UUID, label: 'Büro', version: 1 });

    expect(log).toEqual([`boxes.create(${BOX_UUID})`, 'dispatch(TAG_READ)']);
  });

  it('falls back to the unknown-box label when the tag has no/empty text record', async () => {
    const { repos, handle } = setup();

    await handle({ boxUuid: BOX_UUID, version: 1 });
    expect(repos.boxes.rows.get(BOX_UUID as BoxId)?.label).toBe(UNKNOWN_BOX_LABEL);

    const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await handle({ boxUuid: other, label: '', version: 1 });
    expect(repos.boxes.rows.get(other as BoxId)?.label).toBe(UNKNOWN_BOX_LABEL);
  });
});

// ---------------------------------------------------------------------------
// createArmTimeoutScheduler
// ---------------------------------------------------------------------------

interface FakeTimer {
  readonly fn: () => void;
  readonly ms: number;
  cleared: boolean;
}

function makeFakeTimers() {
  const timers: FakeTimer[] = [];
  return {
    timers,
    setTimer(fn: () => void, ms: number): unknown {
      const timer: FakeTimer = { fn, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(handle: unknown): void {
      (handle as FakeTimer).cleared = true;
    },
    /** Fire a timer as the JS event loop would (no-op when cleared). */
    fire(timer: FakeTimer): void {
      if (!timer.cleared) timer.fn();
    },
  };
}

const ARMED_A: SessionState = {
  kind: 'ARMED',
  boxId: BOX_UUID as BoxId,
  armedAt: 1_000 as EpochMs,
};

describe('createArmTimeoutScheduler', () => {
  function setup(armTimeoutSec = 120) {
    const clock = new FakeClock(5_000 as EpochMs);
    const stub = makeEngineStub();
    const fakeTimers = makeFakeTimers();
    const scheduler = createArmTimeoutScheduler({
      engine: stub.engine,
      clock,
      armTimeoutSec: () => armTimeoutSec,
      setTimer: fakeTimers.setTimer,
      clearTimer: fakeTimers.clearTimer,
    });
    return { clock, stub, fakeTimers, scheduler };
  }

  it('schedules a one-shot timer with armTimeoutSec on entering ARMED', () => {
    const { fakeTimers, scheduler } = setup(90);
    scheduler.onState(ARMED_A);
    expect(fakeTimers.timers).toHaveLength(1);
    expect(fakeTimers.timers[0].ms).toBe(90_000);
  });

  it('fires ARM_TIMEOUT when the same ARMED instance is still current', () => {
    const { stub, fakeTimers, scheduler } = setup();
    stub.setState(ARMED_A);
    scheduler.onState(ARMED_A);

    fakeTimers.fire(fakeTimers.timers[0]);

    expect(stub.dispatched).toEqual([{ type: 'ARM_TIMEOUT', at: 5_000 }]);
  });

  it('does NOT reset the window when the same ARMED instance repeats (e.g. ignored events)', () => {
    const { fakeTimers, scheduler } = setup();
    scheduler.onState(ARMED_A);
    scheduler.onState(ARMED_A); // post-dispatch callback for an ignored event
    expect(fakeTimers.timers).toHaveLength(1);
    expect(fakeTimers.timers[0].cleared).toBe(false);
  });

  it('re-arm cancels the old timer and schedules a fresh one', () => {
    const { stub, fakeTimers, scheduler } = setup();
    scheduler.onState(ARMED_A);
    const rearmed: SessionState = { ...ARMED_A, armedAt: 2_000 as EpochMs };
    stub.setState(rearmed);
    scheduler.onState(rearmed);

    expect(fakeTimers.timers).toHaveLength(2);
    expect(fakeTimers.timers[0].cleared).toBe(true);
    expect(fakeTimers.timers[1].cleared).toBe(false);

    // The old timer can no longer fire; the new one targets the new instance.
    fakeTimers.fire(fakeTimers.timers[0]);
    expect(stub.dispatched).toEqual([]);
    fakeTimers.fire(fakeTimers.timers[1]);
    expect(stub.dispatched).toEqual([{ type: 'ARM_TIMEOUT', at: 5_000 }]);
  });

  it('cancels on leaving ARMED and stays silent on a stale fire', () => {
    const { stub, fakeTimers, scheduler } = setup();
    scheduler.onState(ARMED_A);
    stub.setState({ kind: 'IDLE' });
    scheduler.onState({ kind: 'IDLE' });
    expect(fakeTimers.timers[0].cleared).toBe(true);

    // Even a timer that somehow fired anyway re-checks the live state.
    fakeTimers.timers[0].cleared = false;
    fakeTimers.fire(fakeTimers.timers[0]);
    expect(stub.dispatched).toEqual([]);
  });

  it('a raced fire against a NEWER ARMED instance is ignored', () => {
    const { stub, fakeTimers, scheduler } = setup();
    stub.setState(ARMED_A);
    scheduler.onState(ARMED_A);
    // Re-arm happened but the old callback was already queued: state moved on.
    stub.setState({ ...ARMED_A, armedAt: 9_999 as EpochMs });
    fakeTimers.timers[0].cleared = false; // simulate the callback already queued
    fakeTimers.fire(fakeTimers.timers[0]);
    expect(stub.dispatched).toEqual([]);
  });

  it('dispose cancels a pending timer', () => {
    const { fakeTimers, scheduler } = setup();
    scheduler.onState(ARMED_A);
    scheduler.dispose();
    expect(fakeTimers.timers[0].cleared).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// wireAdapters — power 1:1 + tag stream + disposer
// ---------------------------------------------------------------------------

describe('wireAdapters', () => {
  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  function setup() {
    const clock = new FakeClock(1_000 as EpochMs);
    const repos = makeInMemoryRepositories(clock);
    const stub = makeEngineStub();
    const tagReader = new FakeTagReader();
    const power = new FakePowerStateProvider();
    const dispose = wireAdapters({
      engine: stub.engine,
      tagReader,
      power,
      repositories: repos,
      clock,
      armTimeoutSec: () => 120,
    });
    return { clock, repos, stub, tagReader, power, dispose };
  }

  it('maps power events 1:1 onto domain events (no extra dedupe — #7)', async () => {
    const { stub, power } = setup();
    power.simulateChargingStarted(10 as EpochMs);
    power.simulateHeartbeat(20 as EpochMs);
    power.simulateChargingStopped(30 as EpochMs);
    await flush();

    expect(stub.dispatched).toEqual([
      { type: 'CHARGING_STARTED', at: 10 },
      { type: 'CHARGING_HEARTBEAT', at: 20 },
      { type: 'CHARGING_STOPPED', at: 30 },
    ]);
  });

  it('routes tag reads through §9.2 resolution (auto-create foreign + TAG_READ)', async () => {
    const { repos, stub, tagReader } = setup();
    await tagReader.start();
    tagReader.simulateTag({ boxUuid: BOX_UUID, label: 'Büro', version: 1 });
    await flush();

    expect(repos.boxes.rows.get(BOX_UUID as BoxId)?.origin).toBe('foreign');
    expect(stub.dispatched).toEqual([
      { type: 'TAG_READ', boxId: BOX_UUID, at: 1_000 },
    ]);
  });

  it('disposer detaches everything', async () => {
    const { stub, tagReader, power, dispose } = setup();
    await tagReader.start();
    dispose();
    power.simulateChargingStarted(10 as EpochMs);
    tagReader.simulateTag({ boxUuid: BOX_UUID, version: 1 });
    await flush();
    expect(stub.dispatched).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// createExclusiveTagWriter — wizard steps pause the passive reader
// ---------------------------------------------------------------------------

describe('createExclusiveTagWriter', () => {
  const REQUEST: TagWriteRequest = {
    boxUuid: BOX_UUID,
    label: 'Küche',
    version: 1,
    lock: false,
  };

  function makeReaderSpy(log: string[], failStop = false) {
    return {
      async start(): Promise<void> {
        log.push('reader.start');
      },
      async stop(): Promise<void> {
        log.push('reader.stop');
        if (failStop) throw new Error('stop failed');
      },
    };
  }

  function makeInnerWriter(log: string[], result: TagWriteResult) {
    const writer: TagWriter = {
      beginWriteStep(_request, onTagState) {
        log.push('inner.begin');
        onTagState({ kind: 'blank' });
        return {
          proceed: async () => {
            log.push('inner.proceed');
            return result;
          },
          cancel: () => {
            log.push('inner.cancel');
          },
        };
      },
    };
    return writer;
  }

  it('stops the reader BEFORE the inner step, restarts after proceed', async () => {
    const log: string[] = [];
    const states: TagState[] = [];
    const writer = createExclusiveTagWriter(
      makeInnerWriter(log, { ok: true, verified: true, locked: false }),
      makeReaderSpy(log),
    );

    const step = writer.beginWriteStep(REQUEST, (state) => states.push(state));
    const result = await step.proceed();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({ ok: true, verified: true, locked: false });
    expect(states).toEqual([{ kind: 'blank' }]);
    expect(log).toEqual(['reader.stop', 'inner.begin', 'inner.proceed', 'reader.start']);
  });

  it('cancel forwards to the inner step and restarts the reader', async () => {
    const log: string[] = [];
    const inner: TagWriter = {
      beginWriteStep() {
        log.push('inner.begin');
        return {
          proceed: async () => ({ ok: false, error: 'tag-lost' }) as TagWriteResult,
          cancel: () => log.push('inner.cancel'),
        };
      },
    };
    const writer = createExclusiveTagWriter(inner, makeReaderSpy(log));

    const step = writer.beginWriteStep(REQUEST, () => {});
    await new Promise((resolve) => setTimeout(resolve, 0)); // inner step started
    step.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log).toEqual(['reader.stop', 'inner.begin', 'inner.cancel', 'reader.start']);
  });

  it('cancel BEFORE the reader stopped never starts the inner step', async () => {
    const log: string[] = [];
    const writer = createExclusiveTagWriter(
      makeInnerWriter(log, { ok: true, verified: true, locked: false }),
      makeReaderSpy(log),
    );

    const step = writer.beginWriteStep(REQUEST, () => {});
    step.cancel(); // synchronously, before reader.stop() resolves
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(log).toEqual(['reader.stop', 'reader.start']);
  });

  it('a failing reader.stop does not block the wizard', async () => {
    const log: string[] = [];
    const writer = createExclusiveTagWriter(
      makeInnerWriter(log, { ok: true, verified: true, locked: false }),
      makeReaderSpy(log, true),
    );

    const step = writer.beginWriteStep(REQUEST, () => {});
    const result = await step.proceed();

    expect(result.ok).toBe(true);
    expect(log).toContain('inner.begin');
  });
});
