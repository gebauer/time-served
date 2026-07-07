/**
 * Pure normalization tests (plain Node) — the testable core of
 * AndroidPowerStateProvider (JOBS.md J5).
 */
import { describe, expect, it } from 'vitest';

import type { PowerEvent } from '../PowerStateProvider';
import {
  createPowerEventNormalizer,
  normalizePowerEvent,
  type ChargeState,
} from './normalizePowerEvents';

const started = (at: number): PowerEvent => ({ type: 'CHARGING_STARTED', at });
const stopped = (at: number): PowerEvent => ({ type: 'CHARGING_STOPPED', at });
const heartbeat = (at: number): PowerEvent => ({ type: 'CHARGING_HEARTBEAT', at });

describe('normalizePowerEvent (single step)', () => {
  it('emits STARTED from unknown and from not-charging', () => {
    for (const state of ['unknown', 'not-charging'] as ChargeState[]) {
      const result = normalizePowerEvent(state, started(100));
      expect(result.emit).toEqual(started(100));
      expect(result.state).toBe('charging');
    }
  });

  it('drops a duplicate STARTED while already charging', () => {
    const result = normalizePowerEvent('charging', started(200));
    expect(result.emit).toBeNull();
    expect(result.state).toBe('charging');
  });

  it('emits STOPPED while charging', () => {
    const result = normalizePowerEvent('charging', stopped(300));
    expect(result.emit).toEqual(stopped(300));
    expect(result.state).toBe('not-charging');
  });

  it('emits STOPPED from unknown state (late subscriber must still hear the unplug)', () => {
    const result = normalizePowerEvent('unknown', stopped(300));
    expect(result.emit).toEqual(stopped(300));
    expect(result.state).toBe('not-charging');
  });

  it('drops a duplicate STOPPED while already not-charging', () => {
    const result = normalizePowerEvent('not-charging', stopped(400));
    expect(result.emit).toBeNull();
    expect(result.state).toBe('not-charging');
  });

  it('passes heartbeats through unchanged without touching the dedupe state', () => {
    for (const state of ['unknown', 'charging', 'not-charging'] as ChargeState[]) {
      const result = normalizePowerEvent(state, heartbeat(500));
      expect(result.emit).toEqual(heartbeat(500));
      expect(result.state).toBe(state);
    }
  });

  it('passes timestamps through unchanged', () => {
    const at = 1751850000123;
    expect(normalizePowerEvent('unknown', started(at)).emit).toEqual({
      type: 'CHARGING_STARTED',
      at,
    });
    expect(normalizePowerEvent('charging', stopped(at)).emit).toEqual({
      type: 'CHARGING_STOPPED',
      at,
    });
  });
});

describe('createPowerEventNormalizer (stateful stream)', () => {
  it('collapses the double unplug (FGS receiver + expo-battery) to one STOPPED', () => {
    const normalizer = createPowerEventNormalizer();
    const out: (PowerEvent | null)[] = [
      normalizer.push(started(1000)),
      normalizer.push(heartbeat(2000)),
      normalizer.push(stopped(3000)), // FGS powerDisconnected
      normalizer.push(stopped(3005)), // expo-battery UNPLUGGED, a moment later
    ];
    expect(out).toEqual([started(1000), heartbeat(2000), stopped(3000), null]);
  });

  it('never yields STARTED twice in a row without a STOPPED between', () => {
    const normalizer = createPowerEventNormalizer();
    const forwarded = [
      started(1),
      started(2), // duplicate (e.g. CHARGING → FULL transition)
      heartbeat(3),
      stopped(4),
      started(5), // re-plug: legitimate
    ]
      .map((candidate) => normalizer.push(candidate))
      .filter((event): event is PowerEvent => event !== null);

    expect(forwarded).toEqual([started(1), heartbeat(3), stopped(4), started(5)]);
  });

  it('a heartbeat before the first STARTED does not swallow the STARTED', () => {
    // FGS may still be running from a previous session when a new subscription
    // attaches: heartbeats must not mark the state as charging.
    const normalizer = createPowerEventNormalizer();
    expect(normalizer.push(heartbeat(10))).toEqual(heartbeat(10));
    expect(normalizer.push(started(20))).toEqual(started(20));
  });
});
