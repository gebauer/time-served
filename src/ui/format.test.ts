import { describe, expect, it } from 'vitest';

import type { EpochMs, LocalDate } from '../domain/types';
import {
  formatClockTime,
  formatCountdown,
  formatDuration,
  formatElapsed,
  formatHour,
  formatLocalDate,
} from './format';

describe('formatDuration', () => {
  it('formats 0 as "0 Min."', () => {
    expect(formatDuration(0)).toBe('0 Min.');
  });

  it('formats sub-minute as "unter 1 Min."', () => {
    expect(formatDuration(59)).toBe('unter 1 Min.');
  });

  it('formats minutes only', () => {
    expect(formatDuration(12 * 60)).toBe('12 Min.');
  });

  it('formats hours only', () => {
    expect(formatDuration(2 * 3600)).toBe('2 Std.');
  });

  it('formats hours and minutes ("3 Std. 12 Min.")', () => {
    expect(formatDuration(3 * 3600 + 12 * 60)).toBe('3 Std. 12 Min.');
  });

  it('formats a full 24h day', () => {
    expect(formatDuration(24 * 3600)).toBe('24 Std.');
  });

  it('clamps negative input to 0', () => {
    expect(formatDuration(-5)).toBe('0 Min.');
  });
});

describe('formatElapsed', () => {
  it('formats minutes:seconds below one hour', () => {
    expect(formatElapsed(4 * 60 + 9)).toBe('4:09');
  });

  it('formats h:mm:ss at and above one hour', () => {
    expect(formatElapsed(3600 + 4 * 60 + 9)).toBe('1:04:09');
  });

  it('starts at 0:00', () => {
    expect(formatElapsed(0)).toBe('0:00');
  });
});

describe('formatCountdown', () => {
  it('formats and rounds up partial seconds', () => {
    expect(formatCountdown(91.2)).toBe('1:32');
  });

  it('clamps at 0:00', () => {
    expect(formatCountdown(-3)).toBe('0:00');
  });
});

describe('formatClockTime', () => {
  it('renders wall-clock time in the given zone', () => {
    // 2026-07-06T19:04:00Z = 21:04 in Europe/Berlin (CEST).
    const at = Date.UTC(2026, 6, 6, 19, 4, 0) as EpochMs;
    expect(formatClockTime(at, 'Europe/Berlin')).toBe('21:04');
    expect(formatClockTime(at, 'UTC')).toBe('19:04');
  });
});

describe('formatLocalDate', () => {
  it('renders German weekday + day + month', () => {
    expect(formatLocalDate('2026-07-06' as LocalDate)).toBe('Mo., 6. Juli');
    expect(formatLocalDate('2026-01-01' as LocalDate)).toBe('Do., 1. Januar');
  });
});

describe('formatHour', () => {
  it('pads to two digits', () => {
    expect(formatHour(8)).toBe('08:00');
    expect(formatHour(22)).toBe('22:00');
  });
});
