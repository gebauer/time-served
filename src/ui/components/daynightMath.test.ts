import { describe, expect, it } from 'vitest';

import { computeBarSegments, SECONDS_PER_DAY } from './daynightMath';

describe('computeBarSegments', () => {
  it('is empty at 0/0 with a full remainder track', () => {
    const s = computeBarSegments(0, 0);
    expect(s.empty).toBe(true);
    expect(s.dayFraction).toBe(0);
    expect(s.nightFraction).toBe(0);
    expect(s.restFraction).toBe(1);
  });

  it('fills the whole bar at a full 24h (no remainder)', () => {
    const s = computeBarSegments(14 * 3600, 10 * 3600);
    expect(s.empty).toBe(false);
    expect(s.dayFraction + s.nightFraction).toBeCloseTo(1, 10);
    expect(s.restFraction).toBe(0);
  });

  it('computes proportional fractions against the 24h default scale', () => {
    const s = computeBarSegments(6 * 3600, 3 * 3600);
    expect(s.dayFraction).toBeCloseTo(0.25, 10);
    expect(s.nightFraction).toBeCloseTo(0.125, 10);
    expect(s.restFraction).toBeCloseTo(0.625, 10);
  });

  it('scales down proportionally when totals exceed maxSec', () => {
    const s = computeBarSegments(20 * 3600, 10 * 3600, SECONDS_PER_DAY);
    expect(s.dayFraction + s.nightFraction).toBeCloseTo(1, 10);
    // 2:1 ratio preserved.
    expect(s.dayFraction / s.nightFraction).toBeCloseTo(2, 10);
    expect(s.restFraction).toBeCloseTo(0, 10);
  });

  it('clamps negative inputs to 0', () => {
    const s = computeBarSegments(-100, 3600);
    expect(s.dayFraction).toBe(0);
    expect(s.nightFraction).toBeGreaterThan(0);
  });

  it('supports a custom maxSec scale', () => {
    const s = computeBarSegments(1800, 1800, 7200);
    expect(s.dayFraction).toBeCloseTo(0.25, 10);
    expect(s.nightFraction).toBeCloseTo(0.25, 10);
    expect(s.restFraction).toBeCloseTo(0.5, 10);
  });

  it('sums day+night+rest to 1', () => {
    const s = computeBarSegments(5 * 3600, 2 * 3600);
    expect(s.dayFraction + s.nightFraction + s.restFraction).toBeCloseTo(1, 10);
  });
});
