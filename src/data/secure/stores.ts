/**
 * GroupKeyStore + DeviceCredentialStore (src/data/Repositories.ts) on top of a
 * SecureKeyValueStore. NOT WatermelonDB tables (BUILD_V1 §4.1): group keys and
 * the device credential are key material and belong in the OS keystore.
 *
 * Key layout:
 * - `ts.credential`                 JSON { userId, token }
 * - `ts.groupkey.<groupId>`         base64(K_g)
 * - `ts.groupkeys`                  JSON string[] — index for listGroupIds()
 *                                   (secure stores cannot enumerate keys)
 */
import type { GroupId, UserId } from '../../domain/types';
import type { DeviceCredentialStore, GroupKeyStore } from '../Repositories';
import { base64ToBytes, bytesToBase64 } from './base64';
import type { SecureKeyValueStore } from './SecureKeyValueStore';

const CREDENTIAL_KEY = 'ts.credential';
const GROUP_KEY_PREFIX = 'ts.groupkey.';
const GROUP_INDEX_KEY = 'ts.groupkeys';

export class SecureGroupKeyStore implements GroupKeyStore {
  constructor(private readonly kv: SecureKeyValueStore) {}

  async put(groupId: GroupId, kg: Uint8Array): Promise<void> {
    await this.kv.set(GROUP_KEY_PREFIX + groupId, bytesToBase64(kg));
    const ids = await this.readIndex();
    if (!ids.includes(groupId)) {
      await this.writeIndex([...ids, groupId]);
    }
  }

  async get(groupId: GroupId): Promise<Uint8Array | undefined> {
    const encoded = await this.kv.get(GROUP_KEY_PREFIX + groupId);
    return encoded === null ? undefined : base64ToBytes(encoded);
  }

  async delete(groupId: GroupId): Promise<void> {
    await this.kv.delete(GROUP_KEY_PREFIX + groupId);
    const ids = await this.readIndex();
    if (ids.includes(groupId)) {
      await this.writeIndex(ids.filter((id) => id !== groupId));
    }
  }

  async listGroupIds(): Promise<GroupId[]> {
    return this.readIndex();
  }

  private async readIndex(): Promise<GroupId[]> {
    const raw = await this.kv.get(GROUP_INDEX_KEY);
    if (raw === null) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? (parsed.filter((entry): entry is string => typeof entry === 'string') as GroupId[])
        : [];
    } catch {
      return []; // corrupt index — keys themselves are still per-group entries
    }
  }

  private async writeIndex(ids: GroupId[]): Promise<void> {
    await this.kv.set(GROUP_INDEX_KEY, JSON.stringify(ids));
  }
}

export class SecureDeviceCredentialStore implements DeviceCredentialStore {
  constructor(private readonly kv: SecureKeyValueStore) {}

  async get(): Promise<{ userId: UserId; token: string } | undefined> {
    const raw = await this.kv.get(CREDENTIAL_KEY);
    if (raw === null) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        typeof (parsed as { userId?: unknown }).userId === 'string' &&
        typeof (parsed as { token?: unknown }).token === 'string'
      ) {
        const { userId, token } = parsed as { userId: string; token: string };
        return { userId: userId as UserId, token };
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async put(credential: { userId: UserId; token: string }): Promise<void> {
    await this.kv.set(
      CREDENTIAL_KEY,
      JSON.stringify({ userId: credential.userId, token: credential.token })
    );
  }
}
