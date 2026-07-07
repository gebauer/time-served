/**
 * Sync layer barrel (J10) — Node-safe exports only. sealTriggers.ts (imports
 * react-native) and inviteDeepLink.ts (imports expo-linking) are deliberately
 * NOT re-exported here: the composition root / App.tsx import them directly,
 * keeping this module graph clean for plain-Node tests.
 */
export { DEFAULT_INVITE_HOST, loadSyncConfig, type SyncConfig } from './config';
export {
  createPocketBaseClient,
  isPbError,
  PbError,
  type PocketBaseClient,
} from './pocketbaseClient';
export {
  createDeviceAuth,
  type DeviceAuth,
  type DeviceCredential,
} from './deviceAuth';
export {
  createSealScheduler,
  type SealRunResult,
  type SealScheduler,
  type UploadOutcome,
} from './sealScheduler';
export { createDailyStatUploader } from './dailyStatsUpload';
export {
  createPocketBaseGroupsGateway,
  type PbGroupsGatewayDeps,
} from './groupsGateway';
export { nextSealInstant } from './sealTiming';
export { securePassword, secureUuidV4 } from './random';
