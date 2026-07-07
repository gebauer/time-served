/**
 * Sync configuration (J10). The PocketBase base URL comes from the build-time
 * environment — Expo inlines every `EXPO_PUBLIC_*` variable via Metro, so no
 * expo-constants dependency is needed and this module stays Node-testable.
 *
 *   EXPO_PUBLIC_POCKETBASE_URL   e.g. https://ts.example.com  (unset in plain
 *                                dev → NO server → services.ts keeps the stub
 *                                gateway and the dev harness works offline)
 *   EXPO_PUBLIC_INVITE_HOST      host used to BUILD invite links (default
 *                                timeserved.app). Parsing accepts any host —
 *                                only the fragment payload matters.
 *
 * Local example (dev build against a laptop PocketBase):
 *   EXPO_PUBLIC_POCKETBASE_URL=http://192.168.1.10:8090 pnpm expo run:android
 */
export interface SyncConfig {
  /** PocketBase base URL, no trailing slash. `undefined` = local-only mode. */
  readonly serverUrl: string | undefined;
  /** Host for minted invite links (`https://<host>/j#…`). */
  readonly inviteHost: string;
}

export const DEFAULT_INVITE_HOST = 'timeserved.app';

/** Read + normalize the sync config. Malformed URLs degrade to local-only. */
export function loadSyncConfig(
  env: Record<string, string | undefined> = process.env,
): SyncConfig {
  const raw = env.EXPO_PUBLIC_POCKETBASE_URL?.trim();
  let serverUrl: string | undefined;
  if (raw !== undefined && raw !== '') {
    const normalized = raw.replace(/\/+$/, '');
    // http is allowed for LAN dev instances; production must be https (TLS
    // carries k_auth — server/README.md deploy notes).
    serverUrl = /^https?:\/\/[^\s/]+/i.test(normalized) ? normalized : undefined;
  }
  const host = env.EXPO_PUBLIC_INVITE_HOST?.trim();
  return {
    serverUrl,
    inviteHost: host !== undefined && host !== '' ? host : DEFAULT_INVITE_HOST,
  };
}
