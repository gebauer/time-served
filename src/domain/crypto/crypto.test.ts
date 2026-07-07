/**
 * GroupCrypto tests — THE deliverable (JOBS.md J6). Plain Node, no device.
 *
 * The pinned vectors freeze the derivation + wire formats forever: if a
 * refactor or library swap changes any of them, blobs on the server become
 * undecryptable and auth_hash stops matching — these tests must never be
 * "updated to match the code".
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
// node:crypto is allowed HERE (tests run on plain Node) as an INDEPENDENT
// cross-check of the pure-JS implementation. Never import it in src code.
import { createHash, hkdfSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import type { Sealed } from '../types';
import { createGroupCrypto, defaultRandomBytes, GROUP_KEY_BYTES, NONCE_BYTES, TAG_BYTES } from './crypto';
import { base64ToBytes, bytesToBase64, bytesToBase64Url, bytesToHex, utf8ToBytes } from './encoding';

const hexToBytes = (h: string) => Uint8Array.from((h.match(/../g) ?? []).map((b) => parseInt(b, 16)));

/** Deterministic fake RNG: returns the queued arrays in order. */
function fakeRandom(...queue: Uint8Array[]) {
  let i = 0;
  return (n: number): Uint8Array => {
    const next = queue[i++];
    if (!next || next.length !== n) throw new Error(`fakeRandom: unexpected request for ${n} bytes`);
    return next;
  };
}

// ---------------------------------------------------------------------------
// Pinned vectors (also documented in README.md). Computed independently with
// node:crypto — see the cross-check test below.
// ---------------------------------------------------------------------------
const KG_HEX = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const KENC_HEX = '7c8ddb622aee9d8e8b6d62b8791824c1903a60864d5a76a11bd920cc85982a2f';
const KAUTH_HEX = 'aabc40d126464783643412dc2c6590dc3842913fc7bc800595c06ca499c671b3';
const KAUTH_B64U = 'qrxA0SZGR4NkNBLcLGWQ3DhCkT_HvIAFlcBspJnGcbM';
const AUTH_HASH = 'e6c5f085e7c9314ad20eecf8e51781b52587ca3e8f251036c076e024715a7109';
/** seal("Grün 💚") under the pinned K_enc with nonce = 00..17. */
const SEALED_PINNED = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXtSeJAAMruI/ylzkz+L4myV2/uEoTayzFo98=';

const KG = hexToBytes(KG_HEX);
const NONCE_00_17 = Uint8Array.from({ length: NONCE_BYTES }, (_, i) => i);

const crypto = createGroupCrypto(); // real CSPRNG (Node ≥ 20 has getRandomValues)

