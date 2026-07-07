/**
 * In-memory fakes for domain tests (JOBS.md J2: "fake repositories + fake
 * clock"). Pure TS, plain Node — reused by J3's contract suite, J8's dev
 * harness and J9/J10 integration tests.
 *
 * All fakes accept an optional shared `log: string[]` and append a line per
 * mutating call, so tests can assert cross-port EFFECT ORDERING (e.g. the
 * CLAUDE.md §3 invariant: `sessions.createOpen` before anything else).
 */
import type {
  BoxRepository,
  DayBucketRepository,
  DeviceCredentialStore,
  GroupKeyStore,
  NickOverrideRepository,
  Repositories,
  SessionRepository,
} from '../../data/Repositories';
import type {
  SessionRuntime,
  SessionRuntimeStartOptions,
} from '../../platform/SessionRuntime';
import type {
  Box,
  BoxId,
  Clock,
  DayBucket,
  EpochMs,
  GroupId,
  IdSource,
  LocalDate,
  NickOverride,
  Session,
  SessionEndReason,
  SessionId,
  UserId,
} from '../types';

// ---------------------------------------------------------------------------
// Clock & ids
// ---------------------------------------------------------------------------

export class FakeClock implements Clock {
  constructor(private t: EpochMs = 0) {}
  now(): EpochMs {
    return this.t;
  }
  set(ms: EpochMs): void {
    this.t = ms;
  }
  advance(ms: number): void {
    this.t += ms;
  }
}

