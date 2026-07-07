/**
 * Test/dev database construction: LokiJSAdapter, which on plain Node (no
 * IndexedDB) falls back to Loki's in-memory adapter — that is exactly what the
 * data-layer tests rely on to exercise the REAL schema/migrations/models
 * without a device. Not exported from src/data/index.ts on purpose.
 */
import { Database } from '@nozbe/watermelondb';
import LokiJSAdapter from '@nozbe/watermelondb/adapters/lokijs';
import logger from '@nozbe/watermelondb/utils/common/logger';

import { createDatabase } from './database';
import { migrations } from './migrations';
import { schema } from './schema';

// Loki chatters "[🍉] Database loaded" etc. on every setup — noise in test output.
logger.silence();

let databaseCounter = 0;

export function createTestAdapter(): LokiJSAdapter {
  databaseCounter += 1;
  return new LokiJSAdapter({
    schema,
    migrations,
    dbName: `timeserved-test-${databaseCounter}`,
    useWebWorker: false,
    useIncrementalIndexedDB: false,
    // The in-memory adapter has nothing to persist; a live autosave interval
    // would only keep the Node event loop busy after tests finish.
    extraLokiOptions: { autosave: false },
  });
}

export function createTestDatabase(): Database {
  return createDatabase(createTestAdapter());
}
