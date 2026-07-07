/**
 * Reconciliation tests (BUILD_V1 §7): the safety net that closes orphaned
 * sessions on APP_RESUMED. A missed unplug costs precision (down to the
 * heartbeat watermark), never the session.
 */
import { describe, expect, it } from 'vitest';

import {
  FakeClock,
  FakeIdSource,
  FakeSessionRuntime,
  makeInMemoryRepositories,
  type InMemoryRepositories,
} from '../testing/fakes';
import type { BoxId, BucketConfig, LocalDate, SessionId, SessionState } from '../types';
import { createSessionEngine } from './engine';
import { reconcile, type ReconcileDeps } from './reconcile';

const BERLIN: BucketConfig = {
  dayStartHour: 8,
  nightStartHour: 22,
  timeZone: 'Europe/Berlin',
};

const ld = (s: string): LocalDate => s as LocalDate;
const T = (iso: string): number => Date.parse(iso);
const b1 = 'box-1' as BoxId;
const b2 = 'box-2' as BoxId;
const s1 = 'sess-1' as SessionId;
const IDLE: SessionState = { kind: 'IDLE' };

function deps(
  repos: InMemoryRepositories,
  charging: boolean,
  clock = new FakeClock(T('2026-07-02T05:00:00Z')),
): ReconcileDeps {
  return {
    sessions: repos.sessions,
    dayBuckets: repos.dayBuckets,
    isCharging: async () => charging,
    clock,
    bucketConfig: BERLIN,
  };
}

describe('reconcile', () => {
  it('closes an orphaned session at the heartbeat watermark (missed unplug)', async () => {
    const repos = makeInMemoryRepositories(new FakeClock(T('2026-07-01T19:00:00Z')));
    await repos.sessions.createOpen({ id: s1, boxId: b1, startedAt: T('2026-07-01T19:00:00Z') });
    await repos.sessions.recordHeartbeat(s1, T('2026-07-01T23:00:00Z')); // 01:00 local July 2

    const result = await reconcile(IDLE, deps(repos, false));

    expect(result.closed).toHaveLength(1);
    expect(result.kept).toHaveLength(0);
    expect(await repos.sessions.get(s1)).toMatchObject({
      status: 'closed',
      endedAt: T('2026-07-01T23:00:00Z'),
      endReason: 'reconciled',
    });
    // Buckets recomputed for both touched days:
    // 21:00–22:00 day, 22:00–24:00 night on July 1; 00:00–01:00 night on July 2.
    expect(await repos.dayBuckets.get(ld('2026-07-01'))).toMatchObject({
      dayLockSec: 3600,
      nightLockSec: 7200,
      dirty: false,
    });
    expect(await repos.dayBuckets.get(ld('2026-07-02'))).toMatchObject({
      dayLockSec: 0,
      nightLockSec: 3600,
      dirty: false,
    });
  });

  it('falls back to started_at when no heartbeat ever arrived (zero-length close)', async () => {
    const repos = makeInMemoryRepositories(new FakeClock(T('2026-07-01T19:00:00Z')));
    await repos.sessions.createOpen({ id: s1, boxId: b1, startedAt: T('2026-07-01T19:00:00Z') });

    const result = await reconcile(IDLE, deps(repos, false));

    expect(result.closed[0]).toMatchObject({
      endedAt: T('2026-07-01T19:00:00Z'),
      endReason: 'reconciled',
    });
    // The day still gets a (zero) bucket — dirty flag cleared honestly.
    expect(await repos.dayBuckets.get(ld('2026-07-01'))).toMatchObject({
      dayLockSec: 0,
      nightLockSec: 0,
      dirty: false,
    });
  });

  it('keeps a session that is still charging in the currently active box', async () => {
    const repos = makeInMemoryRepositories(new FakeClock(T('2026-07-01T19:00:00Z')));
    await repos.sessions.createOpen({ id: s1, boxId: b1, startedAt: T('2026-07-01T19:00:00Z') });
    const active: SessionState = {
      kind: 'ACTIVE',
      boxId: b1,
      sessionId: s1,
      startedAt: T('2026-07-01T19:00:00Z'),
    };

    const result = await reconcile(active, deps(repos, true));

    expect(result.closed).toHaveLength(0);
    expect(result.kept).toHaveLength(1);
    expect((await repos.sessions.get(s1))?.status).toBe('open');
  });

  it('closes an open session for ANOTHER box even while charging', async () => {
    const repos = makeInMemoryRepositories(new FakeClock(T('2026-07-01T19:00:00Z')));
    await repos.sessions.createOpen({ id: s1, boxId: b1, startedAt: T('2026-07-01T19:00:00Z') });
    await repos.sessions.recordHeartbeat(s1, T('2026-07-01T20:00:00Z'));
    const armedOther: SessionState = { kind: 'ARMED', boxId: b2, armedAt: T('2026-07-01T21:00:00Z') };

    const result = await reconcile(armedOther, deps(repos, true));

    expect(result.closed).toHaveLength(1);
    expect(await repos.sessions.get(s1)).toMatchObject({
      status: 'closed',
      endedAt: T('2026-07-01T20:00:00Z'),
      endReason: 'reconciled',
    });
  });

  it('closes an orphan even while charging when the machine is IDLE (no armed box)', async () => {
    const repos = makeInMemoryRepositories(new FakeClock(T('2026-07-01T19:00:00Z')));
    await repos.sessions.createOpen({ id: s1, boxId: b1, startedAt: T('2026-07-01T19:00:00Z') });

    const result = await reconcile(IDLE, deps(repos, true));

    expect(result.closed).toHaveLength(1);
  });

  it('never touches sealed buckets while recomputing (multi-day orphan, decision #1)', async () => {
    const repos = makeInMemoryRepositories(new FakeClock(T('2026-07-01T10:00:00Z')));
    // Day was sealed as zero at midday while the phone sat in the box.
    await repos.dayBuckets.markSealed(ld('2026-07-01'), T('2026-07-02T10:00:00Z'));
    await repos.sessions.createOpen({ id: s1, boxId: b1, startedAt: T('2026-07-01T10:00:00Z') });
    await repos.sessions.recordHeartbeat(s1, T('2026-07-02T09:00:00Z')); // 11:00 local July 2

    const result = await reconcile(IDLE, deps(repos, false));

    expect(result.buckets.skippedSealed).toEqual([ld('2026-07-01')]);
    // Sealed day stays zero — that time is lost by design.
    expect(await repos.dayBuckets.get(ld('2026-07-01'))).toMatchObject({
      dayLockSec: 0,
      nightLockSec: 0,
    });
    // July 2 (unsealed) gets its real slices: 00:00–08:00 night, 08:00–11:00 day.
    expect(await repos.dayBuckets.get(ld('2026-07-02'))).toMatchObject({
      dayLockSec: 3 * 3600,
      nightLockSec: 8 * 3600,
    });
  });
});

