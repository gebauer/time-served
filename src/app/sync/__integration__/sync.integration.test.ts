/**
 * Integration tests against a REAL local PocketBase (J7's binary + migrations
 * + hooks) — run via ./run-integration.sh, which boots a throwaway instance
 * and sets PB_TEST_URL. Without PB_TEST_URL the whole suite is skipped, so
 * `pnpm test` stays green offline.
 *
 * These exercise the exact production modules (client, deviceAuth, seal
 * pipeline, groups gateway) end-to-end: two devices, group create/join via
 * invite link, sealed uploads, decrypted feed, consent gating, enumeration
 * resistance, tamper detection and idempotent recovery.
 */
import { describe, expect, it } from 'vitest';

import {
  createRepositories,
  InMemorySecureStore,
  type Repositories,
} from '../../../data';
import { createTestDatabase } from '../../../data/testing';
import { addDaysToLocalDate, localDateOf } from '../../../domain/buckets';
import {
  bytesToBase64Url,
  createGroupCrypto,
  inviteLinkCodec,
} from '../../../domain/crypto';
import type { Clock, LocalDate, Sealed } from '../../../domain/types';
import type { GroupsGateway } from '../../../ui/services/AppServicesContext';
import { createDailyStatUploader } from '../dailyStatsUpload';
import { createDeviceAuth, type DeviceAuth } from '../deviceAuth';
import { createPocketBaseClient, type PocketBaseClient } from '../pocketbaseClient';
import { createPocketBaseGroupsGateway } from '../groupsGateway';
import { createSealScheduler, type SealScheduler } from '../sealScheduler';

const PB_URL = process.env.PB_TEST_URL;
const ZONE = 'Europe/Berlin';
const crypto = createGroupCrypto();
const clock: Clock = { now: () => Date.now() };

interface Device {
  readonly kv: InMemorySecureStore;
  readonly repos: Repositories;
  readonly client: PocketBaseClient;
  readonly auth: DeviceAuth;
  readonly gateway: GroupsGateway;
  readonly scheduler: SealScheduler;
  syncEnabled: boolean;
}

function makeGateway(device: Pick<Device, 'client' | 'auth' | 'repos' | 'kv'>): GroupsGateway {
  return createPocketBaseGroupsGateway({
    client: device.client,
    auth: device.auth,
    crypto,
    codec: inviteLinkCodec,
    groupKeys: device.repos.groupKeys,
    kv: device.kv,
    clock,
    timeZone: () => ZONE,
    inviteHost: 'timeserved.app',
  });
}

function makeDevice(): Device {
  const kv = new InMemorySecureStore();
  const repos = createRepositories({
    database: createTestDatabase(),
    secureStore: kv,
    clock,
  });
  const client = createPocketBaseClient(PB_URL ?? 'http://unset');
  const auth = createDeviceAuth({ client, kv, credentials: repos.deviceCredential });
  const device: Device = {
    kv,
    repos,
    client,
    auth,
    gateway: undefined as unknown as GroupsGateway,
    scheduler: undefined as unknown as SealScheduler,
    syncEnabled: true,
  };
  (device as { gateway: GroupsGateway }).gateway = makeGateway(device);
  (device as { scheduler: SealScheduler }).scheduler = createSealScheduler({
    dayBuckets: repos.dayBuckets,
    kv,
    clock,
    timeZone: () => ZONE,
    syncEnabled: () => device.syncEnabled,
    getUserId: async () => (await auth.ensureAuthed()).userId,
    upload: createDailyStatUploader(client, auth),
  });
  return device;
}

function today(): LocalDate {
  return localDateOf(clock.now(), ZONE);
}

async function seedBucket(
  device: Device,
  daysAgo: number,
  daySec: number,
  nightSec: number,
): Promise<LocalDate> {
  const date = addDaysToLocalDate(today(), -daysAgo);
  await device.repos.dayBuckets.upsert({
    date,
    dayLockSec: daySec,
    nightLockSec: nightSec,
    dirty: false,
  });
  return date;
}

