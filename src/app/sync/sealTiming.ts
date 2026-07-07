/**
 * Pure timing math for the seal triggers (J10) — separate from
 * sealTriggers.ts so it stays Node-testable (that module imports
 * react-native's AppState).
 */
import {
  addDaysToLocalDate,
  localDateOf,
  parseLocalDate,
  wallTimeToEpoch,
} from '../../domain/buckets';
import type { EpochMs } from '../../domain/types';

/** Next occurrence of the local seal hour strictly after `now`. */
export function nextSealInstant(
  now: EpochMs,
  timeZone: string,
  sealHour: number,
): EpochMs {
  const today = localDateOf(now, timeZone);
  const at = wallTimeToEpoch(timeZone, parseLocalDate(today), sealHour);
  if (at > now) return at;
  return wallTimeToEpoch(
    timeZone,
    parseLocalDate(addDaysToLocalDate(today, 1)),
    sealHour,
  );
}
