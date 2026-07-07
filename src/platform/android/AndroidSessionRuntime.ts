/**
 * Android SessionRuntime (BUILD_V1 §8.3) — thin adapter over the FGS module.
 *
 * start() is only legal from a foreground context; in the product flow the NFC read
 * has just foregrounded the app, so the session engine may call it directly.
 *
 * IMPORTANT (CLAUDE.md §3): this runtime is best-effort liveness for event delivery
 * ONLY. No correctness may depend on the service surviving — started_at is already
 * persisted and reconciliation closes orphans.
 */
import type { SessionRuntime, SessionRuntimeStartOptions } from '../SessionRuntime';
import { getFgsModule } from './fgsModule';

export class AndroidSessionRuntime implements SessionRuntime {
  /** Idempotent: a second start() while running just updates the notification label. */
  async start(options: SessionRuntimeStartOptions): Promise<void> {
    const fgs = getFgsModule();
    if (await fgs.isRunning()) {
      await fgs.updateLabel(options.boxLabel);
    } else {
      await fgs.startService(options.boxLabel);
    }
  }

  /** Idempotent: native stopService is a no-op when the service is not running. */
  async stop(): Promise<void> {
    await getFgsModule().stopService();
  }

  /** Best-effort — true between the service's onCreate and onDestroy. */
  async isRunning(): Promise<boolean> {
    return getFgsModule().isRunning();
  }
}
