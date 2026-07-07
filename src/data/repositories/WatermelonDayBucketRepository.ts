/**
 * DayBucketRepository on WatermelonDB. The record id IS the date string, which
 * enforces the §4.1 "unique per date" constraint and makes upsert a find-or-
 * create. Dates are YYYY-MM-DD, so lexicographic string comparison (Q.lt/gte/
 * lte and sortBy) is chronological — no parsing anywhere.
 */
import { Q, type Collection, type Database } from '@nozbe/watermelondb';

import type { DayBucket, EpochMs, LocalDate } from '../../domain/types';
import type { DayBucketRepository } from '../Repositories';
import { DayBucketModel, rawOf, setColumns, type DayBucketRaw } from '../models';

function bucketFromModel(model: DayBucketModel): DayBucket {
  const raw = rawOf<DayBucketRaw>(model);
  return {
    date: raw.date as LocalDate,
    dayLockSec: raw.day_lock_sec,
    nightLockSec: raw.night_lock_sec,
    sealedAt: raw.sealed_at ?? undefined,
    dirty: raw.dirty,
  };
}

export class WatermelonDayBucketRepository implements DayBucketRepository {
  constructor(private readonly database: Database) {}

  private get collection(): Collection<DayBucketModel> {
    return this.database.get<DayBucketModel>(DayBucketModel.table);
  }

  async get(date: LocalDate): Promise<DayBucket | undefined> {
    const model = await this.findModel(date);
    return model ? bucketFromModel(model) : undefined;
  }

  async listRange(from: LocalDate, to: LocalDate): Promise<DayBucket[]> {
    const models = await this.collection
      .query(
        Q.where('date', Q.gte(from as string)),
        Q.where('date', Q.lte(to as string)),
        Q.sortBy('date', Q.asc)
      )
      .fetch();
    return models.map(bucketFromModel);
  }

  async upsert(
    bucket: Pick<DayBucket, 'date' | 'dayLockSec' | 'nightLockSec' | 'dirty'>
  ): Promise<void> {
    await this.database.write(async () => {
      const existing = await this.findModel(bucket.date);
      if (existing) {
        // Replace the computed totals; sealed_at is deliberately untouched.
        await existing.update((m) =>
          setColumns(m, {
            day_lock_sec: bucket.dayLockSec,
            night_lock_sec: bucket.nightLockSec,
            dirty: bucket.dirty,
          })
        );
      } else {
        await this.createBucket(bucket.date, {
          day_lock_sec: bucket.dayLockSec,
          night_lock_sec: bucket.nightLockSec,
          dirty: bucket.dirty,
        });
      }
    });
  }

  async markDirty(dates: LocalDate[]): Promise<void> {
    await this.database.write(async () => {
      for (const date of dates) {
        const existing = await this.findModel(date);
        if (existing) {
          await existing.update((m) => setColumns(m, { dirty: true }));
        } else {
          // A date can be touched (session edit/close) before it was ever
          // computed — create a zeroed dirty bucket so findDirty() feeds it
          // into the next recompute.
          await this.createBucket(date, {
            day_lock_sec: 0,
            night_lock_sec: 0,
            dirty: true,
          });
        }
      }
    });
  }

  async findDirty(): Promise<DayBucket[]> {
    const models = await this.collection
      .query(Q.where('dirty', true), Q.sortBy('date', Q.asc))
      .fetch();
    return models.map(bucketFromModel);
  }

  async findUnsealedBefore(today: LocalDate): Promise<DayBucket[]> {
    const models = await this.collection
      .query(
        Q.where('sealed_at', null),
        Q.where('date', Q.lt(today as string)),
        Q.sortBy('date', Q.asc)
      )
      .fetch();
    return models.map(bucketFromModel);
  }

  async markSealed(date: LocalDate, sealedAt: EpochMs): Promise<void> {
    await this.database.write(async () => {
      const model = await this.collection.find(date);
      await model.update((m) => setColumns(m, { sealed_at: sealedAt }));
    });
  }

  private async findModel(date: LocalDate): Promise<DayBucketModel | undefined> {
    try {
      return await this.collection.find(date);
    } catch {
      return undefined;
    }
  }

  /** Must run inside a writer block. */
  private async createBucket(
    date: LocalDate,
    columns: { day_lock_sec: number; night_lock_sec: number; dirty: boolean }
  ): Promise<void> {
    await this.collection.create((m) => {
      m._raw.id = date;
      setColumns(m, { date, ...columns, sealed_at: null });
    });
  }
}