describe('engine + APP_RESUMED', () => {
  it('drops a stale ACTIVE machine to IDLE and stops the runtime after reconciliation', async () => {
    const log: string[] = [];
    const clock = new FakeClock(T('2026-07-02T05:00:00Z'));
    const repos = makeInMemoryRepositories(clock, log);
    await repos.boxes.create({ id: b1, label: 'Küche', countMode: 'charging', origin: 'own' });
    await repos.sessions.createOpen({ id: s1, boxId: b1, startedAt: T('2026-07-01T19:00:00Z') });
    await repos.sessions.recordHeartbeat(s1, T('2026-07-01T23:00:00Z'));
    const runtime = new FakeSessionRuntime(log);

    // Process was killed mid-session; the app relaunches believing ACTIVE.
    const engine = createSessionEngine(
      {
        sessions: repos.sessions,
        boxes: repos.boxes,
        dayBuckets: repos.dayBuckets,
        runtime,
        isCharging: async () => false,
        clock,
        ids: new FakeIdSource('sess'),
        bucketConfig: BERLIN,
      },
      { kind: 'ACTIVE', boxId: b1, sessionId: s1, startedAt: T('2026-07-01T19:00:00Z') },
    );

    await engine.dispatch({ type: 'APP_RESUMED', at: clock.now() });

    expect(engine.getState()).toEqual({ kind: 'IDLE' });
    expect(runtime.stopCount).toBe(1);
    expect(await repos.sessions.get(s1)).toMatchObject({
      status: 'closed',
      endReason: 'reconciled',
    });
  });

  it('leaves a genuinely running session ACTIVE on resume', async () => {
    const clock = new FakeClock(T('2026-07-01T20:00:00Z'));
    const repos = makeInMemoryRepositories(clock);
    await repos.boxes.create({ id: b1, label: 'Küche', countMode: 'charging', origin: 'own' });
    await repos.sessions.createOpen({ id: s1, boxId: b1, startedAt: T('2026-07-01T19:00:00Z') });
    const runtime = new FakeSessionRuntime();
    const activeState: SessionState = {
      kind: 'ACTIVE',
      boxId: b1,
      sessionId: s1,
      startedAt: T('2026-07-01T19:00:00Z'),
    };

    const engine = createSessionEngine(
      {
        sessions: repos.sessions,
        boxes: repos.boxes,
        dayBuckets: repos.dayBuckets,
        runtime,
        isCharging: async () => true,
        clock,
        ids: new FakeIdSource('sess'),
        bucketConfig: BERLIN,
      },
      activeState,
    );

    await engine.dispatch({ type: 'APP_RESUMED', at: clock.now() });

    expect(engine.getState()).toEqual(activeState);
    expect((await repos.sessions.get(s1))?.status).toBe('open');
    expect(runtime.stopCount).toBe(0);
  });
});
