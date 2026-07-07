/**
 * Keystore-backed SecureKeyValueStore via expo-secure-store. This module may
 * import a native API — src/data is one of the allowed homes (CLAUDE.md §6) —
 * but keep it OUT of anything that runs on plain Node.
 */
import * as SecureStore from 'expo-secure-store';

import type { SecureKeyValueStore } from './SecureKeyValueStore';

export class ExpoSecureKeyValueStore implements SecureKeyValueStore {
  async get(key: string): Promise<string | null> {
    return SecureStore.getItemAsync(key);
  }

  async set(key: string, value: string): Promise<void> {
    await SecureStore.setItemAsync(key, value, {
      // iOS-only knob (harmless on Android): available after first unlock so
      // launch-time reconciliation can read the credential before interaction.
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
    });
  }

  async delete(key: string): Promise<void> {
    await SecureStore.deleteItemAsync(key);
  }
}
