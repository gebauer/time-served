import { describe, expect, it } from 'vitest';

import { FIXTURE_IDS, seedDemoData } from './fixtures';
import { createRepositories } from './repositories';
import { InMemorySecureStore } from './secure';
import { createTestDatabase } from './testing';

describe('seedDemoData', () => {
  it('seeds a consistent demo dataset through the repository contract', async () => {
    const repos = createRepositories({
      database: createTestDatabase(),
      secureStore: new InMemorySecureStore(),
    });
    const dataset = await seedDemoData(repos, { now: Date.now() });

    const boxes = await repos.boxes.list();
    expect(boxes.map((b) => b.origin).sort()).toEqual(['foreign', 'own']);

    const open = await repos.sessions.findOpen();
    expect(open.map((s) => s.id)).toEqual([FIXTURE_IDS.sessionOpen]);
    expect(open[0]?.lastChargingAt).toBeDefined();

    const closedEvening = await repos.sessions.get(FIXTURE_IDS.sessionYesterdayEvening);
    expect(closedEvening?.status).toBe('closed');
    expect(closedEvening?.endReason).toBe('unplug');

    const sealed = await repos.dayBuckets.get(dataset.dayBefore);
    expect(sealed?.sealedAt).toBeDefined();
    const unsealed = await repos.dayBuckets.findUnsealedBefore(dataset.today);
    expect(unsealed.map((b) => b.date)).toEqual([dataset.yesterday]);

    expect(await repos.nickOverrides.listForGroup(FIXTURE_IDS.demoGroup)).toHaveLength(1);
    expect((await repos.deviceCredential.get())?.userId).toBe(FIXTURE_IDS.demoUser);
    expect(await repos.groupKeys.listGroupIds()).toEqual([FIXTURE_IDS.demoGroup]);
    expect((await repos.groupKeys.get(FIXTURE_IDS.demoGroup))?.length).toBe(32);
  });
});
