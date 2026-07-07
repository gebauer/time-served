/**
 * Seed/fixture helpers: a small, self-consistent demo dataset for J8's mocked
 * UI and for integration tests. Goes through the Repositories contract (never
 * raw DB writes), so it works against any implementation — WatermelonDB or
 * fakes. Deterministic IDs so tests can assert against them.
 *
 * Note: fixtures write session rows directly via the repository, which is fine
 * here (seeding is not runtime session mutation); real app code must go
 * through the session reducer (CLAUDE.md §7).
 */
import type {
  BoxId,
  EpochMs,
  GroupId,
  LocalDate,
  SessionId,
  UserId,
} from '../domain/types';
import type { Repositories } from './Repositories';

export const FIXTURE_IDS = {
  ownBox: 'e1a45b84-1111-4a63-9c0e-0d1f2a3b4c5d' as BoxId,
  foreignBox: 'e1a45b84-2222-4a63-9c0e-0d1f2a3b4c5d' as BoxId,
  sessionDayBefore: 'a7c90d12-1111-4f7e-8b2a-9c8d7e6f5a4b' as SessionId,
  sessionYesterdayEvening: 'a7c90d12-2222-4f7e-8b2a-9c8d7e6f5a4b' as SessionId,
  sessionOpen: 'a7c90d12-3333-4f7e-8b2a-9c8d7e6f5a4b' as SessionId,
  demoGroup: 'b3d21e56-4444-4c8f-9d3b-1a2b3c4d5e6f' as GroupId,
  demoUser: 'c5f43a78-5555-4d9a-8e4c-2b3c4d5e6f7a' as UserId,
  demoMember: 'c5f43a78-6666-4d9a-8e4c-2b3c4d5e6f7a' as UserId,
} as const;

export interface DemoDataset {
  now: EpochMs;
  today: LocalDate;
  yesterday: LocalDate;
  dayBefore: LocalDate;
}

/** `YYYY-MM-DD` of the local calendar day containing `at`. */
export function localDateOf(at: EpochMs): LocalDate {
  const d = new Date(at);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}` as LocalDate;
}

const HOUR = 3_600_000;

/**
 * Seeds two boxes (one own, one foreign), two closed sessions (one spanning
 * the 22:00 day/night boundary), one still-open session with a heartbeat,
 * matching day buckets (day-before sealed, yesterday dirty), a nick override,
 * a device credential and one group key.
 */
export async function seedDemoData(
  repos: Repositories,
  options: { now?: EpochMs } = {}
): Promise<DemoDataset> {
  const now = options.now ?? Date.now();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const startOfToday = midnight.getTime();
  const startOfYesterday = startOfToday - 24 * HOUR;
  const startOfDayBefore = startOfToday - 48 * HOUR;

  await repos.boxes.create({
    id: FIXTURE_IDS.ownBox,
    label: 'Wohnzimmer-Box',
    location: 'Sideboard',
    countMode: 'charging',
    origin: 'own',
  });
  await repos.boxes.create({
    id: FIXTURE_IDS.foreignBox,
    label: 'Papas Box',
    countMode: 'charging',
    origin: 'foreign',
  });

  // Day before yesterday, 09:00–11:00 — pure day time, closed by reconciliation.
  await repos.sessions.createOpen({
    id: FIXTURE_IDS.sessionDayBefore,
    boxId: FIXTURE_IDS.ownBox,
    startedAt: startOfDayBefore + 9 * HOUR,
  });
  await repos.sessions.recordHeartbeat(
    FIXTURE_IDS.sessionDayBefore,
    startOfDayBefore + 10.5 * HOUR
  );
  await repos.sessions.close(FIXTURE_IDS.sessionDayBefore, {
    endedAt: startOfDayBefore + 11 * HOUR,
    endReason: 'reconciled',
  });

  // Yesterday, 20:00–23:30 — crosses the 22:00 day→night boundary, unplugged.
  await repos.sessions.createOpen({
    id: FIXTURE_IDS.sessionYesterdayEvening,
    boxId: FIXTURE_IDS.ownBox,
    startedAt: startOfYesterday + 20 * HOUR,
  });
  await repos.sessions.close(FIXTURE_IDS.sessionYesterdayEvening, {
    endedAt: startOfYesterday + 23.5 * HOUR,
    endReason: 'unplug',
  });

  // Open session: started an hour ago, heartbeat five minutes ago.
  await repos.sessions.createOpen({
    id: FIXTURE_IDS.sessionOpen,
    boxId: FIXTURE_IDS.ownBox,
    startedAt: now - HOUR,
  });
  await repos.sessions.recordHeartbeat(FIXTURE_IDS.sessionOpen, now - HOUR / 12);

  const dayBefore = localDateOf(startOfDayBefore);
  const yesterday = localDateOf(startOfYesterday);
  const today = localDateOf(now);

  // Buckets matching the sessions above (BUILD_V1 §5 slicing).
  await repos.dayBuckets.upsert({
    date: dayBefore,
    dayLockSec: 2 * 3600, // 09:00–11:00
    nightLockSec: 0,
    dirty: false,
  });
  await repos.dayBuckets.markSealed(dayBefore, startOfYesterday + 12 * HOUR);
  await repos.dayBuckets.upsert({
    date: yesterday,
    dayLockSec: 2 * 3600, // 20:00–22:00
    nightLockSec: 1.5 * 3600, // 22:00–23:30
    dirty: true,
  });

  await repos.nickOverrides.upsert({
    groupId: FIXTURE_IDS.demoGroup,
    memberUserId: FIXTURE_IDS.demoMember,
    localLabel: 'Petra',
  });

  await repos.deviceCredential.put({
    userId: FIXTURE_IDS.demoUser,
    token: 'demo-device-token',
  });
  await repos.groupKeys.put(
    FIXTURE_IDS.demoGroup,
    Uint8Array.from({ length: 32 }, (_, i) => i)
  );

  return { now, today, yesterday, dayBefore };
}
