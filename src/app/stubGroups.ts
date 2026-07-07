/**
 * In-memory GroupsGateway STUB (JOBS.md J8) — fully drives the Groups/
 * Leaderboard/Settings screens against fixture members and deterministic
 * sealed stats. Groups sync is J10:
 *
 * >>> J10: REPLACE createStubGroupsGateway in services.ts with the real
 * PocketBase-backed gateway (J7 routes + J6 crypto). The GroupsGateway
 * interface in src/ui/services/AppServicesContext.ts is the seam. <<<
 */
import { addDaysToLocalDate, localDateOf } from '../domain/buckets';
import type { LeaderboardMember } from '../domain/scoring';
import type {
  Clock,
  DailyStat,
  EpochMs,
  GroupId,
  IdSource,
  MembershipRole,
  UserId,
} from '../domain/types';
import type { Repositories } from '../data/Repositories';
import { FIXTURE_IDS } from '../data';
import type { GroupsGateway, GroupSummary } from '../ui/services/AppServicesContext';
import { stubGenerateGroupKey, stubInviteLinkCodec } from './stubCrypto';

interface StubMember {
  readonly userId: UserId;
  nickname: string;
}

interface StubGroup {
  readonly groupId: GroupId;
  name: string;
  role: MembershipRole;
  consented: boolean;
  members: StubMember[];
  kg: Uint8Array;
}

const INVITE_HOST = 'timeserved.app';
const PAPA_USER = 'c5f43a78-7777-4d9a-8e4c-2b3c4d5e6f7a' as UserId;

export interface StubGroupsDeps {
  readonly repositories: Repositories;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly timeZone: string;
}

export function createStubGroupsGateway(deps: StubGroupsDeps): GroupsGateway {
  const me = FIXTURE_IDS.demoUser;
  const groups = new Map<GroupId, StubGroup>();

  // Seeded demo group, consistent with J3's fixtures (group key + nick
  // override "Petra" for demoMember already seeded by seedDemoData).
  groups.set(FIXTURE_IDS.demoGroup, {
    groupId: FIXTURE_IDS.demoGroup,
    name: 'Familie',
    role: 'owner',
    consented: true,
    members: [
      { userId: me, nickname: 'Jan' },
      { userId: FIXTURE_IDS.demoMember, nickname: 'Mama' },
      { userId: PAPA_USER, nickname: 'Papa' },
    ],
    kg: Uint8Array.from({ length: 32 }, (_, i) => i),
  });

  function summary(group: StubGroup): GroupSummary {
    return {
      groupId: group.groupId,
      name: group.name,
      role: group.role,
      memberCount: group.members.length,
      consented: group.consented,
      myNickname: group.members.find((m) => m.userId === me)?.nickname ?? '—',
    };
  }

  /** Deterministic pseudo-stats: ~10 sealed days per member before today. */
  function generateStats(group: StubGroup, now: EpochMs): DailyStat[] {
    const today = localDateOf(now, deps.timeZone);
    const stats: DailyStat[] = [];
    group.members.forEach((member, memberIndex) => {
      if (member.userId === me) return; // own numbers come from real seals (J10)
      for (let daysAgo = 1; daysAgo <= 10; daysAgo += 1) {
        const seed = (daysAgo * 7 + memberIndex * 13) % 9;
        stats.push({
          userId: member.userId,
          date: addDaysToLocalDate(today, -daysAgo),
          dayLockSec: (seed + 1) * 1200,
          nightLockSec: ((seed * 5) % 7) * 2400,
          sealedAt: now - daysAgo * 86_400_000,
        });
      }
    });
    // My own sealed buckets (from the fixture data / live seals) join the board.
    return stats;
  }

  return {
    async list(): Promise<GroupSummary[]> {
      return [...groups.values()].map(summary);
    },

    async create(name: string, nickname: string) {
      // reason: designated creation point of a GroupId in the stub
      const groupId = deps.ids.newId() as GroupId;
      const kg = stubGenerateGroupKey();
      const group: StubGroup = {
        groupId,
        name,
        role: 'owner',
        consented: true,
        members: [{ userId: me, nickname }],
        kg,
      };
      groups.set(groupId, group);
      await deps.repositories.groupKeys.put(groupId, kg);
      return {
        group: summary(group),
        inviteLink: stubInviteLinkCodec.build(INVITE_HOST, { groupId, kg }),
      };
    },

    parseInvite(url: string) {
      const invite = stubInviteLinkCodec.parse(url);
      return invite === undefined ? undefined : { groupId: invite.groupId };
    },

    async join(inviteUrl: string, nickname: string, consent: boolean) {
      const invite = stubInviteLinkCodec.parse(inviteUrl);
      if (invite === undefined) throw new Error('invalid invite link');
      let group = groups.get(invite.groupId);
      if (group === undefined) {
        // Unknown group: the stub fabricates one (the real gateway fetches
        // enc_group_meta and decrypts the name with the link's key).
        group = {
          groupId: invite.groupId,
          name: `Gruppe ${invite.groupId.slice(0, 8)}`,
          role: 'member',
          consented: consent,
          members: [{ userId: FIXTURE_IDS.demoMember, nickname: 'Mitglied' }],
          kg: invite.kg,
        };
        groups.set(invite.groupId, group);
      }
      group.consented = consent;
      if (!group.members.some((m) => m.userId === me)) {
        group.members.push({ userId: me, nickname });
      } else {
        group.members = group.members.map((m) =>
          m.userId === me ? { ...m, nickname } : m,
        );
      }
      await deps.repositories.groupKeys.put(group.groupId, invite.kg);
      return summary(group);
    },

    async leave(groupId: GroupId) {
      groups.delete(groupId);
      await deps.repositories.groupKeys.delete(groupId);
    },

    async members(groupId: GroupId): Promise<LeaderboardMember[]> {
      const group = groups.get(groupId);
      if (group === undefined) return [];
      return group.members.map((m) => ({ userId: m.userId, displayName: m.nickname }));
    },

    async stats(groupId: GroupId): Promise<DailyStat[]> {
      const group = groups.get(groupId);
      if (group === undefined) return [];
      const now = deps.clock.now();
      const stats = generateStats(group, now);
      // Merge my real sealed day buckets so the local user is honestly ranked.
      const today = localDateOf(now, deps.timeZone);
      const mine = await deps.repositories.dayBuckets.listRange(
        addDaysToLocalDate(today, -30),
        today,
      );
      for (const bucket of mine) {
        if (bucket.sealedAt === undefined) continue;
        stats.push({
          userId: me,
          date: bucket.date,
          dayLockSec: bucket.dayLockSec,
          nightLockSec: bucket.nightLockSec,
          sealedAt: bucket.sealedAt,
        });
      }
      return stats;
    },

    async setNickname(groupId: GroupId, nickname: string) {
      const group = groups.get(groupId);
      if (group === undefined) return;
      group.members = group.members.map((m) =>
        m.userId === me ? { ...m, nickname } : m,
      );
    },

    async inviteLink(groupId: GroupId) {
      const group = groups.get(groupId);
      if (group === undefined) return undefined;
      return stubInviteLinkCodec.build(INVITE_HOST, { groupId, kg: group.kg });
    },

    async myUserId() {
      const credential = await deps.repositories.deviceCredential.get();
      return credential?.userId ?? me;
    },
  };
}
