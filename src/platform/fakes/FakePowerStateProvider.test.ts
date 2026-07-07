import { describe, expect, it } from 'vitest';

import type { PowerEvent } from '../PowerStateProvider';
import { FakePowerStateProvider } from './FakePowerStateProvider';

describe('FakePowerStateProvider', () => {
  it('delivers scripted events to subscribers in order, timestamps intact', () => {
    const provider = new FakePowerStateProvider();
    const seen: PowerEvent[] = [];
    provider.subscribe((event) => seen.push(event));

    provider.simulateChargingStarted(1000);
    provider.simulateHeartbeat(61000);
    provider.simulateChargingStopped(120000);

    expect(seen).toEqual([
      { type: 'CHARGING_STARTED', at: 1000 },
      { type: 'CHARGING_HEARTBEAT', at: 61000 },
      { type: 'CHARGING_STOPPED', at: 120000 },
    ]);
  });

  it('reflects the simulated state in isCharging(); heartbeats do not change it', async () => {
    const provider = new FakePowerStateProvider();
    await expect(provider.isCharging()).resolves.toBe(false);

    provider.simulateChargingStarted(1);
    await expect(provider.isCharging()).resolves.toBe(true);

    provider.simulateHeartbeat(2);
    await expect(provider.isCharging()).resolves.toBe(true);

    provider.simulateChargingStopped(3);
    await expect(provider.isCharging()).resolves.toBe(false);

    provider.simulateHeartbeat(4); // stray heartbeat after unplug stays a heartbeat
    await expect(provider.isCharging()).resolves.toBe(false);
  });

  it('stops delivering after unsubscribe and supports multiple subscribers', () => {
    const provider = new FakePowerStateProvider();
    const a: PowerEvent[] = [];
    const b: PowerEvent[] = [];
    const unsubscribeA = provider.subscribe((event) => a.push(event));
    provider.subscribe((event) => b.push(event));
    expect(provider.subscriberCount).toBe(2);

    provider.simulateChargingStarted(10);
    unsubscribeA();
    provider.simulateChargingStopped(20);

    expect(a).toEqual([{ type: 'CHARGING_STARTED', at: 10 }]);
    expect(b).toHaveLength(2);
    expect(provider.subscriberCount).toBe(1);
  });

  it('tolerates a listener that unsubscribes itself during delivery', () => {
    const provider = new FakePowerStateProvider();
    const seen: PowerEvent[] = [];
    const unsubscribe = provider.subscribe((event) => {
      seen.push(event);
      unsubscribe();
    });
    provider.simulateChargingStarted(1);
    provider.simulateChargingStopped(2);
    expect(seen).toEqual([{ type: 'CHARGING_STARTED', at: 1 }]);
  });
});
