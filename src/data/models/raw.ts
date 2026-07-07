/**
 * Typed access to WatermelonDB raw rows without decorators.
 *
 * We deliberately do NOT use @nozbe/watermelondb/decorators: they require the
 * legacy-decorators babel/tsc options, which J1's shared configs don't enable,
 * and the repositories are the only code that touches models anyway. Instead,
 * each table gets a raw-row interface mirroring its schema, and repositories
 * read `model._raw` / write via `Model._setRaw` (the public sanitized setter,
 * only legal inside create/update blocks).
 */
import type { Model } from '@nozbe/watermelondb';

/** The only value types WatermelonDB columns can hold. */
export type RawValue = string | number | boolean | null;

export interface BoxRaw {
  id: string;
  label: string;
  location: string | null;
  count_mode: string;
  origin: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export interface SessionRaw {
  id: string;
  box_id: string;
  started_at: number | null;
  ended_at: number | null;
  last_charging_at: number | null;
  status: string;
  end_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface DayBucketRaw {
  id: string;
  date: string;
  day_lock_sec: number;
  night_lock_sec: number;
  sealed_at: number | null;
  dirty: boolean;
}

export interface NickOverrideRaw {
  id: string;
  group_id: string;
  member_user_id: string;
  local_label: string;
}

/** Read a model's raw row under its table's typed shape. */
export function rawOf<T>(model: Model): T {
  return model._raw as unknown as T;
}

/**
 * Set several columns through the sanitizing setter. Must be called inside a
 * `collection.create()` / `model.update()` builder callback.
 */
export function setColumns(model: Model, columns: Record<string, RawValue>): void {
  for (const [name, value] of Object.entries(columns)) {
    model._setRaw(name, value);
  }
}
