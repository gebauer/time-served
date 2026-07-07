/**
 * COMPOSITION ROOT — THE SWAP SURFACE (JOBS.md J8 → J9/J10).
 *
 * This file is the ONE place that decides which concrete implementations sit
 * behind the AppServices seam (src/ui/services/AppServicesContext.ts). J9 wired
 * the live loop; two adapter modes exist:
 *
 * REAL (device builds — the live session loop):
 *   - repositories : WatermelonDB on SQLite (JSI) + expo-secure-store.
 *   - tag/power/FGS: AndroidTagReader/AndroidTagWriter (nfc-manager),
 *                    AndroidPowerStateProvider (expo-battery + FGS receiver),
 *                    AndroidSessionRuntime (modules/fgs). The TagWriter is
 *                    wrapped so wizard write steps pause the passive reader.
 *   - launch-by-tag: the manifest NDEF intent filter (plugins/nfc) foregrounds
 *                    the app; the launch intent is drained once at bootstrap
 *                    (AndroidTagReader.emitLaunchTag) so a cold start by tag
 *                    also produces a TAG_READ.
 *   - APP_RESUMED  : dispatched once at bootstrap and on every AppState
 *                    'active' — reconciliation runs in-engine (CLAUDE.md §3).
 *
 * FAKES (emulator/dev harness):
 *   - repositories : in-memory LokiJS + InMemorySecureStore, demo fixtures.
 *   - tag/power/FGS: the J4/J5 fakes (emulators have no NFC / plug events).
 *
 * ADAPTER-MODE SWITCH (J9, documented per JOBS.md):
 *   - Release builds (!__DEV__) ALWAYS use the real adapters.
 *   - Dev builds default to FAKES (in-memory data + demo seed) so the
 *     DevHarness screen keeps driving the full wiring on an emulator.
 *   - To run a DEV build against the real adapters (device smoke tests before
 *     a release build), set the bundle-time env flag:
 *         EXPO_PUBLIC_TS_REAL_ADAPTERS=1 pnpm expo run:android
 *     In that mode the DevHarness stays usable in degraded form: the simulate
 *     buttons dispatch the equivalent domain events directly (tag reads go
 *     through the real §9.2 resolution), and presentTag is a no-op because the
 *     wizard talks to real NFC hardware.
 *
 * GROUPS/SYNC (J10, DONE): the marked section below swaps in the PocketBase
 * gateway + device auth + daily seal pipeline when EXPO_PUBLIC_POCKETBASE_URL
 * is configured (src/app/sync/); otherwise the stub gateway keeps the offline
 * dev harness working. It runs AFTER the launch reconciliation so the first
 * seal never uploads a bucket that reconciliation is about to recompute.
 */
import { AppState, Platform } from 'react-native';

import {
  createDatabase,
  createRepositories,
  InMemorySecureStore,
  seedDemoData,
} from '../data';
import { createSQLiteAdapter } from '../data/adapters/sqlite';
import { ExpoSecureKeyValueStore } from '../data/secure/ExpoSecureKeyValueStore';
import type { SecureKeyValueStore } from '../data/secure/SecureKeyValueStore';
import { createTestDatabase } from '../data/testing';
import { createSessionEngine } from '../domain/session';
import type { BoxId, BucketConfig, DomainEvent } from '../domain/types';
import { AndroidPowerStateProvider } from '../platform/android/AndroidPowerStateProvider';
import { AndroidSessionRuntime } from '../platform/android/AndroidSessionRuntime';
import { AndroidTagReader, AndroidTagWriter } from '../platform/android/nfc';
import {
  FakePowerStateProvider,
  FakeSessionRuntime,
  FakeTagReader,
  FakeTagWriter,
} from '../platform/fakes';
import type { TagState } from '../platform/TagReader';
import type {
  AppServices,
  DevControls,
  DevTagKind,
  EngineHandle,
  GroupsGateway,
  OnboardingStore,
} from '../ui/services/AppServicesContext';
import { createGroupCrypto, inviteLinkCodec } from '../domain/crypto';
import { initInfoNotifications, notifyForeignBoxCreated } from './notifications';
import { createSettingsStore, deviceTimeZone } from './settingsStore';
import { createStubGroupsGateway } from './stubGroups';
import { createSystemStatusService } from './system';
// --- J10 sync imports (groups/sync wiring section below) ---
import {
  createDailyStatUploader,
  createDeviceAuth,
  createPocketBaseClient,
  createPocketBaseGroupsGateway,
  createSealScheduler,
  loadSyncConfig,
} from './sync';
import { attachSealTriggers } from './sync/sealTriggers';
import {
  createChangeNotifier,
  createEngineHandle,
  createExclusiveTagWriter,
  createTagPayloadHandler,
  createUuidSource,
  OffsetClock,
  wireAdapters,
} from './wiring';

