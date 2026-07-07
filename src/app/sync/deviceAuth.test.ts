/**
 * Device-auth bootstrap unit tests (J10) — fake PocketBase client simulating
 * the server contract (server/README.md §3): open user create, password auth,
 * 401 on stale tokens, 400 on duplicate user_uuid / bad credentials.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemorySecureStore, SecureDeviceCredentialStore } from '../../data';
import { createDeviceAuth, type DeviceAuth } from './deviceAuth';
import {
  PbError,
  type AuthResponseWire,
  type PocketBaseClient,
  type UserRecordWire,
} from './pocketbaseClient';

interface FakeServer {
  client: PocketBaseClient;
  users: Map<string, { password: string; id: string }>;
  calls: { createUser: number; auth: number };
  /** Tokens issued so far, newest last. */
  tokens: string[];
  /** When true, every request throws a network error. */
  offline: boolean;
  /** Tokens considered expired (authed requests would 401). */
  expired: Set<string>;
}

function fakeServer(): FakeServer {
  const users = new Map<string, { password: string; id: string }>();
  const calls = { createUser: 0, auth: 0 };
  const tokens: string[] = [];
  const server: FakeServer = {
    users,
    calls,
    tokens,
    offline: false,
    expired: new Set(),
    client: {
      baseUrl: 'http://fake',
      async createUser({ userUuid, password }): Promise<UserRecordWire> {
        if (server.offline) throw new TypeError('Network request failed');
        calls.createUser += 1;
        if (users.has(userUuid)) throw new PbError(400, 'duplicate user_uuid');
        const id = `rec${String(users.size).padStart(12, '0')}`;
        users.set(userUuid, { password, id });
        return { id, user_uuid: userUuid };
      },
      async authWithPassword(identity, password): Promise<AuthResponseWire> {
        if (server.offline) throw new TypeError('Network request failed');
        calls.auth += 1;
        const user = users.get(identity);
        if (user === undefined || user.password !== password) {
          throw new PbError(400, 'Failed to authenticate.');
        }
        const token = `token-${tokens.length}`;
        tokens.push(token);
        return { token, record: { id: user.id, user_uuid: identity } };
      },
      createDailyStat: () => Promise.reject(new Error('unused')),
      groupCreate: () => Promise.reject(new Error('unused')),
      groupJoin: () => Promise.reject(new Error('unused')),
      groupFeed: () => Promise.reject(new Error('unused')),
      groupLeave: () => Promise.reject(new Error('unused')),
    },
  };
  return server;
}

describe('createDeviceAuth', () => {
  let server: FakeServer;
  let kv: InMemorySecureStore;
  let auth: DeviceAuth;

  beforeEach(() => {
    server = fakeServer();
    kv = new InMemorySecureStore();
    auth = createDeviceAuth({
      client: server.client,
      kv,
      credentials: new SecureDeviceCredentialStore(kv),
    });
  });

  it('bootstraps on first run: create → auth → persist', async () => {
    const credential = await auth.ensureAuthed();
    expect(credential.userId).toMatch(/^rec/);
    expect(credential.token).toBe('token-0');
    expect(server.calls).toEqual({ createUser: 1, auth: 1 });
    // identity persisted for later re-auth
    const identity = JSON.parse((await kv.get('ts.sync.identity')) ?? '{}');
    expect(identity.userUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(server.users.has(identity.userUuid)).toBe(true);
    // credential persisted through the contract store
    const stored = await new SecureDeviceCredentialStore(kv).get();
    expect(stored).toEqual({ userId: credential.userId, token: credential.token });
  });

  it('is cheap once authed (no further network calls)', async () => {
    await auth.ensureAuthed();
    await auth.ensureAuthed();
    await auth.ensureAuthed();
    expect(server.calls).toEqual({ createUser: 1, auth: 1 });
  });

  it('single-flights concurrent bootstraps', async () => {
    const [a, b] = await Promise.all([auth.ensureAuthed(), auth.ensureAuthed()]);
    expect(a).toEqual(b);
    expect(server.calls).toEqual({ createUser: 1, auth: 1 });
  });

  it('is offline-tolerant: identity survives a failed bootstrap and is reused', async () => {
    server.offline = true;
    await expect(auth.ensureAuthed()).rejects.toThrow('Network request failed');
    const identity = JSON.parse((await kv.get('ts.sync.identity')) ?? '{}');
    expect(identity.userUuid).toBeDefined();

    server.offline = false;
    const credential = await auth.ensureAuthed();
    // Registered under the SAME uuid generated during the offline attempt.
    expect(server.users.get(identity.userUuid)?.id).toBe(credential.userId);
    expect(server.users.size).toBe(1);
  });

  it('recovers when the account exists but the local credential is lost', async () => {
    // First device life: full bootstrap.
    await auth.ensureAuthed();
    // "Restart" with identity intact but credential store wiped.
    await kv.delete('ts.credential');
    const auth2 = createDeviceAuth({
      client: server.client,
      kv,
      credentials: new SecureDeviceCredentialStore(kv),
    });
    const credential = await auth2.ensureAuthed();
    expect(credential.token).toBe('token-1');
    // No second users record created.
    expect(server.users.size).toBe(1);
  });

  it('recovers when bootstrap crashed between identity persist and create', async () => {
    // Simulate: identity exists locally, server never saw the create.
    await kv.set(
      'ts.sync.identity',
      JSON.stringify({ userUuid: '11111111-2222-4333-8444-555555555555', password: 'pw-pw-pw-pw' }),
    );
    const credential = await auth.ensureAuthed();
    expect(credential.token).toBeDefined();
    // auth failed once (400) → created → authed again
    expect(server.calls.createUser).toBe(1);
    expect(server.calls.auth).toBe(2);
  });

  it('authed(): transparently re-auths and retries once on 401', async () => {
    const first = await auth.ensureAuthed();
    server.expired.add(first.token);
    const result = await auth.authed(async (token) => {
      if (server.expired.has(token)) throw new PbError(401, 'expired');
      return `ok:${token}`;
    });
    expect(result).toBe('ok:token-1');
    // renewed credential persisted
    const stored = await new SecureDeviceCredentialStore(kv).get();
    expect(stored?.token).toBe('token-1');
  });

  it('authed(): non-401 errors propagate untouched', async () => {
    await auth.ensureAuthed();
    await expect(
      auth.authed(() => Promise.reject(new PbError(403, 'Invalid group credentials.'))),
    ).rejects.toMatchObject({ status: 403 });
    expect(server.calls.auth).toBe(1); // no re-auth attempted
  });

  it('peekUserId never touches the network', async () => {
    server.offline = true;
    expect(await auth.peekUserId()).toBeUndefined();
    server.offline = false;
    const { userId } = await auth.ensureAuthed();
    server.offline = true;
    expect(await auth.peekUserId()).toBe(userId);
  });
});
