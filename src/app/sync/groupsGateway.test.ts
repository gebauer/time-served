/**
 * Groups-gateway unit tests (J10) — REAL J6 crypto + invite codec, fake
 * PocketBase honouring the J7 route contracts (auth_hash check, consent
 * gating, idempotent join). The same flows run against a real PocketBase in
 * __integration__/sync.integration.test.ts.
 */
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemorySecureStore, SecureGroupKeyStore } from '../../data';
import { createGroupCrypto, inviteLinkCodec } from '../../domain/crypto';
import type { UserId } from '../../domain/types';
import type { GroupsGateway } from '../../ui/services/AppServicesContext';
import type { DeviceAuth } from './deviceAuth';
import { createPocketBaseGroupsGateway } from './groupsGateway';
import {
  PbError,
  type FeedDailyStatWire,
  type FeedMembershipWire,
  type PocketBaseClient,
} from './pocketbaseClient';

const crypto = createGroupCrypto();
const ME = 'rec00000000000a' as UserId;
const NOW = Date.parse('2026-07-07T07:00:00Z');

interface FakeGroup {
  enc_group_meta: string;
  auth_hash: string;
  memberships: Map<string, FeedMembershipWire>;
  stats: FeedDailyStatWire[];
}

function fakeBackend() {
  const groups = new Map<string, FakeGroup>();
  const sha256hex = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
  const deny = () => new PbError(403, 'Invalid group credentials.');

  const client: PocketBaseClient = {
    baseUrl: 'http://fake',
    createUser: () => Promise.reject(new Error('unused')),
    authWithPassword: () => Promise.reject(new Error('unused')),
    createDailyStat: () => Promise.reject(new Error('unused')),
    async groupCreate(_token, body) {
      if (groups.has(body.group_id)) throw new PbError(400, 'duplicate group');
      const group: FakeGroup = {
        enc_group_meta: body.enc_group_meta,
        auth_hash: body.auth_hash,
        memberships: new Map(),
        stats: [],
      };
      group.memberships.set(ME, {
        user_id: ME,
        enc_nick: body.enc_nick,
        consent_at: body.consent ? '2026-07-07 07:00:00.000Z' : null,
        role: 'owner',
      });
      groups.set(body.group_id, group);
      return {
        group_id: body.group_id,
        role: 'owner',
        consent_at: body.consent ? '2026-07-07 07:00:00.000Z' : null,
      };
    },
    async groupJoin(_token, body) {
      const group = groups.get(body.group_id);
      if (group === undefined || sha256hex(body.k_auth) !== group.auth_hash) {
        throw deny();
      }
      const existing = group.memberships.get(ME);
      const membership: FeedMembershipWire = {
        user_id: ME,
        enc_nick: body.enc_nick,
        consent_at: body.consent
          ? (existing?.consent_at ?? '2026-07-07 07:00:00.000Z')
          : null,
        role: existing?.role ?? 'member',
      };
      group.memberships.set(ME, membership);
      return {
        group_id: body.group_id,
        role: membership.role,
        consent_at: membership.consent_at,
      };
    },
    async groupFeed(_token, body) {
      const group = groups.get(body.group_id);
      if (group === undefined || sha256hex(body.k_auth) !== group.auth_hash) {
        throw deny();
      }
      const consented = new Set(
        [...group.memberships.values()]
          .filter((m) => m.consent_at !== null)
          .map((m) => m.user_id),
      );
      return {
        group_id: body.group_id,
        enc_group_meta: group.enc_group_meta,
        memberships: [...group.memberships.values()],
        daily_stats: group.stats.filter(
          (row) =>
            consented.has(row.user_id) &&
            row.date >= body.from_date &&
            row.date <= body.to_date,
        ),
      };
    },
    async groupLeave(_token, groupId) {
      groups.get(groupId)?.memberships.delete(ME);
    },
  };
  return { client, groups };
}

const fakeAuth: DeviceAuth = {
  ensureAuthed: async () => ({ userId: ME, token: 'tok' }),
  peekUserId: async () => ME,
  authed: (run) => run('tok'),
};

