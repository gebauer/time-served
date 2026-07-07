/**
 * Bucket recompute tests: rebuild-from-closed-sessions, dirty handling, and
 * the immutability of sealed buckets (docs/CONTRACT_CHANGES.md #1).
 */
import { describe, expect, it } from 'vitest';

import { FakeClock, makeInMemoryRepositories } from '../testing/fakes';
import type { BoxId, BucketConfig, LocalDate, SessionId } from '../types';
import { recomputeDates, recomputeDirtyBuckets, recomputeRange } from './recompute';

const BERLIN: BucketConfig = {
  dayStartHour: 8,
  nightStartHour: 22,
  timeZone: 'Europe/Berlin',
};

const ld = (s: string): LocalDate => s as LocalDate;
const T = (iso: string): number => Date.parse(iso);
const b1 = 'box-1' as BoxId;

async function closedSession(
  repos: ReturnType<typeof makeInMemoryRepositories>,
  id: string,
  startedAt: number,
  endedAt: number,
): Promise<void> {
  await repos.sessions.createOpen({ id: id as SessionId, boxId: b1, startedAt });
  await repos.sessions.close(id as SessionId, { endedAt, endReason: 'unplug' });
}

describe('recomputeRange', () => {
  it('rebuilds the buckets of every date a closed session touches', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    const from = T('2026-07-01T19:00:00Z'); // 21:00 local
    const to = T('2026-07-02T07:00:00Z'); // 09:00 local next day
    await closedSession(repos, 's1', from, to);

    await recomputeRange(repos, BERLIN, from, to);

    expect(await repos.dayBuckets.get(ld('2026-07-01'))).toEqual({
      date: ld('2026-07-01'),
      dayLockSec: 3600,
      nightLockSec: 7200,
      dirty: false,
      sealedAt: undefined,
    });
    expect(await repos.dayBuckets.get(ld('2026-07-02'))).toEqual({
      date: ld('2026-07-02'),
      dayLockSec: 3600,
      nightLockSec: 28800,
      dirty: false,
      sealedAt: undefined,
    });
  });

  it('accumulates multiple sessions on the same day', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    // 10:00–11:00 local and 21:30–22:30 local on 2026-07-01
    await closedSession(repos, 's1', T('2026-07-01T08:00:00Z'), T('2026-07-01T09:00:00Z'));
    await closedSession(repos, 's2', T('2026-07-01T19:30:00Z'), T('2026-07-01T20:30:00Z'));

    await recomputeRange(repos, BERLIN, T('2026-07-01T08:00:00Z'), T('2026-07-01T20:30:00Z'));

    const bucket = await repos.dayBuckets.get(ld('2026-07-01'));
    expect(bucket?.dayLockSec).toBe(3600 + 1800);
    expect(bucket?.nightLockSec).toBe(1800);
  });

  it('also sweeps up dates that were already dirty from an earlier failure', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    await closedSession(repos, 's1', T('2026-06-20T08:00:00Z'), T('2026-06-20T09:00:00Z'));
    await repos.dayBuckets.markDirty([ld('2026-06-20')]); // leftover dirt
    await closedSession(repos, 's2', T('2026-07-01T08:00:00Z'), T('2026-07-01T09:00:00Z'));

    const result = await recomputeRange(
      repos,
      BERLIN,
      T('2026-07-01T08:00:00Z'),
      T('2026-07-01T09:00:00Z'),
    );

    expect(result.recomputed).toEqual([ld('2026-06-20'), ld('2026-07-01')]);
    expect((await repos.dayBuckets.get(ld('2026-06-20')))?.dayLockSec).toBe(3600);
    expect((await repos.dayBuckets.get(ld('2026-06-20')))?.dirty).toBe(false);
  });
});

describe('recomputeDirtyBuckets', () => {
  it('recomputes exactly the dirty dates and clears their flag', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    await closedSession(repos, 's1', T('2026-07-01T08:00:00Z'), T('2026-07-01T09:30:00Z'));
    await repos.dayBuckets.markDirty([ld('2026-07-01')]);

    const result = await recomputeDirtyBuckets(repos, BERLIN);

    expect(result.recomputed).toEqual([ld('2026-07-01')]);
    expect(await repos.dayBuckets.get(ld('2026-07-01'))).toMatchObject({
      dayLockSec: 5400,
      nightLockSec: 0,
      dirty: false,
    });
    expect(await repos.dayBuckets.findDirty()).toEqual([]);
  });

  it('is a no-op when nothing is dirty', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    const result = await recomputeDirtyBuckets(repos, BERLIN);
    expect(result).toEqual({ recomputed: [], skippedSealed: [] });
  });
});

describe('sealed immutability', () => {
  it('never rewrites a sealed bucket — skips it with a note', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    await repos.dayBuckets.upsert({
      date: ld('2026-07-01'),
      dayLockSec: 111,
      nightLockSec: 222,
      dirty: false,
    });
    await repos.dayBuckets.markSealed(ld('2026-07-01'), T('2026-07-02T10:00:00Z'));
    // A late session edit lands on the sealed day…
    await closedSession(repos, 's1', T('2026-07-01T08:00:00Z'), T('2026-07-01T12:00:00Z'));

    const result = await recomputeDates(repos, BERLIN, [ld('2026-07-01')]);

    expect(result.skippedSealed).toEqual([ld('2026-07-01')]);
    expect(result.recomputed).toEqual([]);
    // Totals untouched — sealed days are immutable (BUILD_V1 §3).
    expect(await repos.dayBuckets.get(ld('2026-07-01'))).toMatchObject({
      dayLockSec: 111,
      nightLockSec: 222,
      sealedAt: T('2026-07-02T10:00:00Z'),
    });
  });
});
