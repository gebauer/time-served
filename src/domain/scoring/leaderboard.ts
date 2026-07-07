/**
 * Leaderboard aggregation (BUILD_V1 §4.2/§11 screen 6). The leaderboard is
 * DERIVED, never stored: the caller (J10) fetches the group feed, decrypts
 * nicknames, applies local overrides, and hands this function the plaintext
 * `DailyStat`s of the group's consented members plus display names.
 *
 * Period semantics (sealed stats only ever cover days < today):
 * - 'yesterday' — the single most RECENT sealed day before `today` present in
 *   the stats (not necessarily the calendar yesterday: if nobody has sealed
 *   data for it yet, the latest sealed day wins — §11's "Today=yesterday
 *   sealed").
 * - 'week'      — the 7 calendar days ending yesterday: `today-7 <= date < today`.
 * - 'all-time'  — every stat with `date < today`.
 *
 * Ranking is deterministic: totalSec descending, tie-break by userId
 * ascending (stable across devices). Ranks are 1-based STANDARD COMPETITION
 * ranking: exact totalSec ties share a rank and the next distinct total skips
 * (1, 1, 3).
 *
 * Every member appears in the output — a member without stats in the period
 * gets a zero row (they are on the board, just serving nothing).
 */
import type {
  DailyStat,
  LeaderboardPeriod,
  LeaderboardRow,
  LocalDate,
  UserId,
} from '../types';
import { addDaysToLocalDate } from '../buckets';

export interface LeaderboardMember {
  readonly userId: UserId;
  /** Decrypted per-group nick, already overridden locally where applicable. */
  readonly displayName: string;
}

export interface LeaderboardInput {
  /** Sealed daily stats of the group's consented members (group feed). */
  readonly stats: readonly DailyStat[];
  /** Members to rank; userIds must be unique. Stats of unknown users are ignored. */
  readonly members: readonly LeaderboardMember[];
  readonly period: LeaderboardPeriod;
  /** Today in the viewer's LOCAL zone; only days before it ever count. */
  readonly today: LocalDate;
}

export function buildLeaderboard(input: LeaderboardInput): LeaderboardRow[] {
  const memberIds = new Set(input.members.map((member) => member.userId));
  const past = input.stats.filter(
    (stat) => memberIds.has(stat.userId) && stat.date < input.today,
  );

  let inPeriod: readonly DailyStat[];
  switch (input.period) {
    case 'yesterday': {
      let latest: LocalDate | undefined;
      for (const stat of past) {
        if (latest === undefined || stat.date > latest) latest = stat.date;
      }
      const latestDate = latest;
      inPeriod = latestDate === undefined ? [] : past.filter((stat) => stat.date === latestDate);
      break;
    }
    case 'week': {
      const from = addDaysToLocalDate(input.today, -7);
      inPeriod = past.filter((stat) => stat.date >= from);
      break;
    }
    case 'all-time':
      inPeriod = past;
      break;
  }

  const totals = new Map<UserId, { day: number; night: number }>();
  for (const member of input.members) totals.set(member.userId, { day: 0, night: 0 });
  for (const stat of inPeriod) {
    const total = totals.get(stat.userId);
    if (total === undefined) continue;
    total.day += stat.dayLockSec;
    total.night += stat.nightLockSec;
  }

  const rows = input.members.map((member) => {
    const total = totals.get(member.userId) ?? { day: 0, night: 0 };
    return {
      userId: member.userId,
      displayName: member.displayName,
      dayLockSec: total.day,
      nightLockSec: total.night,
      totalSec: total.day + total.night,
    };
  });

  rows.sort((a, b) => {
    if (b.totalSec !== a.totalSec) return b.totalSec - a.totalSec;
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0;
  });

  // Standard competition ranking: ties share a rank, next distinct skips.
  let position = 0;
  let previousTotal: number | undefined;
  let previousRank = 0;
  return rows.map((row) => {
    position += 1;
    const rank = row.totalSec === previousTotal ? previousRank : position;
    previousTotal = row.totalSec;
    previousRank = rank;
    return { ...row, rank };
  });
}
