/**
 * useSystemStatus (J11) — permission states over the SystemStatusService seam
 * for Onboarding page 3 and the Settings system section. Re-reads on every
 * return to 'active' because both system dialogs (notification permission,
 * battery exemption) resolve OUTSIDE the app: the status only becomes
 * observable when we regain the foreground. Navigation-free on purpose —
 * Onboarding renders before any NavigationContainer exists.
 */
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import {
  useAppServices,
  type PermissionState,
} from '../services/AppServicesContext';

export interface SystemStatus {
  /** undefined while loading. */
  readonly notifications: PermissionState | undefined;
  readonly battery: PermissionState | undefined;
  refresh(): void;
  /** Fires the runtime request, then refreshes. Resolves the new state. */
  requestNotifications(): Promise<PermissionState>;
  /** Fires the system dialog; the next foreground refresh picks up the result. */
  requestBattery(): Promise<void>;
  openAppSettings(): void;
}

export function useSystemStatus(): SystemStatus {
  const { system } = useAppServices();
  const [notifications, setNotifications] = useState<PermissionState | undefined>();
  const [battery, setBattery] = useState<PermissionState | undefined>();
  const [generation, setGeneration] = useState(0);
  const refresh = useCallback(() => setGeneration((g) => g + 1), []);

  useEffect(() => {
    let cancelled = false;
    void system.notificationPermission().then((state) => {
      if (!cancelled) setNotifications(state);
    });
    void system.batteryExemption().then((state) => {
      if (!cancelled) setBattery(state);
    });
    const sub = AppState.addEventListener('change', (appState) => {
      if (appState === 'active') refresh();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [system, generation, refresh]);

  const requestNotifications = useCallback(async () => {
    const state = await system.requestNotificationPermission();
    setNotifications(state);
    return state;
  }, [system]);

  const requestBattery = useCallback(async () => {
    await system.requestBatteryExemption();
    // Result lands when the app refocuses — the AppState listener refreshes.
  }, [system]);

  const openAppSettings = useCallback(() => void system.openAppSettings(), [system]);

  return { notifications, battery, refresh, requestNotifications, requestBattery, openAppSettings };
}
