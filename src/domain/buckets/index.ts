/**
 * Day/night bucketing (BUILD_V1 §5) — public surface of `domain/buckets`.
 * Pure TS on the Intl API; no native imports, no date libraries.
 */
export {
  addCalendarDays,
  addDaysToLocalDate,
  enumerateLocalDates,
  localDateFromParts,
  localDateOf,
  localParts,
  parseLocalDate,
  wallTimeToEpoch,
  type CalendarDay,
  type LocalParts,
} from './localTime';
export {
  categoryAt,
  localDatesInRange,
  splitInterval,
  type SessionSlice,
} from './split';
export {
  recomputeDates,
  recomputeDirtyBuckets,
  recomputeRange,
  type BucketStores,
  type RecomputeResult,
} from './recompute';
export {
  ensureZeroBuckets,
  markSealed,
  selectDaysToSeal,
  type SealArgs,
} from './seal';