const ONBOARDING_KEY = 'ts.ui.onboarded';

type AdapterMode = 'real' | 'fakes';

/** See the header — release always real; dev defaults to fakes unless flagged. */
function resolveAdapterMode(): AdapterMode {
  if (!__DEV__) return 'real';
  return process.env.EXPO_PUBLIC_TS_REAL_ADAPTERS === '1' ? 'real' : 'fakes';
}

export async function createAppServices(): Promise<AppServices> {
  const mode = resolveAdapterMode();
  if (mode === 'real' && Platform.OS !== 'android') {
    // V1 ships Android only; the iOS adapters are stubs (CLAUDE.md §2).
    throw new Error(
      `Time Served V1 has real adapters for Android only (got Platform.OS=${Platform.OS}).`,
    );
  }

  const clock = new OffsetClock();
  const ids = createUuidSource();
  const events = createChangeNotifier();
  const timeZone = deviceTimeZone();

  // --- Data layer (J3): SQLite + Keystore on device, in-memory for the harness.
  const secureStore: SecureKeyValueStore =
    mode === 'real' ? new ExpoSecureKeyValueStore() : new InMemorySecureStore();
  const repositories = createRepositories({
    database:
      mode === 'real' ? createDatabase(createSQLiteAdapter()) : createTestDatabase(),
    secureStore,
    clock,
  });

  const settings = await createSettingsStore(secureStore, timeZone);

  // --- Platform seams (J4/J5 adapters, or their fakes for the emulator).
  const tagReader = mode === 'real' ? new AndroidTagReader() : new FakeTagReader();
  const power =
    mode === 'real' ? new AndroidPowerStateProvider() : new FakePowerStateProvider();
  const runtime = mode === 'real' ? new AndroidSessionRuntime() : new FakeSessionRuntime();
  // Real mode: wizard write steps must run with the passive reader stopped
  // (AndroidTagWriter header); the wrapper stops/restarts it around each step.
  const fakeTagWriter = mode === 'fakes' ? new FakeTagWriter() : undefined;
  const tagWriter =
    fakeTagWriter ?? createExclusiveTagWriter(new AndroidTagWriter(), tagReader);

  // Live view over the settings so tunable changes reach the engine.
  const bucketConfig: BucketConfig = {
    get dayStartHour() {
      return settings.get().dayStartHour;
    },
    get nightStartHour() {
      return settings.get().nightStartHour;
    },
    timeZone,
  };

  const engine = createSessionEngine({
    sessions: repositories.sessions,
    boxes: repositories.boxes,
    dayBuckets: repositories.dayBuckets,
    runtime,
    isCharging: () => power.isCharging(),
    clock,
    ids,
    bucketConfig,
  });
  const engineHandle = createEngineHandle(engine, events);

  wireAdapters({
    engine: engineHandle,
    tagReader,
    power,
    repositories,
    clock,
    armTimeoutSec: () => settings.get().armTimeoutSec,
    // §9.2 one-shot "Neue Box ‚<label>' erkannt" — fire-and-forget local
    // notification (LOW importance, only with granted permission; J11).
    onForeignBoxCreated: (label) => void notifyForeignBoxCreated(label),
  });

  // J11: permissions + NFC availability behind the SystemStatusService seam
  // (Onboarding page 3, Settings system section, Home NFC banner).
  const system = createSystemStatusService({ mode, tagReader });
  // Foreground-presentation handler + LOW info channel; never throws.
  void initInfoNotifications();

  // NFC unavailable/disabled must not block bootstrap: history/leaderboard
  // still work; the Home banner (useNfcBanner → system.nfcStatus) owns the
  // "enable NFC" UX and retries via system.restartTagReader on refocus.
  try {
    await tagReader.start();
  } catch (error) {
    console.warn('[services] TagReader failed to start (NFC unavailable?)', error);
  }

  const onboarding: OnboardingStore = {
    async isDone() {
      return (await secureStore.get(ONBOARDING_KEY)) === 'true';
    },
    async markDone() {
      await secureStore.set(ONBOARDING_KEY, 'true');
    },
    async reset() {
      await secureStore.delete(ONBOARDING_KEY);
    },
  };

  if (mode === 'fakes') {
    // Fresh in-memory DB every launch → always reseed the demo dataset before
    // the initial reconciliation below closes the fixture's stale open session.
    await seedDemoData(repositories, { now: clock.now() });
  }

  // Launch reconciliation (BUILD_V1 §7 — mandatory on EVERY launch): any open
  // session whose phone is no longer charging is closed from persisted state.
  await engineHandle.dispatch({ type: 'APP_RESUMED', at: clock.now() });

  // Foreground reconciliation: every return to 'active' re-runs it in-engine.
  AppState.addEventListener('change', (appState) => {
    if (appState === 'active') {
      void engineHandle.dispatch({ type: 'APP_RESUMED', at: clock.now() });
    }
  });

  // Launch-by-tag (§8.1): a home-screen scan cold-started us via the NDEF
  // intent filter — drain the launch intent so it produces a TAG_READ too.
  // Runs AFTER reconciliation so a stale open session is closed first, and
  // while the activity is foreground, so the engine's FGS start is legal.
  if (tagReader instanceof AndroidTagReader) {
    await tagReader.emitLaunchTag();
  }

  // ==========================================================================
  // >>> J10 — groups/sync wiring (src/app/sync/). With a configured server
  // (EXPO_PUBLIC_POCKETBASE_URL) this runs the REAL PocketBase gateway (J6
  // crypto + J7 routes) plus device auth and the daily seal pipeline; without
  // one, the stub gateway keeps the dev harness fully usable offline.
  //
  // BOOTSTRAP ORDER: deliberately AFTER the awaited APP_RESUMED dispatch and
  // the launch-tag drain above — attachSealTriggers fires an immediate seal
  // run, and reconciliation must first close orphaned sessions and recompute
  // their buckets so yesterday is sealed with the reconciled totals, not the
  // stale ones. (Invite deep links are independent: App.tsx attaches them
  // once services resolve, i.e. also after this whole bootstrap.) <<<
  // ==========================================================================
  const syncConfig = loadSyncConfig();
  let groups: GroupsGateway;
  if (syncConfig.serverUrl !== undefined) {
    const pbClient = createPocketBaseClient(syncConfig.serverUrl);
    const deviceAuth = createDeviceAuth({
      client: pbClient,
      kv: secureStore,
      credentials: repositories.deviceCredential,
    });
    groups = createPocketBaseGroupsGateway({
      client: pbClient,
      auth: deviceAuth,
      crypto: createGroupCrypto(),
      codec: inviteLinkCodec,
      groupKeys: repositories.groupKeys,
      kv: secureStore,
      clock,
      timeZone: () => timeZone,
      inviteHost: syncConfig.inviteHost,
    });
    const sealScheduler = createSealScheduler({
      dayBuckets: repositories.dayBuckets,
      kv: secureStore,
      clock,
      timeZone: () => timeZone,
      syncEnabled: () => settings.get().syncEnabled,
      getUserId: async () => (await deviceAuth.ensureAuthed()).userId,
      upload: createDailyStatUploader(pbClient, deviceAuth),
    });
    // Foreground-only triggers (launch / AppState active / midday timer) —
    // V1 decision documented in sealTriggers.ts. Lives for the app lifetime.
    attachSealTriggers({
      runOnce: () => sealScheduler.runOnce(),
      clock,
      timeZone: () => timeZone,
      sealHourLocal: () => settings.get().sealHourLocal,
    });
  } else {
    groups = createStubGroupsGateway({ repositories, clock, ids, timeZone });
  }
  // ======================= <<< end J10 groups/sync >>> ======================

  const dispatch = (event: DomainEvent) => void engineHandle.dispatch(event);
  const dev: DevControls | undefined = __DEV__
    ? mode === 'fakes'
      ? createFakeDevControls({
          tagReader: tagReader as FakeTagReader,
          tagWriter: fakeTagWriter as FakeTagWriter,
          power: power as FakePowerStateProvider,
          clock,
          events,
          engineHandle,
          repositories,
          dispatch,
        })
      : createRealDevControls({ clock, events, engineHandle, repositories })
    : undefined;

  return {
    engine: engineHandle,
    repositories,
    tagWriter,
    settings,
    groups,
    clock,
    ids,
    events,
    onboarding,
    system,
    dev,
  };
}

