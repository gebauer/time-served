/**
 * useLeaderboard(groupId, period) — members + sealed stats from the groups
 * gateway (FIXTURE data until J10), local nick overrides applied, ranked via
 * J2's buildLeaderboard. Long-press rename writes a NickOverride (local only).
 */
import { useCallback } from 'react';

import { localDateOf } from '../../domain/buckets';
import { buildLeaderboard } from '../../domain/scoring';
import type {
  GroupId,
  LeaderboardPeriod,
  LeaderboardRow,
  UserId,
} from '../../domain/types';
import { useAppServices } from '../services/AppServicesContext';
import { applyNickOverrides } from './leaderboardLogic';
import { useAsyncData } from './useAsyncData';

export interface Leaderboard {
  readonly rows: readonly LeaderboardRow[] | undefined;
  readonly myUserId: string | undefined;
  rename(memberUserId: UserId, localLabel: string): Promise<void>;
  clearRename(memberUserId: UserId): Promise<void>;
}

export function useLeaderboard(groupId: GroupId, period: LeaderboardPeriod): Leaderboard {
  const { groups, repositories, clock, settings, events } = useAppServices();

  const { data } = useAsyncData(async () => {
    const [members, stats, overrides, myUserId] = await Promise.all([
      groups.members(groupId),
      groups.stats(groupId),
      repositories.nickOverrides.listForGroup(groupId),
      groups.myUserId(),
    ]);
    const rows = buildLeaderboard({
      stats,
      members: applyNickOverrides(members, overrides),
      period,
      today: localDateOf(clock.now(), settings.timeZone),
    });
    return { rows, myUserId };
  }, [groupId, period]);

  const rename = useCallback(
    async (memberUserId: UserId, localLabel: string) => {
      await repositories.nickOverrides.upsert({ groupId, memberUserId, localLabel });
      events.notify();
    },
    [repositories, groupId, events],
  );

  const clearRename = useCallback(
    async (memberUserId: UserId) => {
      await repositories.nickOverrides.delete(groupId, memberUserId);
      events.notify();
    },
    [repositories, groupId, events],
  );

  return {
    rows: data?.rows,
    myUserId: data?.myUserId,
    rename,
    clearRename,
  };
}
