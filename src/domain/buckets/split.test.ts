/**
 * Day/night splitter tests (BUILD_V1 §5, JOBS.md J2). Plain Node — the epoch
 * instants are hand-computed from known Berlin offsets (CET=+1, CEST=+2) so
 * the tests do not depend on the code under test for their fixtures.
 *
 * Berlin DST in 2026: spring-forward Sun 2026-03-29 02:00→03:00 (23h day),
 * fall-back Sun 2026-10-25 03:00→02:00 (25h day).
 */
import { describe, expect, it } from 'vitest';

import type { BucketConfig, LocalDate } from '../types';
import { localDatesInRange, splitInterval, type SessionSlice } from './split';

const BERLIN: BucketConfig = {
  dayStartHour: 8,
  nightStartHour: 22,
  timeZone: 'Europe/Berlin',
};

const ld = (s: string): LocalDate => s as LocalDate;
const T = (iso: string): number => Date.parse(iso);
const HOUR = 3_600_000;

function shape(slices: SessionSlice[]): [string, string, number][] {
  return slices.map((s) => [s.date, s.category, s.ms]);
}

function assertPartition(slices: SessionSlice[], fromMs: number, toMs: number): void {
  // Slices must tile [fromMs, toMs) exactly — additivity is by construction.
  expect(slices.reduce((sum, s) => sum + s.ms, 0)).toBe(toMs - fromMs);
  let cursor = fromMs;
  for (const s of slices) {
    expect(s.fromMs).toBe(cursor);
    expect(s.toMs - s.fromMs).toBe(s.ms);
    cursor = s.toMs;
  }
  expect(cursor).toBe(toMs);
}

describe('splitInterval', () => {
  it('splits the §5 example 21:00 D → 09:00 D+1 into exactly four slices', () => {
    // 2026-07-01 21:00 CEST = 19:00Z; 2026-07-02 09:00 CEST = 07:00Z
    const from = T('2026-07-01T19:00:00Z');
    const to = T('2026-07-02T07:00:00Z');
    const slices = splitInterval(from, to, BERLIN);
    expect(shape(slices)).toEqual([
      ['2026-07-01', 'day', 1 * HOUR], // 21:00–22:00
      ['2026-07-01', 'night', 2 * HOUR], // 22:00–24:00
      ['2026-07-02', 'night', 8 * HOUR], // 00:00–08:00
      ['2026-07-02', 'day', 1 * HOUR], // 08:00–09:00
    ]);
    assertPartition(slices, from, to);
  });

  it('attributes a slice starting exactly on the 22:00 boundary to night', () => {
    // 2026-07-01 22:00:00 CEST = 20:00Z
    const from = T('2026-07-01T20:00:00Z');
    const to = T('2026-07-01T20:30:00Z');
    expect(shape(splitInterval(from, to, BERLIN))).toEqual([
      ['2026-07-01', 'night', 30 * 60_000],
    ]);
  });

  it('ends a slice exactly on a boundary without spilling over', () => {
    // 21:00–22:00 local exactly
    const from = T('2026-07-01T19:00:00Z');
    const to = T('2026-07-01T20:00:00Z');
    expect(shape(splitInterval(from, to, BERLIN))).toEqual([
      ['2026-07-01', 'day', 1 * HOUR],
    ]);
  });

  it('returns no slices for a zero-length session', () => {
    const at = T('2026-07-01T19:00:00Z');
    expect(splitInterval(at, at, BERLIN)).toEqual([]);
  });

  it('handles the Berlin spring-forward night (23h day) with exact additivity', () => {
    // Sat 2026-03-28 21:00 CET = 20:00Z → Sun 2026-03-29 09:00 CEST = 07:00Z.
    // Wall clock says 12h in the box; real duration is 11h.
    const from = T('2026-03-28T20:00:00Z');
    const to = T('2026-03-29T07:00:00Z');
    const slices = splitInterval(from, to, BERLIN);
    expect(shape(slices)).toEqual([
      ['2026-03-28', 'day', 1 * HOUR],
      ['2026-03-28', 'night', 2 * HOUR],
      ['2026-03-29', 'night', 7 * HOUR], // 00:00–08:00 local is only 7 real hours
      ['2026-03-29', 'day', 1 * HOUR],
    ]);
    assertPartition(slices, from, to);
    expect(to - from).toBe(11 * HOUR);
  });

  it('handles the Berlin fall-back night (25h day) with exact additivity', () => {
    // Sat 2026-10-24 21:00 CEST = 19:00Z → Sun 2026-10-25 09:00 CET = 08:00Z.
    // Wall clock says 12h; real duration is 13h.
    const from = T('2026-10-24T19:00:00Z');
    const to = T('2026-10-25T08:00:00Z');
    const slices = splitInterval(from, to, BERLIN);
    expect(shape(slices)).toEqual([
      ['2026-10-24', 'day', 1 * HOUR],
      ['2026-10-24', 'night', 2 * HOUR],
      ['2026-10-25', 'night', 9 * HOUR], // 00:00–08:00 local lasts 9 real hours
      ['2026-10-25', 'day', 1 * HOUR],
    ]);
    assertPartition(slices, from, to);
    expect(to - from).toBe(13 * HOUR);
  });

  it('property: slices always tile the interval exactly, across both DST transitions', () => {
    const bases = [
      T('2026-03-27T12:00:00Z'), // spans spring-forward
      T('2026-10-23T12:00:00Z'), // spans fall-back
    ];
    for (const base of bases) {
      for (let startStep = 0; startStep < 16; startStep += 1) {
        const from = base + startStep * (5 * HOUR + 17 * 60_000); // deliberately ragged
        for (const duration of [0, 90 * 60_000, 7 * HOUR, 26 * HOUR, 49 * HOUR]) {
          assertPartition(splitInterval(from, from + duration, BERLIN), from, from + duration);
        }
      }
    }
  });

  it('rejects an inverted config', () => {
    expect(() =>
      splitInterval(0, 1, { dayStartHour: 22, nightStartHour: 8, timeZone: 'Europe/Berlin' }),
    ).toThrow(/Invalid BucketConfig/);
  });
});

describe('localDatesInRange', () => {
  it('lists every local date a multi-day interval touches', () => {
    const from = T('2026-07-01T19:00:00Z'); // 2026-07-01 21:00 local
    const to = T('2026-07-03T10:00:00Z'); // 2026-07-03 12:00 local
    expect(localDatesInRange(from, to, 'Europe/Berlin')).toEqual([
      ld('2026-07-01'),
      ld('2026-07-02'),
      ld('2026-07-03'),
    ]);
  });

  it('excludes the next date when the interval ends exactly at local midnight', () => {
    const from = T('2026-07-01T19:00:00Z');
    const to = T('2026-07-01T22:00:00Z'); // 2026-07-02 00:00 local
    expect(localDatesInRange(from, to, 'Europe/Berlin')).toEqual([ld('2026-07-01')]);
  });

  it('yields the single date for a zero-length interval', () => {
    const at = T('2026-07-01T19:00:00Z');
    expect(localDatesInRange(at, at, 'Europe/Berlin')).toEqual([ld('2026-07-01')]);
  });
});
