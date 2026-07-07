import { describe, expect, it } from 'vitest';

import type { GroupId } from '../types';
import { bytesToBase64Url } from './encoding';
import { inviteLinkCodec } from './inviteLink';

const GROUP_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301' as GroupId;
const KG = Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + 3) & 0xff);
const KG_B64U = bytesToBase64Url(KG); // 43 chars, unpadded

describe('build', () => {
  it('produces the canonical form with the key ONLY in the fragment', () => {
    const url = inviteLinkCodec.build('ts.example.com', { groupId: GROUP_ID, kg: KG });
    expect(url).toBe(`https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}`);
    // THE privacy property: nothing key-shaped left of the '#'.
    const [head, fragment] = url.split('#');
    expect(head).not.toContain('k=');
    expect(head).not.toContain(KG_B64U);
    expect(head).not.toContain(GROUP_ID);
    expect(fragment).toContain(`k=${KG_B64U}`);
  });

  it('normalizes a scheme-prefixed or slash-suffixed host', () => {
    const expected = `https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}`;
    expect(inviteLinkCodec.build('https://ts.example.com', { groupId: GROUP_ID, kg: KG })).toBe(expected);
    expect(inviteLinkCodec.build('ts.example.com/', { groupId: GROUP_ID, kg: KG })).toBe(expected);
  });

  it('rejects a host smuggling a path/query and a wrong-length key', () => {
    expect(() => inviteLinkCodec.build('evil.com/path', { groupId: GROUP_ID, kg: KG })).toThrow();
    expect(() => inviteLinkCodec.build('', { groupId: GROUP_ID, kg: KG })).toThrow();
    expect(() =>
      inviteLinkCodec.build('ts.example.com', { groupId: GROUP_ID, kg: new Uint8Array(16) }),
    ).toThrow(/32 bytes/);
  });
});

describe('parse — happy paths', () => {
  const canonical = `https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}`;

  it('round-trips build → parse', () => {
    const parsed = inviteLinkCodec.parse(inviteLinkCodec.build('ts.example.com', { groupId: GROUP_ID, kg: KG }));
    expect(parsed).toBeDefined();
    expect(parsed?.groupId).toBe(GROUP_ID);
    expect(parsed?.kg).toEqual(KG);
  });

  it.each([
    ['canonical', canonical],
    ['host with port', `https://ts.example.com:8443/j#g=${GROUP_ID}&k=${KG_B64U}`],
    ['trailing slash on path', `https://ts.example.com/j/#g=${GROUP_ID}&k=${KG_B64U}`],
    ['uppercase scheme/host', `HTTPS://TS.EXAMPLE.COM/j#g=${GROUP_ID}&k=${KG_B64U}`],
    ['query string before fragment', `https://ts.example.com/j?utm_source=x#g=${GROUP_ID}&k=${KG_B64U}`],
    ['params in swapped order', `https://ts.example.com/j#k=${KG_B64U}&g=${GROUP_ID}`],
    ['extra unknown params tolerated', `https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}&v=1`],
    ['padded key', `https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}=`],
    ['percent-encoded padding', `https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}%3D`],
    ['deep-link rewrite (tolerated, not contractual)', `timeserved://j#g=${GROUP_ID}&k=${KG_B64U}`],
    ['deep-link with host segment', `timeserved://invite/j#g=${GROUP_ID}&k=${KG_B64U}`],
  ])('accepts %s', (_label, url) => {
    const parsed = inviteLinkCodec.parse(url);
    expect(parsed?.groupId).toBe(GROUP_ID);
    expect(parsed?.kg).toEqual(KG);
  });

  it('lowercases an uppercase UUID (canonical form)', () => {
    const parsed = inviteLinkCodec.parse(
      `https://ts.example.com/j#g=${GROUP_ID.toUpperCase()}&k=${KG_B64U}`,
    );
    expect(parsed?.groupId).toBe(GROUP_ID);
  });
});

describe('parse — hostile / malformed input never throws, returns undefined', () => {
  const cases: readonly [string, string][] = [
    ['empty string', ''],
    ['garbage', 'lol nope'],
    ['no fragment', `https://ts.example.com/j?g=${GROUP_ID}&k=${KG_B64U}`],
    ['key in the query, not the fragment', `https://ts.example.com/j?k=${KG_B64U}#g=${GROUP_ID}`],
    ['wrong scheme http', `http://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}`],
    ['wrong scheme javascript', `javascript:alert(1)#g=${GROUP_ID}&k=${KG_B64U}`],
    ['wrong deep-link path', `timeserved://box/abc#g=${GROUP_ID}&k=${KG_B64U}`],
    ['wrong path', `https://ts.example.com/join#g=${GROUP_ID}&k=${KG_B64U}`],
    ['path with extra segment', `https://ts.example.com/j/extra#g=${GROUP_ID}&k=${KG_B64U}`],
    ['missing host', `https:///j#g=${GROUP_ID}&k=${KG_B64U}`],
    ['missing g', `https://ts.example.com/j#k=${KG_B64U}`],
    ['missing k', `https://ts.example.com/j#g=${GROUP_ID}`],
    ['empty k', `https://ts.example.com/j#g=${GROUP_ID}&k=`],
    ['g not a UUID', `https://ts.example.com/j#g=not-a-uuid&k=${KG_B64U}`],
    ['g with injection', `https://ts.example.com/j#g=${GROUP_ID}%0a&k=${KG_B64U}`],
    ['duplicate k', `https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}&k=${KG_B64U}`],
    ['duplicate g', `https://ts.example.com/j#g=${GROUP_ID}&g=${GROUP_ID}&k=${KG_B64U}`],
    ['key too short (16 bytes)', `https://ts.example.com/j#g=${GROUP_ID}&k=${bytesToBase64Url(KG.subarray(0, 16))}`],
    ['key too long (33 bytes)', `https://ts.example.com/j#g=${GROUP_ID}&k=${bytesToBase64Url(Uint8Array.from({ length: 33 }, (_, i) => i))}`],
    ['key truncated to impossible length', `https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U.slice(0, 42)}`],
    ['key with std-base64 chars', `https://ts.example.com/j#g=${GROUP_ID}&k=${'+'.repeat(43)}`],
    ['key with invalid chars', `https://ts.example.com/j#g=${GROUP_ID}&k=${'!'.repeat(43)}`],
    ['key with bad percent-encoding', `https://ts.example.com/j#g=${GROUP_ID}&k=%zz${KG_B64U}`],
    ['fragment param without =', `https://ts.example.com/j#g=${GROUP_ID}&k=${KG_B64U}&bare`],
    ['fragment param with empty name', `https://ts.example.com/j#=x&g=${GROUP_ID}&k=${KG_B64U}`],
    ['absurdly long input', `https://ts.example.com/j#g=${GROUP_ID}&k=${'A'.repeat(10000)}`],
  ];

  it.each(cases)('%s → undefined', (_label, url) => {
    expect(inviteLinkCodec.parse(url)).toBeUndefined();
  });

  it('non-string input → undefined (hostile deep-link payloads)', () => {
    // reason: deliberately violating the type to simulate untyped deep-link data
    expect(inviteLinkCodec.parse(undefined as unknown as string)).toBeUndefined();
    expect(inviteLinkCodec.parse(42 as unknown as string)).toBeUndefined();
  });
});
