package koeln.gebauer.timeserved.fgs

import android.content.Context
import android.content.Intent
import android.os.Build
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module "TimeServedFgs" — the TS-facing surface of the foreground service.
 * Typed wrapper on the JS side: src/platform/android/fgsModule.ts (single import
 * point for J9 — do not requireNativeModule elsewhere).
 *
 * Events (payload keys are part of the TS wrapper contract):
 *  - "powerDisconnected"  { at: epoch-ms }
 *  - "batteryHeartbeat"   { at: epoch-ms, charging: boolean }  (≤ 1 per 60 s)
 */
class TimeServedFgsModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("TimeServedFgs")

    Events("powerDisconnected", "batteryHeartbeat")

    OnCreate {
      // Bridge service → JS. The sink lives only as long as this module instance;
      // events with no JS alive are dropped (best-effort by contract — the
      // persisted started_at + reconciliation carry correctness, CLAUDE.md §3).
      TimeServedFgsService.eventSink = object : TimeServedFgsService.EventSink {
        override fun onPowerDisconnected(atEpochMs: Long) {
          sendEvent("powerDisconnected", mapOf("at" to atEpochMs))
        }

        override fun onBatteryHeartbeat(atEpochMs: Long, charging: Boolean) {
          sendEvent("batteryHeartbeat", mapOf("at" to atEpochMs, "charging" to charging))
        }
      }
    }

    OnDestroy {
      TimeServedFgsService.eventSink = null
    }

    /**
     * Start the FGS (or refresh its notification when already running — starting an
     * already-running service just re-runs onStartCommand, so this is idempotent).
     * Legal only from a foreground context; the NFC read foregrounds the app before
     * the session engine calls this (BUILD_V1 §8.3).
     */
    AsyncFunction("startService") { boxLabel: String ->
      val intent = Intent(context, TimeServedFgsService::class.java)
        .putExtra(TimeServedFgsService.EXTRA_BOX_LABEL, boxLabel)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    /** Stop the FGS. No-op when it is not running (idempotent). */
    AsyncFunction("stopService") {
      context.stopService(Intent(context, TimeServedFgsService::class.java))
    }

    /**
     * Update the ongoing notification's box label in-process. No-op when the service
     * is not running (no implicit start — start() decides that).
     */
    AsyncFunction("updateLabel") { boxLabel: String ->
      TimeServedFgsService.updateLabel(boxLabel)
    }

    /** Best-effort: true between the service's onCreate and onDestroy. */
    AsyncFunction("isRunning") {
      TimeServedFgsService.isServiceRunning
    }
  }
}
