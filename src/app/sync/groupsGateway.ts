/**
 * Real GroupsGateway (JOBS.md J10) — J6's crypto + J7's /api/ts/* routes,
 * replacing src/app/stubGroups.ts behind the seam of decision #9.
 *
 * Privacy invariants upheld here (BUILD_V1 §10):
 *  - K_g never leaves the device except inside invite-link FRAGMENTS.
 *  - Only k_auth (= HKDF(K_g,"ts-auth-v1"), base64url) is sent to the server;
 *    it grants access but cannot decrypt (auth ≠ decryption).
 *  - Group names / nicknames travel and rest ONLY as AEAD ciphertexts;
 *    decryption happens client-side after the feed call.
 *
 * Offline behavior: `list()` serves a local snapshot (secure-store entry
 * `ts.sync.groupmeta`, decision #10) so the Groups screen works without a
 * network; create/join/leave/members/stats need the server and throw on
 * transport failure (the UI surfaces the error).
 *
 * `members()` returns decrypted per-group nicks WITHOUT local overrides —
 * the UI applies nick_overrides itself (applyNickOverrides), matching the
 * GroupsGateway interface contract.
 */
import { addDaysToLocalDate, localDateOf } from '../../domain/buckets';
import type { LeaderboardMember } from '../../domain/scoring';
import type {
  Clock,
  DailyStat,
  EpochMs,
  GroupId,
  LocalDate,
  MembershipRole,
  Sealed,
  UserId,
} from '../../domain/types';
import type {
  GroupCrypto,
  InviteLinkCodec,
  RandomBytesFn,
} from '../../domain/crypto';
import { bytesToBase64Url } from '../../domain/crypto';
import type { GroupKeyStore } from '../../data/Repositories';
import type { SecureKeyValueStore } from '../../data/secure/SecureKeyValueStore';
import type { GroupsGateway, GroupSummary } from '../../ui/services/AppServicesContext';
import type { DeviceAuth } from './deviceAuth';
import type { GroupFeedResponseWire, PocketBaseClient } from './pocketbaseClient';
import { secureUuidV4 } from './random';

/** Secure-store key: local snapshot of joined groups (names are sensitive). */
const GROUP_META_KEY = 'ts.sync.groupmeta';

/** Feed date range: server caps at 400 days/call; 366 covers 'all-time' V1. */
const FEED_RANGE_DAYS = 366;

/** Two UI queries (members + stats) share one feed fetch within this window. */
const FEED_MEMO_MS = 15_000;

/** Placeholder when ONE member's ciphertext fails to open (tamper/corrupt) —
 * a single bad row must not brick the whole leaderboard. */
const UNDECRYPTABLE_NICK = '???';

interface CachedGroupMeta {
  readonly name: string;
  readonly role: MembershipRole;
  readonly consented: boolean;
  readonly myNickname: string;
  readonly memberCount: number;
}

export interface PbGroupsGatewayDeps {
  readonly client: PocketBaseClient;
  readonly auth: DeviceAuth;
  readonly crypto: GroupCrypto;
  readonly codec: InviteLinkCodec;
  readonly groupKeys: GroupKeyStore;
  readonly kv: SecureKeyValueStore;
  readonly clock: Clock;
  readonly timeZone: () => string;
  /** Host minted into invite links (`https://<host>/j#…`). */
  readonly inviteHost: string;
  readonly randomBytes?: RandomBytesFn;
}

/** PocketBase datetimes are `YYYY-MM-DD HH:mm:ss.sssZ` — normalize for parse. */
function parsePbDate(value: string): EpochMs {
  const ms = Date.parse(value.replace(' ', 'T'));
  return Number.isFinite(ms) ? ms : 0;
}

