/**
 * SystemStatusService implementation (J11, CONTRACT_CHANGES.md #13) — the one
 * place that reads/requests system permissions and NFC availability:
 *
 *  - POST_NOTIFICATIONS via expo-notifications. Android 13+ only; below 13 the
 *    permission is granted at install time and the request resolves 'granted'
 *    without a dialog. PRECISE degraded behavior when denied (verified against
 *    Android 13 docs, not guessed): the FGS itself does NOT need the permission
 *    — startForeground() succeeds and the session counts normally; the system
 *    merely suppresses the FGS notification from the drawer (the session is
 *    still visible under the task-manager "active apps" affordance). Our
 *    one-shot info notifications (foreign box) are also suppressed. So denial
 *    degrades visibility, never counting.
 *  - Battery-optimization exemption via modules/fgs (PowerManager +
 *    ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS dialog, BUILD_V1 §8.5).
 *  - NFC adapter state + settings screen via platform/android/nfc.
 *
 * Fakes mode (emulator harness) reports NFC 'ok' and battery 'unavailable' so
 * no banner/warning noise appears where the fakes drive the loop; notification
 * permission stays REAL in both modes (works on emulators, harmless in tests).
 */
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

import { getOptionalFgsModule } from '../platform/android/fgsModule';
import { getNfcStatus, openNfcSettings } from '../platform/android/nfc';
import type { TagReader } from '../platform/TagReader';
import type {
  NfcAvailability,
  PermissionState,
  SystemStatusService,
} from '../ui/services/AppServicesContext';

function toPermissionState(status: Notifications.PermissionStatus): PermissionState {
  // 'undetermined' reads as 'denied' for the UI: the request button covers both.
  return status === 'granted' ? 'granted' : 'denied';
}

export interface SystemStatusOptions {
  readonly mode: 'real' | 'fakes';
  /** The live reader instance — restart target after NFC gets re-enabled. */
  readonly tagReader: TagReader;
}

export function createSystemStatusService(
  options: SystemStatusOptions,
): SystemStatusService {
  const real = options.mode === 'real';

  return {
    async notificationPermission(): Promise<PermissionState> {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        return toPermissionState(status);
      } catch {
        return 'unavailable';
      }
    },

    async requestNotificationPermission(): Promise<PermissionState> {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        return toPermissionState(status);
      } catch {
        return 'unavailable';
      }
    },

    async batteryExemption(): Promise<PermissionState> {
      const fgs = getOptionalFgsModule();
      if (!real || fgs === null) return 'unavailable';
      try {
        return (await fgs.isIgnoringBatteryOptimizations()) ? 'granted' : 'denied';
      } catch {
        return 'unavailable';
      }
    },

    async requestBatteryExemption(): Promise<void> {
      const fgs = getOptionalFgsModule();
      if (fgs === null) return;
      try {
        await fgs.requestIgnoreBatteryOptimizations();
      } catch {
        // Dialog unavailable (OEM build) — Settings row offers the app page.
      }
    },

    async nfcStatus(): Promise<NfcAvailability> {
      if (!real) return 'ok'; // fakes drive tag reads; never show the banner
      return getNfcStatus();
    },

    async openNfcSettings(): Promise<void> {
      if (real) await openNfcSettings();
    },

    async restartTagReader(): Promise<boolean> {
      try {
        await options.tagReader.start(); // idempotent per the TagReader contract
        return true;
      } catch {
        return false;
      }
    },

    async openAppSettings(): Promise<void> {
      try {
        await Linking.openSettings();
      } catch {
        // Nothing sensible left to do.
      }
    },
  };
}
