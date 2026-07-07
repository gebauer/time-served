/**
 * useSessionEditor — manual edits on UNSEALED days (BUILD_V1 §11 screen 5):
 * shift start/end, delete. Edits go through `SessionRepository.update` followed
 * by a bucket recompute over the union of old+new extents; deletion sets
 * status='discarded' (recompute only counts 'closed' rows). Manual edits are
 * NOT live-session mutations — the running machine is untouched, which is why
 * this may bypass the reducer (the reducer owns the session lifecycle, History
 * owns corrections; sealed days are refused before any write).
 */
import { useCallback } from 'react';

import { localDateOf, recomputeRange } from '../../domain/buckets';
import type { EpochMs, SessionId } from '../../domain/types';
import { useAppServices } from '../services/AppServicesContext';
import { isValidSessionEdit } from './historyLogic';

export interface SessionEditor {
  /** Set new endpoints. Returns false (and writes nothing) if invalid/sealed. */
  updateTimes(id: SessionId, startedAt: EpochMs, endedAt: EpochMs): Promise<boolean>;
  /**
   * Discard the session and recompute the affected days. Returns false (and
   * writes nothing) when the session touches a sealed day — callers surface
   * that honestly (J11 toast) instead of silently doing nothing.
   */
  remove(id: SessionId): Promise<boolean>;
}

export function useSessionEditor(): SessionEditor {
  const { repositories, settings, events } = useAppServices();

  const guardSealed = useCallback(
    async (...instants: EpochMs[]): Promise<boolean> => {
      for (const at of instants) {
        const bucket = await repositories.dayBuckets.get(
          localDateOf(at, settings.timeZone),
        );
        if (bucket?.sealedAt !== undefined) return false;
      }
      return true;
    },
    [repositories, settings.timeZone],
  );

  const updateTimes = useCallback(
    async (id: SessionId, startedAt: EpochMs, endedAt: EpochMs): Promise<boolean> => {
      if (!isValidSessionEdit(startedAt, endedAt)) return false;
      const existing = await repositories.sessions.get(id);
      if (existing === undefined || existing.status !== 'closed') return false;
      const oldStart = existing.startedAt ?? startedAt;
      const oldEnd = existing.endedAt ?? endedAt;
      if (!(await guardSealed(oldStart, oldEnd, startedAt, endedAt))) return false;

      await repositories.sessions.update(id, { startedAt, endedAt, endReason: 'manual' });
      await recomputeRange(
        { sessions: repositories.sessions, dayBuckets: repositories.dayBuckets },
        settings.toAppConfig().bucket,
        Math.min(oldStart, startedAt),
        Math.max(oldEnd, endedAt),
      );
      events.notify();
      return true;
    },
    [repositories, settings, events, guardSealed],
  );

  const remove = useCallback(
    async (id: SessionId): Promise<boolean> => {
      const existing = await repositories.sessions.get(id);
      if (existing === undefined) return false;
      const from = existing.startedAt ?? existing.createdAt;
      const to = existing.endedAt ?? from;
      if (!(await guardSealed(from, to))) return false;
      await repositories.sessions.update(id, { status: 'discarded' });
      await recomputeRange(
        { sessions: repositories.sessions, dayBuckets: repositories.dayBuckets },
        settings.toAppConfig().bucket,
        from,
        to,
      );
      events.notify();
      return true;
    },
    [repositories, settings, events, guardSealed],
  );

  return { updateTimes, remove };
}