export function createPocketBaseGroupsGateway(deps: PbGroupsGatewayDeps): GroupsGateway {
  const feedMemo = new Map<GroupId, { at: EpochMs; feed: GroupFeedResponseWire }>();

  // --- local group-meta snapshot ------------------------------------------

  async function readMeta(): Promise<Record<string, CachedGroupMeta>> {
    const raw = await deps.kv.get(GROUP_META_KEY);
    if (raw === null) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, CachedGroupMeta>)
        : {};
    } catch {
      return {};
    }
  }

  async function patchMeta(
    groupId: GroupId,
    patch: Partial<CachedGroupMeta> | undefined,
  ): Promise<void> {
    const all = await readMeta();
    if (patch === undefined) {
      delete all[groupId];
    } else {
      const defaults: CachedGroupMeta = {
        name: `Gruppe ${groupId.slice(0, 8)}`,
        role: 'member',
        consented: false,
        myNickname: '',
        memberCount: 1,
      };
      all[groupId] = { ...defaults, ...all[groupId], ...patch };
    }
    await deps.kv.set(GROUP_META_KEY, JSON.stringify(all));
  }

  function summaryOf(groupId: GroupId, meta: CachedGroupMeta): GroupSummary {
    return {
      groupId,
      name: meta.name,
      role: meta.role,
      memberCount: meta.memberCount,
      consented: meta.consented,
      myNickname: meta.myNickname,
    };
  }

  // --- key / feed helpers ---------------------------------------------------

  async function keysFor(groupId: GroupId) {
    const kg = await deps.groupKeys.get(groupId);
    if (kg === undefined) {
      throw new Error(`No group key stored for ${groupId} — rejoin via invite link.`);
    }
    const derived = deps.crypto.deriveKeys(kg);
    return { kg, kEnc: derived.kEnc, kAuthB64u: bytesToBase64Url(derived.kAuth) };
  }

  async function fetchFeed(groupId: GroupId): Promise<GroupFeedResponseWire> {
    const now = deps.clock.now();
    const memo = feedMemo.get(groupId);
    if (memo !== undefined && now - memo.at < FEED_MEMO_MS) return memo.feed;

    const { kAuthB64u } = await keysFor(groupId);
    const today: LocalDate = localDateOf(now, deps.timeZone());
    const feed = await deps.auth.authed((token) =>
      deps.client.groupFeed(token, {
        group_id: groupId,
        k_auth: kAuthB64u,
        from_date: addDaysToLocalDate(today, -FEED_RANGE_DAYS),
        to_date: today,
      }),
    );
    feedMemo.set(groupId, { at: now, feed });

    // Opportunistically refresh the local snapshot (name/member count).
    try {
      const { kEnc } = await keysFor(groupId);
      await patchMeta(groupId, {
        name: decryptGroupName(kEnc, feed.enc_group_meta),
        memberCount: feed.memberships.length,
      });
    } catch {
      // Snapshot refresh is best-effort; the feed itself already succeeded.
    }
    return feed;
  }

  function decryptGroupName(kEnc: Uint8Array, encMeta: string): string {
    const meta: unknown = JSON.parse(deps.crypto.open(kEnc, encMeta as Sealed));
    if (
      typeof meta === 'object' &&
      meta !== null &&
      typeof (meta as { name?: unknown }).name === 'string'
    ) {
      return (meta as { name: string }).name;
    }
    throw new Error('enc_group_meta has no name field');
  }

  // --- the gateway ----------------------------------------------------------

  return {
    async list(): Promise<GroupSummary[]> {
      const all = await readMeta();
      return Object.entries(all)
        .map(([groupId, meta]) => summaryOf(groupId as GroupId, meta))
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async create(name: string, nickname: string) {
      const kg = deps.crypto.generateGroupKey();
      const groupId = secureUuidV4(deps.randomBytes) as GroupId;
      const { kEnc, kAuth } = deps.crypto.deriveKeys(kg);
      const response = await deps.auth.authed((token) =>
        deps.client.groupCreate(token, {
          group_id: groupId,
          enc_group_meta: deps.crypto.seal(kEnc, JSON.stringify({ name })),
          auth_hash: deps.crypto.authHash(kAuth),
          enc_nick: deps.crypto.seal(kEnc, nickname),
          consent: true, // creator shares by default (stub parity; BUILD_V1 §10.5)
        }),
      );
      await deps.groupKeys.put(groupId, kg);
      const meta: CachedGroupMeta = {
        name,
        role: response.role,
        consented: response.consent_at !== null,
        myNickname: nickname,
        memberCount: 1,
      };
      await patchMeta(groupId, meta);
      return {
        group: summaryOf(groupId, meta),
        inviteLink: deps.codec.build(deps.inviteHost, { groupId, kg }),
      };
    },

    parseInvite(url: string) {
      const invite = deps.codec.parse(url);
      return invite === undefined ? undefined : { groupId: invite.groupId };
    },

    async join(inviteUrl: string, nickname: string, consent: boolean) {
      const invite = deps.codec.parse(inviteUrl);
      if (invite === undefined) throw new Error('Invalid invite link');
      const { groupId, kg } = invite;
      const { kEnc, kAuth } = deps.crypto.deriveKeys(kg);
      const response = await deps.auth.authed((token) =>
        deps.client.groupJoin(token, {
          group_id: groupId,
          k_auth: bytesToBase64Url(kAuth),
          enc_nick: deps.crypto.seal(kEnc, nickname),
          consent,
        }),
      );
      await deps.groupKeys.put(groupId, kg);
      feedMemo.delete(groupId);

      // Learn the (decrypted) group name + member count from the feed; a
      // transport hiccup here must not undo the successful join.
      let name = `Gruppe ${groupId.slice(0, 8)}`;
      let memberCount = 1;
      try {
        const feed = await fetchFeed(groupId);
        name = decryptGroupName(kEnc, feed.enc_group_meta);
        memberCount = feed.memberships.length;
      } catch {
        // Snapshot refresh happens on the next successful feed.
      }
      const meta: CachedGroupMeta = {
        name,
        role: response.role,
        consented: response.consent_at !== null,
        myNickname: nickname,
        memberCount,
      };
      await patchMeta(groupId, meta);
      return summaryOf(groupId, meta);
    },

    async leave(groupId: GroupId) {
      await deps.auth.authed((token) => deps.client.groupLeave(token, groupId));
      await deps.groupKeys.delete(groupId);
      await patchMeta(groupId, undefined);
      feedMemo.delete(groupId);
    },

    async members(groupId: GroupId): Promise<LeaderboardMember[]> {
      const { kEnc } = await keysFor(groupId);
      const feed = await fetchFeed(groupId);
      return feed.memberships.map((member) => {
        let displayName = UNDECRYPTABLE_NICK;
        try {
          displayName = deps.crypto.open(kEnc, member.enc_nick as Sealed);
        } catch {
          // Tampered/corrupt ciphertext — placeholder instead of a crash.
        }
        return { userId: member.user_id as UserId, displayName };
      });
    },

    async stats(groupId: GroupId): Promise<DailyStat[]> {
      const feed = await fetchFeed(groupId);
      // Server-side consent gate: rows exist only for consented members.
      return feed.daily_stats.map((row) => ({
        userId: row.user_id as UserId,
        date: row.date as LocalDate,
        dayLockSec: row.day_lock_sec,
        nightLockSec: row.night_lock_sec,
        sealedAt: parsePbDate(row.sealed_at),
      }));
    },

    async setNickname(groupId: GroupId, nickname: string) {
      const { kg, kEnc } = await keysFor(groupId);
      const meta = (await readMeta())[groupId];
      const { kAuth } = deps.crypto.deriveKeys(kg);
      // group-join is idempotent: re-joining updates enc_nick, keeps consent.
      const response = await deps.auth.authed((token) =>
        deps.client.groupJoin(token, {
          group_id: groupId,
          k_auth: bytesToBase64Url(kAuth),
          enc_nick: deps.crypto.seal(kEnc, nickname),
          consent: meta?.consented ?? true,
        }),
      );
      feedMemo.delete(groupId);
      await patchMeta(groupId, {
        myNickname: nickname,
        consented: response.consent_at !== null,
      });
    },

    async inviteLink(groupId: GroupId) {
      const kg = await deps.groupKeys.get(groupId);
      if (kg === undefined) return undefined;
      return deps.codec.build(deps.inviteHost, { groupId, kg });
    },

    async myUserId() {
      const peeked = await deps.auth.peekUserId();
      if (peeked !== undefined) return peeked;
      try {
        return (await deps.auth.ensureAuthed()).userId;
      } catch {
        // Offline before first auth — no server id yet; nothing to mark
        // "(du)" against either, so an empty sentinel is harmless.
        return '';
      }
    },
  };
}
