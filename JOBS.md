# JOBS.md — Time Served, parallel work packages for Claude Code

Companion to `CLAUDE.md` (rules) and `BUILD_V1.md` (what to build). This file slices V1 into
jobs that independent agents can work on **in parallel**, with explicit contracts so they
don't collide. Every agent reads CLAUDE.md first; section references (§) point into BUILD_V1.md.

## Dependency graph

```
J1 Scaffold & contracts  ──────────────┐  (blocking: everything depends on it)
        │
        ├─► J2 Domain: session machine + day/night bucketing   (pure TS)
        ├─► J3 Data layer: WatermelonDB schema + repositories  (TS + native db)
        ├─► J4 NFC: tag read/write + config plugin             (TS + plugin)
        ├─► J5 FGS: Kotlin module + power receiver             (Kotlin + plugin)
        ├─► J6 Crypto: HKDF/AEAD + invite-link codec           (pure TS)
        ├─► J7 Backend: PocketBase collections/rules/hook      (fully independent, JS)
        └─► J8 UI: screens against mocked hooks                (TSX)
                     │
J9  Integration A: adapters → machine → data (needs J2,J3,J4,J5)
J10 Integration B: seal scheduler + groups + sync (needs J2,J3,J6,J7)
J11 Hardening & onboarding (needs J9,J10, parts of J8)
```

J2–J8 are mutually parallel once J1 lands. J7 can even start **before** J1 (it doesn't share
code with the app). J9 and J10 are parallel to each other.

Rule for all agents: **do not edit another job's directories.** Shared types live only in
`src/domain/types.ts` and the interface files created by J1; changing a contract requires a
note in `docs/CONTRACT_CHANGES.md` and is otherwise forbidden.

---

## J1 — Scaffold & contracts (BLOCKING, do first, single agent)

Deliverables:
- Expo app (dev-build workflow), TypeScript strict, pnpm, ESLint, folder layout per
  CLAUDE.md §6 (`src/domain`, `src/platform`, `src/data`, `src/ui`, `src/app`, `modules/`,
  `plugins/`, `docs/`).
- `src/domain/types.ts`: all shared types — `DomainEvent` union (`TAG_READ`,
  `CHARGING_STARTED`, `CHARGING_STOPPED`, `CHARGING_HEARTBEAT`, `APP_RESUMED`, `ARM_TIMEOUT`),
  `SessionState`, `Session`, `Box`, `DayBucket`, `DailyStat`, `Group`, `Membership`, ids as
  branded string types.
- Interface files with full doc comments (no implementations):
  `src/platform/TagReader.ts`, `src/platform/PowerStateProvider.ts`,
  `src/platform/SessionRuntime.ts`, `src/data/Repositories.ts` (repository interfaces J3 will
  implement, J2/J8 will consume), `src/domain/crypto/CryptoPorts.ts` (what J6 implements).
- iOS stubs in `src/platform/ios/` (throw NotImplemented) so the seam compiles.
- Node test harness (`vitest` or `jest` on plain Node) + one passing dummy test.
- `docs/CONTRACT_CHANGES.md` (empty, with the process note).
- Repo hygiene: `.gitignore` (Expo), `README.md` pointing at the three docs.

Done when: `pnpm typecheck && pnpm lint && pnpm test` green; all interfaces compile; no
implementation code beyond stubs.

## J2 — Domain: state machine + bucketing (pure TS, no native imports)

Owns: `src/domain/session/`, `src/domain/buckets/`, `src/domain/scoring/`.

- Session reducer per §6: IDLE→ARMED→ACTIVE→CLOSED, ARM_TIMEOUT (default 120 s), re-arm,
  heartbeat, synchronous `started_at` persistence via the J1 repository interface.
- Reconciliation function per §7 (operates on repository interface, injectable clock).
- Day/night splitter per §5: slice sessions at 00:00 / 08:00 / 22:00 local, attribute to
  `(calendar_date, category)`; recompute dirty `day_buckets`.
