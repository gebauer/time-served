/**
 * STUB crypto for the mocked UI wiring (JOBS.md J8) — implements the
 * InviteLinkCodec contract from src/domain/crypto/CryptoPorts.ts so the group
 * create/join screens are fully functional against in-memory data.
 *
 * >>> J10: REPLACE the uses of this module with J6's real implementation. <<<
 * The link FORMAT already matches BUILD_V1 §10.4 (`https://<host>/j#g=<id>&
 * k=<base64url K_g>`, key only in the fragment), so links minted here parse
 * with the real codec and vice versa. Key generation here is Math.random —
 * fine for fixtures, never for production keys.
 *
 * Pure TS (no Buffer/atob — Hermes-safe), unit-tested on plain Node.
 */
import type { GroupKey, InviteLink } from '../domain/crypto/CryptoPorts';
import type { GroupId } from '../domain/types';

const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url (no padding) of raw bytes. */
export function base64UrlEncode(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += BASE64URL_ALPHABET[b0 >> 2];
    out += BASE64URL_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    if (b1 !== undefined) out += BASE64URL_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    if (b2 !== undefined) out += BASE64URL_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** Inverse of base64UrlEncode; undefined on malformed input. */
export function base64UrlDecode(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return undefined;
  const values = new Array<number>(text.length);
  for (let i = 0; i < text.length; i += 1) {
    const value = BASE64URL_ALPHABET.indexOf(text[i]);
    if (value < 0) return undefined;
    values[i] = value;
  }
  const bytes: number[] = [];
  for (let i = 0; i < values.length; i += 4) {
    const v0 = values[i];
    const v1 = values[i + 1];
    const v2 = i + 2 < values.length ? values[i + 2] : undefined;
    const v3 = i + 3 < values.length ? values[i + 3] : undefined;
    if (v1 === undefined) return undefined;
    bytes.push(((v0 << 2) | (v1 >> 4)) & 0xff);
    if (v2 !== undefined) bytes.push(((v1 << 4) | (v2 >> 2)) & 0xff);
    if (v3 !== undefined && v2 !== undefined) bytes.push(((v2 << 6) | v3) & 0xff);
  }
  return Uint8Array.from(bytes);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `https://<host>/j#g=<group_id>&k=<K_g base64url>` — K_g in the FRAGMENT only
 * (BUILD_V1 §10.4). Parse never throws on hostile input.
 */
export const stubInviteLinkCodec = {
  build(host: string, invite: InviteLink): string {
    return `https://${host}/j#g=${invite.groupId}&k=${base64UrlEncode(invite.kg)}`;
  },

  parse(url: string): InviteLink | undefined {
    const hashIndex = url.indexOf('#');
    if (hashIndex < 0) return undefined;
    const beforeHash = url.slice(0, hashIndex);
    if (!/^https:\/\/[^/]+\/j$/.test(beforeHash)) return undefined;
    const params = new Map<string, string>();
    for (const pair of url.slice(hashIndex + 1).split('&')) {
      const eq = pair.indexOf('=');
      if (eq <= 0) return undefined;
      params.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const groupId = params.get('g');
    const key = params.get('k');
    if (groupId === undefined || key === undefined) return undefined;
    if (!UUID_RE.test(groupId)) return undefined;
    const kg = base64UrlDecode(key);
    if (kg === undefined || kg.length !== 32) return undefined;
    return { groupId: groupId as GroupId, kg };
  },
};

/** Fixture-grade 32-byte "key" — Math.random, NEVER for production (J6/J10). */
export function stubGenerateGroupKey(): GroupKey {
  return Uint8Array.from({ length: 32 }, () => Math.floor(Math.random() * 256));
}