// ---------------------------------------------------------------------------
// Dev controls (DEBUG builds only)
// ---------------------------------------------------------------------------

interface DevControlsCommon {
  readonly clock: OffsetClock;
  readonly events: ReturnType<typeof createChangeNotifier>;
  readonly engineHandle: EngineHandle;
  readonly repositories: ReturnType<typeof createRepositories>;
}

function createDevControlsBase(options: DevControlsCommon) {
  const { clock, events, engineHandle, repositories } = options;
  return {
    fireAppResumed: () =>
      void engineHandle.dispatch({ type: 'APP_RESUMED', at: clock.now() }),
    fireArmTimeout: () =>
      void engineHandle.dispatch({ type: 'ARM_TIMEOUT', at: clock.now() }),
    advanceClock(ms: number) {
      clock.advance(ms);
      events.notify();
    },
    resetClock() {
      clock.reset();
      events.notify();
    },
    async snapshot() {
      return {
        machineState: engineHandle.getState(),
        openSessions: await repositories.sessions.findOpen(),
        dirtyBuckets: await repositories.dayBuckets.findDirty(),
        clockNow: clock.now(),
        clockOffsetMs: clock.offset,
      };
    },
  };
}

/** Harness drives the FAKES — exercises the exact adapter→engine wiring. */
function createFakeDevControls(
  options: DevControlsCommon & {
    readonly tagReader: FakeTagReader;
    readonly tagWriter: FakeTagWriter;
    readonly power: FakePowerStateProvider;
    readonly dispatch: (event: DomainEvent) => void;
  },
): DevControls {
  const { tagReader, tagWriter, power, clock } = options;
  return {
    ...createDevControlsBase(options),
    simulateTagRead(boxId: BoxId, label: string) {
      tagReader.simulateTag({ boxUuid: boxId, label, version: 1 });
    },
    simulateChargingStarted: () => power.simulateChargingStarted(clock.now()),
    simulateChargingStopped: () => power.simulateChargingStopped(clock.now()),
    simulateHeartbeat: () => power.simulateHeartbeat(clock.now()),
    presentTag(kind: DevTagKind, boxUuid?: string, label?: string) {
      tagWriter.presentTag(devTagState(kind, boxUuid, label));
    },
  };
}

