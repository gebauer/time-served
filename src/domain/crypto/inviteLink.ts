/**
 * Invite-link codec (BUILD_V1 §10.4) — the group key K_g travels ONLY in the
 * URL fragment, which browsers and servers never transmit.
 *
 * Canonical form (the only form `build` produces and the only form REQUIRED
 * to be accepted):
 *
 *   https://<host>/j#g=<group_id (UUID v4)>&k=<K_g base64url unpadded (43 chars)>
 *
 * `parse` is additionally tolerant of:
 *   - the app's own deep-link form `timeserved://j#...` (or `timeserved://<x>/j#...`)
 *     in case the host app / OS rewrites the universal link before delivery —
 *     convenience only, NOT part of the contract;
 *   - a query string before the fragment, trailing slash on the path,
 *     percent-encoded or `=`-padded key values, extra unknown fragment params,
 *     uppercase scheme/host/UUID.
 *
 * Everything is local string parsing — no URL/global network-adjacent API is
 * involved, so the fragment can never leak anywhere.
 */
import type { GroupId } from '../types';
import { GROUP_KEY_BYTES } from './crypto';
import type { InviteLink, InviteLinkCodec } from './CryptoPorts';
import { base64ToBytes, bytesToBase64Url } from './encoding';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `https://host/j` (canonical) — host must be non-empty, optional trailing `/`. */
const HTTPS_HEAD_RE = /^https:\/\/[^/?#]+\/j\/?$/i;
/** `timeserved://j` or `timeserved://<segment>/j` — tolerated deep-link rewrite. */
const DEEPLINK_HEAD_RE = /^timeserved:\/\/(?:[^/?#]+\/)?j\/?$/i;

/** base64url, optional `=` padding; strict alphabet (no `+`/`/` in a URL fragment). */
const B64URL_RE = /^[A-Za-z0-9\-_]+={0,2}$/;

function parseFragmentParams(fragment: string): Map<string, string> | undefined {
  const params = new Map<string, string>();
  for (const pair of fragment.split('&')) {
    if (pair === '') continue;
    const eq = pair.indexOf('=');
    if (eq <= 0) return undefined; // no key, or no '=' at all — malformed
    const key = pair.slice(0, eq);
    let value = pair.slice(eq + 1);
    try {
      value = decodeURIComponent(value);
    } catch {
      return undefined; // malformed percent-encoding
    }
    if (params.has(key)) return undefined; // duplicate params are hostile
    params.set(key, value);
  }
  return params;
}

export const inviteLinkCodec: InviteLinkCodec = {
  build(host: string, invite: InviteLink): string {
    if (invite.kg.length !== GROUP_KEY_BYTES) {
      throw new Error(`invite: K_g must be ${GROUP_KEY_BYTES} bytes`);
    }
    // Accept "ts.example.com", "https://ts.example.com" or a trailing slash —
    // normalize to the canonical https form.
    const bare = host.replace(/^https:\/\//i, '').replace(/\/+$/, '');
    if (bare === '' || /[/?#]/.test(bare) || /^[a-z][a-z0-9+.-]*:\/\//i.test(bare)) {
      throw new Error('invite: host must be a bare hostname (no path/query/scheme)');
    }
    return `https://${bare}/j#g=${invite.groupId}&k=${bytesToBase64Url(invite.kg)}`;
  },

  parse(url: string): InviteLink | undefined {
    try {
      if (typeof url !== 'string' || url.length === 0 || url.length > 4096) return undefined;
      const hashAt = url.indexOf('#');
      if (hashAt < 0) return undefined; // no fragment → no key → not an invite
      let head = url.slice(0, hashAt);
      const fragment = url.slice(hashAt + 1);

      // Tolerate a query string before the fragment (e.g. tracking junk).
      const queryAt = head.indexOf('?');
      if (queryAt >= 0) head = head.slice(0, queryAt);

      if (!HTTPS_HEAD_RE.test(head) && !DEEPLINK_HEAD_RE.test(head)) return undefined;

      const params = parseFragmentParams(fragment);
      if (!params) return undefined;
      const g = params.get('g');
      const k = params.get('k');
      if (!g || !k) return undefined;

      if (!UUID_RE.test(g)) return undefined;

      if (!B64URL_RE.test(k)) return undefined;
      let kg: Uint8Array;
      try {
        kg = base64ToBytes(k);
      } catch {
        return undefined;
      }
      if (kg.length !== GROUP_KEY_BYTES) return undefined;

      // Canonical UUIDs are lowercase (server compares strings — README §1).
      return { groupId: g.toLowerCase() as GroupId, kg };
    } catch {
      // Contract: never throw on hostile input.
      return undefined;
    }
  },
};
