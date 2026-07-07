/**
 * Android PowerStateProvider (BUILD_V1 §8.2). Merges two sources into the clean
 * domain-event stream the contract promises:
 *
 *  (a) expo-battery `batteryStateDidChange` — the app-foreground path. Delivers
 *      CHARGING_STARTED (the machine's ARMED→ACTIVE trigger fires while the app is
 *      visible right after the NFC read) and a redundant CHARGING_STOPPED.
 *  (b) the FGS module (modules/fgs) — the locked-in-the-box path. `powerDisconnected`
 *      → CHARGING_STOPPED (primary finalizer) and `batteryHeartbeat(charging=true)`
 *      → CHARGING_HEARTBEAT (bounds reconciliation, ≤ 1/60 s).
 *
 * Normalization (see normalizePowerEvents.ts for the full rules): duplicate
 * STARTED/STOPPED are dropped so consumers never see STARTED twice in a row without a
 * STOPPED between; heartbeats pass through untouched. Native timestamps pass through
 * unchanged; events synthesized from expo-battery use the JS observation time
 * (Date.now()) because expo-battery carries no timestamp.
 *
 * Charging means power-CONNECTION (CLAUDE.md §4): BatteryState.FULL is still plugged
 * in, so it counts as charging — "battery full, current ≈ 0" must not end a session.
 * A heartbeat with charging=false is dropped: the unplug is reported by
 * powerDisconnected / batteryStateDidChange, and heartbeats only exist to feed
 * `last_charging_at`.
 *
 * Delivery is best-effort by contract — the FGS stream is only live while the
 * service runs, and nothing here may be trusted to always arrive. Reconciliation is
 * the safety net (CLAUDE.md §3).
 */
import * as Battery from 'expo-battery';
import { BatteryState } from 'expo-battery';

import type { EpochMs } from '../../domain/types';
import type { PowerEvent, PowerListener, PowerStateProvider } from '../PowerStateProvider';
import { getFgsModule } from './fgsModule';
import { createPowerEventNormalizer } from './normalizePowerEvents';

function isChargingState(state: BatteryState): boolean {
  // FULL = plugged in with a full battery — still "charging" by our definition
  // (power-connection state, CLAUDE.md §4).
  return state === BatteryState.CHARGING || state === BatteryState.FULL;
}

export class AndroidPowerStateProvider implements PowerStateProvider {
  /** Foreground quick path (BUILD_V1 §8.2). */
  async isCharging(): Promise<boolean> {
    return isChargingState(await Battery.getBatteryStateAsync());
  }

  subscribe(listener: PowerListener): () => void {
    // One normalizer per subscription: every subscriber gets the full, clean stream
    // regardless of when it attached.
    const normalizer = createPowerEventNormalizer();
    const forward = (candidate: PowerEvent): void => {
      const event = normalizer.push(candidate);
      if (event !== null) listener(event);
    };

    // (a) Foreground path — expo-battery.
    const batterySubscription = Battery.addBatteryStateListener(({ batteryState }) => {
      if (batteryState === BatteryState.UNKNOWN) return;
      const at: EpochMs = Date.now(); // expo-battery carries no timestamp
      forward(
        isChargingState(batteryState)
          ? { type: 'CHARGING_STARTED', at }
          : { type: 'CHARGING_STOPPED', at },
      );
    });

    // (b) FGS path — native timestamps pass through unchanged.
    const fgs = getFgsModule();
    const disconnectSubscription = fgs.addListener('powerDisconnected', ({ at }) => {
      forward({ type: 'CHARGING_STOPPED', at });
    });
    const heartbeatSubscription = fgs.addListener('batteryHeartbeat', ({ at, charging }) => {
      if (charging) forward({ type: 'CHARGING_HEARTBEAT', at });
    });

    return () => {
      batterySubscription.remove();
      disconnectSubscription.remove();
      heartbeatSubscription.remove();
    };
  }
}
