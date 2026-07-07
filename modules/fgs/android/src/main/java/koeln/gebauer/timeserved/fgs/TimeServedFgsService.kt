package koeln.gebauer.timeserved.fgs

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Foreground service providing best-effort LIVENESS FOR EVENT DELIVERY while a box
 * session runs (CLAUDE.md §3). It holds the DYNAMICALLY registered receiver for
 *
 *  - ACTION_POWER_DISCONNECTED — the primary session finalizer, and
 *  - ACTION_BATTERY_CHANGED    — throttled heartbeat that bounds reconciliation
 *                                (`last_charging_at`, BUILD_V1 §7).
 *
 * The receiver is registered in onCreate and unregistered in onDestroy — NEVER in the
 * manifest (CLAUDE.md §4: manifest-declared implicit power receivers are unreliable on
 * Android 8+).
 *
 * Resilience model: nothing may depend on this service surviving. `started_at` is
 * already persisted by the domain layer before this service matters, and launch
 * reconciliation closes orphaned sessions. Hence onStartCommand returns
 * START_NOT_STICKY — if the OS or an OEM battery manager kills us, we accept losing
 * event precision, never the session. Doze does not apply while charging, so in the
 * normal case the service runs undisturbed until unplug (CLAUDE.md §4).
 *
 * Foreground service type: `connectedDevice` — the phone is physically connected to
 * the box's charging setup for the entire session, which is the closest matching
 * category (BUILD_V1 §8.3). If Play review objects, the documented fallback is
 * `specialUse` with the justification string in modules/fgs/README.md; switching
 * requires changing the type below, the permission + `android:foregroundServiceType`
 * in plugins/fgs, and adding the PROPERTY_SPECIAL_USE_FGS_SUBTYPE <property>.
 */
class TimeServedFgsService : Service() {

  /** Implemented by TimeServedFgsModule to forward native events to JS. */
  interface EventSink {
    fun onPowerDisconnected(atEpochMs: Long)
    fun onBatteryHeartbeat(atEpochMs: Long, charging: Boolean)
  }

  companion object {
    const val EXTRA_BOX_LABEL = "boxLabel"

    /** Own LOW-importance channel (silent, ongoing). "timeserved" is a grep target — CLAUDE.md preamble. */
    const val CHANNEL_ID = "timeserved_session"
    const val NOTIFICATION_ID = 0x7501

    /**
     * ACTION_BATTERY_CHANGED fires on every level/temperature tick; the heartbeat only
     * needs to BOUND reconciliation, so forward at most one event per minute.
     */
    const val HEARTBEAT_MIN_INTERVAL_MS = 60_000L

    /**
     * Set by TimeServedFgsModule while the JS runtime is alive; events observed with no
     * sink attached are dropped. That is fine: delivery is best-effort by contract
     * (PowerStateProvider doc) — reconciliation is the safety net.
     */
    @Volatile
    @JvmStatic
    var eventSink: EventSink? = null

    @Volatile
    @JvmStatic
    var isServiceRunning = false
      private set

    @Volatile
    private var instance: TimeServedFgsService? = null

    /**
     * Update the ongoing notification label in-process (no new start command needed).
     * Returns false when the service is not running — callers treat that as a no-op.
     */
    @JvmStatic
    fun updateLabel(boxLabel: String): Boolean {
      val service = instance ?: return false
      service.showNotification(boxLabel)
      return true
    }
  }

  private var receiver: BroadcastReceiver? = null
  private var lastHeartbeatForwardedAt = 0L
  private var startedInForeground = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
    isServiceRunning = true
    createNotificationChannel()
    registerPowerReceiver()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // Must reach startForeground() promptly after startForegroundService();
    // showNotification does exactly that on the first call.
    val label = intent?.getStringExtra(EXTRA_BOX_LABEL) ?: ""
    showNotification(label)
    // START_NOT_STICKY on purpose: the session lives in the DB (persisted started_at,
    // CLAUDE.md §3). Restarting a killed service without its session context would
    // only produce a zombie notification.
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    receiver?.let { unregisterReceiver(it) }
    receiver = null
    instance = null
    isServiceRunning = false
    super.onDestroy()
  }

  // ---------------------------------------------------------------------------
  // Dynamic power receiver (CLAUDE.md §4 — never in the manifest)
  // ---------------------------------------------------------------------------

  private fun registerPowerReceiver() {
    val filter = IntentFilter().apply {
      addAction(Intent.ACTION_POWER_DISCONNECTED)
      addAction(Intent.ACTION_BATTERY_CHANGED)
    }
    val r = object : BroadcastReceiver() {
      override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
          // Primary finalizer. Always forwarded, never throttled.
          Intent.ACTION_POWER_DISCONNECTED ->
            eventSink?.onPowerDisconnected(System.currentTimeMillis())
          Intent.ACTION_BATTERY_CHANGED -> handleBatteryChanged(intent)
        }
      }
    }
    receiver = r
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      // System broadcasts are exempt from the export requirement, but be explicit.
      registerReceiver(r, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      registerReceiver(r, filter)
    }
    // Note: ACTION_BATTERY_CHANGED is sticky — registration delivers the current
    // battery state immediately, so the first heartbeat lands right at session start.
  }

  private fun handleBatteryChanged(intent: Intent) {
    val now = System.currentTimeMillis()
    if (now - lastHeartbeatForwardedAt < HEARTBEAT_MIN_INTERVAL_MS) return
    lastHeartbeatForwardedAt = now
    // The signal is the power-CONNECTION state, never measured current (CLAUDE.md §4):
    // EXTRA_PLUGGED != 0 stays true for "battery full, current ≈ 0" while still
    // plugged, so a full battery never ends a session.
    val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
    eventSink?.onBatteryHeartbeat(now, plugged != 0)
  }

  // ---------------------------------------------------------------------------
  // Notification
  // ---------------------------------------------------------------------------

  private fun createNotificationChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Time Served Session",
        // LOW: visible in the shade, no sound, no heads-up.
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Zeigt an, dass gerade eine Box-Session läuft."
        setShowBadge(false)
      }
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.createNotificationChannel(channel)
    }
  }

  private fun showNotification(boxLabel: String) {
    val notification = buildNotification(boxLabel)
    if (!startedInForeground) {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        startForeground(
          NOTIFICATION_ID,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
        )
      } else {
        @Suppress("DEPRECATION")
        startForeground(NOTIFICATION_ID, notification)
      }
      startedInForeground = true
    } else {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      nm.notify(NOTIFICATION_ID, notification)
    }
  }

  private fun buildNotification(boxLabel: String): Notification {
    // Honest and minimal copy (CLAUDE.md §7).
    val title =
      if (boxLabel.isBlank()) "Time Served läuft"
      else "Time Served läuft – Box: $boxLabel"
    // Prefer the proper white-on-transparent status-bar icon that the
    // expo-notifications config plugin generates (J11, app.config.ts); the
    // launcher icon stays as fallback so this module needs no own drawable.
    val smallIcon = resources
      .getIdentifier("notification_icon", "drawable", packageName)
      .takeIf { it != 0 } ?: applicationInfo.icon
    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(smallIcon)
      .setContentTitle(title)
      .setOngoing(true)
      .setSilent(true)
      .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
      .setCategory(NotificationCompat.CATEGORY_SERVICE)
      .build()
  }
}
