/**
 * TagReader — platform seam for NFC tag identity (CLAUDE.md §2, BUILD_V1 §9).
 *
 * CONTRACT FILE (JOBS.md): implemented by J4 (`platform/android/nfc/`) and later
 * `platform/ios/`; a FakeTagReader drives the emulator dev harness. Changes require
 * a docs/CONTRACT_CHANGES.md entry.
 *
 * The reader performs the §9.2 three-stage detection itself (scope prefix, payload
 * parse, plausibility incl. `?v=1`) and emits only tags that carry a well-formed
 * Time Served payload. Non-app tags and malformed payloads are dropped silently —
 * reading is always interaction-free. RESOLUTION against the local `boxes` table is
 * NOT the reader's job: it emits the raw payload and the J9 wiring decides
 * known-box vs auto-create-foreign (BUILD_V1 §9.2 step 2).
 */

/** A successfully parsed Time Served tag payload (`timeserved://box/<uuid>?v=1`). */
export interface TagPayload {
  /** The box UUID from the URI record — box identity, NOT the hardware UID. */
  readonly boxUuid: string;
  /** The box label from the accompanying text record, if present. */
  readonly label?: string;
  /** Payload format version from `?v=`; readers ignore unknown major versions. */
  readonly version: number;
}

export type TagListener = (payload: TagPayload) => void;

export interface TagReader {
  /**
   * Begin listening for tags (Android: foreground reader mode). Idempotent.
   * Rejects if NFC is unavailable/disabled — caller surfaces that in UI.
   */
  start(): Promise<void>;

  /** Stop listening. Idempotent. */
  stop(): Promise<void>;

  /** Subscribe to parsed tag reads. Returns an unsubscribe function. */
  subscribe(listener: TagListener): () => void;

  /** Whether NFC exists and is enabled on this device right now. */
  isAvailable(): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Write path — used ONLY by the registration wizard (BUILD_V1 §9.3), never
// reactively. Separate interface so read-only consumers can't touch it.
// ---------------------------------------------------------------------------

/** What is currently on a physical tag, from the wizard's perspective. */
export type TagState =
  | { readonly kind: 'blank' }
  | { readonly kind: 'foreign'; readonly summary: string }
  | { readonly kind: 'ours'; readonly payload: TagPayload }
  | { readonly kind: 'locked-foreign' };

export interface TagWriteRequest {
  readonly boxUuid: string;
  readonly label: string;
  /** Payload format version to write; V1 writes 1. */
  readonly version: number;
  /**
   * Permanently set lock bits after a verified write. IRREVERSIBLE — must only
   * ever be true after the explicit user confirmation of §9.4. Default false.
   */
  readonly lock: boolean;
}

export type TagWriteResult =
  | { readonly ok: true; readonly verified: true; readonly locked: boolean }
  | { readonly ok: false; readonly error: 'write-failed' | 'verify-failed' | 'lock-failed' | 'tag-lost' };

export interface TagWriter {
  /**
   * One wizard "Write tag" step: wait for a tag, report its state via `onTagState`,
   * and — once the caller confirms via the returned `proceed` — write the NDEF
   * message (URI + text record), verify by read-back, optionally lock.
   * `cancel` aborts the step (user backed out / timeout).
   */
  beginWriteStep(
    request: TagWriteRequest,
    onTagState: (state: TagState) => void
  ): {
    proceed: () => Promise<TagWriteResult>;
    cancel: () => void;
  };
}