describe('createPocketBaseGroupsGateway', () => {
  let backend: ReturnType<typeof fakeBackend>;
  let kv: InMemorySecureStore;
  let gateway: GroupsGateway;
  let now: number;

  beforeEach(() => {
    backend = fakeBackend();
    kv = new InMemorySecureStore();
    now = NOW;
    gateway = createPocketBaseGroupsGateway({
      client: backend.client,
      auth: fakeAuth,
      crypto,
      codec: inviteLinkCodec,
      groupKeys: new SecureGroupKeyStore(kv),
      kv,
      clock: { now: () => now },
      timeZone: () => 'Europe/Berlin',
      inviteHost: 'timeserved.app',
    });
  });

  it('create: encrypts name/nick, stores K_g, returns a parseable invite link', async () => {
    const { group, inviteLink } = await gateway.create('Familie', 'Jan');
    expect(group).toMatchObject({
      name: 'Familie',
      role: 'owner',
      consented: true,
      myNickname: 'Jan',
      memberCount: 1,
    });
    // The invite link round-trips through the REAL codec.
    const parsed = gateway.parseInvite(inviteLink);
    expect(parsed?.groupId).toBe(group.groupId);
    // Server never saw plaintext.
    const stored = backend.groups.get(group.groupId);
    expect(stored?.enc_group_meta).not.toContain('Familie');
    expect(stored?.auth_hash).toMatch(/^[0-9a-f]{64}$/);
    // K_g persisted → inviteLink() reproduces the same link.
    expect(await gateway.inviteLink(group.groupId)).toBe(inviteLink);
    // list() serves the local snapshot.
    expect(await gateway.list()).toHaveLength(1);
  });

  it('join: derives keys from the link fragment and decrypts the group name', async () => {
    const { group, inviteLink } = await gateway.create('Familie', 'Jan');
    // Second device: fresh local state, same backend.
    const kv2 = new InMemorySecureStore();
    const device2 = createPocketBaseGroupsGateway({
      client: backend.client,
      auth: fakeAuth,
      crypto,
      codec: inviteLinkCodec,
      groupKeys: new SecureGroupKeyStore(kv2),
      kv: kv2,
      clock: { now: () => now },
      timeZone: () => 'Europe/Berlin',
      inviteHost: 'timeserved.app',
    });
    const joined = await device2.join(inviteLink, 'Mama', true);
    expect(joined.groupId).toBe(group.groupId);
    expect(joined.name).toBe('Familie'); // decrypted from enc_group_meta
    expect(joined.consented).toBe(true);
    expect(await device2.list()).toHaveLength(1);
  });

  it('join with a tampered/wrong key link is rejected by the server (403)', async () => {
    const { group } = await gateway.create('Familie', 'Jan');
    const wrongKey = crypto.generateGroupKey();
    const forged = inviteLinkCodec.build('timeserved.app', {
      groupId: group.groupId,
      kg: wrongKey,
    });
    const kv2 = new InMemorySecureStore();
    const device2 = createPocketBaseGroupsGateway({
      client: backend.client,
      auth: fakeAuth,
      crypto,
      codec: inviteLinkCodec,
      groupKeys: new SecureGroupKeyStore(kv2),
      kv: kv2,
      clock: { now: () => now },
      timeZone: () => 'Europe/Berlin',
      inviteHost: 'timeserved.app',
    });
    await expect(device2.join(forged, 'Eve', true)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('members: decrypts nicks; a tampered nick degrades to a placeholder, not a crash', async () => {
    const { group } = await gateway.create('Familie', 'Jan');
    const stored = backend.groups.get(group.groupId);
    const other = 'rec00000000000b';
    stored?.memberships.set(other, {
      user_id: other,
      enc_nick: 'AAAA' + stored.memberships.get(ME)!.enc_nick.slice(4), // tampered
      consent_at: null,
      role: 'member',
    });
    const members = await gateway.members(group.groupId);
    expect(members).toHaveLength(2);
    expect(members.find((m) => m.userId === ME)?.displayName).toBe('Jan');
    expect(members.find((m) => m.userId === (other as UserId))?.displayName).toBe('???');
  });

  it('stats: maps wire rows and honours the server-side consent gate', async () => {
    const { group } = await gateway.create('Familie', 'Jan');
    const stored = backend.groups.get(group.groupId)!;
    const consentless = 'rec00000000000c';
    stored.memberships.set(consentless, {
      user_id: consentless,
      enc_nick: crypto.seal(crypto.deriveKeys((await new SecureGroupKeyStore(kv).get(group.groupId))!).kEnc, 'Silent'),
      consent_at: null,
      role: 'member',
    });
    stored.stats.push(
      {
        user_id: ME,
        date: '2026-07-06',
        day_lock_sec: 3600,
        night_lock_sec: 900,
        sealed_at: '2026-07-07 10:00:00.000Z',
      },
      {
        user_id: consentless,
        date: '2026-07-06',
        day_lock_sec: 999,
        night_lock_sec: 999,
        sealed_at: '2026-07-07 10:00:00.000Z',
      },
    );
    const stats = await gateway.stats(group.groupId);
    expect(stats).toHaveLength(1); // unconsented member filtered by the server
    expect(stats[0]).toEqual({
      userId: ME,
      date: '2026-07-06',
      dayLockSec: 3600,
      nightLockSec: 900,
      sealedAt: Date.parse('2026-07-07T10:00:00.000Z'),
    });
  });

  it('setNickname re-joins idempotently and keeps consent', async () => {
    const { group } = await gateway.create('Familie', 'Jan');
    now += 20_000; // step past the feed memo window
    await gateway.setNickname(group.groupId, 'Papa');
    const summaries = await gateway.list();
    expect(summaries[0].myNickname).toBe('Papa');
    expect(summaries[0].consented).toBe(true);
    now += 20_000;
    const members = await gateway.members(group.groupId);
    expect(members.find((m) => m.userId === ME)?.displayName).toBe('Papa');
  });

  it('leave deletes the key, the membership and the local snapshot', async () => {
    const { group } = await gateway.create('Familie', 'Jan');
    await gateway.leave(group.groupId);
    expect(await gateway.list()).toHaveLength(0);
    expect(await gateway.inviteLink(group.groupId)).toBeUndefined();
    expect(backend.groups.get(group.groupId)?.memberships.size).toBe(0);
  });

  it('parseInvite rejects non-invite URLs', () => {
    expect(gateway.parseInvite('https://example.com/nope')).toBeUndefined();
    expect(gateway.parseInvite('timeserved://box/123?v=1')).toBeUndefined();
  });

  it('myUserId returns the PB record id', async () => {
    expect(await gateway.myUserId()).toBe(ME);
  });

  it('wrong K_g cannot decrypt a sealed blob (tamper check at the crypto layer)', async () => {
    const { group } = await gateway.create('Geheim', 'Jan');
    const stored = backend.groups.get(group.groupId)!;
    const wrong = crypto.deriveKeys(crypto.generateGroupKey());
    expect(() =>
      crypto.open(wrong.kEnc, stored.enc_group_meta as never),
    ).toThrow();
  });
});
