/**
 * Wires the WatermelonDB repositories + secure stores into the `Repositories`
 * bundle the domain layer receives (src/data/Repositories.ts). This is the
 * public entry point for J9/J10:
 *
 *   const database = createDatabase(adapter);          // src/data/database.ts
 *   const repos = createRepositories({ database, secureStore });
 */
import type { Database } from '@nozbe/watermelondb';

import type { Clock } from '../../domain/types';
import type { Repositories } from '../Repositories';
import { SecureDeviceCredentialStore, SecureGroupKeyStore } from '../secure/stores';
import type { SecureKeyValueStore } from '../secure/SecureKeyValueStore';
import { WatermelonBoxRepository } from './WatermelonBoxRepository';
import { WatermelonDayBucketRepository } from './WatermelonDayBucketRepository';
import { WatermelonNickOverrideRepository } from './WatermelonNickOverrideRepository';
import { WatermelonSessionRepository } from './WatermelonSessionRepository';

export interface CreateRepositoriesOptions {
  database: Database;
  /** ExpoSecureKeyValueStore in the app; InMemorySecureStore in tests/dev. */
  secureStore: SecureKeyValueStore;
  /** Stamps created_at/updated_at/deleted_at. Defaults to Date.now(). */
  clock?: Clock;
}

const systemClock: Clock = { now: () => Date.now() };

export function createRepositories(options: CreateRepositoriesOptions): Repositories {
  const clock = options.clock ?? systemClock;
  return {
    sessions: new WatermelonSessionRepository(options.database, clock),
    boxes: new WatermelonBoxRepository(options.database, clock),
    dayBuckets: new WatermelonDayBucketRepository(options.database),
    nickOverrides: new WatermelonNickOverrideRepository(options.database),
    groupKeys: new SecureGroupKeyStore(options.secureStore),
    deviceCredential: new SecureDeviceCredentialStore(options.secureStore),
  };
}

export { WatermelonBoxRepository } from './WatermelonBoxRepository';
export { WatermelonDayBucketRepository } from './WatermelonDayBucketRepository';
export { WatermelonNickOverrideRepository } from './WatermelonNickOverrideRepository';
export { WatermelonSessionRepository } from './WatermelonSessionRepository';
