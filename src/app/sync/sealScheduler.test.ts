/**
 * Seal-scheduler unit tests (J10) — real J3 repositories on the in-memory
 * WatermelonDB adapter, fake uploader. Covers BUILD_V1 §5 semantics: never
 * seal today, zero-fill gap days, mark sealed only on server confirmation,
 * idempotent duplicate recovery, offline retry, sync-off = full no-op.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { createRepositories, InMemorySecureStore, type Repositories } from '../../data';
import { createTestDatabase } from '../../data/testing';
import { addDaysToLocalDate, localDateOf } from '../../domain/buckets';
import type { DailyStat, LocalDate, UserId } from '../../domain/types';
import { createSealScheduler, type SealScheduler, type UploadOutcome } from './sealScheduler';

const ZONE = 'Europe/Berlin';
const USER = 'rec000000000001' as UserId;
// 2026-07-07 09:00 Berlin.
const NOW = Date.parse('2026-07-07T07:00:00Z');

interface Harness {
  repos: Repositories;
  kv: InMemorySecureStore;
  scheduler: SealScheduler;
  uploads: DailyStat[];
  /** Next outcomes per date; default 'created'. */
  outcome: (stat: DailyStat) => UploadOutcome | Error;
  syncEnabled: boolean;
  authAvailable: boolean;
  now: number;
}

function harness(): Harness {
  const kv = new InMemorySecureStore();
  const repos = createRepositories({
    database: createTestDatabase(),
    secureStore: kv,
    clock: { now: () => h.now },
  });
  const h: Harness = {
    repos,
    kv,
    uploads: [],
    outcome: () => 'created',
    syncEnabled: true,
    authAvailable: true,
    now: NOW,
    scheduler: undefined as unknown as SealScheduler,
  };
  h.scheduler = createSealScheduler({
    dayBuckets: repos.dayBuckets,
    kv,
    clock: { now: () => h.now },
    timeZone: () => ZONE,
    syncEnabled: () => h.syncEnabled,
    getUserId: async () => {
      if (!h.authAvailable) throw new Error('offline');
      return USER;
    },
    upload: async (stat) => {
      const result = h.outcome(stat);
      if (result instanceof Error) throw result;
      h.uploads.push(stat);
      return result;
    },
  });
  return h;
}

function today(h: Harness): LocalDate {
  return localDateOf(h.now, ZONE);
}

async function seedBucket(h: Harness, daysAgo: number, daySec: number, nightSec: number) {
  await h.repos.dayBuckets.upsert({
    date: addDaysToLocalDate(today(h), -daysAgo),
    dayLockSec: daySec,
    nightLockSec: nightSec,
    dirty: false,
  });
}

