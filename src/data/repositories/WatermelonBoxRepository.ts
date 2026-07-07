/**
 * BoxRepository on WatermelonDB. Foreign boxes (origin='foreign', auto-created
 * from another member's tag) are read-only: update() throws on them (BUILD_V1
 * §9.2). Deletion is soft (deleted_at) so session rows keep a resolvable box.
 */
import { Q, type Collection, type Database } from '@nozbe/watermelondb';

import type { Box, BoxId, BoxOrigin, Clock } from '../../domain/types';
import type { BoxRepository } from '../Repositories';
import { BoxModel, rawOf, setColumns, type BoxRaw, type RawValue } from '../models';

function boxFromModel(model: BoxModel): Box {
  const raw = rawOf<BoxRaw>(model);
  return {
    id: raw.id as BoxId,
    label: raw.label,
    location: raw.location ?? undefined,
    countMode: raw.count_mode as Box['countMode'],
    origin: raw.origin as BoxOrigin,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    deletedAt: raw.deleted_at ?? undefined,
  };
}

export class WatermelonBoxRepository implements BoxRepository {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock
  ) {}

  private get collection(): Collection<BoxModel> {
    return this.database.get<BoxModel>(BoxModel.table);
  }

  async create(box: Omit<Box, 'createdAt' | 'updatedAt'>): Promise<Box> {
    const now = this.clock.now();
    const model = await this.database.write(() =>
      this.collection.create((m) => {
        m._raw.id = box.id;
        setColumns(m, {
          label: box.label,
          location: box.location ?? null,
          count_mode: box.countMode,
          origin: box.origin,
          created_at: now,
          updated_at: now,
          deleted_at: box.deletedAt ?? null,
        });
      })
    );
    return boxFromModel(model);
  }

  async get(id: BoxId): Promise<Box | undefined> {
    try {
      return boxFromModel(await this.collection.find(id));
    } catch {
      return undefined;
    }
  }

  async list(): Promise<Box[]> {
    const models = await this.collection
      .query(Q.where('deleted_at', null), Q.sortBy('created_at', Q.asc))
      .fetch();
    return models.map(boxFromModel);
  }

  async update(id: BoxId, patch: Partial<Pick<Box, 'label' | 'location'>>): Promise<void> {
    await this.database.write(async () => {
      const model = await this.collection.find(id);
      if (rawOf<BoxRaw>(model).origin !== 'own') {
        throw new Error(
          `BoxRepository.update: box ${id} has origin='foreign' and is read-only (BUILD_V1 §9.2)`
        );
      }
      const columns: Record<string, RawValue> = { updated_at: this.clock.now() };
      if ('label' in patch && patch.label !== undefined) columns.label = patch.label;
      if ('location' in patch) columns.location = patch.location ?? null;
      await model.update((m) => setColumns(m, columns));
    });
  }

  async softDelete(id: BoxId): Promise<void> {
    const now = this.clock.now();
    await this.database.write(async () => {
      const model = await this.collection.find(id);
      if (rawOf<BoxRaw>(model).deleted_at !== null) return; // already deleted
      await model.update((m) => setColumns(m, { deleted_at: now, updated_at: now }));
    });
  }
}
