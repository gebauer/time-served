/**
 * Migrations/schema sanity: the real schema + migrations must set up cleanly
 * from an empty database on the LokiJS adapter (in-memory on Node) and accept
 * a round-trip write. This is the "migrations apply cleanly" gate (JOBS.md J3).
 */
import { describe, expect, it } from 'vitest';

import type { BoxId } from '../domain/types';
import { migrations } from './migrations';
import { createRepositories } from './repositories';
import { SCHEMA_VERSION, schema } from './schema';
import { InMemorySecureStore } from './secure';
import { createTestDatabase } from './testing';

describe('schema + migrations', () => {
  it('declares all four local tables of BUILD_V1 §4.1', () => {
    expect(Object.keys(schema.tables).sort()).toEqual([
      'boxes',
      'day_buckets',
      'nick_overrides',
      'sessions',
    ]);
  });

  it('migrations are consistent with the schema version', () => {
    // Baseline: no steps yet; every future migration must target <= version.
    for (const migration of migrations.sortedMigrations) {
      expect(migration.toVersion).toBeLessThanOrEqual(SCHEMA_VERSION);
    }
    expect(migrations.maxVersion).toBeLessThanOrEqual(SCHEMA_VERSION);
  });

  it('sets up from empty and round-trips a write', async () => {
    const repos = createRepositories({
      database: createTestDatabase(),
      secureStore: new InMemorySecureStore(),
    });
    const id = '4c94bd3e-8d5a-4a86-9f2b-0a1b2c3d4e5f' as BoxId;
    await repos.boxes.create({ id, label: 'Smoke', countMode: 'charging', origin: 'own' });
    const found = await repos.boxes.get(id);
    expect(found?.label).toBe('Smoke');
  });
});