describe('deriveKeys (HKDF-SHA256, empty salt — frozen forever)', () => {
  it('matches the pinned vectors for the fixed K_g', () => {
    const { kEnc, kAuth } = crypto.deriveKeys(KG);
    expect(bytesToHex(kEnc)).toBe(KENC_HEX);
    expect(bytesToHex(kAuth)).toBe(KAUTH_HEX);
    expect(kEnc.length).toBe(32);
    expect(kAuth.length).toBe(32);
  });

  it('cross-checks against an independent node:crypto HKDF', () => {
    const kEnc = Buffer.from(hkdfSync('sha256', KG, Buffer.alloc(0), 'ts-enc-v1', 32));
    const kAuth = Buffer.from(hkdfSync('sha256', KG, Buffer.alloc(0), 'ts-auth-v1', 32));
    expect(kEnc.toString('hex')).toBe(KENC_HEX);
    expect(kAuth.toString('hex')).toBe(KAUTH_HEX);
  });

  it('is deterministic and the two info strings diverge', () => {
    const a = crypto.deriveKeys(KG);
    const b = crypto.deriveKeys(hexToBytes(KG_HEX));
    expect(a.kEnc).toEqual(b.kEnc);
    expect(a.kAuth).toEqual(b.kAuth);
    expect(bytesToHex(a.kEnc)).not.toBe(bytesToHex(a.kAuth));
  });

  it('different K_g → different keys', () => {
    const other = crypto.deriveKeys(hexToBytes(KG_HEX.replace(/^00/, 'ff')));
    expect(bytesToHex(other.kEnc)).not.toBe(KENC_HEX);
    expect(bytesToHex(other.kAuth)).not.toBe(KAUTH_HEX);
  });

  it('rejects a wrong-length K_g', () => {
    expect(() => crypto.deriveKeys(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => crypto.deriveKeys(new Uint8Array(0))).toThrow(/32 bytes/);
  });
});

describe('authHash (decision #5: sha256 over the base64url STRING)', () => {
  it('matches the pinned chain K_auth → base64url → sha256-hex', () => {
    expect(bytesToBase64Url(hexToBytes(KAUTH_HEX))).toBe(KAUTH_B64U);
    expect(KAUTH_B64U.length).toBe(43); // 32 bytes, unpadded
    expect(crypto.authHash(hexToBytes(KAUTH_HEX))).toBe(AUTH_HASH);
  });

  it('cross-checks against node:crypto sha256 of the UTF-8 string (PocketBase semantics)', () => {
    const independent = createHash('sha256').update(KAUTH_B64U, 'utf8').digest('hex');
    expect(independent).toBe(AUTH_HASH);
  });

  it('is lowercase hex, 64 chars', () => {
    const h = crypto.authHash(crypto.deriveKeys(crypto.generateGroupKey()).kAuth);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes the ENCODED string, not the raw bytes', () => {
    const rawHash = createHash('sha256').update(hexToBytes(KAUTH_HEX)).digest('hex');
    expect(crypto.authHash(hexToBytes(KAUTH_HEX))).not.toBe(rawHash);
  });

  it('rejects a wrong-length K_auth', () => {
    expect(() => crypto.authHash(new Uint8Array(16))).toThrow(/32 bytes/);
  });
});

describe('seal / open (decision #3: base64(nonce24 || xchacha20poly1305 ct))', () => {
  const { kEnc } = crypto.deriveKeys(KG);

  it.each([
    ['group meta', '{"name":"Familie Müller"}'],
    ['nick with umlauts', 'Björn Größenwahn'],
    ['emoji + CJK', '💚🏆 日本語 nick'],
    ['empty string', ''],
    ['long text', 'x'.repeat(5000) + ' — Ende 💚'],
  ])('round-trips %s', (_label, plaintext) => {
    const sealed = crypto.seal(kEnc, plaintext);
    expect(crypto.open(kEnc, sealed)).toBe(plaintext);
  });

  it('produces the exact pinned wire format for a fixed nonce', () => {
    const c = createGroupCrypto(fakeRandom(NONCE_00_17));
    expect(c.seal(kEnc, 'Grün 💚')).toBe(SEALED_PINNED);
    expect(crypto.open(kEnc, SEALED_PINNED as Sealed)).toBe('Grün 💚');
  });

  it('layout: base64(nonce || ct), tag at the end, fresh random nonce each call', () => {
    const sealed = crypto.seal(kEnc, 'hi');
    const blob = base64ToBytes(sealed);
    expect(blob.length).toBe(NONCE_BYTES + utf8ToBytes('hi').length + TAG_BYTES);
    // decrypting manually with the prepended nonce works ⇒ layout is nonce||ct
    const pt = xchacha20poly1305(kEnc, blob.subarray(0, NONCE_BYTES)).decrypt(blob.subarray(NONCE_BYTES));
    expect(pt).toEqual(utf8ToBytes('hi'));
    // two seals of the same plaintext differ (fresh nonce)
    expect(crypto.seal(kEnc, 'hi')).not.toBe(sealed);
  });

  it('open accepts url-safe / unpadded re-encodings of the same blob (server tolerance)', () => {
    const blob = base64ToBytes(crypto.seal(kEnc, 'tolerant'));
    const urlSafe = bytesToBase64Url(blob) as Sealed;
    expect(crypto.open(kEnc, urlSafe)).toBe('tolerant');
  });

  it.each([
    ['nonce', 0],
    ['ciphertext body', NONCE_BYTES],
    ['tag (last byte)', -1],
  ])('detects tampering in the %s', (_where, index) => {
    const sealed = crypto.seal(kEnc, 'secret nickname');
    const blob = base64ToBytes(sealed);
    const i = index < 0 ? blob.length + index : index;
    blob[i] ^= 0x01; // flip one bit
    expect(() => crypto.open(kEnc, bytesToBase64(blob) as Sealed)).toThrow(/authentication failed/);
  });

  it('throws on a wrong key', () => {
    const sealed = crypto.seal(kEnc, 'secret');
    const wrong = crypto.deriveKeys(hexToBytes('ff' + KG_HEX.slice(2))).kEnc;
    expect(() => crypto.open(wrong, sealed)).toThrow(/authentication failed/);
  });

  it('throws on kAuth used as kEnc (auth ≠ decryption)', () => {
    const { kAuth } = crypto.deriveKeys(KG);
    const sealed = crypto.seal(kEnc, 'secret');
    expect(() => crypto.open(kAuth, sealed)).toThrow(/authentication failed/);
  });

  it('throws on garbage / truncated / non-base64 blobs', () => {
    expect(() => crypto.open(kEnc, 'not base64 !!!' as Sealed)).toThrow(/not valid base64/);
    expect(() => crypto.open(kEnc, '' as Sealed)).toThrow(/too short/);
    const tooShort = bytesToBase64(new Uint8Array(NONCE_BYTES + TAG_BYTES - 1)) as Sealed;
    expect(() => crypto.open(kEnc, tooShort)).toThrow(/too short/);
  });

  it('rejects wrong-length kEnc', () => {
    expect(() => crypto.seal(new Uint8Array(16), 'x')).toThrow(/32 bytes/);
    expect(() => crypto.open(new Uint8Array(16), SEALED_PINNED as Sealed)).toThrow(/32 bytes/);
  });
});

describe('generateGroupKey', () => {
  it('returns exactly the injected randomness (32 bytes)', () => {
    const fixed = Uint8Array.from({ length: GROUP_KEY_BYTES }, (_, i) => 255 - i);
    const c = createGroupCrypto(fakeRandom(fixed));
    expect(c.generateGroupKey()).toEqual(fixed);
  });

  it('default RNG produces 32 differing keys', () => {
    const a = crypto.generateGroupKey();
    const b = crypto.generateGroupKey();
    expect(a.length).toBe(GROUP_KEY_BYTES);
    expect(b.length).toBe(GROUP_KEY_BYTES);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it('defaultRandomBytes uses the platform CSPRNG', () => {
    expect(defaultRandomBytes(8).length).toBe(8);
    expect(bytesToHex(defaultRandomBytes(16))).not.toBe(bytesToHex(defaultRandomBytes(16)));
  });
});

// ---------------------------------------------------------------------------
// Interop guards for CONTRACT_CHANGES #7: prove the primitives are the standard
// constructions, i.e. byte-compatible with libsodium / RFC implementations.
// ---------------------------------------------------------------------------
describe('interop pins (libsodium / RFC compatibility)', () => {
  it('XChaCha20-Poly1305 matches draft-irtf-cfrg-xchacha §A.3 (== libsodium crypto_aead_xchacha20poly1305_ietf)', () => {
    const key = hexToBytes('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f');
    const nonce = hexToBytes('404142434445464748494a4b4c4d4e4f5051525354555657');
    const aad = hexToBytes('50515253c0c1c2c3c4c5c6c7');
    const pt = utf8ToBytes(
      "Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.",
    );
    const expected =
      'bd6d179d3e83d43b9576579493c0e939572a1700252bfaccbed2902c21396cbb731c7f1b0b4aa6440bf3a82f4eda' +
      '7e39ae64c6708c54c216cb96b72e1213b4522f8c9ba40db5d945b11b69b982c1bb9e3f3fac2bc369488f76b23835' +
      '65d3fff921f9664c97637da9768812f615c68b13b52e' + // ciphertext
      'c0875924c1c7987947deafd8780acf49'; // tag appended at the end (combined mode)
    expect(bytesToHex(xchacha20poly1305(key, nonce, aad).encrypt(pt))).toBe(expected);
  });

  it('the shipped HKDF-SHA256 matches RFC 5869 test cases 1 and 3', () => {
    // TC1 (salt + info):
    expect(
      bytesToHex(
        hkdf(
          sha256,
          hexToBytes('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'),
          hexToBytes('000102030405060708090a0b0c'),
          hexToBytes('f0f1f2f3f4f5f6f7f8f9'),
          42,
        ),
      ),
    ).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
    // TC3 (EMPTY salt + empty info — our salt convention):
    expect(
      bytesToHex(
        hkdf(sha256, hexToBytes('0b'.repeat(22)), new Uint8Array(0), new Uint8Array(0), 42),
      ),
    ).toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8');
  });
});
