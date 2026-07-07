/**
 * Typed wrapper around the "TimeServedFgs" native module (modules/fgs) — the SINGLE
 * import point for the FGS on the TS side (J9 consumes this; nothing else may call
 * `requireNativeModule('TimeServedFgs')`).
 *
 * Event names and payload shapes here mirror the Kotlin side
 * (modules/fgs/.../TimeServedFgsModule.kt) — change them only together.
 */
import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { EpochMs } from '../../domain/types';

/** Payload of "powerDisconnected" — the primary session finalizer (CLAUDE.md §3). */
export interface PowerDisconnectedEvent {
  /** Native-side observation time; passed through unchanged. */
  readonly at: EpochMs;
}

/**
 * Payload of "batteryHeartbeat" — throttled to at most one per 60 s native-side.
 * `charging` is the power-CONNECTION state (EXTRA_PLUGGED != 0), never measured
 * current, so "battery full" still reads as charging (CLAUDE.md §4).
 */
export interface BatteryHeartbeatEvent {
  readonly at: EpochMs;
  readonly charging: boolean;
}

export type TimeServedFgsEvents = {
  powerDisconnected: (event: PowerDisconnectedEvent) => void;
  batteryHeartbeat: (event: BatteryHeartbeatEvent) => void;
};

declare class TimeServedFgsModuleType extends NativeModule<TimeServedFgsEvents> {
  /**
   * Start the FGS with the given notification label. Idempotent — re-start refreshes
   * the notification. Only legal while the app is foreground (the NFC read is).
   */
  startService(boxLabel: string): Promise<void>;
  /** Stop the FGS. No-op when not running (idempotent). */
  stopService(): Promise<void>;
  /** Update the notification label. No-op when not running (never starts). */
  updateLabel(boxLabel: string): Promise<void>;
  /** Best-effort: true between service onCreate and onDestroy. */
  isRunning(): Promise<boolean>;
}

export type { TimeServedFgsModuleType };

let cached: TimeServedFgsModuleType | null | undefined;

/** Null in environments without the native module (Expo Go, web, tests). */
export function getOptionalFgsModule(): TimeServedFgsModuleType | null {
  if (cached === undefined) {
    cached = requireOptionalNativeModule<TimeServedFgsModuleType>('TimeServedFgs');
  }
  return cached;
}

/** The module, or a descriptive throw when the dev build is missing it. */
export function getFgsModule(): TimeServedFgsModuleType {
  const module = getOptionalFgsModule();
  if (module === null) {
    throw new Error(
      'Native module "TimeServedFgs" is not available. Time Served needs a dev build ' +
        '(expo prebuild + expo run:android) — modules/fgs does not exist in Expo Go.',
    );
  }
  return module;
}
