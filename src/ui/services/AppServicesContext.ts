/**
 * AppServices — the injection seam between ui/ and the composition root.
 *
 * This file defines ONLY types + the React context (referencing domain types,
 * repository contracts and platform INTERFACES — all legal ui imports). The
 * concrete wiring lives in `src/app/services.ts` (fakes + in-memory data for
 * now; J9/J10 swap in real adapters THERE, not here). Keeping the context
 * definition in ui/ preserves the one-way dependency direction of CLAUDE.md §6
 * (app → ui → domain; ui never imports app).
 */
import { createContext, useContext } from 'react';

import type { Repositories } from '../../data/Repositories';
import type {
  AppConfig,
  BoxId,
  Clock,
  DailyStat,
  DayBucket,
  DomainEvent,
  EpochMs,
  GroupId,
  IdSource,
  MembershipRole,
  Session,
  SessionState,
} from '../../domain/types';
import type { LeaderboardMember } from '../../domain/scoring';
import type { TagWriter } from '../../platform/TagReader';

// ---------------------------------------------------------------------------
// Engine handle — J2's engine plus a change subscription (added by the wiring)
// ---------------------------------------------------------------------------

export interface EngineHandle {
  getState(): SessionState;
  dispatch(event: DomainEvent): Promise<SessionState>;
  /** Fires after every dispatch settles (state may or may not have changed). */
  subscribe(listener: (state: SessionState) => void): () => void;
}

/** Coarse "something in the data layer changed" signal for query hooks. */
export interface ChangeNotifier {
  subscribe(listener: () => void): () => void;
  notify(): void;
}

// ---------------------------------------------------------------------------
// Settings (persisted app tunables + UI-level flags)
// ---------------------------------------------------------------------------

export interface SettingsValues {
  readonly armTimeoutSec: number;
  readonly dayStartHour: number;
  readonly nightStartHour: number;
  readonly sealHourLocal: number;
  readonly syncEnabled: boolean;
}

export interface SettingsStore {
  get(): SettingsValues;
  update(patch: Partial<SettingsValues>): Promise<void>;
  subscribe(listener: () => void): () => void;
  /** IANA zone the app buckets in (derived from the device at bootstrap). */
  readonly timeZone: string;
  /** Current AppConfig assembled from the values above. */
  toAppConfig(): AppConfig;
}

// ---------------------------------------------------------------------------
// Groups gateway — STUB CONTRACT for J10. The V1-mock implementation lives in
// src/app/services.ts (in-memory members/stats, fake invite-link codec built
// against src/domain/crypto/CryptoPorts.ts). J10 replaces the implementation
// with real PocketBase sync + J6 crypto; this interface is the seam.
// ---------------------------------------------------------------------------

export interface GroupSummary {
  readonly groupId: GroupId;
  /** Decrypted group name. */
  readonly name: string;
  readonly role: MembershipRole;
  readonly memberCount: number;
  /** Whether THIS user consented to sharing daily sums with the group. */
  readonly consented: boolean;
  /** This user's nickname in the group. */
  readonly myNickname: string;
}

export interface GroupsGateway {
  list(): Promise<GroupSummary[]>;
  create(name: string, nickname: string): Promise<{ group: GroupSummary; inviteLink: string }>;
  /** Undefined for anything that is not a well-formed invite link. */
  parseInvite(url: string): { groupId: GroupId } | undefined;
  join(inviteUrl: string, nickname: string, consent: boolean): Promise<GroupSummary>;
  leave(groupId: GroupId): Promise<void>;
  /** Members with decrypted nicknames (before local overrides). */
  members(groupId: GroupId): Promise<LeaderboardMember[]>;
  /** Sealed daily stats of the group's consented members. */
  stats(groupId: GroupId): Promise<DailyStat[]>;
  setNickname(groupId: GroupId, nickname: string): Promise<void>;
  inviteLink(groupId: GroupId): Promise<string | undefined>;
  /** This device's user id (to mark "(du)" in the leaderboard). */
  myUserId(): Promise<string>;
}

// ---------------------------------------------------------------------------
// Onboarding flag
// ---------------------------------------------------------------------------

export interface OnboardingStore {
  isDone(): Promise<boolean>;
  markDone(): Promise<void>;
  reset(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Dev harness controls (DEBUG builds only; undefined in release)
// ---------------------------------------------------------------------------

export interface DebugSnapshot {
  readonly machineState: SessionState;
  readonly openSessions: readonly Session[];
  readonly dirtyBuckets: readonly DayBucket[];
  readonly clockNow: EpochMs;
  readonly clockOffsetMs: number;
}

export type DevTagKind = 'blank' | 'ours' | 'foreign' | 'locked-foreign';

export interface DevControls {
  /** Inject TAG_READ via the FakeTagReader (exercises the real wiring). */
  simulateTagRead(boxId: BoxId, label: string): void;
  simulateChargingStarted(): void;
  simulateChargingStopped(): void;
  simulateHeartbeat(): void;
  fireAppResumed(): void;
  fireArmTimeout(): void;
  /** Present a physical tag to a waiting wizard write step (FakeTagWriter). */
  presentTag(kind: DevTagKind, boxUuid?: string, label?: string): void;
  /** Time travel: shift the injected clock (dev builds run an offset clock). */
  advanceClock(ms: number): void;
  resetClock(): void;
  snapshot(): Promise<DebugSnapshot>;
}

// ---------------------------------------------------------------------------
// The aggregate + context
// ---------------------------------------------------------------------------

export interface AppServices {
  readonly engine: EngineHandle;
  readonly repositories: Repositories;
  readonly tagWriter: TagWriter;
  readonly settings: SettingsStore;
  readonly groups: GroupsGateway;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly events: ChangeNotifier;
  readonly onboarding: OnboardingStore;
  /** Present only in __DEV__ builds. */
  readonly dev?: DevControls;
}

export const AppServicesContext = createContext<AppServices | undefined>(undefined);

export function useAppServices(): AppServices {
  const services = useContext(AppServicesContext);
  if (services === undefined) {
    throw new Error('AppServicesContext missing — wrap the tree in the app provider.');
  }
  return services;
}
