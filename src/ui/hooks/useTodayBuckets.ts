/**
 * useTodayBuckets — today's day/night totals (the Home hero bar). Buckets are
 * the derived cache rebuilt on session close/edit (BUILD_V1 §5); an ACTIVE
 * session's running time is deliberately NOT in here — Home shows it separately
 * as the live elapsed readout.
 */
import { localDateOf } from '../../domain/buckets';
import type { DayBucket, LocalDate } from '../../domain/types';
import { useAppServices } from '../services/AppServicesContext';
import { useAsyncData } from './useAsyncData';

export interface TodayBuckets {
  readonly date: LocalDate;
  readonly dayLockSec: number;
  readonly nightLockSec: number;
}

export function useTodayBuckets(): TodayBuckets | undefined {
  const { repositories, clock, settings } = useAppServices();
  const today = localDateOf(clock.now(), settings.timeZone);
  const { data } = useAsyncData<DayBucket | undefined>(
    () => repositories.dayBuckets.get(today),
    [today],
  );
  return {
    date: today,
    dayLockSec: data?.dayLockSec ?? 0,
    nightLockSec: data?.nightLockSec ?? 0,
  };
}