- Scoring: aggregate sealed daily stats into leaderboard rows (today=yesterday-sealed, week,
  all-time).
- **Tests are the deliverable**: over-midnight splits, DST transitions (Europe/Berlin!),
  missed-unplug reconciliation, arm-timeout discard, re-arm to another box, seal idempotency.
  All on plain Node with fake repositories + fake clock.

Must not import: anything from `platform/android`, `data/` implementations, React.

## J3 — Data layer: WatermelonDB (owns `src/data/`)

- Schema + migrations for the **local** tables §4.1 (`boxes` incl. `origin`, `sessions`,
  `day_buckets`, `group_keys` → secure storage wrapper not DB, `nick_overrides`).
- Repository implementations of the J1 interfaces (used by J2's logic at runtime).
- Secure-storage wrapper (`expo-secure-store`) for device credential + `K_g` map.
- Seed/fixture helpers for J8's mocked UI and J2's integration tests.

Done when: repositories pass the contract test suite J2 ships (run against real WatermelonDB
in a jest environment), migrations apply cleanly.

## J4 — NFC (owns `src/platform/android/nfc/`, `plugins/nfc/`)

- `AndroidTagReader` implementing `TagReader` via `react-native-nfc-manager`: foreground
  reader mode; parse NDEF; three-stage detection per §9.2 (scope prefix, resolve, plausibility
  incl. `?v=1`); emit `TAG_READ`. Auto-create-foreign-box is a callback into the repository
  interface — J4 emits a `UNKNOWN_VALID_TAG(uuid, label)` signal, the wiring in J9 decides.
- Registration wizard **service layer** (not UI): write NDEF (URI + text records), read-back
  verify, blank/foreign/ours state detection, optional lock-bits behind an explicit parameter
  (never auto — §9.4). UI comes from J8, glued in J9.
- Config plugin: NFC permission/feature + NDEF intent filter for `timeserved://box/`.
- Emulator can't do NFC → ship a `FakeTagReader` (same interface) that the dev harness (J8)
  can drive; real-device test checklist in `docs/DEVICE_TESTS.md`.

## J5 — Foreground service (owns `modules/fgs/`, `plugins/fgs/`)

- Kotlin Expo module: FGS type `connectedDevice` (fallback `specialUse` documented), ongoing
  notification "Time Served läuft – Box: <name>", start/stop API exposed to TS.
- Inside the service: **dynamically registered** receiver for `ACTION_POWER_DISCONNECTED` +
  `ACTION_BATTERY_CHANGED` (heartbeat), forwarded to TS as events. Never manifest-registered
  (CLAUDE.md §4).
- `AndroidPowerStateProvider` + `AndroidSessionRuntime` implementing the J1 interfaces;
  `expo-battery` for the foreground quick path.
- Config plugin: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`,
  `POST_NOTIFICATIONS`, `<service>` entry.
- Ship `FakePowerStateProvider` for the dev harness. Document the ADB simulation commands
  (`dumpsys battery unplug / set ac 1 / reset`) in `docs/DEVICE_TESTS.md`.

## J6 — Crypto & invite codec (pure TS, owns `src/domain/crypto/`)

- libsodium (`react-native-libsodium` or `libsodium-wrappers` — must also run on Node for
  tests): HKDF derivations `K_enc = HKDF(K_g,"ts-enc-v1")`, `K_auth = HKDF(K_g,"ts-auth-v1")`;
  AEAD (XChaCha20-Poly1305) encrypt/decrypt for group meta + nicks; `SHA-256(K_auth)`.
- Invite-link codec: build/parse `https://<host>/j#g=<group_id>&k=<K_g_b64url>`; assert the
  key never leaves the fragment.
- Pure functions, injectable randomness. **Round-trip tests on Node** (encrypt→decrypt, derive
  determinism, tamper detection) are the deliverable.

## J7 — Backend: PocketBase (owns `server/`, independent — can start immediately)

- Collections per §4.2 (`users` auth, `daily_stats`, `groups`, `memberships`) as migration
  files.
- API rules: all four collections **not listable/viewable directly**; `daily_stats` create-only
  by owner (`@request.auth.id = user_id`), no update (immutability).
- JS hook `POST /api/ts/group-feed` per §10.3: verify `SHA-256(k_auth) == groups.auth_hash`,
  return `enc_group_meta` + memberships + consented members' `daily_stats` in range. Do not
  log `k_auth`.
- Group create + join endpoints (create: store `auth_hash`, `enc_group_meta`; join: create
  membership with `enc_nick`, `consent_at`).
- Optional aggregate-stats endpoint (global sums, no per-user exposure) — nice-to-have.
- Deliverable includes: docker-compose for local dev, hook tests via PocketBase test runner or
  curl-based script, `server/README.md` (deploy on Coolify).

## J8 — UI (owns `src/ui/`, `src/app/`)

- All screens per §11 against **mocked hooks** (fixtures from J3's seed helpers; fake platform
  implementations from J4/J5 once available, hand-rolled until then).
- Signature visual: stacked day/night bar (sun-yellow/moon-blue) for Today + History.
- Registration wizard UI (§9.3) incl. the explicit lock-bit confirmation dialog (§9.4).
- Groups UI: create (name → link with fragment key), join (deep link → nickname → consent),
  leaderboard with decrypted nicks + local rename (`nick_overrides`).
- **Dev harness screen** (debug builds only): buttons to inject `TAG_READ(boxId)`,
  `CHARGING_STARTED/STOPPED`, `HEARTBEAT`, time-travel the fake clock — this is how everything
  is tested on the emulator, where NFC does not exist.
- No business logic in components (CLAUDE.md §7); everything through hooks that wrap domain.

## J9 — Integration A: the live loop (needs J2+J3+J4+J5)

- Wire real adapters into the machine: NFC read → ARMED + FGS start; charging → ACTIVE;
  unplug → CLOSED + bucket recompute; APP_RESUMED → reconciliation.
- Decide the `UNKNOWN_VALID_TAG` wiring: auto-create `origin=foreign` box + info notification
  (§9.2), then proceed to ARMED.
- End-to-end on real device: full placement ritual, kill-process-mid-session → reconciled,
  battery-optimization exemption flow.
- Update `docs/DEVICE_TESTS.md` with the executed checklist.

## J10 — Integration B: seal, groups, sync (needs J2+J3+J6+J7)

- Seal scheduler: at ~12:00 local (WorkManager via `expo-background-task` or headless task),
  seal all unsealed past days, upload `daily_stats`, mark `sealed_at`. Idempotent, offline-
  tolerant (retry next run), never uploads today.
- Device auth bootstrap (anonymous user + credential in secure storage).
- Group flows against the real backend: create/join via invite link (fragment key handling),
  feed fetch with `K_auth`, decrypt, leaderboard.
- Consent gating verified: unconsented member's numbers never appear in the feed.

## J11 — Hardening & onboarding (needs J9+J10)

- Onboarding per §11 screen 3 (ritual, charging gate, upload notice, permission prompts,
  battery-optimization exemption).
- OEM survival pass (Samsung/Xiaomi if available), notification polish, empty states,
  error toasts, app icon + splash.
- Final `pnpm test` gate: domain, bucketing, crypto round-trip all green on plain Node
  (CLAUDE.md §9 definition of done).

---

## Suggested agent assignment

Wave 1: one agent on J1 (short). J7 may run concurrently.
Wave 2: five agents on J2, J3, J4, J5, J6+J8 (J6 is small; pair it with J8 or run solo).
Wave 3: two agents on J9 and J10 in parallel.
Wave 4: one agent on J11.
