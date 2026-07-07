/**
 * WatermelonDB schema for the LOCAL tables (BUILD_V1 §4.1). These tables never
 * leave the device — sync only ever touches sealed daily totals + the encrypted
 * name layer, and reads them through the repositories, not through this schema.
 *
 * Columns are snake_case (BUILD_V1 §4.1); the repository layer maps them to the
 * camelCase domain types in src/domain/types.ts. All instants are UTC epoch ms
 * (number columns); `date` is a `YYYY-MM-DD` local-calendar string.
 *
 * NOT tables (secure storage instead, see src/data/secure/): `group_keys` and
 * the device credential live in the OS keystore via expo-secure-store.
 *
 * Record ids:
 * - `boxes` / `sessions`: client-generated UUID v4, supplied by the caller
 *   (CLAUDE.md §7) and written to `_raw.id` on create.
 * - `day_buckets`: the record id IS the `date` string — that is what enforces
 *   the "unique per date" constraint (WatermelonDB has no unique indexes).
 * - `nick_overrides`: the record id is `<group_id>:<member_user_id>` — enforces
 *   uniqueness on the pair. Both are storage details; they never leak into
 *   domain types.
 */
import { appSchema, tableSchema } from '@nozbe/watermelondb';

export const SCHEMA_VERSION = 1;

export const schema = appSchema({
  version: SCHEMA_VERSION,
  tables: [
    tableSchema({
      name: 'boxes',
      columns: [
        { name: 'label', type: 'string' },
        { name: 'location', type: 'string', isOptional: true },
        // V1: always 'charging' (the gate); field exists for future count modes.
        { name: 'count_mode', type: 'string' },
        // 'own' (editable) | 'foreign' (read-only, auto-created from another
        // member's tag; BUILD_V1 §9.2).
        { name: 'origin', type: 'string' },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
        // Soft delete: list() filters on this; row is kept for session FKs.
        { name: 'deleted_at', type: 'number', isOptional: true },
      ],
    }),
    tableSchema({
      name: 'sessions',
      columns: [
        { name: 'box_id', type: 'string', isIndexed: true },
        // Written SYNCHRONOUSLY on entering ACTIVE — the CLAUDE.md §3 invariant.
        { name: 'started_at', type: 'number', isOptional: true },
        { name: 'ended_at', type: 'number', isOptional: true },
        // Heartbeat watermark; bounds a lost session on reconciliation (§7).
        { name: 'last_charging_at', type: 'number', isOptional: true },
        // 'armed' | 'open' | 'closed' | 'discarded'
        { name: 'status', type: 'string', isIndexed: true },
        // 'unplug' | 'reconciled' | 'manual'
        { name: 'end_reason', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
        { name: 'updated_at', type: 'number' },
      ],
    }),
    tableSchema({
      name: 'day_buckets',
      columns: [
        // YYYY-MM-DD local; also the record id (unique). Lexicographic order ==
        // chronological order, so string range queries are correct.
        { name: 'date', type: 'string', isIndexed: true },
        { name: 'day_lock_sec', type: 'number' },
        { name: 'night_lock_sec', type: 'number' },
        // Set once uploaded; sealed days are immutable (BUILD_V1 §5).
        { name: 'sealed_at', type: 'number', isOptional: true },
        // Changed since last recompute.
        { name: 'dirty', type: 'boolean' },
      ],
    }),
    tableSchema({
      name: 'nick_overrides',
      columns: [
        { name: 'group_id', type: 'string', isIndexed: true },
        { name: 'member_user_id', type: 'string' },
        { name: 'local_label', type: 'string' },
      ],
    }),
  ],
});
