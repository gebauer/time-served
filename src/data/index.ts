/**
 * Public API of the data layer (J3). Everything exported here is Node-safe —
 * no react-native / expo imports on the module graph. The two native-touching
 * modules are imported directly by app bootstrap instead:
 *
 * - src/data/adapters/sqlite.ts        → createSQLiteAdapter() (react-native)
 * - src/data/secure/ExpoSecureKeyValueStore.ts (expo-secure-store)
 *
 * Typical wiring (J9/J10):
 *
 *   import { createDatabase, createRepositories } from '../data';
 *   import { createSQLiteAdapter } from '../data/adapters/sqlite';
 *   import { ExpoSecureKeyValueStore } from '../data/secure/ExpoSecureKeyValueStore';
 *
 *   const database = createDatabase(createSQLiteAdapter());
 *   const repos = createRepositories({
 *     database,
 *     secureStore: new ExpoSecureKeyValueStore(),
 *   });
 */
export * from './Repositories';
export { schema, SCHEMA_VERSION } from './schema';
export { migrations } from './migrations';
export { createDatabase } from './database';
export {
  createRepositories,
  type CreateRepositoriesOptions,
  WatermelonBoxRepository,
  WatermelonDayBucketRepository,
  WatermelonNickOverrideRepository,
  WatermelonSessionRepository,
} from './repositories';
export * from './secure';
export { seedDemoData, localDateOf, FIXTURE_IDS, type DemoDataset } from './fixtures';
