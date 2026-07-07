/**
 * SettingsStore implementation — app tunables (AppConfig fields + sync flag),
 * persisted as JSON in the injected SecureKeyValueStore (in-memory for now;
 * J9's real secure store makes it survive restarts). Time zone is derived from
 * the device once per launch (Intl) and is not user-tunable.
 */
import { DEFAULT_APP_CONFIG, type AppConfig } from '../domain/types';
import type { SecureKeyValueStore } from '../data/secure/SecureKeyValueStore';
import type { SettingsStore, SettingsValues } from '../ui/services/AppServicesContext';

const SETTINGS_KEY = 'ts.ui.settings';

const DEFAULTS: SettingsValues = {
  armTimeoutSec: DEFAULT_APP_CONFIG.armTimeoutSec,
  dayStartHour: DEFAULT_APP_CONFIG.bucket.dayStartHour,
  nightStartHour: DEFAULT_APP_CONFIG.bucket.nightStartHour,
  sealHourLocal: DEFAULT_APP_CONFIG.sealHourLocal,
  syncEnabled: true,
};

export function deviceTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone !== undefined && zone.length > 0 ? zone : 'Europe/Berlin';
}

export async function createSettingsStore(
  store: SecureKeyValueStore,
  timeZone: string = deviceTimeZone(),
): Promise<SettingsStore> {
  let values = DEFAULTS;
  const raw = await store.get(SETTINGS_KEY);
  if (raw !== null) {
    try {
      values = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<SettingsValues>) };
    } catch {
      // Corrupt payload → defaults.
    }
  }

  const listeners = new Set<() => void>();

  return {
    timeZone,
    get: () => values,
    async update(patch) {
      values = { ...values, ...patch };
      await store.set(SETTINGS_KEY, JSON.stringify(values));
      for (const listener of [...listeners]) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    toAppConfig(): AppConfig {
      return {
        armTimeoutSec: values.armTimeoutSec,
        sealHourLocal: values.sealHourLocal,
        bucket: {
          dayStartHour: values.dayStartHour,
          nightStartHour: values.nightStartHour,
          timeZone,
        },
      };
    },
  };
}
