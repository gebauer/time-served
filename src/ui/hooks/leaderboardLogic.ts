/**
 * Pure leaderboard display logic — nick overrides applied before ranking
 * (BUILD_V1 §11 screen 6 "local rename"). Extracted for plain-Node tests.
 */
import type { LeaderboardMember } from '../../domain/scoring';
import type { NickOverride } from '../../domain/types';

/** Replace decrypted nicks with local overrides where present. */
export function applyNickOverrides(
  members: readonly LeaderboardMember[],
  overrides: readonly NickOverride[],
): LeaderboardMember[] {
  const byUser = new Map(overrides.map((o) => [o.memberUserId, o.localLabel]));
  return members.map((member) => {
    const local = byUser.get(member.userId);
    return local === undefined || local.trim().length === 0
      ? member
      : { userId: member.userId, displayName: local };
  });
}
