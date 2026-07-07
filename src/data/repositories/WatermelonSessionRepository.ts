/**
 * SessionRepository on WatermelonDB. Every mutation runs inside database.write
 * and resolves only after the adapter batch completed — `createOpen` in
 * particular returns only once the row is durably queued to storage (the
 * CLAUDE.md §3 invariant write).
 */
import { Q, type Collection, type Database } from '@nozbe/watermelondb';

import type {
  Clock,
  EpochMs,
  Session,
  SessionEndReason,
  SessionId,
  SessionStatus,
  BoxId,
} from '../../domain/types';
import type { SessionRepository } from '../Repositories';
import { SessionModel, rawOf, setColumns, type RawValue, type SessionRaw } from '../models';

function sessionFromModel(model: SessionModel): Session {
  const raw = rawOf<SessionRaw>(model);
  return {
    id: raw.id as SessionId,
    boxId: raw.box_id as BoxId,
    startedAt: raw.started_at ?? undefined,
    endedAt: raw.ended_at ?? undefined,
    lastChargingAt: raw.last_charging_at ?? undefined,
    status: raw.status as SessionStatus,
    endReason: (raw.end_reason ?? undefined) as SessionEndReason | undefined,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
  };
}

export class WatermelonSessionRepository implements SessionRepository {
  constructor(
    private readonly database: Database,
    private readonly clock: Clock
  ) {}

  private get collection(): Collection<SessionModel> {
    return this.database.get<SessionModel>(SessionModel.table);
  }

  async createOpen(input: {
    id: SessionId;
    boxId: BoxId;
    startedAt: EpochMs;
  }): Promise<Session> {
    const now = this.clock.now();
    const model = await this.database.write(() =>
      this.collection.create((m) => {
        m._raw.id = input.id;
        setColumns(m, {
          box_id: input.boxId,
          started_at: input.startedAt,
          ended_at: null,
          last_charging_at: null,
          status: 'open',
          end_reason: null,
          created_at: now,
          updated_at: now,
        });
      })
    );
    return sessionFromModel(model);
  }

  async recordHeartbeat(id: SessionId, at: EpochMs): Promise<void> {
    await this.mutate(id, { last_charging_at: at });
  }

  async close(
    id: SessionId,
    end: { endedAt: EpochMs; endReason: SessionEndReason }
  ): Promise<void> {
    await this.mutate(id, {
      status: 'closed',
      ended_at: end.endedAt,
      end_reason: end.endReason,
    });
  }

  async findOpen(): Promise<Session[]> {
    const models = await this.collection.query(Q.where('status', 'open')).fetch();
    return models.map(sessionFromModel);
  }

  async get(id: SessionId): Promise<Session | undefined> {
    try {
      return sessionFromModel(await this.collection.find(id));
    } catch {
      return undefined;
    }
  }

  async findOverlapping(fromMs: EpochMs, toMs: EpochMs): Promise<Session[]> {
    // Half-open interval overlap: [started_at, ended_at) ∩ [fromMs, toMs) ≠ ∅
    // ⇔ started_at < toMs AND ended_at > fromMs. Only closed sessions count —
    // they are the only ones with both bounds (BUILD_V1 §5 recompute input).
    const models = await this.collection
      .query(
        Q.where('status', 'closed'),
        Q.where('started_at', Q.lt(toMs)),
        Q.where('ended_at', Q.gt(fromMs)),
        Q.sortBy('started_at', Q.asc)
      )
      .fetch();
    return models.map(sessionFromModel);
  }

  async update(
    id: SessionId,
    patch: Partial<Pick<Session, 'startedAt' | 'endedAt' | 'status' | 'endReason'>>
  ): Promise<void> {
    const columns: Record<string, RawValue> = {};
    if ('startedAt' in patch) columns.started_at = patch.startedAt ?? null;
    if ('endedAt' in patch) columns.ended_at = patch.endedAt ?? null;
    if ('status' in patch && patch.status !== undefined) columns.status = patch.status;
    if ('endReason' in patch) columns.end_reason = patch.endReason ?? null;
    await this.mutate(id, columns);
  }

  /** find + update in one writer block; rejects if the session does not exist. */
  private async mutate(id: SessionId, columns: Record<string, RawValue>): Promise<void> {
    await this.database.write(async () => {
      const model = await this.collection.find(id);
      await model.update((m) => {
        setColumns(m, { ...columns, updated_at: this.clock.now() });
      });
    });
  }
}
