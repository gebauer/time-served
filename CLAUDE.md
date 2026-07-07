# CLAUDE.md — Time Served

> **Time Served** — gamified "keep your phone in the box" tracker. The pun: prison time +
> the app measures exactly the time "served" away from the phone; the leaderboard ranks who
> served the most. Deep-link scheme: `timeserved://`. The name string lives in
> `app.config.ts`, `package.json`, the deep-link scheme, and the FGS notification channel —
> grep for `timeserved` / `Time Served` before renaming.

This file is the contract for working in this repo with Claude Code. Read it before
touching anything. If a change would violate a rule here, stop and flag it instead.

---

## 1. What this app is

A gamified "keep your phone in the box" tracker. The user puts the phone into a physical
box that is **completely passive** — it contains only one or two NFC tags and a charging
cable. The phone does all the work:

1. Phone is placed in the box (screen unlocked) → an NFC tag is read → identifies *which*
   box.
2. The charging cable is connected → this is the **gate**: a session only counts if the
   phone is actually charging.
3. The phone is unplugged → session ends. Duration = `unplugged_at − charging_started_at`.

Sessions feed a per-day **day-lock / night-lock** total. Those daily totals (two integers per
day) feed a group **leaderboard**, local-first per device and optionally shared with a group
(e.g. family). Privacy model (see BUILD_V1.md §10): the server stores only **sealed daily
totals in plaintext** plus an **end-to-end-encrypted name layer** (group name + per-group
nicknames). Sessions and boxes never leave the device. `user_id` is a random UUID, never
derived from hardware.

Not cheat-proof by design. If someone plugs in and keeps playing, it still counts. If
someone puts the phone in without charging, it does not count. This is accepted — see
BUILD_V1.md §"Non-goals".

## 2. Platform strategy

**Android-first, iOS-convertible.** Ship Android now; do not paint iOS into a corner.

The rule that makes this work: **all platform-specific behaviour lives behind interfaces in
`src/platform/`**. The domain layer (state machine, scoring, data model, sync) is pure
TypeScript and must never import a native API directly. iOS later = new adapters only, no
domain rewrite.

The three platform seams:

| Concern        | Interface (`src/platform/`) | Android impl                          | iOS impl (later)                         |
|----------------|-----------------------------|---------------------------------------|------------------------------------------|
| Tag identity   | `TagReader`                 | reader-mode dispatch on unlock        | `NFCTagReaderSession` / background NDEF  |
| Power state    | `PowerStateProvider`        | `BatteryManager` + `POWER_DISCONNECTED` receiver inside FGS | `UIDevice.batteryState` notifications |
| Liveness       | `SessionRuntime`            | Foreground Service                     | `BGTaskScheduler` + launch reconciliation |

## 3. The one architectural invariant — read this twice

**Sessions are event-based, not timer-based.** Never run a ticking clock to measure a
session. On charging-confirmed, persist `started_at` immediately. The session needs nothing
running afterwards. Duration is computed once, from two timestamps.

Why: a phone in a charging box has its screen off and is locked for hours. Anything that
"runs" can be killed by the OS or an OEM battery manager. Because `started_at` is on disk
the instant a session starts, a killed process never loses a session — only precision.

Consequences every contributor must honour:

- `started_at` is written to the DB synchronously before anything else in the ACTIVE state.
- The end event (`POWER_DISCONNECTED`) is the *primary* finalizer, but it is **not trusted
  to always arrive**. On every app launch / foreground, run **reconciliation** (BUILD_V1.md
  §6): any `open` session whose phone is no longer charging is closed using the last known
  end signal (heartbeat fallback).
- A periodic `BATTERY_CHANGED` heartbeat (already available via the same dynamic receiver)
  writes `last_charging_at` so reconciliation can recover a good `ended_at` even if the
  unplug event was missed.
- This same design is what lets iOS work without a foreground service: iOS finalizes lazily
  on next launch from persisted state. Do not add anything that assumes a long-running
  background process exists.

## 4. Hard platform facts (do not "fix" these — design around them)

- **NFC needs an unlocked, awake screen.** Android only dispatches external tags when the
  display is on and the device is unlocked. There is no way around this without becoming a
  device-owner app. The instruction "unlock → connect cable → place in box" is part of the
  product, documented in onboarding. The visible app screen at placement time is the user's
  confirmation that counting started.
- **Do NOT register `ACTION_POWER_CONNECTED/DISCONNECTED` statically in the manifest.** Per
  Android 8+ background limits, manifest-declared implicit receivers for these are
  unreliable across OEMs/versions. Register the receiver **dynamically inside the foreground
  service** that the NFC read starts.
- **Charging-state, not current draw, is the signal.** "Battery full → current ≈ 0" does not
  end a session, because we key off the OS power-connection state (plug/unplug), not measured
  amperage.
- **Doze does not apply while charging** — the phone is plugged in for the whole session, so
  the FGS + dynamic receiver run undisturbed until unplug.
