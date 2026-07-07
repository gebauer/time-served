# modules/fgs — Time Served foreground service (Android)

Local Expo Module (Kotlin) that owns session **liveness** on Android (BUILD_V1 §8.3):
a foreground service holding a **dynamically registered** receiver for
`ACTION_POWER_DISCONNECTED` (primary session finalizer) and `ACTION_BATTERY_CHANGED`
(heartbeat, throttled to ≤ 1 event / 60 s).

It is best-effort by design (CLAUDE.md §3): `started_at` is persisted before the
service matters and reconciliation closes orphaned sessions — the service only
improves *precision* of `ended_at`. Consequently `onStartCommand` returns
`START_NOT_STICKY`; if an OEM kills the service, that is accepted.

## TS surface

Never `requireNativeModule('TimeServedFgs')` directly — use the typed wrapper
`src/platform/android/fgsModule.ts` (single import point).

| Native function | Behaviour |
|---|---|
| `startService(boxLabel)` | Starts the FGS; idempotent (re-start refreshes the notification). Must be called while the app is foreground (the NFC read guarantees that). |
| `stopService()` | Stops the FGS; no-op when not running. |
| `updateLabel(boxLabel)` | Updates the ongoing notification label in-process; no-op when not running. |
| `isRunning()` | Best-effort: true between service `onCreate`/`onDestroy`. |
| `isIgnoringBatteryOptimizations()` | `PowerManager.isIgnoringBatteryOptimizations(pkg)` — true when the app is exempt. |
| `requestIgnoreBatteryOptimizations()` | Fires the one-time system exemption dialog (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` + `package:` uri). Resolves at launch, not at the user's decision — re-check status on the next foreground. |

Events: `powerDisconnected { at }`, `batteryHeartbeat { at, charging }` — epoch ms,
timestamps taken native-side and passed through unchanged.

## Battery-optimization exemption & Play policy

The direct dialog needs `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` in the manifest (added
by `plugins/fgs`). Google Play treats this permission as an *acceptable-use* case: the
app must have a core feature that demonstrably breaks under battery optimization. Ours
qualifies (a multi-hour FGS session on OEMs that kill services), but a reviewer may
still object.

**Fallback if Play review objects:** drop the permission from `plugins/fgs`, replace the
`requestIgnoreBatteryOptimizations()` call sites with opening the app's own settings
page — `ACTION_APPLICATION_DETAILS_SETTINGS` (from JS simply
`Linking.openSettings()`) — and instruct the user in copy to set battery usage to
"Unrestricted" there. Status detection (`isIgnoringBatteryOptimizations()`) needs no
permission and keeps working either way.

## Notification

Own channel `timeserved_session`, `IMPORTANCE_LOW` (silent, no badge), ongoing.
Title: `"Time Served läuft – Box: <name>"` — keep the copy honest and minimal
(CLAUDE.md §7).

## Foreground service type: `connectedDevice` — and the `specialUse` fallback

Declared type (manifest entry comes from `plugins/fgs`): **`connectedDevice`**, with
permission `FOREGROUND_SERVICE_CONNECTED_DEVICE`. Rationale: for the entire session
the phone is physically connected to the box's charging cable, and the service exists
solely to monitor that connection (plug/unplug + charge heartbeat). Of Android 14's
enumerated FGS types this is the closest match.

**Fallback if Play review rejects `connectedDevice`:** switch to `specialUse`
(`FOREGROUND_SERVICE_SPECIAL_USE`). Required changes:

1. `plugins/fgs/index.js`: permission → `android.permission.FOREGROUND_SERVICE_SPECIAL_USE`,
   `android:foregroundServiceType="specialUse"`, and add inside the `<service>` element:

   ```xml
   <property
     android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
     android:value="Measures how long the phone stays plugged into its charging box by listening for the system unplug broadcast; runs only while the user has deliberately placed the phone in the box and ends at unplug." />
   ```

2. `TimeServedFgsService.showNotification`: `ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE`.

Play Console justification string (use verbatim in the declaration form):

> "Time Served measures how long a phone stays in its charging box. The foreground
> service runs only during an active session that the user starts deliberately
> (NFC tag scan + plugging in). It listens for the system power-disconnect broadcast
> to end the session at the exact unplug moment and shows a persistent notification
> the whole time. No timer alternative exists: the measurement IS the connected
> state of the device."

## Build caveat

This repo's CI has no Android SDK; the Kotlin sources compile first during the J9
device build (`pnpm expo run:android` after `expo prebuild`).
