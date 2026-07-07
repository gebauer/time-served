import { describe, expect, it } from 'vitest';

import { DEFAULT_INVITE_HOST, loadSyncConfig } from './config';
import { nextSealInstant } from './sealTiming';
import { securePassword, secureUuidV4 } from './random';

describe('loadSyncConfig', () => {
  it('is local-only without a configured server', () => {
    expect(loadSyncConfig({})).toEqual({
      serverUrl: undefined,
      inviteHost: DEFAULT_INVITE_HOST,
    });
  });

  it('normalizes trailing slashes off the server URL', () => {
    expect(
      loadSyncConfig({ EXPO_PUBLIC_POCKETBASE_URL: 'https://ts.example.com//' })
        .serverUrl,
    ).toBe('https://ts.example.com');
  });

  it('accepts http for LAN dev instances', () => {
    expect(
      loadSyncConfig({ EXPO_PUBLIC_POCKETBASE_URL: 'http://192.168.1.10:8090' })
        .serverUrl,
    ).toBe('http://192.168.1.10:8090');
  });

  it('degrades malformed URLs to local-only', () => {
    expect(loadSyncConfig({ EXPO_PUBLIC_POCKETBASE_URL: 'ftp://x' }).serverUrl).toBe(
      undefined,
    );
    expect(loadSyncConfig({ EXPO_PUBLIC_POCKETBASE_URL: '   ' }).serverUrl).toBe(
      undefined,
    );
  });

  it('reads a custom invite host', () => {
    expect(loadSyncConfig({ EXPO_PUBLIC_INVITE_HOST: 'ts.gebauer.koeln' }).inviteHost).toBe(
      'ts.gebauer.koeln',
    );
  });
});

describe('secureUuidV4 / securePassword', () => {
  it('produces lowercase UUID v4 (matches the server pattern)', () => {
    const uuid = secureUuidV4();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(secureUuidV4()).not.toBe(uuid);
  });

  it('produces a 32-char base64url password (24 bytes)', () => {
    const password = securePassword();
    expect(password).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe('nextSealInstant', () => {
  const zone = 'Europe/Berlin';

  it('targets today when the seal hour is still ahead', () => {
    // 2026-07-07 09:00 Berlin (UTC+2) = 07:00Z
    const now = Date.parse('2026-07-07T07:00:00Z');
    expect(new Date(nextSealInstant(now, zone, 12)).toISOString()).toBe(
      '2026-07-07T10:00:00.000Z',
    );
  });

  it('rolls to tomorrow once the seal hour passed (or is exactly now)', () => {
    const at1200 = Date.parse('2026-07-07T10:00:00Z');
    expect(new Date(nextSealInstant(at1200, zone, 12)).toISOString()).toBe(
      '2026-07-08T10:00:00.000Z',
    );
  });

  it('respects the local calendar across the UTC date line', () => {
    // 2026-07-07 01:30 Berlin = 2026-07-06 23:30Z: "today" is already the 7th.
    const now = Date.parse('2026-07-06T23:30:00Z');
    expect(new Date(nextSealInstant(now, zone, 12)).toISOString()).toBe(
      '2026-07-07T10:00:00.000Z',
    );
  });
});
