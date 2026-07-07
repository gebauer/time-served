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

## J9 — end-to-end integration (real device)

The live loop: real adapters wired in `src/app/services.ts` (SQLite + Keystore +
AndroidTagReader/Writer + AndroidPowerStateProvider + AndroidSessionRuntime). Needs a
registered box (wizard, two written tags) and a charger in the box. Record device model +
Android version + result per run.

Adapter-mode note: RELEASE builds always use the real adapters. DEV builds default to the
FAKES (in-memory DB + demo seed; DevHarness drives everything on the emulator). To run a
dev build against the real adapters, build with the bundle-time flag:

```bash
EXPO_PUBLIC_TS_REAL_ADAPTERS=1 pnpm expo run:android
```

(The flag is inlined by Metro at bundle time — restart the bundler after changing it. In
real mode the DevHarness stays usable in degraded form: simulate buttons inject domain
events directly; `presentTag` is a no-op.)

### How to run the first device build

Requirements:

- **JDK 17** (`java -version` must say 17.x — RN 0.86/AGP requires it; newer JDKs fail
  the Gradle build). E.g. `sudo apt install openjdk-17-jdk` +
  `export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64`.
- **Android SDK**: `ANDROID_HOME` set; SDK Platform 36 + Build-Tools + Platform-Tools
  installed (`sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`).
- **Device**: NFC-capable phone, developer mode + USB debugging on, visible in
  `adb devices`. (WSL2: attach via `usbipd` or use `adb connect <phone-ip>:5555`.)

```bash
pnpm install
pnpm dlx expo prebuild --platform android   # plugin chain → android/ (validated by J9 on 2026-07-07)
pnpm expo run:android                        # dev build, fakes mode (emulator-friendly)
EXPO_PUBLIC_TS_REAL_ADAPTERS=1 pnpm expo run:android   # dev build on the REAL adapters
eas build -p android --profile preview       # shareable release APK (always real adapters)
```

Known compile-deferred item: the Kotlin sources in `modules/fgs/android` have never been
compiled (no toolchain on the dev machine) — expect to fix trivial Kotlin/AGP issues on
the first `expo run:android`. The prebuild-level plugin chain (manifest permissions, FGS
`<service>` + `connectedDevice` type, NDEF intent filter, expo-modules + RN autolinking
incl. `modules/fgs`, `react-native-nfc-manager`, WatermelonDB JSI,
`react-native-get-random-values`) was validated on 2026-07-07.

### The full placement ritual (§1 product flow)

Prerequisite: onboarded, one box registered (label e.g. "Küche"), tags stuck in the box,
charger cable in the box.

- [ ] **Arm.** Unlock the phone, hold it over a box tag: app foregrounds (or was open),
      Home shows ARMED for "Küche" (TAG_READ). FGS notification "Time Served läuft –
      Box: Küche" appears (started while foreground — legal start).
- [ ] **Start.** Connect the charging cable within the arm window (default 120 s):
      state flips to ACTIVE. Verify `started_at` is persisted IMMEDIATELY: the session
      row exists even if you kill the app right after (see kill test below).
- [ ] **Serve.** Lock the phone, leave it 5+ minutes. No ticking timer anywhere; the
      FGS notification stays; heartbeats update `last_charging_at` (snapshot via
      DevHarness in dev-real mode).
- [ ] **End.** Unplug: session closes with `end_reason=unplug`, duration =
      unplugged−started (to the second), FGS notification disappears, Home/History/
      day-night buckets update.
- [ ] **Arm timeout.** Arm again but do NOT plug in: after `armTimeoutSec` the arm
      window dies silently (state back to IDLE, FGS stops, nothing persisted).
- [ ] **No-NFC boot.** Turn NFC off, cold-start the app: no crash, history still
      renders, a warn is logged (`TagReader failed to start`). Turn NFC back on (reader
      restart is a J11 UX item — for now relaunch).

### Launch-by-tag

- [ ] **Cold start by tag.** Force-stop the app (`adb shell am force-stop
      koeln.gebauer.timeserved`). Unlock the phone on the home screen, scan a box tag:
      the NDEF intent filter launches the app AND the launch intent is drained into a
      TAG_READ (ARMED for that box, FGS notification up) — no second scan needed.
- [ ] **Warm scan (backgrounded).** App running but backgrounded: scan → app
      foregrounds via onNewIntent, TAG_READ arrives through the normal DiscoverTag
      path. Exactly ONE TAG_READ (launch-intent drain must not double-fire).
- [ ] **Recents relaunch quirk (accepted).** After a launch-by-tag, kill the process,
      relaunch from recents: Android may re-deliver the old tag intent → the box re-arms
      and times out after `armTimeoutSec`. Nothing is persisted in ARMED — acceptable.
- [ ] **Foreign/unknown tags.** Scan an unknown-but-valid Time Served tag (written by
      another device): box auto-created with `origin=foreign` + its tag label, counting
      works, NO dialog (§9.2).

### Kill-process-mid-session → reconciled on relaunch (CLAUDE.md §3)

1. Start a session (ACTIVE, plugged, FGS up). Wait ≥ 2 min (so a heartbeat landed).
2. Kill the process: `adb shell am force-stop koeln.gebauer.timeserved` (also kills the
   FGS — worst case).