/** Deterministic ids: `sess-1`, `sess-2`, … */
export class FakeIdSource implements IdSource {
  private n = 0;
  constructor(private readonly prefix = 'id') {}
  newId(): string {
    this.n += 1;
    return `${this.prefix}-${this.n}`;
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export class InMemorySessionRepository implements SessionRepository {
  readonly rows = new Map<SessionId, Session>();
  /** When true, the next createOpen throws (invariant-rollback tests). */
  failNextCreateOpen = false;

  constructor(
    private readonly clock: Clock,
    private readonly log?: string[],
  ) {}

  async createOpen(input: {
    id: SessionId;
    boxId: BoxId;
    startedAt: EpochMs;
  }): Promise<Session> {
    this.log?.push(`sessions.createOpen(${input.id})`);
    if (this.failNextCreateOpen) {
      this.failNextCreateOpen = false;
      throw new Error('fake: createOpen failed');
    }
    const now = this.clock.now();
    const session: Session = {
      id: input.id,
      boxId: input.boxId,
      startedAt: input.startedAt,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(session.id, session);
    return session;
  }

  async recordHeartbeat(id: SessionId, at: EpochMs): Promise<void> {
    this.log?.push(`sessions.recordHeartbeat(${id})`);
    const row = this.mustGet(id);
    this.rows.set(id, { ...row, lastChargingAt: at, updatedAt: this.clock.now() });
  }

  async close(
    id: SessionId,
    end: { endedAt: EpochMs; endReason: SessionEndReason },
  ): Promise<void> {
    this.log?.push(`sessions.close(${id})`);
    const row = this.mustGet(id);
    this.rows.set(id, {
      ...row,
      status: 'closed',
      endedAt: end.endedAt,
      endReason: end.endReason,
      updatedAt: this.clock.now(),
    });
  }

  async findOpen(): Promise<Session[]> {
    return [...this.rows.values()].filter((s) => s.status === 'open');
  }

  async get(id: SessionId): Promise<Session | undefined> {
    return this.rows.get(id);
  }

  async findOverlapping(fromMs: EpochMs, toMs: EpochMs): Promise<Session[]> {
    return [...this.rows.values()].filter(
      (s) =>
        s.status === 'closed' &&
        s.startedAt !== undefined &&
        s.endedAt !== undefined &&
        s.startedAt < toMs &&
        s.endedAt > fromMs,
    );
  }

  async update(
    id: SessionId,
    patch: Partial<Pick<Session, 'startedAt' | 'endedAt' | 'status' | 'endReason'>>,
  ): Promise<void> {
    this.log?.push(`sessions.update(${id})`);
    const row = this.mustGet(id);
    this.rows.set(id, { ...row, ...patch, updatedAt: this.clock.now() });
  }

  private mustGet(id: SessionId): Session {
    const row = this.rows.get(id);
    if (row === undefined) throw new Error(`fake: no session '${id}'`);
    return row;
  }
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

export class InMemoryBoxRepository implements BoxRepository {
  readonly rows = new Map<BoxId, Box>();

  constructor(
    private readonly clock: Clock,
    private readonly log?: string[],
  ) {}

  async create(box: Omit<Box, 'createdAt' | 'updatedAt'>): Promise<Box> {
    this.log?.push(`boxes.create(${box.id})`);
    const now = this.clock.now();
    const row: Box = { ...box, createdAt: now, updatedAt: now };
    this.rows.set(row.id, row);
    return row;
  }

  async get(id: BoxId): Promise<Box | undefined> {
    return this.rows.get(id);
  }

  async list(): Promise<Box[]> {
    return [...this.rows.values()].filter((b) => b.deletedAt === undefined);
  }

  async update(id: BoxId, patch: Partial<Pick<Box, 'label' | 'location'>>): Promise<void> {
    this.log?.push(`boxes.update(${id})`);
    const row = this.rows.get(id);
    if (row === undefined) throw new Error(`fake: no box '${id}'`);
    if (row.origin === 'foreign') throw new Error('fake: foreign boxes are read-only');
    this.rows.set(id, { ...row, ...patch, updatedAt: this.clock.now() });
  }

  async softDelete(id: BoxId): Promise<void> {
    this.log?.push(`boxes.softDelete(${id})`);
    const row = this.rows.get(id);
    if (row === undefined) throw new Error(`fake: no box '${id}'`);
    this.rows.set(id, { ...row, deletedAt: this.clock.now(), updatedAt: this.clock.now() });
  }
}

// ---------------------------------------------------------------------------
// Day buckets
// ---------------------------------------------------------------------------

export class InMemoryDayBucketRepository implements DayBucketRepository {
  readonly rows = new Map<LocalDate, DayBucket>();

  constructor(private readonly log?: string[]) {}

  async get(date: LocalDate): Promise<DayBucket | undefined> {
    return this.rows.get(date);
  }

  async listRange(from: LocalDate, to: LocalDate): Promise<DayBucket[]> {
    return [...this.rows.values()]
      .filter((b) => b.date >= from && b.date <= to)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async upsert(
    bucket: Pick<DayBucket, 'date' | 'dayLockSec' | 'nightLockSec' | 'dirty'>,
  ): Promise<void> {
    this.log?.push(`dayBuckets.upsert(${bucket.date})`);
    const existing = this.rows.get(bucket.date);
    this.rows.set(bucket.date, { ...bucket, sealedAt: existing?.sealedAt });
  }

  async markDirty(dates: LocalDate[]): Promise<void> {
    this.log?.push(`dayBuckets.markDirty(${dates.join(',')})`);
    for (const date of dates) {
      const existing = this.rows.get(date);
      this.rows.set(
        date,
        existing !== undefined
          ? { ...existing, dirty: true }
          : { date, dayLockSec: 0, nightLockSec: 0, dirty: true },
      );
    }
  }

  async findDirty(): Promise<DayBucket[]> {
    return [...this.rows.values()].filter((b) => b.dirty);
  }

  async findUnsealedBefore(today: LocalDate): Promise<DayBucket[]> {
    return [...this.rows.values()]
      .filter((b) => b.sealedAt === undefined && b.date < today)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  async markSealed(date: LocalDate, sealedAt: EpochMs): Promise<void> {
    this.log?.push(`dayBuckets.markSealed(${date})`);
    const existing = this.rows.get(date);
    this.rows.set(
      date,
      existing !== undefined
        ? { ...existing, sealedAt }
        : { date, dayLockSec: 0, nightLockSec: 0, dirty: false, sealedAt },
    );
  }
}

// ---------------------------------------------------------------------------
// Secure stores & nick overrides (trivial)
// ---------------------------------------------------------------------------

export class InMemoryGroupKeyStore implements GroupKeyStore {
  private readonly keys = new Map<GroupId, Uint8Array>();
  async put(groupId: GroupId, kg: Uint8Array): Promise<void> {
    this.keys.set(groupId, kg);
  }
  async get(groupId: GroupId): Promise<Uint8Array | undefined> {
    return this.keys.get(groupId);
  }
  async delete(groupId: GroupId): Promise<void> {
    this.keys.delete(groupId);
  }
  async listGroupIds(): Promise<GroupId[]> {
    return [...this.keys.keys()];
  }
}

export class InMemoryDeviceCredentialStore implements DeviceCredentialStore {
  private credential: { userId: UserId; token: string } | undefined;
  async get(): Promise<{ userId: UserId; token: string } | undefined> {
    return this.credential;
  }
  async put(credential: { userId: UserId; token: string }): Promise<void> {
    this.credential = credential;
  }
}

export class InMemoryNickOverrideRepository implements NickOverrideRepository {
  private readonly rows = new Map<string, NickOverride>();
  async upsert(override: NickOverride): Promise<void> {
    this.rows.set(`${override.groupId}:${override.memberUserId}`, override);
  }
  async listForGroup(groupId: GroupId): Promise<NickOverride[]> {
    return [...this.rows.values()].filter((o) => o.groupId === groupId);
  }
  async delete(groupId: GroupId, memberUserId: UserId): Promise<void> {
    this.rows.delete(`${groupId}:${memberUserId}`);
  }
}

// ---------------------------------------------------------------------------
// Runtime (FGS stand-in)
// ---------------------------------------------------------------------------

export class FakeSessionRuntime implements SessionRuntime {
  readonly startedLabels: string[] = [];
  stopCount = 0;
  private running = false;

  constructor(private readonly log?: string[]) {}

  async start(options: SessionRuntimeStartOptions): Promise<void> {
    this.log?.push(`runtime.start(${options.boxLabel})`);
    this.startedLabels.push(options.boxLabel);
    this.running = true;
  }

  async stop(): Promise<void> {
    this.log?.push('runtime.stop');
    this.stopCount += 1;
    this.running = false;
  }

  async isRunning(): Promise<boolean> {
    return this.running;
  }
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export interface InMemoryRepositories extends Repositories {
  readonly sessions: InMemorySessionRepository;
  readonly boxes: InMemoryBoxRepository;
  readonly dayBuckets: InMemoryDayBucketRepository;
}

export function makeInMemoryRepositories(
  clock: Clock,
  log?: string[],
): InMemoryRepositories {
  return {
    sessions: new InMemorySessionRepository(clock, log),
    boxes: new InMemoryBoxRepository(clock, log),
    dayBuckets: new InMemoryDayBucketRepository(log),
    groupKeys: new InMemoryGroupKeyStore(),
    deviceCredential: new InMemoryDeviceCredentialStore(),
    nickOverrides: new InMemoryNickOverrideRepository(),
  };
}
