import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  utf8ToBytes,
} from './encoding';

const ascii = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

describe('base64 (RFC 4648 §10 vectors)', () => {
  const vectors: readonly [string, string][] = [
    ['', ''],
    ['f', 'Zg=='],
    ['fo', 'Zm8='],
    ['foo', 'Zm9v'],
    ['foob', 'Zm9vYg=='],
    ['fooba', 'Zm9vYmE='],
    ['foobar', 'Zm9vYmFy'],
  ];

  it.each(vectors)('encodes %j → %j', (plain, b64) => {
    expect(bytesToBase64(ascii(plain))).toBe(b64);
  });

  it.each(vectors)('decodes %j ← %j', (plain, b64) => {
    expect(base64ToBytes(b64)).toEqual(ascii(plain));
  });

  it('decodes unpadded input too', () => {
    expect(base64ToBytes('Zg')).toEqual(ascii('f'));
    expect(base64ToBytes('Zm9vYg')).toEqual(ascii('foob'));
  });

  it('uses +/ in std and -_ in url alphabet for the same bytes', () => {
    const bytes = Uint8Array.from([0xfb, 0xef, 0xff]);
    expect(bytesToBase64(bytes)).toBe('++//');
    expect(bytesToBase64Url(bytes)).toBe('--__');
    expect(base64ToBytes('++//')).toEqual(bytes);
    expect(base64ToBytes('--__')).toEqual(bytes);
  });

  it('base64url is unpadded', () => {
    expect(bytesToBase64Url(ascii('f'))).toBe('Zg');
    expect(bytesToBase64Url(ascii('fooba'))).toBe('Zm9vYmE');
  });

  it('round-trips random-ish byte lengths 0..66', () => {
    for (let len = 0; len <= 66; len++) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + len) & 0xff);
      expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
      expect(base64ToBytes(bytesToBase64Url(bytes))).toEqual(bytes);
    }
  });

  it('rejects malformed input', () => {
    expect(() => base64ToBytes('Zg=')).toThrow(); // short padding (must be Zg==)
    expect(() => base64ToBytes('Z')).toThrow(); // 4n+1 data chars impossible
    expect(() => base64ToBytes('Zm9vY')).toThrow();
    expect(() => base64ToBytes('Zg===')).toThrow(); // too much padding
    expect(() => base64ToBytes('Z!m9')).toThrow(); // bad char
    expect(() => base64ToBytes('Zm 9v')).toThrow(); // whitespace is not tolerated
    expect(() => base64ToBytes('Zh==')).toThrow(); // non-zero trailing bits (non-canonical)
    expect(() => base64ToBytes('Zm9=')).toThrow(); // non-canonical final chunk
  });
});

describe('hex', () => {
  it('is lowercase and zero-padded', () => {
    expect(bytesToHex(Uint8Array.from([0x00, 0x01, 0x0f, 0xab, 0xff]))).toBe('00010fabff');
    expect(bytesToHex(new Uint8Array(0))).toBe('');
  });
});

describe('utf8', () => {
  it('round-trips ASCII, umlauts, CJK and emoji (incl. surrogate pairs)', () => {
    for (const s of ['', 'plain', 'Grüße, Björn & Œuvre', '日本語テスト', '💚🔥 Familie Müller 🏆', '߿ࠀ￿\u{10000}\u{10ffff}']) {
      expect(bytesToUtf8(utf8ToBytes(s))).toBe(s);
    }
  });

  it('matches known byte sequences', () => {
    expect(utf8ToBytes('ü')).toEqual(Uint8Array.from([0xc3, 0xbc]));
    expect(utf8ToBytes('€')).toEqual(Uint8Array.from([0xe2, 0x82, 0xac]));
    expect(utf8ToBytes('💚')).toEqual(Uint8Array.from([0xf0, 0x9f, 0x92, 0x9a]));
  });

  it('rejects lone surrogates on encode', () => {
    expect(() => utf8ToBytes('\ud800')).toThrow(/surrogate/);
  });

  it('rejects invalid byte sequences on decode', () => {
    expect(() => bytesToUtf8(Uint8Array.from([0x80]))).toThrow(); // stray continuation
    expect(() => bytesToUtf8(Uint8Array.from([0xc3]))).toThrow(); // truncated
    expect(() => bytesToUtf8(Uint8Array.from([0xc0, 0x80]))).toThrow(); // overlong NUL
    expect(() => bytesToUtf8(Uint8Array.from([0xed, 0xa0, 0x80]))).toThrow(); // surrogate cp
    expect(() => bytesToUtf8(Uint8Array.from([0xf4, 0x90, 0x80, 0x80]))).toThrow(); // > U+10FFFF
    expect(() => bytesToUtf8(Uint8Array.from([0xff]))).toThrow(); // invalid lead
    expect(() => bytesToUtf8(Uint8Array.from([0xe2, 0x82, 0x2c]))).toThrow(); // bad continuation
  });
});

describe('concatBytes', () => {
  it('concatenates in order', () => {
    expect(concatBytes(Uint8Array.from([1, 2]), new Uint8Array(0), Uint8Array.from([3]))).toEqual(
      Uint8Array.from([1, 2, 3]),
    );
  });
});
