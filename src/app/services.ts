/**
 * COMPOSITION ROOT — THE SWAP SURFACE (JOBS.md J8 → J9/J10).
 *
 * This file is the ONE place that decides which concrete implementations sit
 * behind the AppServices seam (src/ui/services/AppServicesContext.ts). Today —
 * mocked wiring for the emulator:
 *
 *   - repositories : J3's WatermelonDB repositories on the in-memory LokiJS
 *                    adapter + InMemorySecureStore, seeded with demo fixtures.
 *   - tag/power/FGS: the J4/J5 fakes (emulators have no NFC / plug events).
 *   - groups       : in-memory stub gateway with stub crypto (stubGroups.ts).
 *   - clock        : OffsetClock (dev-harness time travel).
 *
 * J9 (live loop): swap createTestDatabase() → createDatabase(createSQLiteAdapter()),
 * InMemorySecureStore → ExpoSecureKeyValueStore, the fakes → AndroidTagReader/
 * AndroidTagWriter/AndroidPowerStateProvider/AndroidSessionRuntime, and revisit
 * the provisional tag/ARM_TIMEOUT wiring in wiring.ts.
 * J10 (sync, DONE): the groups/sync section below swaps in the PocketBase
 * gateway + device auth + seal scheduler when EXPO_PUBLIC_POCKETBASE_URL is
 * configured (src/app/sync/); otherwise the stub gateway keeps the offline
 * dev harness working. Everything else stays untouched.
 */
import { createRepositories, InMemorySecureStore, seedDemoData } from '../data';
import { createTestDatabase } from '../data/testing';
import { createSessionEngine } from '../domain/session';
import type { BoxId, BucketConfig, DomainEvent } from '../domain/types';
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
  GroupsGateway,
  OnboardingStore,
} from '../ui/services/AppServicesContext';
import { createGroupCrypto, inviteLinkCodec } from '../domain/crypto';
import { createSettingsStore, deviceTimeZone } from './settingsStore';
import { createStubGroupsGateway } from './stubGroups';
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
  createUuidSource,
  OffsetClock,
  wireAdapters,
} from './wiring';

const ONBOARDING_KEY = 'ts.ui.onboarded';

export async function createAppServices(): Promise<AppServices> {
  const clock = new OffsetClock();
  const ids = createUuidSource();
  const events = createChangeNotifier();
  const timeZone = deviceTimeZone();

  // --- Data layer (J3) on in-memory adapters — J9 swaps these two lines. ---
  const secureStore = new InMemorySecureStore();
  const repositories = createRepositories({
    database: createTestDatabase(),
    secureStore,
    clock,
  });

  const settings = await createSettingsStore(secureStore, timeZone);

  // --- Platform seams: FAKES for the emulator — J9 swaps these. ---
  const tagReader = new FakeTagReader();
  const tagWriter = new FakeTagWriter();
  const power = new FakePowerStateProvider();
  const runtime = new FakeSessionRuntime();

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
  });
  await tagReader.start();

  // ==========================================================================
  // >>> J10 — groups/sync wiring (src/app/sync/). With a configured server
  // (EXPO_PUBLIC_POCKETBASE_URL) this runs the REAL PocketBase gateway (J6
  // crypto + J7 routes) plus device auth and the daily seal pipeline; without
  // one, the stub gateway keeps the dev harness fully usable offline. <<<
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

  if (__DEV__) {
    // Fresh in-memory DB every launch → always reseed the demo dataset, then
    // reconcile: the fixture's open session is no longer charging, so it is
    // closed honestly as 'reconciled' and today's bucket gets recomputed.
    await seedDemoData(repositories, { now: clock.now() });
    await engineHandle.dispatch({ type: 'APP_RESUMED', at: clock.now() });
  }

  const dispatch = (event: DomainEvent) => void engineHandle.dispatch(event);
  const dev: DevControls | undefined = __DEV__
    ? {
        simulateTagRead(boxId: BoxId, label: string) {
          tagReader.simulateTag({ boxUuid: boxId, label, version: 1 });
        },
        simulateChargingStarted: () => power.simulateChargingStarted(clock.now()),
        simulateChargingStopped: () => power.simulateChargingStopped(clock.now()),
        simulateHeartbeat: () => power.simulateHeartbeat(clock.now()),
        fireAppResumed: () => dispatch({ type: 'APP_RESUMED', at: clock.now() }),
        fireArmTimeout: () => dispatch({ type: 'ARM_TIMEOUT', at: clock.now() }),
        presentTag(kind: DevTagKind, boxUuid?: string, label?: string) {
          tagWriter.presentTag(devTagState(kind, boxUuid, label));
        },
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
      }
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
    dev,
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
