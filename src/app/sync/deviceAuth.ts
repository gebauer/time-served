/**
 * Anonymous device-auth bootstrap (BUILD_V1 §10.1, server/README.md §3).
 *
 * First run: generate `user_uuid` (crypto-strength UUID v4) + a random
 * password, persist BOTH in secure storage BEFORE any network call (so a
 * crashed/offline bootstrap retries with the same identity instead of
 * leaking half-registered accounts), then create the `users` record and
 * auth-with-password. The auth response's 15-char record id is the on-wire
 * `user_id` (decision #4) and is persisted via the DeviceCredentialStore
 * contract ({userId, token}); the {user_uuid, password} pair lives in an
 * ADDITIONAL secure-store entry `ts.sync.identity` (decision #10) so the
 * contract shape stays untouched.
 *
 * Offline tolerance: every method that needs the network throws the
 * underlying fetch error when unreachable — callers (seal scheduler, groups
 * gateway) treat that as "retry on next trigger". Nothing here blocks app
 * startup.
 *
 * Token expiry: PocketBase tokens live ~7 days. `authed()` runs a request
 * with the cached token and transparently re-auths + retries ONCE on 401.
 */
import type { UserId } from '../../domain/types';
import type { DeviceCredentialStore } from '../../data/Repositories';
import type { SecureKeyValueStore } from '../../data/secure/SecureKeyValueStore';
import type { RandomBytesFn } from '../../domain/crypto';
import { isPbError, type PocketBaseClient } from './pocketbaseClient';
import { securePassword, secureUuidV4 } from './random';

const IDENTITY_KEY = 'ts.sync.identity';

interface StoredIdentity {
  readonly userUuid: string;
  readonly password: string;
}

export interface DeviceCredential {
  readonly userId: UserId;
  readonly token: string;
}

export interface DeviceAuth {
  /**
   * Register (first run) and/or log in as needed; returns the credential.
   * Cheap when a credential is already cached. Throws when offline.
   */
  ensureAuthed(): Promise<DeviceCredential>;
  /** The persisted user id WITHOUT touching the network (undefined pre-auth). */
  peekUserId(): Promise<UserId | undefined>;
  /** Run an authed request; on 401 re-auth once and retry. */
  authed<T>(run: (token: string) => Promise<T>): Promise<T>;
}

export interface DeviceAuthDeps {
  readonly client: PocketBaseClient;
  /** Secure store for the extra `ts.sync.identity` entry. */
  readonly kv: SecureKeyValueStore;
  /** The contract store for {userId, token}. */
  readonly credentials: DeviceCredentialStore;
  readonly randomBytes?: RandomBytesFn;
}

export function createDeviceAuth(deps: DeviceAuthDeps): DeviceAuth {
  let cached: DeviceCredential | undefined;
  let inFlight: Promise<DeviceCredential> | undefined;

  async function readIdentity(): Promise<StoredIdentity | undefined> {
    const raw = await deps.kv.get(IDENTITY_KEY);
    if (raw === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { userUuid?: unknown }).userUuid === 'string' &&
        typeof (parsed as { password?: unknown }).password === 'string'
      ) {
        return parsed as StoredIdentity;
      }
    } catch {
      // corrupt entry — fall through to regeneration
    }
    return undefined;
  }

  async function getOrCreateIdentity(): Promise<{
    identity: StoredIdentity;
    fresh: boolean;
  }> {
    const existing = await readIdentity();
    if (existing !== undefined) return { identity: existing, fresh: false };
    const identity: StoredIdentity = {
      userUuid: secureUuidV4(deps.randomBytes),
      password: securePassword(deps.randomBytes),
    };
    // Persist BEFORE the network call — bootstrap must be retryable.
    await deps.kv.set(IDENTITY_KEY, JSON.stringify(identity));
    return { identity, fresh: true };
  }

  async function persist(credential: DeviceCredential): Promise<DeviceCredential> {
    cached = credential;
    await deps.credentials.put(credential);
    return credential;
  }

  async function authWith(identity: StoredIdentity): Promise<DeviceCredential> {
    const auth = await deps.client.authWithPassword(
      identity.userUuid,
      identity.password,
    );
    return persist({ userId: auth.record.id as UserId, token: auth.token });
  }

  /** Full login: register if needed, then password auth. */
  async function login(): Promise<DeviceCredential> {
    const { identity, fresh } = await getOrCreateIdentity();
    if (fresh) {
      // Brand-new identity: the record cannot exist yet — create then auth.
      // A duplicate 400 (astronomically unlikely uuid collision, or a lost
      // response from an earlier attempt) falls through to auth anyway.
      try {
        await deps.client.createUser({
          userUuid: identity.userUuid,
          password: identity.password,
        });
      } catch (error) {
        if (!isPbError(error, 400)) throw error;
      }
      return authWith(identity);
    }
    // Existing identity: the record usually exists — try auth first, and
    // register on a 400 (bootstrap crashed between persist and create).
    try {
      return await authWith(identity);
    } catch (error) {
      if (!isPbError(error, 400)) throw error;
      await deps.client.createUser({
        userUuid: identity.userUuid,
        password: identity.password,
      });
      return authWith(identity);
    }
  }

  async function ensureAuthed(): Promise<DeviceCredential> {
    if (cached !== undefined) return cached;
    const stored = await deps.credentials.get();
    if (stored !== undefined) {
      cached = stored;
      return stored;
    }
    // Single-flight: concurrent callers share one bootstrap.
    inFlight ??= login().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  async function reauth(): Promise<DeviceCredential> {
    cached = undefined;
    const identity = await readIdentity();
    if (identity === undefined) return login();
    return authWith(identity);
  }

  return {
    ensureAuthed,
    async peekUserId() {
      if (cached !== undefined) return cached.userId;
      return (await deps.credentials.get())?.userId;
    },
    async authed<T>(run: (token: string) => Promise<T>): Promise<T> {
      const credential = await ensureAuthed();
      try {
        return await run(credential.token);
      } catch (error) {
        if (!isPbError(error, 401)) throw error;
        const renewed = await reauth();
        return run(renewed.token);
      }
    },
  };
}
