/**
 * GroupCrypto implementation (J6) — pure TS, runs identically on plain Node and
 * React Native Hermes.
 *
 * LIBRARY CHOICE (docs/CONTRACT_CHANGES.md #7): audited pure-JS
 * `@noble/hashes` (SHA-256, HKDF) + `@noble/ciphers` (XChaCha20-Poly1305)
 * instead of JOBS.md's libsodium suggestion — libsodium-wrappers is WASM and
 * does not run on Hermes. The constructions are the standard ones
 * (RFC 5869 HKDF-SHA256; draft-irtf-cfrg-xchacha XChaCha20-Poly1305, identical
 * to libsodium's `crypto_aead_xchacha20poly1305_ietf`), so ciphertexts stay
 * interoperable with any future libsodium implementation. Interop is pinned by
 * test vectors in `crypto.test.ts`.
 *
 * KEY DERIVATION — frozen forever (BUILD_V1 §10.2; reproducibility is the
 * whole point, sealed blobs on the server must stay decryptable):
 *
 *   K_enc  = HKDF-SHA256(IKM = K_g, salt = EMPTY (0 bytes), info = "ts-enc-v1",  L = 32)
 *   K_auth = HKDF-SHA256(IKM = K_g, salt = EMPTY (0 bytes), info = "ts-auth-v1", L = 32)
 *
 *   - HKDF per RFC 5869 (extract-then-expand), hash = SHA-256.
 *   - Salt is the EMPTY byte string. Per RFC 5869 §2.2 that is equivalent to a
 *     salt of HashLen (32) zero bytes — both HMAC-key-pad to the same block —
 *     so `node:crypto`'s `hkdfSync('sha256', kg, '', info, 32)` produces the
 *     identical output (cross-checked in tests).
 *   - Info strings are the ASCII/UTF-8 bytes of exactly "ts-enc-v1" / "ts-auth-v1".
 *
 * AEAD — decision #3 (docs/CONTRACT_CHANGES.md):
 *   sealed = base64( nonce(24 random bytes) || XChaCha20-Poly1305(kEnc, nonce, utf8(plaintext)) )
 *   No additional data (AAD). The Poly1305 tag (16 bytes) sits at the END of
 *   the ciphertext (IETF/libsodium "combined" layout). Standard padded base64.
 *
 * AUTH HASH — decision #5 (docs/CONTRACT_CHANGES.md, server/README.md §2):
 *   auth_hash = lowercase hex( SHA-256( UTF-8 bytes of base64url_unpadded(K_auth) ) )
 *   The hash covers the ENCODED STRING (43 chars for 32 bytes), not the raw key
 *   bytes, because PocketBase's JSVM `$security.sha256()` hashes strings.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import type { Sealed } from '../types';
import type { DerivedKeys, GroupCrypto, GroupKey } from './CryptoPorts';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToBase64Url,
  bytesToHex,
  bytesToUtf8,
  concatBytes,
  utf8ToBytes,
} from './encoding';

export const GROUP_KEY_BYTES = 32;
export const NONCE_BYTES = 24; // XChaCha20-Poly1305 nonce
export const TAG_BYTES = 16; // Poly1305 tag (trails the ciphertext)

const INFO_ENC = utf8ToBytes('ts-enc-v1');
const INFO_AUTH = utf8ToBytes('ts-auth-v1');
const EMPTY_SALT = new Uint8Array(0);

/** Injectable randomness so tests are deterministic and the CSPRNG is explicit. */
export type RandomBytesFn = (n: number) => Uint8Array;

/**
 * Default CSPRNG: `globalThis.crypto.getRandomValues`. Available natively on
 * Node ≥ 20 and in browsers. ON DEVICE (Hermes) IT DOES NOT EXIST BY DEFAULT:
 * J9/J10 must ensure `react-native-get-random-values` is imported at app
 * bootstrap (before any crypto call) so the polyfill installs it. We fail loud
 * rather than fall back to anything non-cryptographic.
 */
export function defaultRandomBytes(n: number): Uint8Array {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error(
      'crypto.getRandomValues is unavailable — on React Native, import ' +
        '"react-native-get-random-values" at app bootstrap before using GroupCrypto.',
    );
  }
  const out = new Uint8Array(n);
  c.getRandomValues(out);
  return out;
}

function assertKey(key: Uint8Array, what: string): void {
  if (!(key instanceof Uint8Array) || key.length !== GROUP_KEY_BYTES) {
    throw new Error(`${what} must be ${GROUP_KEY_BYTES} bytes, got ${key?.length}`);
  }
}

/**
 * Build a `GroupCrypto`. Pass a deterministic `randomBytes` in tests; the
 * default uses the platform CSPRNG (see `defaultRandomBytes`).
 */
export function createGroupCrypto(randomBytes: RandomBytesFn = defaultRandomBytes): GroupCrypto {
  return {
    generateGroupKey(): GroupKey {
      const kg = randomBytes(GROUP_KEY_BYTES);
      assertKey(kg, 'generated K_g'); // guards a misbehaving injected RNG
      return kg;
    },

    deriveKeys(kg: GroupKey): DerivedKeys {
      assertKey(kg, 'K_g');
      return {
        kEnc: hkdf(sha256, kg, EMPTY_SALT, INFO_ENC, 32),
        kAuth: hkdf(sha256, kg, EMPTY_SALT, INFO_AUTH, 32),
      };
    },

    authHash(kAuth: Uint8Array): string {
      assertKey(kAuth, 'K_auth');
      // Hash the base64url STRING's UTF-8 bytes — matches PocketBase's
      // $security.sha256(string). See header comment / decision #5.
      return bytesToHex(sha256(utf8ToBytes(bytesToBase64Url(kAuth))));
    },

    seal(kEnc: Uint8Array, plaintext: string): Sealed {
      assertKey(kEnc, 'K_enc');
      const nonce = randomBytes(NONCE_BYTES);
      if (nonce.length !== NONCE_BYTES) {
        throw new Error(`randomBytes returned ${nonce.length} bytes, expected ${NONCE_BYTES}`);
      }
      const ct = xchacha20poly1305(kEnc, nonce).encrypt(utf8ToBytes(plaintext));
      return bytesToBase64(concatBytes(nonce, ct)) as Sealed;
    },

    open(kEnc: Uint8Array, sealed: Sealed): string {
      assertKey(kEnc, 'K_enc');
      let blob: Uint8Array;
      try {
        blob = base64ToBytes(sealed);
      } catch {
        throw new Error('open: sealed blob is not valid base64');
      }
      if (blob.length < NONCE_BYTES + TAG_BYTES) {
        throw new Error('open: sealed blob too short');
      }
      const nonce = blob.subarray(0, NONCE_BYTES);
      const ct = blob.subarray(NONCE_BYTES);
      let pt: Uint8Array;
      try {
        pt = xchacha20poly1305(kEnc, nonce).decrypt(ct);
      } catch {
        // noble throws on Poly1305 tag mismatch — tampered blob or wrong key.
        throw new Error('open: authentication failed (tampered ciphertext or wrong key)');
      }
      return bytesToUtf8(pt);
    },
  };
}
