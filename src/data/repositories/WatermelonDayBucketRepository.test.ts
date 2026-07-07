import { beforeEach, describe, expect, it } from 'vitest';

import type { LocalDate } from '../../domain/types';
import type { Repositories } from '../Repositories';
import { InMemorySecureStore } from '../secure';
import { createTestDatabase } from '../testing';
import { createRepositories } from './index';

const d = (s: string): LocalDate => s as LocalDate;

let repos: Repositories;

beforeEach(() => {
  repos = createRepositories({
    database: createTestDatabase(),
    secureStore: new InMemorySecureStore(),
  });
});

describe('DayBucketRepository', () => {
  it('upsert creates then replaces totals; date stays unique', async () => {
    await repos.dayBuckets.upsert({
      date: d('2026-07-05'),
      dayLockSec: 100,
      nightLockSec: 50,
      dirty: true,
    });
    await repos.dayBuckets.upsert({
      date: d('2026-07-05'),
      dayLockSec: 200,
      nightLockSec: 80,
      dirty: false,
    });
    const bucket = await repos.dayBuckets.get(d('2026-07-05'));
    expect(bucket).toMatchObject({ dayLockSec: 200, nightLockSec: 80, dirty: false });
    // uniqueness: still exactly one row for that date
    expect(await repos.dayBuckets.listRange(d('2026-07-05'), d('2026-07-05'))).toHaveLength(1);
  });

  it('upsert preserves sealed_at (recompute must not unseal)', async () => {
    await repos.dayBuckets.upsert({
      date: d('2026-07-05'),
      dayLockSec: 100,
      nightLockSec: 0,
      dirty: false,
    });
    await repos.dayBuckets.markSealed(d('2026-07-05'), 1234);
    await repos.dayBuckets.upsert({
      date: d('2026-07-05'),
      dayLockSec: 999,
      nightLockSec: 1,
      dirty: true,
    });
    const bucket = await repos.dayBuckets.get(d('2026-07-05'));
    expect(bucket?.sealedAt).toBe(1234);
    expect(bucket?.dayLockSec).toBe(999);
  });

  it('listRange is inclusive and ascending by date', async () => {
    for (const date of ['2026-07-06', '2026-07-03', '2026-07-04', '2026-07-01']) {
      await repos.dayBuckets.upsert({
        date: d(date),
        dayLockSec: 1,
        nightLockSec: 1,
        dirty: false,
      });
    }
    const range = await repos.dayBuckets.listRange(d('2026-07-03'), d('2026-07-06'));
    expect(range.map((b) => b.date)).toEqual(['2026-07-03', '2026-07-04', '2026-07-06']);
  });

  it('markDirty flags existing buckets and creates missing ones as dirty zeros', async () => {
    await repos.dayBuckets.upsert({
      date: d('2026-07-05'),
      dayLockSec: 100,
      nightLockSec: 0,
      dirty: false,
    });
    await repos.dayBuckets.markDirty([d('2026-07-05'), d('2026-07-06')]);
    const dirty = await repos.dayBuckets.findDirty();
    expect(dirty.map((b) => b.date)).toEqual(['2026-07-05', '2026-07-06']);
    expect(dirty[1]).toMatchObject({ dayLockSec: 0, nightLockSec: 0, dirty: true });
    // existing totals survive markDirty
    expect(dirty[0]?.dayLockSec).toBe(100);
  });

  it('findUnsealedBefore uses YYYY-MM-DD string order and excludes sealed/today', async () => {
    // deliberately out of insertion order + a month boundary (2026-06-30 < 2026-07-01)
    for (const date of ['2026-07-05', '2026-06-30', '2026-07-06', '2026-07-03']) {
      await repos.dayBuckets.upsert({
        date: d(date),
        dayLockSec: 1,
        nightLockSec: 1,
        dirty: false,
      });
    }
    await repos.dayBuckets.markSealed(d('2026-07-03'), 999);

    const unsealed = await repos.dayBuckets.findUnsealedBefore(d('2026-07-06'));
    expect(unsealed.map((b) => b.date)).toEqual(['2026-06-30', '2026-07-05']);
  });

  it('markSealed rejects for a date that has no bucket', async () => {
    await expect(repos.dayBuckets.markSealed(d('2026-07-05'), 1)).rejects.toThrow();
  });
});
