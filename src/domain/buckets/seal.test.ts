/**
 * Seal-selection tests (BUILD_V1 §5, docs/CONTRACT_CHANGES.md #1): selection
 * is unconditional for every unsealed day < today, idempotent, and sealed
 * days never re-enter selection or recompute.
 */
import { describe, expect, it } from 'vitest';

import { FakeClock, makeInMemoryRepositories } from '../testing/fakes';
import type { BoxId, LocalDate, SessionId, UserId } from '../types';
import { ensureZeroBuckets, markSealed, selectDaysToSeal } from './seal';

const ld = (s: string): LocalDate => s as LocalDate;
const user = 'user-1' as UserId;
const TODAY = ld('2026-07-07');
const SEALED_AT = Date.parse('2026-07-07T10:00:00Z');

describe('selectDaysToSeal', () => {
  it('selects every unsealed day < today as a DailyStat, ascending', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    await repos.dayBuckets.upsert({ date: ld('2026-07-05'), dayLockSec: 100, nightLockSec: 200, dirty: false });
    await repos.dayBuckets.upsert({ date: ld('2026-07-04'), dayLockSec: 10, nightLockSec: 20, dirty: false });
    await repos.dayBuckets.upsert({ date: ld('2026-07-07'), dayLockSec: 999, nightLockSec: 999, dirty: false }); // today
    await repos.dayBuckets.markSealed(ld('2026-07-06'), SEALED_AT - 1); // already sealed

    const stats = await selectDaysToSeal(repos.dayBuckets, {
      today: TODAY,
      userId: user,
      sealedAt: SEALED_AT,
    });

    expect(stats).toEqual([
      { userId: user, date: ld('2026-07-04'), dayLockSec: 10, nightLockSec: 20, sealedAt: SEALED_AT },
      { userId: user, date: ld('2026-07-05'), dayLockSec: 100, nightLockSec: 200, sealedAt: SEALED_AT },
    ]);
  });

  it('is idempotent: after markSealed a second selection is empty', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    await repos.dayBuckets.upsert({ date: ld('2026-07-05'), dayLockSec: 100, nightLockSec: 200, dirty: false });
    await repos.dayBuckets.upsert({ date: ld('2026-07-06'), dayLockSec: 1, nightLockSec: 2, dirty: false });

    const args = { today: TODAY, userId: user, sealedAt: SEALED_AT };
    const first = await selectDaysToSeal(repos.dayBuckets, args);
    expect(first.map((s) => s.date)).toEqual([ld('2026-07-05'), ld('2026-07-06')]);

    await markSealed(repos.dayBuckets, first.map((s) => s.date), SEALED_AT);

    expect(await selectDaysToSeal(repos.dayBuckets, args)).toEqual([]);
    expect((await repos.dayBuckets.get(ld('2026-07-05')))?.sealedAt).toBe(SEALED_AT);
  });

  it('seals unconditionally — decision #1: a day spanned by a still-open session seals as zero', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    // Phone has been in the box since 2026-07-05 evening; session still open.
    await repos.sessions.createOpen({
      id: 'open-1' as SessionId,
      boxId: 'box-1' as BoxId,
      startedAt: Date.parse('2026-07-05T18:00:00Z'),
    });
    // The scheduler zero-fills the elapsed days (no bucket rows exist yet)…
    await ensureZeroBuckets(repos.dayBuckets, [ld('2026-07-05'), ld('2026-07-06')]);
    // …and selection includes them regardless of the open session.
    const stats = await selectDaysToSeal(repos.dayBuckets, {
      today: TODAY,
      userId: user,
      sealedAt: SEALED_AT,
    });
    expect(stats.map((s) => [s.date, s.dayLockSec, s.nightLockSec])).toEqual([
      [ld('2026-07-05'), 0, 0],
      [ld('2026-07-06'), 0, 0],
    ]);
  });
});

describe('ensureZeroBuckets', () => {
  it('creates zero rows only for missing dates and never touches existing ones', async () => {
    const repos = makeInMemoryRepositories(new FakeClock());
    await repos.dayBuckets.upsert({ date: ld('2026-07-05'), dayLockSec: 42, nightLockSec: 7, dirty: false });
    await repos.dayBuckets.markSealed(ld('2026-07-04'), SEALED_AT - 10);

    const created = await ensureZeroBuckets(repos.dayBuckets, [
      ld('2026-07-04'),
      ld('2026-07-05'),
      ld('2026-07-06'),
    ]);

    expect(created).toEqual([ld('2026-07-06')]);
    expect(await repos.dayBuckets.get(ld('2026-07-05'))).toMatchObject({ dayLockSec: 42, nightLockSec: 7 });
    expect(await repos.dayBuckets.get(ld('2026-07-04'))).toMatchObject({ sealedAt: SEALED_AT - 10 });
    expect(await repos.dayBuckets.get(ld('2026-07-06'))).toMatchObject({
      dayLockSec: 0,
      nightLockSec: 0,
      dirty: false,
    });
  });
});
