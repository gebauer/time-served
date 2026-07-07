/**
 * Database bootstrap. Adapter is injected so the same construction path serves
 * both runtimes:
 * - app: SQLiteAdapter (JSI) from src/data/adapters/sqlite.ts — import that
 *   module directly in app bootstrap; it is NOT re-exported from src/data/index
 *   because it pulls in react-native and would break plain-Node consumers.
 * - tests / Node: LokiJSAdapter via src/data/testing.ts (in-memory).
 */
import { Database } from '@nozbe/watermelondb';
import type { DatabaseAdapter } from '@nozbe/watermelondb/adapters/type';

import { modelClasses } from './models';

export function createDatabase(adapter: DatabaseAdapter): Database {
  return new Database({ adapter, modelClasses });
}
