/**
 * Engine tests: the reducer's effects executed against the fake ports, with
 * cross-port ORDERING asserted through a shared log — persist-before-anything
 * (CLAUDE.md §3), close-before-recompute-before-stop, and rollback when the
 * invariant write fails.
 */
import { describe, expect, it } from 'vitest';

import {
  FakeClock,
  FakeIdSource,
  FakeSessionRuntime,
  makeInMemoryRepositories,
} from '../testing/fakes';
import type { BoxId, BucketConfig, LocalDate, SessionId } from '../types';
import { createSessionEngine, type SessionEngine } from './engine';

const BERLIN: BucketConfig = {
  dayStartHour: 8,
  nightStartHour: 22,
  timeZone: 'Europe/Berlin',
};

const ld = (s: string): LocalDate => s as LocalDate;
const T = (iso: string): number => Date.parse(iso);
const b1 = 'box-1' as BoxId;
const b2 = 'box-2' as BoxId;

interface Harness {
  engine: SessionEngine;
  repos: ReturnType<typeof makeInMemoryRepositories>;
  runtime: FakeSessionRuntime;
  log: string[];
}

async function makeHarness(isCharging = async () => true): Promise<Harness> {
  const log: string[] = [];
  const clock = new FakeClock(T('2026-07-01T18:00:00Z'));
  const repos = makeInMemoryRepositories(clock, log);
  await repos.boxes.create({ id: b1, label: 'Küche', countMode: 'charging', origin: 'own' });
  await repos.boxes.create({ id: b2, label: 'Büro', countMode: 'charging', origin: 'foreign' });
  const runtime = new FakeSessionRuntime(log);
  log.length = 0; // drop setup noise; tests assert from here
  const engine = createSessionEngine({
    sessions: repos.sessions,
    boxes: repos.boxes,
    dayBuckets: repos.dayBuckets,
    runtime,
    isCharging,
    clock,
    ids: new FakeIdSource('sess'),
    bucketConfig: BERLIN,
  });
  return { engine, repos, runtime, log };
}

describe('engine: happy path IDLE → ARMED → ACTIVE → CLOSED', () => {
  it('runs the full placement ritual with the exact effect order', async () => {
    const { engine, repos, log } = await makeHarness();
    const t0 = T('2026-07-01T18:58:00Z'); // tag read
    const t1 = T('2026-07-01T19:00:00Z'); // plugged in (21:00 local)
    const t2 = T('2026-07-01T19:30:00Z'); // heartbeat
    const t3 = T('2026-07-01T20:30:00Z'); // unplug (22:30 local)

    await engine.dispatch({ type: 'TAG_READ', boxId: b1, at: t0 });
    expect(engine.getState()).toEqual({ kind: 'ARMED', boxId: b1, armedAt: t0 });

    await engine.dispatch({ type: 'CHARGING_STARTED', at: t1 });
    expect(engine.getState()).toEqual({
      kind: 'ACTIVE',
      boxId: b1,
      sessionId: 'sess-1',
      startedAt: t1,
    });
    // started_at is on disk the instant we are ACTIVE.
    expect(await repos.sessions.get('sess-1' as SessionId)).toMatchObject({
      status: 'open',
      startedAt: t1,
      boxId: b1,
    });

    await engine.dispatch({ type: 'CHARGING_HEARTBEAT', at: t2 });
    expect((await repos.sessions.get('sess-1' as SessionId))?.lastChargingAt).toBe(t2);

    await engine.dispatch({ type: 'CHARGING_STOPPED', at: t3 });
    expect(engine.getState()).toEqual({ kind: 'IDLE' });
    expect(await repos.sessions.get('sess-1' as SessionId)).toMatchObject({
      status: 'closed',
      endedAt: t3,
      endReason: 'unplug',
    });

    // Cross-port ordering: runtime up before persist, persist before close,
    // close before bucket recompute, runtime released last.
    expect(log).toEqual([
      'runtime.start(Küche)',
      'sessions.createOpen(sess-1)',
      'sessions.recordHeartbeat(sess-1)',
      'sessions.close(sess-1)',
      'dayBuckets.markDirty(2026-07-01)',
      'dayBuckets.upsert(2026-07-01)',
      'runtime.stop',
    ]);

    // Buckets: 21:00–22:00 day, 22:00–22:30 night.
    expect(await repos.dayBuckets.get(ld('2026-07-01'))).toMatchObject({
      dayLockSec: 3600,
      nightLockSec: 1800,
      dirty: false,
    });
  });
});

