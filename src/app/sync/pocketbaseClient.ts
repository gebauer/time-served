/**
 * Thin typed fetch client for the Time Served PocketBase backend (J10).
 *
 * Deliberately NOT the `pocketbase` npm SDK: the app touches exactly seven
 * endpoints (register, auth, daily_stats create + the four /api/ts/* hooks),
 * needs no realtime/file/OAuth machinery, and `fetch` behaves identically on
 * React Native (Hermes) and Node ≥ 18 — which is what lets the integration
 * tests run this exact module against a real local PocketBase.
 *
 * Auth: PocketBase expects the raw JWT in the `Authorization` header (no
 * "Bearer" prefix — server/README.md §3). Token acquisition/refresh lives in
 * deviceAuth.ts; this client just carries whatever token it is handed.
 *
 * Errors: HTTP-level failures become `PbError` (status + server message).
 * Network failures (offline, DNS, refused) keep their native error type —
 * callers distinguish "server said no" from "no server reachable" that way.
 */

// ---------------------------------------------------------------------------
// Wire shapes (snake_case — exactly what server/README.md specifies)
// ---------------------------------------------------------------------------

export interface UserRecordWire {
  readonly id: string; // 15-char PB record id — the on-wire user_id
  readonly user_uuid: string;
}

export interface AuthResponseWire {
  readonly token: string;
  readonly record: UserRecordWire;
}

export interface DailyStatWire {
  readonly user_id: string;
  readonly date: string; // YYYY-MM-DD (local calendar date of the sealed day)
  readonly day_lock_sec: number;
  readonly night_lock_sec: number;
  readonly sealed_at: string; // ISO datetime
}

export interface GroupCreateRequestWire {
  readonly group_id: string;
  readonly enc_group_meta: string;
  readonly auth_hash: string;
  readonly enc_nick: string;
  readonly consent: boolean;
}

export interface GroupJoinRequestWire {
  readonly group_id: string;
  readonly k_auth: string; // base64url without padding (43 chars)
  readonly enc_nick: string;
  readonly consent: boolean;
}

export interface MembershipResponseWire {
  readonly group_id: string;
  readonly role: 'owner' | 'member';
  readonly consent_at: string | null;
}

export interface GroupFeedRequestWire {
  readonly group_id: string;
  readonly k_auth: string;
  readonly from_date: string;
  readonly to_date: string;
}

export interface FeedMembershipWire {
  readonly user_id: string;
  readonly enc_nick: string;
  readonly consent_at: string | null;
  readonly role: 'owner' | 'member';
}

export interface FeedDailyStatWire {
  readonly user_id: string;
  readonly date: string;
  readonly day_lock_sec: number;
  readonly night_lock_sec: number;
  readonly sealed_at: string;
}

export interface GroupFeedResponseWire {
  readonly group_id: string;
  readonly enc_group_meta: string;
  readonly memberships: readonly FeedMembershipWire[];
  readonly daily_stats: readonly FeedDailyStatWire[];
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** The server answered with a non-2xx status (as opposed to being offline). */
export class PbError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Parsed response body, if any (PocketBase error shape). */
    readonly data?: unknown,
  ) {
    super(`PocketBase ${status}: ${message}`);
    this.name = 'PbError';
  }
}

export function isPbError(error: unknown, status?: number): error is PbError {
  return (
    error instanceof PbError && (status === undefined || error.status === status)
  );
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface PocketBaseClient {
  readonly baseUrl: string;
  /** POST /api/collections/users/records — open create rule (bootstrap). */
  createUser(input: { userUuid: string; password: string }): Promise<UserRecordWire>;
  /** POST /api/collections/users/auth-with-password. */
  authWithPassword(identity: string, password: string): Promise<AuthResponseWire>;
  /** POST /api/collections/daily_stats/records — the only direct data write. */
  createDailyStat(token: string, stat: DailyStatWire): Promise<void>;
  groupCreate(
    token: string,
    body: GroupCreateRequestWire,
  ): Promise<MembershipResponseWire>;
  groupJoin(token: string, body: GroupJoinRequestWire): Promise<MembershipResponseWire>;
  groupFeed(token: string, body: GroupFeedRequestWire): Promise<GroupFeedResponseWire>;
  /** POST /api/ts/group-leave — 204 always (idempotent). */
  groupLeave(token: string, groupId: string): Promise<void>;
}

export type FetchFn = typeof fetch;

export function createPocketBaseClient(
  baseUrl: string,
  fetchFn: FetchFn = fetch,
): PocketBaseClient {
  const base = baseUrl.replace(/\/+$/, '');

  async function request<T>(
    path: string,
    body: unknown,
    token?: string,
  ): Promise<T> {
    const response = await fetchFn(base + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token !== undefined ? { Authorization: token } : {}),
      },
      body: JSON.stringify(body),
    });
    if (response.status === 204) {
      return undefined as T;
    }
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text === '' ? null : JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (!response.ok) {
      const message =
        typeof json === 'object' && json !== null && 'message' in json
          ? String((json as { message: unknown }).message)
          : response.statusText;
      throw new PbError(response.status, message, json);
    }
    return json as T;
  }

  return {
    baseUrl: base,
    createUser({ userUuid, password }) {
      return request<UserRecordWire>('/api/collections/users/records', {
        user_uuid: userUuid,
        password,
        passwordConfirm: password,
      });
    },
    authWithPassword(identity, password) {
      return request<AuthResponseWire>('/api/collections/users/auth-with-password', {
        identity,
        password,
      });
    },
    async createDailyStat(token, stat) {
      await request<unknown>('/api/collections/daily_stats/records', stat, token);
    },
    groupCreate(token, body) {
      return request<MembershipResponseWire>('/api/ts/group-create', body, token);
    },
    groupJoin(token, body) {
      return request<MembershipResponseWire>('/api/ts/group-join', body, token);
    },
    groupFeed(token, body) {
      return request<GroupFeedResponseWire>('/api/ts/group-feed', body, token);
    },
    async groupLeave(token, groupId) {
      await request<void>('/api/ts/group-leave', { group_id: groupId }, token);
    },
  };
}