/**
 * Degraded harness for a DEV build on REAL adapters: real NFC/power events flow
 * anyway, so the simulate buttons inject the equivalent domain events directly
 * (tag reads through the real §9.2 resolution). presentTag cannot conjure
 * physical hardware — no-op with a warning.
 */
function createRealDevControls(options: DevControlsCommon): DevControls {
  const { clock, engineHandle, repositories } = options;
  const handleTagPayload = createTagPayloadHandler({
    engine: engineHandle,
    boxes: repositories.boxes,
    clock,
  });
  return {
    ...createDevControlsBase(options),
    simulateTagRead(boxId: BoxId, label: string) {
      void handleTagPayload({ boxUuid: boxId, label, version: 1 });
    },
    simulateChargingStarted: () =>
      void engineHandle.dispatch({ type: 'CHARGING_STARTED', at: clock.now() }),
    simulateChargingStopped: () =>
      void engineHandle.dispatch({ type: 'CHARGING_STOPPED', at: clock.now() }),
    simulateHeartbeat: () =>
      void engineHandle.dispatch({ type: 'CHARGING_HEARTBEAT', at: clock.now() }),
    presentTag() {
      console.warn('[dev] presentTag is fakes-only; real mode uses physical tags.');
    },
  };
}

function devTagState(kind: DevTagKind, boxUuid?: string, label?: string): TagState {
  switch (kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'ours':
      return {
        kind: 'ours',
        payload: { boxUuid: boxUuid ?? 'dev-box', label: label ?? 'Dev-Box', version: 1 },
      };
    case 'foreign':
      return { kind: 'foreign', summary: 'https://example.com/etwas' };
    case 'locked-foreign':
      return { kind: 'locked-foreign' };
  }
}
