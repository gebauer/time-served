# BACKLOG.md — V2 / pre-release items

Created by J11 as the landing place for everything V1 deliberately does NOT do.
Source of truth for scope remains BUILD_V1.md ("Non-goals" / §2-out); this file tracks
the concrete work items. The `grep -rn "TODO" src/ modules/ plugins/` audit is clean
as of J11 — new deferred work goes HERE, not into TODO comments.

## Pre-release (before Play submission)

- **assetlinks.json + `autoVerify`** — the `https://timeserved.app/j` invite intent
  filter (app.config.ts) is unverified: Android shows a chooser instead of opening the
  app directly. Host `/.well-known/assetlinks.json` on timeserved.app (needs the
  release-key SHA-256), then set `autoVerify: true` on the intent filter.
- **OEM survival pass** — run docs/DEVICE_TESTS.md on aggressive OEMs
  (Samsung/Xiaomi/OnePlus): FGS lifetime over multi-hour sessions with and without the
  battery exemption, reconciliation correctness after OEM kills. Record per-OEM notes
  in DEVICE_TESTS.
- **FGS type Play review** — `connectedDevice` justification is written
  (modules/fgs/README.md, incl. the `specialUse` fallback). Submit and be prepared to
  switch.
- **REQUEST_IGNORE_BATTERY_OPTIMIZATIONS Play review** — acceptable-use case is
  documented (modules/fgs/README.md); if rejected, swap the dialog for the app
  settings page per the README's fallback recipe.
- **Real device matrix for tag writing** — NTAG215 write/verify/lock across several
  phone models (antenna variance is the whole reason for two tags per box).

## V2 candidates

- **Member removal / group-key rotation** (BUILD_V1 §2-out) — leaving is implemented;
  kicking a member and rotating `K_g` so the removed member loses future reads is not.
  Requires versioned keys in the invite/name layer.
- **Background sealing** — V1 seals foreground-only by decision #12
  (src/app/sync/sealTriggers.ts). If "seal without opening the app" becomes a
  requirement, add expo-background-task (WorkManager) as an ADDITIONAL trigger; the
  pipeline is already idempotent.
- **Surface background seal-upload failures** — the seal scheduler retries silently
  (by design); consider a Settings row showing "last successful upload" so silent
  network problems become visible without adding notification noise.
- **i18n** — src/ui/strings.ts is shaped for a locale swap (one nested object);
  V1 ships German only.
- **iOS adapters** (BUILD_V1 §13) — TagReader via NFCTagReaderSession + universal-link
  launch, PowerStateProvider via UIDevice battery notifications, SessionRuntime as a
  no-op + reconciliation; SystemStatusService per CONTRACT_CHANGES #13.
- **Sealed-day export/rectification** — GDPR-adjacent nicety: local export of all
  device data (sessions/boxes stay local anyway; daily_stats are already public to the
  group).

## Known accepted limitations (documented, not planned work)

- Multi-day open sessions lose their earlier (sealed-as-zero) days —
  CONTRACT_CHANGES #1, BUILD_V1 §3.
- Not cheat-proof (charging is the only gate) — CLAUDE.md §1.
- Recents-relaunch after process death can re-deliver the NFC launch intent and
  harmlessly re-arm a box (times out) — CONTRACT_CHANGES #10.
