/**
 * Crypto-strength id/password generation for the sync layer (J10). Built on
 * J6's `RandomBytesFn` seam (default: crypto.getRandomValues — the app
 * imports `react-native-get-random-values` at bootstrap, decision #8).
 *
 * NOT the Math.random uuid from wiring.ts: `user_uuid` is the account
 * identity and the password is the only thing protecting it, so both must be
 * unguessable.
 */
import { bytesToBase64Url, defaultRandomBytes, type RandomBytesFn } from '../../domain/crypto';

/** Lowercase UUID v4 from cryptographic randomness. */
export function secureUuidV4(randomBytes: RandomBytesFn = defaultRandomBytes): string {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10xx
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
    `${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

/** 24 random bytes as base64url — the device account password (README §3). */
export function securePassword(randomBytes: RandomBytesFn = defaultRandomBytes): string {
  return bytesToBase64Url(randomBytes(24));
}
