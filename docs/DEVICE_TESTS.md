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

_J9 adds the end-to-end integration checklist._

## J4 — NFC (real device)

Needs: a dev build (`pnpm expo run:android`) on an NFC-capable phone, two NTAG215 tags,
one foreign NDEF tag (e.g. a tag holding an `https://` URI written by another app).
Record device model + Android version + result per item.

Design note — dedupe: both tags of a box carry the identical payload, so dropping the
phone in can graze both within a second or two. `AndroidTagReader` therefore suppresses a
repeat read of the SAME box uuid within **3 s** of the last emitted read
(`TAG_READ_DEDUPE_WINDOW_MS` in `src/platform/android/nfc/dedupe.ts`; the window does not
slide on suppressed reads, and a different uuid always emits immediately).

### Read path (§9.2 — always interaction-free)

- [ ] **Locked phone, screen off → nothing.** Hold a registered box tag against the locked
      phone: no dispatch, no sound, no app launch (hard platform fact, CLAUDE.md §4 —
      Android does not dispatch tags while locked). This is expected, not a bug.
- [ ] **Unlocked, app closed → app foregrounds.** Scan the same tag with the phone unlocked
      on the home screen: the NDEF intent filter (`timeserved://box`, `plugins/nfc`) opens
      /foregrounds Time Served.
- [ ] **App in foreground → TAG_READ.** With the app open (reader mode active), scan the
      tag: the read is handled in-app (payload emitted) without any prompt or chooser.
- [ ] **Foreign NDEF tag → ignored silently.** Scan the foreign tag with the app in
      foreground: nothing visible happens in the app — no toast, no dialog, no error
      (stage-1 scope check).
- [ ] **Unknown-but-valid tag.** Scan a Time Served tag written by ANOTHER device (valid
      uuid + label, not in the local `boxes` table): the reader emits the payload; the J9
      wiring auto-creates a `origin=foreign` box and counting works. No dialog.
- [ ] **Unsupported version dropped.** Write a test tag with `?v=2` (e.g. via NFC Tools):
      scanning it does nothing user-visible; a debug log notes the dropped version.
- [ ] **Both tags, same box → single TAG_READ.** Place the phone so it grazes both tags of
      one box within ~3 s: exactly ONE read is emitted (dedupe window above). Wait >3 s,
      scan again: a new read is emitted.
- [ ] **NFC off → isAvailable false.** Disable NFC in system settings: `isAvailable()`
      reports false and `start()` rejects; the UI surfaces it (no crash).

### Write path (§9.3 wizard / §9.4 locking)

- [ ] **Blank tag write.** Run the registration wizard with a factory-blank NTAG215: state
      reported as `blank`, write succeeds, read-back verify passes, box counts on scan.
      Also try a factory tag without an NDEF container (NdefFormatable): it is formatted
      and written.
- [ ] **Foreign tag overwrite warning.** Present the foreign NDEF tag in the wizard: state
      `foreign` with a readable summary (the wizard must warn before overwriting); after
      confirming, write + verify succeed.
- [ ] **Our tag re-detected.** Present an already-written Time Served tag: state `ours`
      with its payload (wizard offers re-link/relabel, §9.3).
- [ ] **Read-back verify.** Pull the tag away immediately after tapping write: the step
      fails with `write-failed`/`verify-failed`/`tag-lost` — never a false success.
- [ ] **Lock-bit flow — explicit only.** Complete a write WITHOUT confirming locking: the
      tag stays rewritable (rewrite it to prove it). Complete another write and explicitly
      confirm locking (`lock: true`): `locked: true` is reported and a subsequent wizard
      write on that tag fails; scanning it still reads fine.
- [ ] **Locked foreign tag.** Present a read-only tag with foreign content: state
      `locked-foreign`; the wizard offers no overwrite.
- [ ] **Second tag, same box.** Write a second tag for the same box in the wizard loop:
      identical payload; scanning either tag yields the same box (and dedupe above).

### Emulator (no NFC hardware)

- [ ] Dev harness drives `FakeTagReader.simulateTag/simulateRawScan` and `FakeTagWriter`
      (`src/platform/fakes/`) — the full arm→charge→close loop works without NFC.

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