describe('engine: arming edge cases', () => {
  it('ARM_TIMEOUT discards without ever touching session storage', async () => {
    const { engine, repos, runtime } = await makeHarness();
    await engine.dispatch({ type: 'TAG_READ', boxId: b1, at: T('2026-07-01T19:00:00Z') });
    await engine.dispatch({ type: 'ARM_TIMEOUT', at: T('2026-07-01T19:02:00Z') });

    expect(engine.getState()).toEqual({ kind: 'IDLE' });
    expect(repos.sessions.rows.size).toBe(0);
    expect(runtime.stopCount).toBe(1);
    expect(await runtime.isRunning()).toBe(false);
  });

  it('re-arms to another box; the session then belongs to the second box', async () => {
    const { engine, repos, runtime } = await makeHarness();
    await engine.dispatch({ type: 'TAG_READ', boxId: b1, at: T('2026-07-01T19:00:00Z') });
    await engine.dispatch({ type: 'TAG_READ', boxId: b2, at: T('2026-07-01T19:01:00Z') });
    await engine.dispatch({ type: 'CHARGING_STARTED', at: T('2026-07-01T19:02:00Z') });

    expect(engine.getState()).toMatchObject({ kind: 'ACTIVE', boxId: b2 });
    expect((await repos.sessions.get('sess-1' as SessionId))?.boxId).toBe(b2);
    // Runtime notification followed the re-arm.
    expect(runtime.startedLabels).toEqual(['Küche', 'Büro']);
  });

  it('ignores TAG_READ while ACTIVE — no restart, no box switch, no runtime churn', async () => {
    const { engine, repos, runtime } = await makeHarness();
    await engine.dispatch({ type: 'TAG_READ', boxId: b1, at: T('2026-07-01T19:00:00Z') });
    await engine.dispatch({ type: 'CHARGING_STARTED', at: T('2026-07-01T19:01:00Z') });
    const active = engine.getState();

    await engine.dispatch({ type: 'TAG_READ', boxId: b2, at: T('2026-07-01T19:05:00Z') });

    expect(engine.getState()).toBe(active);
    expect(repos.sessions.rows.size).toBe(1);
    expect(runtime.startedLabels).toEqual(['Küche']);
  });
});

describe('engine: invariant-write failure', () => {
  it('rolls back to ARMED when createOpen fails — never ACTIVE without a row', async () => {
    const { engine, repos } = await makeHarness();
    const t0 = T('2026-07-01T19:00:00Z');
    await engine.dispatch({ type: 'TAG_READ', boxId: b1, at: t0 });
    repos.sessions.failNextCreateOpen = true;

    await expect(
      engine.dispatch({ type: 'CHARGING_STARTED', at: T('2026-07-01T19:01:00Z') }),
    ).rejects.toThrow('createOpen failed');

    expect(engine.getState()).toEqual({ kind: 'ARMED', boxId: b1, armedAt: t0 });
    expect(repos.sessions.rows.size).toBe(0);

    // The queue is not wedged: the next plug-in works.
    await engine.dispatch({ type: 'CHARGING_STARTED', at: T('2026-07-01T19:03:00Z') });
    expect(engine.getState()).toMatchObject({ kind: 'ACTIVE', sessionId: 'sess-2' });
  });
});
