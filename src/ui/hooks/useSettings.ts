/**
 * useSettings — reactive view over the SettingsStore (app tunables, BUILD_V1
 * §11 screen 7).
 */
import { useCallback, useEffect, useState } from 'react';

import {
  useAppServices,
  type SettingsValues,
} from '../services/AppServicesContext';

export interface Settings {
  readonly values: SettingsValues;
  readonly timeZone: string;
  update(patch: Partial<SettingsValues>): Promise<void>;
}

export function useSettings(): Settings {
  const { settings } = useAppServices();
  const [values, setValues] = useState<SettingsValues>(() => settings.get());

  useEffect(() => settings.subscribe(() => setValues(settings.get())), [settings]);

  const update = useCallback(
    (patch: Partial<SettingsValues>) => settings.update(patch),
    [settings],
  );

  return { values, timeZone: settings.timeZone, update };
}