3. Unplug the phone while the process is dead. Wait a noticeable interval (e.g. 10 min).
4. Relaunch the app normally.
   - [ ] Bootstrap APP_RESUMED reconciliation closes the orphaned session with
         `end_reason=reconciled` and `ended_at = last_charging_at` (never "now") —
         the wait interval from step 3 is NOT counted.
   - [ ] Buckets recomputed; Home/History consistent; no stale FGS notification.
5. Variant — still charging on relaunch: kill the process but leave the phone plugged
   in, relaunch.
   - [ ] With the machine state lost (fresh process = IDLE, no armed box), the open
         session is closed as `reconciled` per BUILD_V1 §7's rule (open session +
         `s.box_id !== currentArmedBox`). Re-scan + re-plug starts a new session.
6. AppState variant: background the app (don't kill), unplug while backgrounded,
   foreground again.
   - [ ] APP_RESUMED on AppState 'active' reconciles immediately (no relaunch needed).

### Battery-optimization exemption

The one-time exemption request lives in J11's onboarding (see §5.5 above). For J9 runs
on aggressive OEMs (Samsung/Xiaomi/OnePlus), record whether the exemption was granted —
without it the FGS may die mid-session and every session ends via reconciliation
(shorter by up to one heartbeat interval). That is degraded precision, not data loss.

## J11 — onboarding & permissions (real device)

Build: real adapters (`EXPO_PUBLIC_TS_REAL_ADAPTERS=1` dev build or release). Reset app
data (or reinstall) to re-run onboarding. Android 13+ device required for the
notification-permission paths.

### Notification permission (POST_NOTIFICATIONS, Android 13+)

- [ ] **Grant path.** Onboarding page 3 → "Benachrichtigungen erlauben" → system dialog
      → allow. Button is replaced by "Erledigt ✓"; Einstellungen → System shows
      "Erlaubt".
- [ ] **Deny path.** Deny the dialog instead. Onboarding shows the honest hint ("die
      Zeit zählt trotzdem …") + an "App-Einstellungen öffnen" escape hatch; onboarding
      can be completed regardless.
- [ ] **Degraded-but-working.** With the permission DENIED, run a full session (scan →
      plug → unplug): the session counts normally and history is correct; the FGS runs
      but its "Time Served läuft" notification is NOT visible in the drawer (Android
      suppresses it; the session may still appear under the system's "active apps"
      affordance). This is the documented behavior — counting never depends on the
      permission.
- [ ] **Permanent denial.** Deny twice so the system stops showing the dialog. In
      Einstellungen → System the button escalates to "App-Einstellungen öffnen" and
      lands on the app's settings page; granting there flips the row to "Erlaubt" on
      return (refocus refresh).
- [ ] **Android 12 or lower** (if available): the request resolves granted without any
      dialog; row shows "Erlaubt".

### Battery-optimization exemption (§8.5)

- [ ] **Dialog fires.** Onboarding page 3 → "Akku-Optimierung ausnehmen" → the system
      exemption dialog appears (not the settings list). Framing text ("… während dein
      Handy in der Box schläft") is visible on the page.
- [ ] **Allow** → back in the app the button flips to "Erledigt ✓" (refocus refresh);
      Einstellungen → System shows "Ausgenommen — Sitzungen laufen ungestört."
- [ ] **Deny** → Settings row shows "Nicht ausgenommen" + hint + "Ausnehmen" button;
      tapping it re-fires the dialog.
- [ ] **Verify with adb:** `adb shell dumpsys deviceidle whitelist | grep timeserved`
      lists the package after allowing.

### Foreign-box info notification (§9.2)

- [ ] With notification permission GRANTED: scan a tag written by ANOTHER device
      (unknown box UUID). A silent, LOW-importance notification "Neue Box ‚<label>‘
      erkannt" appears (no sound, no heads-up banner); the session arms normally and
      the box appears under Boxen with "von anderem Mitglied".
- [ ] With permission DENIED: same scan — NO notification, but arming/box-creation
      work identically (the notification is informational only and never blocks
      TAG_READ).
- [ ] Re-scanning the same foreign tag later does NOT re-notify (box already known).

### NFC-off / NFC-missing UX

- [ ] Turn NFC OFF, kill and relaunch the app: bootstrap completes (no crash), Home
      shows the "NFC ist ausgeschaltet" banner with "NFC-Einstellungen öffnen";
      Verlauf/Gruppen/Einstellungen fully usable.
- [ ] Tap the banner button → system NFC settings open. Enable NFC, return to the
      app: banner disappears (refocus recheck) and a tag scan works WITHOUT an app
      restart (reader restarted via the system seam).
- [ ] Device without NFC (or emulator in real-adapter mode): banner shows the
      "Kein NFC auf diesem Gerät" variant, no settings button, no crash; everything
      except tag-driven sessions works.

### Icon / splash / misc polish

- [ ] Launcher shows the box glyph (adaptive: slate background, glyph within the
      mask; themed/monochrome icon renders on Android 13+ themed-icons mode).
- [ ] Cold start shows the splash glyph on the correct light/dark background.
- [ ] FGS + info notifications use the white glyph as status-bar small icon (not a
      grey square).
- [ ] Force a group create/join failure (server unreachable): honest German toast
      appears, UI stays usable; History edit on a day made sealed meanwhile shows the
      "versiegelt" toast instead of silently ignoring the tap.
