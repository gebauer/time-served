/**
 * J1 harness smoke test — proves the Node test setup works and the contract types
 * compile. Real domain tests are J2's deliverable.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_APP_CONFIG, type DomainEvent, type SessionState } from './types';

describe('test harness', () => {
  it('runs on plain Node with the contract types', () => {
    const idle: SessionState = { kind: 'IDLE' };
    const event: DomainEvent = { type: 'APP_RESUMED', at: 0 };

    expect(idle.kind).toBe('IDLE');
    expect(event.type).toBe('APP_RESUMED');
    expect(DEFAULT_APP_CONFIG.armTimeoutSec).toBe(120);
    expect(DEFAULT_APP_CONFIG.bucket.dayStartHour).toBe(8);
    expect(DEFAULT_APP_CONFIG.bucket.nightStartHour).toBe(22);
    expect(DEFAULT_APP_CONFIG.sealHourLocal).toBe(12);
  });
});
