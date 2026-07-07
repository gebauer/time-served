/**
 * Crypto ports — the contract J6 implements (JOBS.md), consumed by J10's group/sync
 * flows. Pure, Node-compatible (tests run without a device). Changes require a
 * docs/CONTRACT_CHANGES.md entry.
 *
 * Scheme (BUILD_V1 §10.2, auth ≠ decryption):
 *   K_enc  = HKDF(K_g, "ts-enc-v1")   — AEAD key, never sent to the server
 *   K_auth = HKDF(K_g, "ts-auth-v1")  — access proof; server stores SHA-256(K_auth)
 *
 * AEAD convention (docs/CONTRACT_CHANGES.md #3): XChaCha20-Poly1305, random 24-byte
 * nonce PREPENDED to the ciphertext, no additional data; whole blob base64-encoded
 * (the `Sealed` brand).
 */
import type { GroupId, Sealed } from '../types';

/** 32-byte group key. Lives only in invite-link fragments + device secure storage. */
export type GroupKey = Uint8Array;

export interface DerivedKeys {
  /** HKDF(K_g, "ts-enc-v1") — 32-byte AEAD key. */
  readonly kEnc: Uint8Array;
  /** HKDF(K_g, "ts-auth-v1") — 32-byte access proof, sent to the server over TLS. */
  readonly kAuth: Uint8Array;
}

export interface GroupCrypto {
  /** Fresh random 32-byte K_g (group creation). */
  generateGroupKey(): GroupKey;

  /** Deterministic HKDF derivations from K_g. */
  deriveKeys(kg: GroupKey): DerivedKeys;

  /**
   * SHA-256(K_auth), encoded for transport/storage as the server's `auth_hash`.
   * Encoding must match server/README.md — single source of truth is the J7 doc.
   */
  authHash(kAuth: Uint8Array): string;

  /** AEAD-encrypt a UTF-8 string under kEnc → base64(nonce || ct). */
  seal(kEnc: Uint8Array, plaintext: string): Sealed;

  /** Decrypt; throws on tamper/wrong key (AEAD auth failure). */
  open(kEnc: Uint8Array, sealed: Sealed): string;
}

// ---------------------------------------------------------------------------
// Invite link (BUILD_V1 §10.4) — the key travels ONLY in the URL fragment.
// ---------------------------------------------------------------------------

export interface InviteLink {
  readonly groupId: GroupId;
  readonly kg: GroupKey;
}

export interface InviteLinkCodec {
  /** `https://<host>/j#g=<group_id>&k=<K_g base64url>` — K_g in the fragment only. */
  build(host: string, invite: InviteLink): string;

  /**
   * Parse an incoming invite URL (deep link). Returns undefined for anything that
   * is not a well-formed invite (wrong path, missing/malformed params, bad key
   * length) — never throws on hostile input.
   */
  parse(url: string): InviteLink | undefined;
}
