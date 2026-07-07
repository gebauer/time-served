/**
 * Shared domain types for Time Served.
 *
 * THIS FILE IS A CONTRACT (JOBS.md): J2–J10 all build against it. Changing anything
 * here requires an entry in docs/CONTRACT_CHANGES.md and is otherwise forbidden.
 *
 * Conventions (CLAUDE.md §7):
 * - All instants are UTC epoch milliseconds (`EpochMs`). Format only at the UI edge.
 * - Calendar dates (`LocalDate`) are `YYYY-MM-DD` in the user's LOCAL time zone —
 *   day/night bucketing is local-time (BUILD_V1 §5).
 * - IDs are client-generated UUID v4, branded so they cannot be mixed up.
 */

// ---------------------------------------------------------------------------
// Branded primitives
// ---------------------------------------------------------------------------

declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/** UTC epoch milliseconds. */
export type EpochMs = number;
/** `YYYY-MM-DD` in the user's local time zone. */
export type LocalDate = Brand<string, 'LocalDate'>;

export type BoxId = Brand<string, 'BoxId'>;
export type SessionId = Brand<string, 'SessionId'>;
export type UserId = Brand<string, 'UserId'>;
export type GroupId = Brand<string, 'GroupId'>;
export type MembershipId = Brand<string, 'MembershipId'>;

// ---------------------------------------------------------------------------
// Domain events (CLAUDE.md §7) — the ONLY vocabulary the state machine sees.
// Adapters (J4/J5/J9) translate native callbacks into these.
// ---------------------------------------------------------------------------

export type DomainEvent =
  | { readonly type: 'TAG_READ'; readonly boxId: BoxId; readonly at: EpochMs }
  | { readonly type: 'CHARGING_STARTED'; readonly at: EpochMs }
  | { readonly type: 'CHARGING_STOPPED'; readonly at: EpochMs }
  | { readonly type: 'CHARGING_HEARTBEAT'; readonly at: EpochMs }
  | { readonly type: 'APP_RESUMED'; readonly at: EpochMs }
  | { readonly type: 'ARM_TIMEOUT'; readonly at: EpochMs };

// ---------------------------------------------------------------------------
// Session state machine (BUILD_V1 §6)
// ---------------------------------------------------------------------------

/**
 * In-memory machine state. Note: ARMED persists nothing; entering ACTIVE writes the
 * session row (status=open, started_at) SYNCHRONOUSLY before anything else — the one
 * architectural invariant (CLAUDE.md §3).
 */
export type SessionState =
  | { readonly kind: 'IDLE' }
  | { readonly kind: 'ARMED'; readonly boxId: BoxId; readonly armedAt: EpochMs }
  | {
      readonly kind: 'ACTIVE';
      readonly boxId: BoxId;
      readonly sessionId: SessionId;
      readonly startedAt: EpochMs;
    };

export type SessionStatus = 'armed' | 'open' | 'closed' | 'discarded';
export type SessionEndReason = 'unplug' | 'reconciled' | 'manual';

/** Persisted session row (local only — never syncs; BUILD_V1 §4.1). */
export interface Session {
  readonly id: SessionId;
  readonly boxId: BoxId;
  readonly startedAt?: EpochMs;
  readonly endedAt?: EpochMs;
  /** Heartbeat watermark; bounds a lost session on reconciliation (BUILD_V1 §7). */
  readonly lastChargingAt?: EpochMs;
  readonly status: SessionStatus;
  readonly endReason?: SessionEndReason;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
}

// ---------------------------------------------------------------------------
// Boxes (local only)
// ---------------------------------------------------------------------------

export type BoxOrigin = 'own' | 'foreign';

export interface Box {
  readonly id: BoxId;
  readonly label: string;
  readonly location?: string;
  /** V1: always 'charging' (the gate). Field exists for future count modes. */
  readonly countMode: 'charging';
  /**
   * 'own' = registered on this device (editable).
   * 'foreign' = auto-created from another member's tag (read-only; BUILD_V1 §9.2).
   */
  readonly origin: BoxOrigin;
  readonly createdAt: EpochMs;
  readonly updatedAt: EpochMs;
  readonly deletedAt?: EpochMs;
}

// ---------------------------------------------------------------------------
// Day/night bucketing (BUILD_V1 §5)
// ---------------------------------------------------------------------------