describe('createSealScheduler', () => {
  let h: Harness;

  beforeEach(() => {
    h = harness();
  });

  it('sync OFF: full no-op — nothing zero-filled, nothing uploaded, days stay unsealed', async () => {
    await seedBucket(h, 1, 3600, 1200);
    h.syncEnabled = false;
    const result = await h.scheduler.runOnce();
    expect(result).toEqual({
      status: 'sync-off',
      uploaded: 0,
      alreadySealed: 0,
      failed: 0,
      zeroFilled: 0,
    });
    expect(h.uploads).toHaveLength(0);
    const bucket = await h.repos.dayBuckets.get(addDaysToLocalDate(today(h), -1));
    expect(bucket?.sealedAt).toBeUndefined();
  });

  it('uploads every unsealed past day and marks it sealed, never today', async () => {
    await seedBucket(h, 2, 3600, 0);
    await seedBucket(h, 1, 1800, 900);
    await seedBucket(h, 0, 60, 0); // today — must NOT seal
    const result = await h.scheduler.runOnce();
    expect(result.status).toBe('ran');
    expect(result.uploaded).toBe(2);
    expect(h.uploads.map((stat) => stat.date)).toEqual([
      addDaysToLocalDate(today(h), -2),
      addDaysToLocalDate(today(h), -1),
    ]);
    expect(h.uploads.every((stat) => stat.userId === USER)).toBe(true);
    expect(h.uploads.every((stat) => stat.date < today(h))).toBe(true);
    const todayBucket = await h.repos.dayBuckets.get(today(h));
    expect(todayBucket?.sealedAt).toBeUndefined();
    const sealed = await h.repos.dayBuckets.get(addDaysToLocalDate(today(h), -1));
    expect(sealed?.sealedAt).toBe(NOW);
  });

  it('zero-fills gap days between existing history and yesterday', async () => {
    await seedBucket(h, 4, 3600, 0); // history; days 3,2,1 ago have no rows
    const result = await h.scheduler.runOnce();
    expect(result.zeroFilled).toBe(3);
    expect(result.uploaded).toBe(4);
    const zeroDay = h.uploads.find(
      (stat) => stat.date === addDaysToLocalDate(today(h), -2),
    );
    expect(zeroDay).toMatchObject({ dayLockSec: 0, nightLockSec: 0 });
  });

  it('fresh install: no history is fabricated', async () => {
    const result = await h.scheduler.runOnce();
    expect(result).toMatchObject({ status: 'ran', uploaded: 0, zeroFilled: 0 });
  });

  it('fills days that pass while the app is closed (watermark advance)', async () => {
    await h.scheduler.runOnce(); // establishes watermark = yesterday
    h.now = NOW + 3 * 86_400_000; // three days later, no sessions in between
    const result = await h.scheduler.runOnce();
    expect(result.zeroFilled).toBe(3);
    expect(result.uploaded).toBe(3);
  });

  it('idempotent: a second run uploads nothing', async () => {
    await seedBucket(h, 1, 3600, 0);
    await h.scheduler.runOnce();
    const again = await h.scheduler.runOnce();
    expect(again).toMatchObject({ uploaded: 0, alreadySealed: 0, failed: 0 });
    expect(h.uploads).toHaveLength(1);
  });

  it("treats the server's duplicate-400 as sealed (idempotent recovery)", async () => {
    await seedBucket(h, 1, 3600, 0);
    h.outcome = () => 'duplicate';
    const result = await h.scheduler.runOnce();
    expect(result).toMatchObject({ uploaded: 0, alreadySealed: 1, failed: 0 });
    const bucket = await h.repos.dayBuckets.get(addDaysToLocalDate(today(h), -1));
    expect(bucket?.sealedAt).toBe(NOW);
  });

  it('transport failure: day stays unsealed and is retried next run', async () => {
    await seedBucket(h, 2, 3600, 0);
    await seedBucket(h, 1, 1800, 0);
    let calls = 0;
    h.outcome = () => {
      calls += 1;
      return calls >= 2 ? new Error('ECONNREFUSED') : 'created';
    };
    const first = await h.scheduler.runOnce();
    expect(first).toMatchObject({ uploaded: 1, failed: 1 });
    const pending = await h.repos.dayBuckets.get(addDaysToLocalDate(today(h), -1));
    expect(pending?.sealedAt).toBeUndefined();

    h.outcome = () => 'created';
    const second = await h.scheduler.runOnce();
    expect(second).toMatchObject({ uploaded: 1, failed: 0 });
    expect(h.uploads).toHaveLength(2);
  });

  it('auth unavailable (offline): zero-fill still happens, sealing waits', async () => {
    await seedBucket(h, 3, 3600, 0);
    h.authAvailable = false;
    const result = await h.scheduler.runOnce();
    expect(result.status).toBe('auth-unavailable');
    expect(result.zeroFilled).toBe(2);
    expect(h.uploads).toHaveLength(0);

    h.authAvailable = true;
    const retry = await h.scheduler.runOnce();
    expect(retry).toMatchObject({ status: 'ran', uploaded: 3 });
  });

  it('midnight/zone edge: "today" is the LOCAL date, not the UTC date', async () => {
    // 2026-07-07 00:30 Berlin = 2026-07-06 22:30Z. UTC still says the 6th;
    // Berlin already lives on the 7th, so the 6th is sealable.
    h.now = Date.parse('2026-07-06T22:30:00Z');
    const localToday = localDateOf(h.now, ZONE);
    expect(localToday).toBe('2026-07-07');
    await h.repos.dayBuckets.upsert({
      date: '2026-07-06' as LocalDate,
      dayLockSec: 3600,
      nightLockSec: 0,
      dirty: false,
    });
    const result = await h.scheduler.runOnce();
    expect(result.uploaded).toBe(1);
    expect(h.uploads[0].date).toBe('2026-07-06');
  });
});
