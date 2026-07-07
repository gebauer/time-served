/**
 * WatermelonDB model classes for the local tables. Deliberately field-less (no
 * decorators — see models/raw.ts); repositories map raw rows to domain types.
 */
import { Model } from '@nozbe/watermelondb';

export class BoxModel extends Model {
  static table = 'boxes';
}

export class SessionModel extends Model {
  static table = 'sessions';
}

export class DayBucketModel extends Model {
  static table = 'day_buckets';
}

export class NickOverrideModel extends Model {
  static table = 'nick_overrides';
}

/** Everything database.ts registers. */
export const modelClasses = [BoxModel, SessionModel, DayBucketModel, NickOverrideModel];

export * from './raw';
