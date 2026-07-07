/**
 * NickOverrideRepository on WatermelonDB. Record id is
 * `<group_id>:<member_user_id>` (both are UUIDs, ':' is unambiguous), which
 * enforces the §4.1 uniqueness on the pair and makes upsert a find-or-create.
 * Purely local — never synced.
 */
import { Q, type Collection, type Database } from '@nozbe/watermelondb';

import type { GroupId, NickOverride, UserId } from '../../domain/types';
import type { NickOverrideRepository } from '../Repositories';
import { NickOverrideModel, rawOf, setColumns, type NickOverrideRaw } from '../models';

function overrideFromModel(model: NickOverrideModel): NickOverride {
  const raw = rawOf<NickOverrideRaw>(model);
  return {
    groupId: raw.group_id as GroupId,
    memberUserId: raw.member_user_id as UserId,
    localLabel: raw.local_label,
  };
}

function idFor(groupId: GroupId, memberUserId: UserId): string {
  return `${groupId}:${memberUserId}`;
}

export class WatermelonNickOverrideRepository implements NickOverrideRepository {
  constructor(private readonly database: Database) {}

  private get collection(): Collection<NickOverrideModel> {
    return this.database.get<NickOverrideModel>(NickOverrideModel.table);
  }

  async upsert(override: NickOverride): Promise<void> {
    const id = idFor(override.groupId, override.memberUserId);
    await this.database.write(async () => {
      const existing = await this.findModel(id);
      if (existing) {
        await existing.update((m) => setColumns(m, { local_label: override.localLabel }));
      } else {
        await this.collection.create((m) => {
          m._raw.id = id;
          setColumns(m, {
            group_id: override.groupId,
            member_user_id: override.memberUserId,
            local_label: override.localLabel,
          });
        });
      }
    });
  }

  async listForGroup(groupId: GroupId): Promise<NickOverride[]> {
    const models = await this.collection.query(Q.where('group_id', groupId)).fetch();
    return models.map(overrideFromModel);
  }

  async delete(groupId: GroupId, memberUserId: UserId): Promise<void> {
    await this.database.write(async () => {
      const model = await this.findModel(idFor(groupId, memberUserId));
      if (model) {
        await model.destroyPermanently();
      }
    });
  }

  private async findModel(id: string): Promise<NickOverrideModel | undefined> {
    try {
      return await this.collection.find(id);
    } catch {
      return undefined;
    }
  }
}
