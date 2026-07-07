/**
 * Runtime adapter for the app: SQLite via JSI. Keep this import path OUT of
 * anything that runs on plain Node (it transitively imports react-native) —
 * app bootstrap (J9) imports this module directly:
 *
 *   import { createSQLiteAdapter } from '../data/adapters/sqlite';
 *   import { createDatabase } from '../data';
 *   const database = createDatabase(createSQLiteAdapter());
 */
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import { migrations } from '../migrations';
import { schema } from '../schema';

export function createSQLiteAdapter(
  onSetUpError?: (error: Error) => void
): SQLiteAdapter {
  return new SQLiteAdapter({
    schema,
    migrations,
    dbName: 'timeserved',
    jsi: true,
    onSetUpError:
      onSetUpError ??
      ((error: Error): void => {
        // A corrupted local DB is not recoverable in-process; surface loudly.
        console.error('[data] WatermelonDB failed to set up', error);
      }),
  });
}
