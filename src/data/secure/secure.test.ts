import { beforeEach, describe, expect, it } from 'vitest';

import type { GroupId, UserId } from '../../domain/types';
import { base64ToBytes, bytesToBase64 } from './base64';
import { InMemorySecureStore } from './InMemorySecureStore';
import { SecureDeviceCredentialStore, SecureGroupKeyStore } from './stores';

const GROUP_A = 'aaaaaaaa-1111-4111-8111-111111111111' as GroupId;
const GROUP_B = 'bbbbbbbb-2222-4222-8222-222222222222' as GroupId;

describe('base64 codec', () => {
  it('round-trips all lengths mod 3 (padding cases)', () => {
    for (const bytes of [
      new Uint8Array(0),
      Uint8Array.of(0),
      Uint8Array.of(255, 254),
      Uint8Array.of(1, 2, 3),
      Uint8Array.of(0, 127, 128, 255),
      Uint8Array.from({ length: 32 }, (_, i) => (i * 37) % 256),
    ]) {
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    }
  });

  it('matches the standard alphabet/padding', () => {
    // "Man" in ASCII — the canonical RFC 4648 example.
    expect(bytesToBase64(Uint8Array.of(77, 97, 110))).toBe('TWFu');
    expect(bytesToBase64(Uint8Array.of(77, 97))).toBe('TWE=');
    expect(bytesToBase64(Uint8Array.of(77))).toBe('TQ==');
  });

  it('rejects malformed input', () => {
    expect(() => base64ToBytes('abc')).toThrow(/multiple of 4/);
    expect(() => base64ToBytes('ab!=')).toThrow(/invalid character/);
  });
});

describe('SecureGroupKeyStore', () => {
  let store: SecureGroupKeyStore;

  beforeEach(() => {
    store = new SecureGroupKeyStore(new InMemorySecureStore());
  });

  it('round-trips a 256-bit key', async () => {
    const kg = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
    await store.put(GROUP_A, kg);
    expect(await store.get(GROUP_A)).toEqual(kg);
  });

  it('returns undefined for unknown groups', async () => {
    expect(await store.get(GROUP_B)).toBeUndefined();
  });

  it('maintains the group-id index across put/delete', async () => {
    await store.put(GROUP_A, new Uint8Array(32));
    await store.put(GROUP_B, new Uint8Array(32));
    expect((await store.listGroupIds()).sort()).toEqual([GROUP_A, GROUP_B]);

    // re-put must not duplicate the index entry
    await store.put(GROUP_A, new Uint8Array(32));
    expect(await store.listGroupIds()).toHaveLength(2);

    await store.delete(GROUP_A);
    expect(await store.listGroupIds()).toEqual([GROUP_B]);
    expect(await store.get(GROUP_A)).toBeUndefined();
  });
});

describe('SecureDeviceCredentialStore', () => {
  it('round-trips the credential and starts empty', async () => {
    const kv = new InMemorySecureStore();
    const store = new SecureDeviceCredentialStore(kv);
    expect(await store.get()).toBeUndefined();

    const credential = {
      userId: 'cccccccc-3333-4333-8333-333333333333' as UserId,
      token: 'pb-device-token',
    };
    await store.put(credential);
    expect(await store.get()).toEqual(credential);

    // stored under the documented key, as JSON
    expect(kv.snapshot()['ts.credential']).toBe(JSON.stringify(credential));
  });

  it('treats corrupt stored JSON as absent', async () => {
    const kv = new InMemorySecureStore();
    await kv.set('ts.credential', 'not-json');
    expect(await new SecureDeviceCredentialStore(kv).get()).toBeUndefined();
  });
});
