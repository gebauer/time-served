/**
 * PowerStateProvider — platform seam for charging state (CLAUDE.md §2, BUILD_V1 §8.2).
 *
 * CONTRACT FILE (JOBS.md): implemented by J5 (`platform/android/`, expo-battery +
 * dynamic receiver inside the FGS) and later `platform/ios/`; FakePowerStateProvider
 * drives the dev harness. Changes require a docs/CONTRACT_CHANGES.md entry.
 *
 * The signal is the OS power-CONNECTION state (plug/unplug), never measured current —
 * "battery full, current ≈ 0" must NOT end a session (CLAUDE.md §4). Events carry the
 * timestamp the adapter observed; the J9 wiring maps them 1:1 onto the domain events
 * CHARGING_STARTED / CHARGING_STOPPED / CHARGING_HEARTBEAT.
 */
import type { EpochMs } from '../domain/types';

export type PowerEvent =
  | { readonly type: 'CHARGING_STARTED'; readonly at: EpochMs }
  | { readonly type: 'CHARGING_STOPPED'; readonly at: EpochMs }
  /**
   * Periodic while charging (Android: ACTION_BATTERY_CHANGED inside the FGS).
   * Feeds `last_charging_at` so reconciliation can bound a session whose unplug
   * event was missed (CLAUDE.md §3). Delivery is best-effort — nothing may depend
   * on heartbeats arriving.
   */
  | { readonly type: 'CHARGING_HEARTBEAT'; readonly at: EpochMs };

export type PowerListener = (event: PowerEvent) => void;

export interface PowerStateProvider {
  /** Point-in-time charging state (foreground quick path; expo-battery on Android). */
  isCharging(): Promise<boolean>;

  /**
   * Subscribe to power events. Returns an unsubscribe function. On Android the
   * STOPPED/HEARTBEAT stream is only live while the FGS runs (SessionRuntime);
   * consumers must not assume events always arrive — reconciliation is the net.
   */
  subscribe(listener: PowerListener): () => void;
}
