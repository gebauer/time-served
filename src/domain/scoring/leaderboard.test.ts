/**
 * Leaderboard aggregation tests: period windows, deterministic ranking with
 * standard competition ties (1, 1, 3), and userId tie-breaking.
 */
import { describe, expect, it } from 'vitest';

import type { DailyStat, LocalDate, UserId } from '../types';
import { buildLeaderboard, type LeaderboardMember } from './leaderboard';

const ld = (s: string): LocalDate => s as LocalDate;
const uid = (s: string): UserId => s as UserId;
const TODAY = ld('2026-07-07');

function stat(userId: string, date: string, day: number, night: number): DailyStat {
  return {
    userId: uid(userId),
    date: ld(date),
    dayLockSec: day,
    nightLockSec: night,
    sealedAt: Date.parse(`${date}T10:00:00Z`) + 86_400_000,
  };
}

const members: LeaderboardMember[] = [
  { userId: uid('u-anna'), displayName: 'Anna' },
  { userId: uid('u-ben'), displayName: 'Ben' },
  { userId: uid('u-cleo'), displayName: 'Cleo' },
];

describe("period 'yesterday'", () => {
  it('uses the single most recent sealed day before today', () => {
    const rows = buildLeaderboard({
      members,
      today: TODAY,
      period: 'yesterday',
      stats: [
        stat('u-anna', '2026-07-05', 1000, 500), // latest sealed day is 07-05,
        stat('u-ben', '2026-07-05', 2000, 0), //    NOT calendar yesterday 07-06
        stat('u-anna', '2026-07-04', 9999, 9999), // older — must not count
      ],
    });

    expect(rows.map((r) => [r.displayName, r.totalSec, r.rank])).toEqual([
      ['Ben', 2000, 1],
      ['Anna', 1500, 2],
      ['Cleo', 0, 3],
    ]);
  });

  it('returns all-zero rows when nothing is sealed yet', () => {
    const rows = buildLeaderboard({ members, today: TODAY, period: 'yesterday', stats: [] });
    expect(rows.map((r) => [r.totalSec, r.rank])).toEqual([
      [0, 1],
      [0, 1],
      [0, 1],
    ]);
  });
});

describe("period 'week'", () => {
  it('covers exactly the 7 calendar days ending yesterday', () => {
    const rows = buildLeaderboard({
      members,
      today: TODAY,
      period: 'week',
      stats: [
        stat('u-anna', '2026-06-30', 100, 0), // first day IN the window (today-7)
        stat('u-anna', '2026-06-29', 5000, 5000), // one day too old — OUT
        stat('u-anna', '2026-07-06', 200, 50), // yesterday — IN
        stat('u-ben', '2026-07-03', 100, 100),
      ],
    });

    const anna = rows.find((r) => r.displayName === 'Anna');
    expect(anna).toMatchObject({ dayLockSec: 300, nightLockSec: 50, totalSec: 350, rank: 1 });
    expect(rows.find((r) => r.displayName === 'Ben')).toMatchObject({ totalSec: 200, rank: 2 });
  });
});

describe("period 'all-time'", () => {
  it('sums everything sealed before today and ignores unknown users', () => {
    const rows = buildLeaderboard({
      members,
      today: TODAY,
      period: 'all-time',
      stats: [
        stat('u-anna', '2026-01-01', 1000, 0),
        stat('u-anna', '2026-07-06', 500, 500),
        stat('u-cleo', '2026-03-15', 100, 300),
        stat('u-stranger', '2026-07-01', 99999, 99999), // not a member — ignored
      ],
    });

    expect(rows.map((r) => [r.displayName, r.dayLockSec, r.nightLockSec, r.totalSec, r.rank])).toEqual([
      ['Anna', 1500, 500, 2000, 1],
      ['Cleo', 100, 300, 400, 2],
      ['Ben', 0, 0, 0, 3],
    ]);
  });
});

describe('ranking', () => {
  it('applies standard competition ranking on exact ties (1, 1, 3)', () => {
    const rows = buildLeaderboard({
      members,
      today: TODAY,
      period: 'all-time',
      stats: [
        stat('u-anna', '2026-07-01', 500, 500),
        stat('u-ben', '2026-07-02', 1000, 0), // ties Anna at 1000
        stat('u-cleo', '2026-07-03', 100, 0),
      ],
    });

    expect(rows.map((r) => [r.displayName, r.totalSec, r.rank])).toEqual([
      ['Anna', 1000, 1], // tie-break: 'u-anna' < 'u-ben'
      ['Ben', 1000, 1],
      ['Cleo', 100, 3],
    ]);
  });

  it('breaks exact ties deterministically by userId ascending', () => {
    const shuffled: LeaderboardMember[] = [
      { userId: uid('u-zoe'), displayName: 'Zoe' },
      { userId: uid('u-adam'), displayName: 'Adam' },
    ];
    const rows = buildLeaderboard({
      members: shuffled,
      today: TODAY,
      period: 'all-time',
      stats: [stat('u-zoe', '2026-07-01', 100, 0), stat('u-adam', '2026-07-01', 100, 0)],
    });
    expect(rows.map((r) => r.displayName)).toEqual(['Adam', 'Zoe']);
    expect(rows.map((r) => r.rank)).toEqual([1, 1]);
  });
});
