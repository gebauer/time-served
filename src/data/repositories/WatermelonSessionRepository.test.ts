import { beforeEach, describe, expect, it } from 'vitest';

import type { BoxId, Clock, SessionId } from '../../domain/types';
import type { Repositories } from '../Repositories';
import { InMemorySecureStore } from '../secure';
import { createTestDatabase } from '../testing';
import { createRepositories } from './index';

const BOX = '11111111-1111-4111-8111-111111111111' as BoxId;
const sid = (n: number): SessionId =>
  `00000000-0000-4000-8000-00000000000${n}` as SessionId;

let fakeNow = 1_750_000_000_000;
const clock: Clock = { now: () => fakeNow };

let repos: Repositories;

beforeEach(() => {
  fakeNow = 1_750_000_000_000;
  repos = createRepositories({
    database: createTestDatabase(),
    secureStore: new InMemorySecureStore(),
    clock,
  });
});

describe('SessionRepository.createOpen (the invariant write)', () => {
  it('resolves only after the row is written — readable immediately after await', async () => {
    const created = await repos.sessions.createOpen({
      id: sid(1),
      boxId: BOX,
      startedAt: 1000,
    });
    expect(created).toMatchObject({ id: sid(1), boxId: BOX, startedAt: 1000, status: 'open' });
    expect(created.createdAt).toBe(fakeNow);

    // No flushing, no waiting: the awaited promise IS the durability barrier.
    const readBack = await repos.sessions.get(sid(1));
    expect(readBack).toBeDefined();
    expect(readBack).toMatchObject({ id: sid(1), startedAt: 1000, status: 'open' });
    expect(readBack?.endedAt).toBeUndefined();
    expect(readBack?.lastChargingAt).toBeUndefined();
  });

  it('does not resolve before the database write completed', async () => {
    // Ordering probe: if createOpen resolved before its write finished, the
    // row would not yet be visible to a query started synchronously after.
    let visibleAtResolve = false;
    await repos.sessions
      .createOpen({ id: sid(2), boxId: BOX, startedAt: 2000 })
      .then(async () => {
        visibleAtResolve = (await repos.sessions.findOpen()).some((s) => s.id === sid(2));
      });
    expect(visibleAtResolve).toBe(true);
  });
});

describe('SessionRepository lifecycle', () => {
  it('recordHeartbeat updates last_charging_at and updated_at', async () => {
    await repos.sessions.createOpen({ id: sid(1), boxId: BOX, startedAt: 1000 });
    fakeNow += 5000;
    await repos.sessions.recordHeartbeat(sid(1), 6000);
    const session = await repos.sessions.get(sid(1));
    expect(session?.lastChargingAt).toBe(6000);
    expect(session?.updatedAt).toBe(fakeNow);
    expect(session?.status).toBe('open');
  });

  it('close sets status/ended_at/end_reason', async () => {
    await repos.sessions.createOpen({ id: sid(1), boxId: BOX, startedAt: 1000 });
    await repos.sessions.close(sid(1), { endedAt: 9000, endReason: 'unplug' });
    const session = await repos.sessions.get(sid(1));
    expect(session).toMatchObject({ status: 'closed', endedAt: 9000, endReason: 'unplug' });
  });

  it('findOpen returns only open sessions (reconciliation input)', async () => {
    await repos.sessions.createOpen({ id: sid(1), boxId: BOX, startedAt: 1000 });
    await repos.sessions.createOpen({ id: sid(2), boxId: BOX, startedAt: 2000 });
    await repos.sessions.close(sid(1), { endedAt: 3000, endReason: 'reconciled' });
    const open = await repos.sessions.findOpen();
    expect(open.map((s) => s.id)).toEqual([sid(2)]);
  });

  it('update patches only the provided fields', async () => {
    await repos.sessions.createOpen({ id: sid(1), boxId: BOX, startedAt: 1000 });
    await repos.sessions.close(sid(1), { endedAt: 9000, endReason: 'unplug' });
    await repos.sessions.update(sid(1), { startedAt: 1500, endReason: 'manual' });
    const session = await repos.sessions.get(sid(1));
    expect(session).toMatchObject({
      startedAt: 1500,
      endedAt: 9000, // untouched
      status: 'closed', // untouched
      endReason: 'manual',
    });
  });

  it('get returns undefined for unknown ids; mutations reject', async () => {
    expect(await repos.sessions.get(sid(9))).toBeUndefined();
    await expect(repos.sessions.recordHeartbeat(sid(9), 1)).rejects.toThrow();
    await expect(
      repos.sessions.close(sid(9), { endedAt: 1, endReason: 'unplug' })
    ).rejects.toThrow();
  });
});

describe('SessionRepository.findOverlapping', () => {
  const seed = async (id: SessionId, startedAt: number, endedAt: number) => {
    await repos.sessions.createOpen({ id, boxId: BOX, startedAt });
    await repos.sessions.close(id, { endedAt, endReason: 'unplug' });
  };

  it('finds sessions spanning the range boundary, excludes disjoint ones', async () => {
    await seed(sid(1), 1000, 2000); // ends before range
    await seed(sid(2), 1500, 2500); // spans range start
    await seed(sid(3), 2100, 2900); // fully inside
    await seed(sid(4), 2500, 3500); // spans range end
    await seed(sid(5), 3000, 4000); // starts at range end (half-open: out)
    await seed(sid(6), 500, 5000); // spans the whole range

    const overlapping = await repos.sessions.findOverlapping(2000, 3000);
    expect(overlapping.map((s) => s.id)).toEqual([sid(6), sid(2), sid(3), sid(4)]);
  });

  it('half-open semantics: touching endpoints do not overlap', async () => {
    await seed(sid(1), 1000, 2000); // [1000,2000) vs [2000,3000): disjoint
    await seed(sid(2), 3000, 4000); // [3000,4000) vs [2000,3000): disjoint
    expect(await repos.sessions.findOverlapping(2000, 3000)).toEqual([]);
  });

  it('excludes open sessions', async () => {
    await repos.sessions.createOpen({ id: sid(1), boxId: BOX, startedAt: 2100 });
    expect(await repos.sessions.findOverlapping(2000, 3000)).toEqual([]);
  });
});
