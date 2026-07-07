/**
 * WatermelonDB schema migrations. Version 1 is the baseline (fresh installs get
 * the schema directly; there is nothing to migrate from), so the list is empty.
 *
 * Process for future changes (WatermelonDB requires this exact order):
 * 1. Add a `{ toVersion: N, steps: [...] }` entry here (addColumns/createTable).
 * 2. Bump `SCHEMA_VERSION` in schema.ts and make the schema match the migrated
 *    end state.
 * 3. Never edit or remove a shipped migration step.
 */
import { schemaMigrations } from '@nozbe/watermelondb/Schema/migrations';

export const migrations = schemaMigrations({
  migrations: [
    // Baseline is version 1 — first migration will be `{ toVersion: 2, ... }`.
  ],
});
