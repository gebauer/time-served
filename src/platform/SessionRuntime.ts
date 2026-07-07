/**
 * SessionRuntime — platform seam for session liveness (CLAUDE.md §2, BUILD_V1 §8.3).
 *
 * CONTRACT FILE (JOBS.md): implemented by J5 as an Android Foreground Service
 * (Kotlin Expo module) holding the dynamically registered power receiver; on iOS
 * this is a no-op backed entirely by persisted state + reconciliation on launch.
 *
 * IMPORTANT (CLAUDE.md §3): the runtime provides best-effort liveness for event
 * DELIVERY only. No correctness may depend on it running — `started_at` is already
 * on disk, and reconciliation closes orphans. Never assume start() implies the
 * service survives until stop().
 */

export interface SessionRuntimeStartOptions {
  /** Box label for the ongoing notification: "Time Served läuft – Box: <name>". */
  readonly boxLabel: string;
}

export interface SessionRuntime {
  /**
   * Begin liveness (Android: start FGS + register the power receiver). Must be
   * called from a legal FGS-start context (app foregrounded by the NFC read).
   * Idempotent; a second start() updates the notification label.
   */
  start(options: SessionRuntimeStartOptions): Promise<void>;

  /** End liveness (stop FGS, unregister receiver). Idempotent. */
  stop(): Promise<void>;

  /** Whether the runtime believes it is currently running. Best-effort. */
  isRunning(): Promise<boolean>;
}
