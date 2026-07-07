# Time Served

Gamified "keep your phone in the box" tracker. Phone goes into a passive box (NFC tags +
charging cable); charging is the gate; the time "served" feeds a day/night leaderboard
shared with a group. Android-first, iOS-convertible.

**Status: V1 feature-complete.** All build jobs (J1–J11, see JOBS.md) have landed:
domain state machine + bucketing + scoring, WatermelonDB persistence, NFC read/write,
foreground service, E2E-crypto'd groups over PocketBase, full UI, onboarding &
permission flows, icons/splash. What remains before release is device/OEM validation —
see [docs/DEVICE_TESTS.md](docs/DEVICE_TESTS.md) and [docs/BACKLOG.md](docs/BACKLOG.md).

## Read these first

1. [CLAUDE.md](CLAUDE.md) — architecture rules & invariants (the contract for all work)
2. [BUILD_V1.md](BUILD_V1.md) — what V1 is
3. [JOBS.md](JOBS.md) — parallel work packages & dependency graph
4. [docs/CONTRACT_CHANGES.md](docs/CONTRACT_CHANGES.md) — decision log for shared contracts
5. [docs/BACKLOG.md](docs/BACKLOG.md) — V2 / pre-release items (the TODO landing place)

## Commands

```bash
pnpm install
pnpm test          # unit tests (domain, wiring, sync) — plain Node, no device
pnpm lint          # includes the "no native imports in domain/ui" boundary rules
pnpm typecheck
pnpm dlx expo prebuild          # generate native projects (FGS/NFC/notification plugins)
pnpm expo run:android           # dev build on device/emulator (Expo Go won't work)
```

Requires Node ≥ 20 and pnpm (via corepack). The backend lives in [server/](server/).

## Running without a device (dev harness)

Dev builds default to **fake adapters** (in-memory DB, simulated NFC/power) so the full
session loop runs on an emulator: Einstellungen → Entwicklung → **Dev-Harness öffnen**
injects tag reads, plug/unplug events, heartbeats and clock time-travel through the
exact production wiring. To run a dev build against the **real** adapters
(SQLite/Keystore/NFC/FGS) on a device:

```bash
EXPO_PUBLIC_TS_REAL_ADAPTERS=1 pnpm expo run:android
```

Release builds always use the real adapters. Sync activates when
`EXPO_PUBLIC_POCKETBASE_URL` is set at bundle time; without it a stub groups gateway
keeps everything usable offline.

## Integration tests (PocketBase sync)

```bash
./src/app/sync/run-integration.sh   # boots a throwaway PocketBase, runs the suite
./server/test.sh                    # server-side hook/route tests
```

Both download the PocketBase binary on first run (gitignored). Needs bash, curl, unzip.

## What needs a physical device

NFC tag read/write, the foreground service + unplug events, permission dialogs
(notifications, battery exemption) and OEM survival behavior can only be tested on
hardware — checklists per job in [docs/DEVICE_TESTS.md](docs/DEVICE_TESTS.md)
(J4 NFC, J5 FGS/power, J9 end-to-end, J11 onboarding & permissions).

## Icons

`assets/*` are generated — edit [scripts/generate-icons.mjs](scripts/generate-icons.mjs)
(dependency-free Node) and run `node scripts/generate-icons.mjs`, never the PNGs.
