# src/data — local persistence (J3)

WatermelonDB implementation of the repository contract in `Repositories.ts`
(J1, do not modify) plus keystore-backed secure storage. Consumed by J2's
domain logic and wired by J9/J10.

## Public API (what J9/J10 use)

```ts
// Node-safe barrel — no native imports on this module graph:
import { createDatabase, createRepositories, seedDemoData } from '../data';

// Native-touching modules, imported directly by app bootstrap only:
import { createSQLiteAdapter } from '../data/adapters/sqlite'; // react-native (JSI SQLite)
import { ExpoSecureKeyValueStore } from '../data/secure/ExpoSecureKeyValueStore'; // expo-secure-store

const database = createDatabase(createSQLiteAdapter());
const repos = createRepositories({
  database,
  secureStore: new ExpoSecureKeyValueStore(),
  // clock?: Clock — injectable for tests; defaults to Date.now()
});
// repos: Repositories → hand to the domain layer / hooks.
```

For tests and the emulator dev harness: `createTestDatabase()` from
`src/data/testing.ts` (in-memory LokiJS) and `InMemorySecureStore` replace the
native pieces; `seedDemoData(repos)` (fixtures.ts) fills a consistent demo
dataset with deterministic ids (`FIXTURE_IDS`).

## Storage layout decisions (not visible through the contract)

- **No decorators.** Model classes are field-less; repositories read
  `model._raw` under typed raw-row interfaces and write via `_setRaw` (the
  sanitizing setter) — see `models/raw.ts`. This avoids the legacy-decorators
  babel/tsc options the shared configs don't enable.
- **Record ids:** `boxes`/`sessions` use the caller-supplied UUID v4
  (CLAUDE.md §7). `day_buckets` use the `date` string as record id and
  `nick_overrides` use `<group_id>:<member_user_id>` — WatermelonDB has no
  unique indexes, so the id *is* the uniqueness constraint from BUILD_V1 §4.1.
- **`markDirty` on a date without a bucket row creates a zeroed dirty bucket**
  so `findDirty()` feeds it into the next recompute (see CONTRACT_CHANGES.md
  PROPOSAL #4).
- **`boxes.softDelete` works for foreign boxes too**; only `update` is
  own-only (BUILD_V1 §9.2 makes foreign boxes read-only w.r.t. relabeling).
- **Secure storage is not a table** (BUILD_V1 §4.1): `ts.credential` (JSON
  `{userId, token}`), `ts.groupkey.<groupId>` (base64 K_g), `ts.groupkeys`
  (JSON id array — secure stores can't enumerate keys, so listGroupIds needs
  an index entry).

## How the tests run real WatermelonDB on plain Node

`LokiJSAdapter` with `useWebWorker: false` probes for IndexedDB, finds none on
Node, and falls back to Loki's in-memory adapter — no jsdom, no extra vitest
config; the shared `vitest.config.ts` include globs are untouched. Autosave is
disabled in `testing.ts` (nothing to persist; a live interval would keep the
event loop alive). Every `createTestDatabase()` call gets a fresh, isolated
in-memory database.

`pnpm test` runs the whole suite; the data tests cover CRUD round-trips per
repository, the `createOpen` durability semantics (CLAUDE.md §3 invariant),
`findOverlapping` half-open interval logic, seal preservation on upsert,
`findUnsealedBefore` string-date ordering, foreign-box update rejection,
nick-override upsert-on-conflict, the secure stores, and clean schema setup
from empty.

## Migrations

Version 1 is the baseline (empty migration list). Future schema changes: add a
`{ toVersion: N, steps }` entry in `migrations.ts`, bump `SCHEMA_VERSION`,
keep the schema equal to the migrated end state, never edit shipped steps.
