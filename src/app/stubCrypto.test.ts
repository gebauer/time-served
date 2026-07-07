import { describe, expect, it } from 'vitest';

import type { GroupId } from '../domain/types';
import {
  base64UrlDecode,
  base64UrlEncode,
  stubGenerateGroupKey,
  stubInviteLinkCodec,
} from './stubCrypto';

const GROUP = 'b3d21e56-4444-4c8f-9d3b-1a2b3c4d5e6f' as GroupId;

describe('base64url codec', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = Uint8Array.from({ length: 32 }, (_, i) => (i * 37) % 256);
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });

  it('round-trips lengths that need 1 and 2 padding bytes', () => {
    for (const length of [1, 2, 3, 4, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length }, (_, i) => i);
      expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
    }
  });

  it('rejects malformed input', () => {
    expect(base64UrlDecode('not valid!')).toBeUndefined();
    expect(base64UrlDecode('a')).toBeUndefined(); // impossible length
  });
});

describe('stubInviteLinkCodec', () => {
  it('builds the BUILD_V1 §10.4 format with the key in the fragment only', () => {
    const kg = stubGenerateGroupKey();
    const link = stubInviteLinkCodec.build('timeserved.app', { groupId: GROUP, kg });
    expect(link.startsWith(`https://timeserved.app/j#g=${GROUP}&k=`)).toBe(true);
    // Nothing key-like before the fragment.
    expect(link.split('#')[0]).toBe('https://timeserved.app/j');
  });

  it('round-trips build → parse', () => {
    const kg = stubGenerateGroupKey();
    const link = stubInviteLinkCodec.build('timeserved.app', { groupId: GROUP, kg });
    const parsed = stubInviteLinkCodec.parse(link);
    expect(parsed?.groupId).toBe(GROUP);
    expect(parsed?.kg).toEqual(kg);
  });

  it('returns undefined on hostile/malformed input without throwing', () => {
    const kg = base64UrlEncode(stubGenerateGroupKey());
    for (const bad of [
      '',
      'hallo',
      'https://timeserved.app/j', // no fragment
      `https://timeserved.app/wrong#g=${GROUP}&k=${kg}`, // wrong path
      `https://timeserved.app/j#g=${GROUP}`, // missing key
      `https://timeserved.app/j#k=${kg}`, // missing group
      `https://timeserved.app/j#g=nicht-uuid&k=${kg}`, // bad uuid
      `https://timeserved.app/j#g=${GROUP}&k=zukurz`, // bad key length
      `https://timeserved.app/j#g=${GROUP}&k=!!!`, // bad encoding
    ]) {
      expect(stubInviteLinkCodec.parse(bad), bad).toBeUndefined();
    }
  });
});

describe('stubGenerateGroupKey', () => {
  it('returns 32 bytes', () => {
    expect(stubGenerateGroupKey().length).toBe(32);
  });
});