- **OEM aggressiveness is the only real enemy.** Samsung/Xiaomi/etc. can still kill an FGS.
  Mitigations: request battery-optimization exemption once during onboarding; rely on
  reconciliation as the safety net. Never assume the FGS survived.
- **Two tags per box** exist to cover NFC antenna position variance between phone models, not
  for security. Both carry the *identical* box payload.

## 5. Tech stack

- **Expo** (managed, but **dev build required** — uses native modules, not Expo Go).
- **React Native + TypeScript** (strict).
- **WatermelonDB** — local-first persistence (same as Häkchen).
- **PocketBase** — sync backend (self-hosted, Coolify). Stores only sealed daily totals
  (plaintext integers) + an E2E-encrypted name layer; reads go through a `group-feed` JS hook
  gated by an auth key that cannot decrypt. Never syncs sessions or boxes. See BUILD_V1.md §10.
- **react-native-nfc-manager** — tag read (Android reader mode; iOS session later).
- **expo-battery** — cross-platform charging state; Android also uses a native dynamic
  receiver for the unplug event + heartbeat.
- Foreground service — Expo **config plugin** + small Kotlin module via Expo Modules API
  (no off-the-shelf lib covers "FGS holding a dynamic power receiver" cleanly; see BUILD_V1
  §7).
- **expo-linking** — deep links for invites and (later) iOS NFC URL launch.

## 6. Repo layout

```
src/
  domain/            # pure TS. state machine, bucketing, scoring, crypto. NO native imports.
    session/         #   session state machine + reducer
    buckets/         #   day/night splitting + daily seal logic
    scoring/         #   leaderboard aggregation (period buckets)
    crypto/          #   HKDF/AEAD, invite-link codec (Node-compatible)
    types.ts
  platform/          # interfaces + per-platform adapters
    TagReader.ts            # interface
    PowerStateProvider.ts   # interface
    SessionRuntime.ts       # interface
    android/                # Android implementations
    ios/                    # iOS stubs (throw NotImplemented in V1)
    fakes/                  # FakeTagReader, FakePowerStateProvider (emulator/dev harness)
  data/              # WatermelonDB models, schema, migrations; sync of sealed daily totals +
                     #   encrypted name layer only (PocketBase). Sessions/boxes are local-only.
  ui/                # screens + components (no business logic; calls domain via hooks)
  app/               # navigation, providers, app bootstrap
modules/             # native Expo modules (FGS)
plugins/             # Expo config plugins (NFC, FGS manifest, permissions)
server/              # PocketBase: migrations, API rules, group-feed hook, docker-compose
docs/                # CLAUDE.md, BUILD_V1.md, JOBS.md, CONTRACT_CHANGES.md, DEVICE_TESTS.md
```

Dependency direction is one-way: `ui → domain → (data, platform interfaces)`. `domain`
depends on nothing native. `platform/android/*` and `data/*` are the only places allowed to
import native modules.

## 7. Conventions

- TypeScript strict; no `any` without a `// reason:` comment.
- No business logic in components. Screens read state via hooks that wrap the domain layer.
- All times stored as UTC epoch ms (`number`). Format only at the UI edge.
- IDs: UUID v4, generated client-side (offline-first; sync must tolerate client IDs).
- Every DB write that mutates a session goes through the session reducer — never write
  session rows ad hoc from a component or a receiver callback.
- Adapters translate native events into **domain events** (`TAG_READ`, `CHARGING_STARTED`,
  `CHARGING_STOPPED`, `APP_RESUMED`). The state machine only ever sees domain events.
- Keep the FGS notification copy honest and minimal ("Time Served läuft – Box: <name>").

## 8. Commands

```bash
pnpm install
pnpm dlx expo prebuild            # generate native projects (needed for FGS plugin)
pnpm expo run:android             # dev build on device/emulator
pnpm test                         # domain unit tests (state machine, scoring) — keep green
pnpm lint && pnpm typecheck
eas build -p android --profile preview   # shareable APK
```

Domain logic (`src/domain/**`) must have unit tests and must be testable **without a device**
— that is the proof the architecture stayed portable.

## 9. Definition of done (per feature)

1. Domain change covered by a unit test that runs on plain Node.
2. No native import outside `platform/android`, `data`, or `modules`.
3. Reconciliation still correctly closes an orphaned session (simulate a missed unplug in a
   test).
4. iOS stub interfaces still compile (don't break the seam).

## 10. Do NOT

- Do not add a ticking timer to measure sessions.
- Do not register power broadcasts in the manifest.
- Do not call NFC/battery/FGS APIs from `domain/` or `ui/`.
- Do not assume the FGS or the unplug event always survive — reconciliation is mandatory.
- Do not add an iOS-incompatible assumption (long-running background) to the domain layer.
- Do not gate counting on anything except confirmed charging (product decision).
