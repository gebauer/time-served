# DEVICE_TESTS.md — real-device test checklist

Populated by J4 (NFC), J5 (FGS/power), J9 (end-to-end). The emulator cannot do NFC; power
events can be simulated (see below). Everything here must be executed on at least one real
device before release; record device model + Android version + result per run.

## Power simulation on emulator (J5)

```bash
adb shell dumpsys battery unplug     # simulate unplug
adb shell dumpsys battery set ac 1   # simulate AC charger connected
adb shell dumpsys battery reset      # return control to the emulated battery
```

## Checklists

_To be filled in by J4/J5/J9._

## J5 — FGS & power (device/emulator)

Prerequisite: dev build (`pnpm dlx expo prebuild && pnpm expo run:android`) — the
`TimeServedFgs` module does not exist in Expo Go. Drive the module from the dev
harness (or a debug screen) via `AndroidSessionRuntime` / `AndroidPowerStateProvider`.
Record device model + Android version + result per run.

### 5.1 Notification lifecycle (start / label / stop)

1. Foreground the app, call `runtime.start({ boxLabel: 'Küche' })`.
   - [ ] Ongoing notification appears immediately: "Time Served läuft – Box: Küche".
   - [ ] Channel is LOW importance: no sound, no heads-up, no badge.
   - [ ] `runtime.isRunning()` → `true`.
2. Call `runtime.start({ boxLabel: 'Schlafzimmer' })` again (idempotent re-start).
   - [ ] No second notification; title updates to "… Box: Schlafzimmer".
3. Call `runtime.stop()`.
   - [ ] Notification disappears; `isRunning()` → `false`.
4. Call `runtime.stop()` again.
   - [ ] No crash, still `false` (idempotent).

### 5.2 Unplug event (`powerDisconnected` → CHARGING_STOPPED)

With the FGS running and a `provider.subscribe(...)` active:

```bash
adb shell dumpsys battery set ac 1   # plugged
adb shell dumpsys battery unplug     # unplug
```

- [ ] CHARGING_STARTED arrives after `set ac 1` (app foreground, expo-battery path).
- [ ] CHARGING_STOPPED arrives within a few seconds of `unplug`, with a plausible
      epoch-ms `at`.
- [ ] Exactly ONE CHARGING_STOPPED even though both the FGS receiver and expo-battery
      observe the unplug (normalization dedupe).
- [ ] `adb shell dumpsys battery reset` afterwards.

### 5.3 Heartbeat cadence (≤ 1 per 60 s while charging)

FGS running, phone plugged (or `set ac 1`), screen off, leave it 5+ minutes:

- [ ] First `batteryHeartbeat` arrives right after service start (sticky
      ACTION_BATTERY_CHANGED).
- [ ] Subsequent heartbeats arrive, spaced ≥ 60 s apart (throttle) — expect roughly
      one per battery-level tick, never more than one per minute.
- [ ] Each heartbeat has `charging: true` while plugged.

### 5.4 Kill the app while the FGS runs

1. Start a session (FGS running, plugged in), then swipe the app away from recents
   (and/or `adb shell am force-stop <pkg>` — note: force-stop also kills the FGS).
   - [ ] Swipe-away: service keeps running or is killed depending on OEM — RECORD the
         behavior per device; both are acceptable (CLAUDE.md §3/§4).
2. Unplug while the app process is dead.
   - [ ] No crash, no ANR. The unplug event may be lost — that is the accepted design.
3. Relaunch the app.
   - [ ] Reconciliation (J9) closes the open session using `last_charging_at`; the
         session is never lost, only end-precision.
   - [ ] No stale "Time Served läuft" notification survives a killed service +
         relaunch + `stop()`.

### 5.5 Battery-optimization exemption

The one-time exemption request ("so a session isn't cut short while your phone sleeps
in the box") is J11's onboarding flow — NOT tested here. For J5 runs on aggressive
OEMs (Samsung/Xiaomi), note in the run log whether the exemption was granted, since it
changes FGS survival behavior.
