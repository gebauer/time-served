/**
 * Pure-TS byte/string encodings for the crypto layer.
 *
 * WHY HAND-ROLLED: this file must run identically on plain Node (vitest) and on
 * React Native **Hermes**, which does not reliably provide `Buffer`, `atob`/`btoa`
 * or `TextDecoder`. No globals beyond plain JS are used. Tested against the
 * RFC 4648 §10 vectors in `encoding.test.ts`.
 *
 * Wire relevance (see README.md in this directory):
 * - `Sealed` blobs are STANDARD base64 (padded) of `nonce || ct` — decision #3.
 * - `k_auth` and the invite-link key travel as base64url WITHOUT padding —
 *   decision #5 / BUILD_V1 §10.4.
 * - `auth_hash` is lowercase hex.
 */

const B64_STD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Reverse lookup accepting BOTH alphabets (std `+/` and url-safe `-_`). */
const B64_REV: Record<string, number> = {};
for (let i = 0; i < 64; i++) {
  B64_REV[B64_STD[i]] = i;
  B64_REV[B64_URL[i]] = i;
}

function encodeBase64(bytes: Uint8Array, alphabet: string, pad: boolean): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    if (i + 1 < bytes.length) out += alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)];
    else if (pad) out += '=';
    if (i + 2 < bytes.length) out += alphabet[b2 & 0x3f];
    else if (pad) out += '=';
  }
  return out;
}

/** Standard base64 (RFC 4648 §4), padded — the `Sealed` transport encoding. */
export function bytesToBase64(bytes: Uint8Array): string {
  return encodeBase64(bytes, B64_STD, true);
}

/** base64url (RFC 4648 §5) WITHOUT padding — `k_auth` / invite-fragment encoding. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes, B64_URL, false);
}

/**
 * Decode base64. Tolerant on input variant (accepts BOTH the standard and the
 * url-safe alphabet, with or without `=` padding) but strict on structure:
 * throws on any other character, on an impossible length (4n+1 chars of data),
 * and on non-zero trailing bits (non-canonical final chunk).
 */
export function base64ToBytes(s: string): Uint8Array {
  // Strip padding, then validate the remaining length: n % 4 === 1 is impossible.
  let end = s.length;
  while (end > 0 && s[end - 1] === '=') end--;
  const padChars = s.length - end;
  if (padChars > 2) throw new Error('base64: too much padding');
  const n = end;
  const rem = n % 4;
  if (rem === 1) throw new Error('base64: invalid length');
  if (padChars > 0 && (n + padChars) % 4 !== 0) throw new Error('base64: misplaced padding');

  const outLen = Math.floor(n / 4) * 3 + (rem === 2 ? 1 : rem === 3 ? 2 : 0);
  const out = new Uint8Array(outLen);
  let o = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < n; i++) {
    const v = B64_REV[s[i]];
    if (v === undefined) throw new Error(`base64: invalid character at ${i}`);
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  // Canonical form: leftover bits (4 for rem=2, 2 for rem=3) must be zero.
  if (bits > 0 && (buffer & ((1 << bits) - 1)) !== 0) {
    throw new Error('base64: non-canonical trailing bits');
  }
  return out;
}

/** Lowercase hex — the `auth_hash` transport encoding. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * UTF-8 encode. Hand-rolled because Hermes historically lacks `TextDecoder`
 * and we want encode/decode to be symmetric from one implementation.
 * Handles the full Unicode range incl. surrogate pairs; lone surrogates throw
 * (a JS string with a lone surrogate is a bug upstream, not valid plaintext).
 */
export function utf8ToBytes(s: string): Uint8Array {
  // First pass: size.
  let len = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i) as number; // reason: i < s.length ⇒ defined
    if (c >= 0xd800 && c <= 0xdfff) throw new Error('utf8: lone surrogate');
    if (c <= 0x7f) len += 1;
    else if (c <= 0x7ff) len += 2;
    else if (c <= 0xffff) len += 3;
    else {
      len += 4;
      i++; // consumed a surrogate pair
    }
  }
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.codePointAt(i) as number; // reason: i < s.length ⇒ defined
    if (c <= 0x7f) {
      out[o++] = c;
    } else if (c <= 0x7ff) {
      out[o++] = 0xc0 | (c >> 6);
      out[o++] = 0x80 | (c & 0x3f);
    } else if (c <= 0xffff) {
      out[o++] = 0xe0 | (c >> 12);
      out[o++] = 0x80 | ((c >> 6) & 0x3f);
      out[o++] = 0x80 | (c & 0x3f);
    } else {
      out[o++] = 0xf0 | (c >> 18);
      out[o++] = 0x80 | ((c >> 12) & 0x3f);
      out[o++] = 0x80 | ((c >> 6) & 0x3f);
      out[o++] = 0x80 | (c & 0x3f);
      i++; // consumed a surrogate pair
    }
  }
  return out;
}

/**
 * Strict UTF-8 decode: rejects truncated sequences, stray continuation bytes,
 * overlong encodings, surrogate code points and values > U+10FFFF. Inside this
 * module it only ever runs on AEAD-authenticated plaintext, so a failure means
 * the *encoder* was buggy — throwing loudly is correct.
 */
export function bytesToUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i];
    let cp: number;
    let extra: number;
    if (b0 <= 0x7f) {
      cp = b0;
      extra = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      extra = 1;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      extra = 2;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      extra = 3;
    } else {
      throw new Error(`utf8: invalid lead byte at ${i}`);
    }
    if (i + extra >= bytes.length && extra > 0) {
      throw new Error('utf8: truncated sequence');
    }
    for (let j = 1; j <= extra; j++) {
      const b = bytes[i + j];
      if ((b & 0xc0) !== 0x80) throw new Error(`utf8: invalid continuation at ${i + j}`);
      cp = (cp << 6) | (b & 0x3f);
    }
    // Overlong / range checks.
    if (
      (extra === 1 && cp < 0x80) ||
      (extra === 2 && cp < 0x800) ||
      (extra === 3 && cp < 0x10000) ||
      cp > 0x10ffff ||
      (cp >= 0xd800 && cp <= 0xdfff)
    ) {
      throw new Error('utf8: invalid code point');
    }
    out += String.fromCodePoint(cp);
    i += 1 + extra;
  }
  return out;
}

/** Concatenate byte arrays (nonce || ct assembly). */
export function concatBytes(...arrays: readonly Uint8Array[]): Uint8Array {
  let len = 0;
  for (const a of arrays) len += a.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
