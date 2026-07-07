import { describe, expect, it } from 'vitest';

import type { BoxId, EpochMs, Session, SessionId } from '../../domain/types';
import { groupSessionsByStartDay, isValidSessionEdit } from './historyLogic';

const TZ = 'Europe/Berlin';
const BOX = 'box-1' as BoxId;

function session(
  id: string,
  startedAt: EpochMs | undefined,
  endedAt: EpochMs | undefined,
  status: Session['status'] = 'closed',
): Session {
  return {
    id: id as SessionId,
    boxId: BOX,
    startedAt,
    endedAt,
    status,
    createdAt: startedAt ?? 0,
    updatedAt: endedAt ?? 0,
  };
}

describe('groupSessionsByStartDay', () => {
  it('assigns a session to the LOCAL date it started, even across midnight', () => {
    // 2026-07-05 23:00 Berlin (21:00Z) → 2026-07-06 01:00 Berlin.
    const start = Date.UTC(2026, 6, 5, 21, 0, 0);
    const end = Date.UTC(2026, 6, 5, 23, 0, 0);
    const grouped = groupSessionsByStartDay([session('s1', start, end)], TZ);
    expect([...grouped.keys()]).toEqual(['2026-07-05']);
    expect(grouped.get('2026-07-05' as never)?.[0].durationSec).toBe(7200);
  });

  it('drops open/discarded sessions and rows missing endpoints', () => {
    const t = Date.UTC(2026, 6, 5, 10, 0, 0);
    const grouped = groupSessionsByStartDay(
      [
        session('open', t, undefined, 'open'),
        session('discarded', t, t + 1000, 'discarded'),
        session('noStart', undefined, t + 1000),
      ],
      TZ,
    );
    expect(grouped.size).toBe(0);
  });

  it('sorts sessions within a day newest first', () => {
    const early = Date.UTC(2026, 6, 5, 7, 0, 0);
    const late = Date.UTC(2026, 6, 5, 12, 0, 0);
    const grouped = groupSessionsByStartDay(
      [session('a', early, early + 1000), session('b', late, late + 1000)],
      TZ,
    );
    const day = [...grouped.values()][0];
    expect(day.map((entry) => entry.session.id)).toEqual(['b', 'a']);
  });
});

describe('isValidSessionEdit', () => {
  it('accepts start strictly before end', () => {
    expect(isValidSessionEdit(1000, 2000)).toBe(true);
  });

  it('rejects start >= end', () => {
    expect(isValidSessionEdit(2000, 2000)).toBe(false);
    expect(isValidSessionEdit(3000, 2000)).toBe(false);
  });

  it('rejects negative start', () => {
    expect(isValidSessionEdit(-1, 2000)).toBe(false);
  });
});
