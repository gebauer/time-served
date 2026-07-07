/**
 * Repository interfaces — the persistence contract (JOBS.md J1 → implemented by J3
 * on WatermelonDB, consumed by J2's domain logic and J8's hooks). Changes require a
 * docs/CONTRACT_CHANGES.md entry.
 *
 * Every session mutation goes through the session reducer → these methods; nothing
 * writes session rows ad hoc (CLAUDE.md §7). All methods are async, but
 * `SessionRepository.createOpen` must resolve only after the row is durably queued
 * to storage — it is the CLAUDE.md §3 invariant write.
 */
import type {
  Box,
  BoxId,
  DayBucket,
  EpochMs,
  GroupId,
  LocalDate,
  NickOverride,
  Session,
  SessionEndReason,
  SessionId,
  UserId,
} from '../domain/types';

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface SessionRepository {
  /**
   * Persist a new open session (status='open', started_at set). THE invariant
   * write: called synchronously on entering ACTIVE, before anything else.
   */
  createOpen(input: {
    id: SessionId;
    boxId: BoxId;
    startedAt: EpochMs;
  }): Promise<Session>;

  /** Update last_charging_at (heartbeat watermark). */
  recordHeartbeat(id: SessionId, at: EpochMs): Promise<void>;

  /** Close a session (status='closed'). */
  close(
    id: SessionId,
    end: { endedAt: EpochMs; endReason: SessionEndReason }
  ): Promise<void>;

  /** All sessions with status='open' (reconciliation input, BUILD_V1 §7). */
  findOpen(): Promise<Session[]>;

  get(id: SessionId): Promise<Session | undefined>;

  /**
   * Closed sessions overlapping [fromMs, toMs) — input for bucket recompute
   * (a day's buckets derive from every session slice touching that day).
   */
  findOverlapping(fromMs: EpochMs, toMs: EpochMs): Promise<Session[]>;

  /** Manual edit on an unsealed day (History screen). */
  update(
    id: SessionId,
    patch: Partial<Pick<Session, 'startedAt' | 'endedAt' | 'status' | 'endReason'>>
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

export interface BoxRepository {
  create(box: Omit<Box, 'createdAt' | 'updatedAt'>): Promise<Box>;
  get(id: BoxId): Promise<Box | undefined>;
  /** Excludes soft-deleted boxes. */
  list(): Promise<Box[]>;
  /** Only valid for origin='own' boxes; foreign boxes are read-only (§9.2). */
  update(id: BoxId, patch: Partial<Pick<Box, 'label' | 'location'>>): Promise<void>;
  softDelete(id: BoxId): Promise<void>;
}

// ---------------------------------------------------------------------------
// Day buckets (derived cache; BUILD_V1 §5)
// ---------------------------------------------------------------------------

export interface DayBucketRepository {
  get(date: LocalDate): Promise<DayBucket | undefined>;
  /** Ascending by date, inclusive bounds. */
  listRange(from: LocalDate, to: LocalDate): Promise<DayBucket[]>;
  /** Insert-or-replace the computed totals; preserves sealed_at. */
  upsert(bucket: Pick<DayBucket, 'date' | 'dayLockSec' | 'nightLockSec' | 'dirty'>): Promise<void>;
  markDirty(dates: LocalDate[]): Promise<void>;
  findDirty(): Promise<DayBucket[]>;
  /** Unsealed buckets with date < the given local date (seal-task input, §5). */
  findUnsealedBefore(today: LocalDate): Promise<DayBucket[]>;
  markSealed(date: LocalDate, sealedAt: EpochMs): Promise<void>;
}

// ---------------------------------------------------------------------------
// Secure storage (Keystore-backed; NOT WatermelonDB)
// ---------------------------------------------------------------------------

/** Per-group 256-bit key K_g from the invite link. Never synced (BUILD_V1 §4.1). */
export interface GroupKeyStore {
  put(groupId: GroupId, kg: Uint8Array): Promise<void>;
  get(groupId: GroupId): Promise<Uint8Array | undefined>;
  delete(groupId: GroupId): Promise<void>;
  listGroupIds(): Promise<GroupId[]>;
}

/** Anonymous device identity (BUILD_V1 §10.1). Created once, never derived. */
export interface DeviceCredentialStore {
  get(): Promise<{ userId: UserId; token: string } | undefined>;
  put(credential: { userId: UserId; token: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Local nick overrides (never synced)
// ---------------------------------------------------------------------------

export interface NickOverrideRepository {
  upsert(override: NickOverride): Promise<void>;
  listForGroup(groupId: GroupId): Promise<NickOverride[]>;
  delete(groupId: GroupId, memberUserId: UserId): Promise<void>;
}

// ---------------------------------------------------------------------------
// Aggregate handle the domain layer receives (dependency injection)
// ---------------------------------------------------------------------------

export interface Repositories {
  readonly sessions: SessionRepository;
  readonly boxes: BoxRepository;
  readonly dayBuckets: DayBucketRepository;
  readonly groupKeys: GroupKeyStore;
  readonly deviceCredential: DeviceCredentialStore;
  readonly nickOverrides: NickOverrideRepository;
}