export type BucketCategory = 'day' | 'night';

/**
 * Bucketing window constants, LOCAL time. V1 defaults: day 08:00–22:00, night
 * 22:00–08:00; sessions are additionally sliced at calendar midnight.
 */
export interface BucketConfig {
  /** Local hour the day window starts (default 8). */
  readonly dayStartHour: number;
  /** Local hour the night window starts (default 22). */
  readonly nightStartHour: number;
  /** IANA zone for local-time slicing, e.g. 'Europe/Berlin'. */
  readonly timeZone: string;
}

/** Derived per-day cache, recomputable from sessions (BUILD_V1 §4.1). */
export interface DayBucket {
  readonly date: LocalDate;
  readonly dayLockSec: number;
  readonly nightLockSec: number;
  /** Set once uploaded; sealed days are immutable. */
  readonly sealedAt?: EpochMs;
  /** Changed since last recompute. */
  readonly dirty: boolean;
}

// ---------------------------------------------------------------------------
// Server-side shapes (PocketBase; BUILD_V1 §4.2) — what sync reads/writes.
// Only sealed daily totals + the E2E-encrypted name layer ever leave the device.
// ---------------------------------------------------------------------------

/** The ONLY per-user data the server stores in plaintext. */
export interface DailyStat {
  readonly userId: UserId;
  readonly date: LocalDate;
  readonly dayLockSec: number;
  readonly nightLockSec: number;
  readonly sealedAt: EpochMs;
}

/**
 * Opaque AEAD ciphertext, base64-encoded `nonce(24 bytes) || ciphertext`.
 * XChaCha20-Poly1305, no AAD (docs/CONTRACT_CHANGES.md #3).
 */
export type Sealed = Brand<string, 'Sealed'>;

export interface Group {
  readonly id: GroupId;
  /** AEAD ciphertext of `{ name: string }` under K_enc — server cannot read. */
  readonly encGroupMeta: Sealed;
  /** SHA-256(K_auth); lets the server verify access without decrypting (§10.2). */
  readonly authHash: string;
  readonly createdAt: EpochMs;
}

export type MembershipRole = 'owner' | 'member';

export interface Membership {
  readonly id: MembershipId;
  readonly groupId: GroupId;
  readonly userId: UserId;
  /** AEAD ciphertext of the per-group nickname under K_enc. */
  readonly encNick: Sealed;
  /** Set when the user consented that this group may read their daily stats. */
  readonly consentAt?: EpochMs;
  readonly role: MembershipRole;
  readonly createdAt: EpochMs;
}

/** Purely local rename of another member ("for me this is Petra"); never synced. */
export interface NickOverride {
  readonly groupId: GroupId;
  readonly memberUserId: UserId;
  readonly localLabel: string;
}

// ---------------------------------------------------------------------------
// Scoring (BUILD_V1 §11 screen 6)
// ---------------------------------------------------------------------------

export type LeaderboardPeriod = 'yesterday' | 'week' | 'all-time';

export interface LeaderboardRow {
  readonly userId: UserId;
  /** Decrypted per-group nick, possibly overridden locally. */
  readonly displayName: string;
  readonly dayLockSec: number;
  readonly nightLockSec: number;
  readonly totalSec: number;
  readonly rank: number;
}

// ---------------------------------------------------------------------------
// Shared utility ports
// ---------------------------------------------------------------------------

/** Injectable clock — domain code never calls Date.now() directly. */
export interface Clock {
  now(): EpochMs;
}

/** Injectable id source — domain code never calls a uuid lib directly. */
export interface IdSource {
  newId(): string;
}

/** V1 tunables (BUILD_V1 §6/§5; user-adjustable in Settings). */
export interface AppConfig {
  /** Seconds ARMED waits for charging before discarding (default 120). */
  readonly armTimeoutSec: number;
  readonly bucket: BucketConfig;
  /** Local hour of the daily seal task (default 12). */
  readonly sealHourLocal: number;
}

export const DEFAULT_APP_CONFIG: Omit<AppConfig, 'bucket'> & {
  bucket: Omit<BucketConfig, 'timeZone'>;
} = {
  armTimeoutSec: 120,
  bucket: { dayStartHour: 8, nightStartHour: 22 },
  sealHourLocal: 12,
};
