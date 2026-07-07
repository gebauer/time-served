/**
 * Minimal async key-value seam under GroupKeyStore / DeviceCredentialStore.
 * Implementations: ExpoSecureKeyValueStore (Keystore-backed, the app) and
 * InMemorySecureStore (tests / dev harness).
 *
 * Key constraint (from expo-secure-store): keys must contain only
 * alphanumerics, '.', '-' and '_' — the `ts.` namespaced keys used by the
 * stores satisfy this (UUIDs are alphanumeric + '-').
 */
export interface SecureKeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}
