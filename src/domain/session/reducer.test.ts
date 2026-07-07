/**
 * Pure reducer tests (BUILD_V1 §6): transitions, effect shapes and — above
 * all — effect ORDER. The CLAUDE.md §3 invariant shows up here as
 * `PERSIST_OPEN_SESSION` being the first (and only) effect of entering ACTIVE.
 */
import { describe, expect, it } from 'vitest';

import { FakeIdSource } from '../testing/fakes';
import type { BoxId, SessionId, SessionState } from '../types';
import { reduce } from './reducer';

const b1 = 'box-1' as BoxId;
const b2 = 'box-2' as BoxId;
const ids = () => new FakeIdSource('sess');

const IDLE: SessionState = { kind: 'IDLE' };
const ARMED: SessionState = { kind: 'ARMED', boxId: b1, armedAt: 1_000 };
const ACTIVE: SessionState = {
  kind: 'ACTIVE',
  boxId: b1,
  sessionId: 'sess-9' as SessionId,
  startedAt: 2_000,
};

describe('reduce: arming', () => {
  it('IDLE + TAG_READ arms the box and starts the runtime', () => {
    const t = reduce(IDLE, { type: 'TAG_READ', boxId: b1, at: 1_000 }, ids());
    expect(t.state).toEqual({ kind: 'ARMED', boxId: b1, armedAt: 1_000 });
    expect(t.effects).toEqual([{ type: 'START_RUNTIME', boxId: b1 }]);
  });

  it('ARMED + TAG_READ(other) re-arms to the other box', () => {
    const t = reduce(ARMED, { type: 'TAG_READ', boxId: b2, at: 1_500 }, ids());
    expect(t.state).toEqual({ kind: 'ARMED', boxId: b2, armedAt: 1_500 });
    expect(t.effects).toEqual([{ type: 'START_RUNTIME', boxId: b2 }]);
  });

  it('ARMED + TAG_READ(same box) refreshes the arm window', () => {
    const t = reduce(ARMED, { type: 'TAG_READ', boxId: b1, at: 1_900 }, ids());
    expect(t.state).toEqual({ kind: 'ARMED', boxId: b1, armedAt: 1_900 });
  });

  it('ARMED + ARM_TIMEOUT discards and stops the runtime — nothing persisted', () => {
    const t = reduce(ARMED, { type: 'ARM_TIMEOUT', at: 121_000 }, ids());
    expect(t.state).toEqual({ kind: 'IDLE' });
    expect(t.effects).toEqual([
      { type: 'DISCARD', boxId: b1 },
      { type: 'STOP_RUNTIME' },
    ]);
  });
});

describe('reduce: the invariant write', () => {
  it('ARMED + CHARGING_STARTED emits PERSIST_OPEN_SESSION as the FIRST effect', () => {
    const t = reduce(ARMED, { type: 'CHARGING_STARTED', at: 2_000 }, ids());
    expect(t.state).toEqual({
      kind: 'ACTIVE',
      boxId: b1,
      sessionId: 'sess-1',
      startedAt: 2_000,
    });
    expect(t.effects[0]).toEqual({
      type: 'PERSIST_OPEN_SESSION',
      sessionId: 'sess-1',
      boxId: b1,
      startedAt: 2_000,
    });
    expect(t.effects).toHaveLength(1);
  });

  it('IDLE + CHARGING_STARTED is ignored — charging without a box never counts', () => {
    const t = reduce(IDLE, { type: 'CHARGING_STARTED', at: 2_000 }, ids());
    expect(t.state).toBe(IDLE);
    expect(t.effects).toEqual([]);
  });
});

describe('reduce: active session', () => {
  it('ACTIVE + CHARGING_HEARTBEAT records the watermark and stays ACTIVE', () => {
    const t = reduce(ACTIVE, { type: 'CHARGING_HEARTBEAT', at: 5_000 }, ids());
    expect(t.state).toBe(ACTIVE);
    expect(t.effects).toEqual([
      { type: 'RECORD_HEARTBEAT', sessionId: 'sess-9', at: 5_000 },
    ]);
  });

  it('ACTIVE + CHARGING_STOPPED closes, recomputes, then stops — in that order', () => {
    const t = reduce(ACTIVE, { type: 'CHARGING_STOPPED', at: 9_000 }, ids());
    expect(t.state).toEqual({ kind: 'IDLE' });
    expect(t.effects).toEqual([
      { type: 'CLOSE_SESSION', sessionId: 'sess-9', endedAt: 9_000, endReason: 'unplug' },
      { type: 'RECOMPUTE_BUCKETS', fromMs: 2_000, toMs: 9_000 },
      { type: 'STOP_RUNTIME' },
    ]);
  });

  it('ACTIVE + TAG_READ is ignored — a running session is never restarted or switched', () => {
    for (const boxId of [b1, b2]) {
      const t = reduce(ACTIVE, { type: 'TAG_READ', boxId, at: 6_000 }, ids());
      expect(t.state).toBe(ACTIVE);
      expect(t.effects).toEqual([]);
    }
  });

  it('ACTIVE + stale ARM_TIMEOUT is ignored', () => {
    const t = reduce(ACTIVE, { type: 'ARM_TIMEOUT', at: 121_000 }, ids());
    expect(t.state).toBe(ACTIVE);
    expect(t.effects).toEqual([]);
  });

  it('IDLE + CHARGING_STOPPED / CHARGING_HEARTBEAT are ignored', () => {
    expect(reduce(IDLE, { type: 'CHARGING_STOPPED', at: 1 }, ids()).effects).toEqual([]);
    expect(reduce(IDLE, { type: 'CHARGING_HEARTBEAT', at: 1 }, ids()).effects).toEqual([]);
  });
});

describe('reduce: APP_RESUMED', () => {
  it('emits RECONCILE from every state without changing it', () => {
    for (const state of [IDLE, ARMED, ACTIVE]) {
      const t = reduce(state, { type: 'APP_RESUMED', at: 7_000 }, ids());
      expect(t.state).toBe(state);
      expect(t.effects).toEqual([{ type: 'RECONCILE', at: 7_000 }]);
    }
  });
});