describe.skipIf(PB_URL === undefined)('sync integration (real PocketBase)', () => {
  // Shared story state — tests run in order within this file.
  const device1 = makeDevice();
  const device2 = makeDevice();
  let inviteLink: string;
  let groupId: string;
  let user1 = '';
  let user2 = '';

  it('bootstraps device auth: users record + password auth + persisted credential', async () => {
    const credential = await device1.auth.ensureAuthed();
    user1 = credential.userId;
    expect(user1).toMatch(/^[a-z0-9]{15}$/); // PB record id, decision #4
    expect(credential.token.split('.')).toHaveLength(3); // JWT
    // Stable across calls and across a fresh DeviceAuth over the same store.
    const again = createDeviceAuth({
      client: device1.client,
      kv: device1.kv,
      credentials: device1.repos.deviceCredential,
    });
    expect((await again.ensureAuthed()).userId).toBe(user1);
  });

  it('device 1 creates a group; server stores only ciphertext + hash', async () => {
    const created = await device1.gateway.create('Familie Integration', 'Jan');
    groupId = created.group.groupId;
    inviteLink = created.inviteLink;
    expect(created.group).toMatchObject({
      name: 'Familie Integration',
      role: 'owner',
      consented: true,
      myNickname: 'Jan',
    });
    expect(inviteLink).toMatch(
      /^https:\/\/timeserved\.app\/j#g=[0-9a-f-]{36}&k=[A-Za-z0-9_-]{43}$/,
    );
  });

  it('device 2 joins via the invite link and decrypts the group name', async () => {
    user2 = (await device2.auth.ensureAuthed()).userId;
    const joined = await device2.gateway.join(inviteLink, 'Mama', true);
    expect(joined).toMatchObject({
      groupId,
      name: 'Familie Integration', // decrypted E2E — server never saw it
      role: 'member',
      consented: true,
      myNickname: 'Mama',
      memberCount: 2,
    });
  });

  it('seal pipeline uploads both devices’ past days, never today', async () => {
    await seedBucket(device1, 2, 3600, 600);
    await seedBucket(device1, 1, 1800, 900);
    await seedBucket(device1, 0, 12345, 0); // today — must stay local
    await seedBucket(device2, 1, 7200, 0);

    const run1 = await device1.scheduler.runOnce();
    expect(run1).toMatchObject({ status: 'ran', uploaded: 2, failed: 0 });
    const run2 = await device2.scheduler.runOnce();
    expect(run2).toMatchObject({ status: 'ran', uploaded: 1, failed: 0 });

    const todayBucket = await device1.repos.dayBuckets.get(today());
    expect(todayBucket?.sealedAt).toBeUndefined();
    const sealed = await device1.repos.dayBuckets.get(addDaysToLocalDate(today(), -1));
    expect(sealed?.sealedAt).toBeDefined();
  });

  it('feed decrypts names/nicks and carries both members’ numbers', async () => {
    const view = makeGateway(device1); // fresh instance → fresh feed memo
    const members = await view.members(groupId as never);
    const byId = new Map(members.map((m) => [m.userId as string, m.displayName]));
    expect(byId.get(user1)).toBe('Jan');
    expect(byId.get(user2)).toBe('Mama');

    const stats = await view.stats(groupId as never);
    const mine = stats.filter((s) => (s.userId as string) === user1);
    const theirs = stats.filter((s) => (s.userId as string) === user2);
    expect(mine.map((s) => [s.date, s.dayLockSec, s.nightLockSec])).toEqual([
      [addDaysToLocalDate(today(), -2), 3600, 600],
      [addDaysToLocalDate(today(), -1), 1800, 900],
    ]);
    expect(theirs).toEqual([
      expect.objectContaining({
        date: addDaysToLocalDate(today(), -1),
        dayLockSec: 7200,
        nightLockSec: 0,
      }),
    ]);
    // Today's numbers never left the device.
    expect(stats.some((s) => s.date === today())).toBe(false);
  });

  it('an unconsented member is listed but their stats are absent', async () => {
    const device3 = makeDevice();
    const user3 = (await device3.auth.ensureAuthed()).userId;
    await device3.gateway.join(inviteLink, 'Lurker', false);
    await seedBucket(device3, 1, 5555, 555);
    const run = await device3.scheduler.runOnce();
    // Upload is NOT consent-gated (own daily_stats are always writable) —
    // only the group FEED filters them.
    expect(run).toMatchObject({ status: 'ran', uploaded: 1 });

    const view = makeGateway(device1);
    const members = await view.members(groupId as never);
    expect(members.map((m) => m.displayName)).toContain('Lurker');
    const stats = await view.stats(groupId as never);
    expect(stats.some((s) => (s.userId as string) === user3)).toBe(false);
  });

  it('wrong K_g is rejected with the same 403 as an unknown group (enumeration resistance)', async () => {
    const forged = inviteLinkCodec.build('timeserved.app', {
      groupId: groupId as never,
      kg: crypto.generateGroupKey(),
    });
    const device4 = makeDevice();
    await expect(device4.gateway.join(forged, 'Eve', true)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('Invalid group credentials.'),
    });

    const unknownGroup = inviteLinkCodec.build('timeserved.app', {
      groupId: '00000000-0000-4000-8000-000000000000' as never,
      kg: crypto.generateGroupKey(),
    });
    await expect(device4.gateway.join(unknownGroup, 'Eve', true)).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('Invalid group credentials.'),
    });
  });

  it('a tampered ciphertext from the server fails AEAD decryption', async () => {
    const kg = await device1.repos.groupKeys.get(groupId as never);
    const { kEnc, kAuth } = crypto.deriveKeys(kg!);
    const feed = await device1.auth.authed((token) =>
      device1.client.groupFeed(token, {
        group_id: groupId,
        k_auth: bytesToBase64Url(kAuth),
        from_date: addDaysToLocalDate(today(), -7),
        to_date: today(),
      }),
    );
    // Baseline: the untampered blob opens.
    expect(() => crypto.open(kEnc, feed.enc_group_meta as Sealed)).not.toThrow();
    // Flip one character deep in the ciphertext → Poly1305 must reject.
    const blob = feed.enc_group_meta;
    const index = blob.length - 6;
    const flipped =
      blob.slice(0, index) + (blob[index] === 'A' ? 'B' : 'A') + blob.slice(index + 1);
    expect(() => crypto.open(kEnc, flipped as Sealed)).toThrow();
  });

  it('re-running the pipeline uploads nothing (idempotent), and a restored device recovers via duplicate-400', async () => {
    // Same device, second run: local sealed_at gates re-selection.
    const rerun = await device1.scheduler.runOnce();
    expect(rerun).toMatchObject({ uploaded: 0, alreadySealed: 0, failed: 0 });

    // "Restored" device: same identity (kv survives), FRESH local database —
    // the same days become selectable again, the server 400s the duplicates
    // and the client marks them sealed locally instead of double-counting.
    const restoredRepos = createRepositories({
      database: createTestDatabase(),
      secureStore: device1.kv,
      clock,
    });
    await restoredRepos.dayBuckets.upsert({
      date: addDaysToLocalDate(today(), -1),
      dayLockSec: 1800,
      nightLockSec: 900,
      dirty: false,
    });
    const restoredScheduler = createSealScheduler({
      dayBuckets: restoredRepos.dayBuckets,
      kv: device1.kv,
      clock,
      timeZone: () => ZONE,
      syncEnabled: () => true,
      getUserId: async () => (await device1.auth.ensureAuthed()).userId,
      upload: createDailyStatUploader(device1.client, device1.auth),
    });
    const recovery = await restoredScheduler.runOnce();
    expect(recovery).toMatchObject({ uploaded: 0, alreadySealed: 1, failed: 0 });
    const bucket = await restoredRepos.dayBuckets.get(addDaysToLocalDate(today(), -1));
    expect(bucket?.sealedAt).toBeDefined();

    // The server kept exactly ONE row for that day.
    const view = makeGateway(device1);
    const stats = await view.stats(groupId as never);
    const rows = stats.filter(
      (s) =>
        (s.userId as string) === user1 && s.date === addDaysToLocalDate(today(), -1),
    );
    expect(rows).toHaveLength(1);
  });

  it('sync OFF uploads nothing and leaves days editable', async () => {
    const device5 = makeDevice();
    const user5 = (await device5.auth.ensureAuthed()).userId;
    await device5.gateway.join(inviteLink, 'Offline-Otto', true);
    await seedBucket(device5, 1, 4242, 42);
    device5.syncEnabled = false;
    const run = await device5.scheduler.runOnce();
    expect(run).toMatchObject({ status: 'sync-off', uploaded: 0, zeroFilled: 0 });
    const bucket = await device5.repos.dayBuckets.get(addDaysToLocalDate(today(), -1));
    expect(bucket?.sealedAt).toBeUndefined(); // still unsealed/editable

    const view = makeGateway(device1);
    const stats = await view.stats(groupId as never);
    expect(stats.some((s) => (s.userId as string) === user5)).toBe(false);
  });

  it('setNickname + leave round-trip against the real hooks', async () => {
    await device2.gateway.setNickname(groupId as never, 'Mutti');
    const view = makeGateway(device1);
    const members = await view.members(groupId as never);
    expect(members.map((m) => m.displayName)).toContain('Mutti');

    await device2.gateway.leave(groupId as never);
    expect(await device2.gateway.list()).toHaveLength(0);
    expect(await device2.gateway.inviteLink(groupId as never)).toBeUndefined();
    const after = await makeGateway(device1).members(groupId as never);
    expect(after.some((m) => (m.userId as string) === user2)).toBe(false);
  });
});
