# Time Served

Gamified "keep your phone in the box" tracker. Phone goes into a passive box (NFC tags +
charging cable); charging is the gate; the time "served" feeds a day/night leaderboard
shared with a group. Android-first, iOS-convertible.

## Read these first

1. [CLAUDE.md](CLAUDE.md) — architecture rules & invariants (the contract for all work)
2. [BUILD_V1.md](BUILD_V1.md) — what V1 is
3. [JOBS.md](JOBS.md) — parallel work packages & dependency graph
4. [docs/CONTRACT_CHANGES.md](docs/CONTRACT_CHANGES.md) — decision log for shared contracts

## Commands

```bash
pnpm install
pnpm test          # domain unit tests — plain Node, no device (must stay green)
pnpm lint
pnpm typecheck
pnpm dlx expo prebuild          # generate native projects (FGS/NFC plugins)
pnpm expo run:android           # dev build on device/emulator (Expo Go won't work)
```

Requires Node ≥ 20 and pnpm (via corepack). The backend lives in [server/](server/).
