/**
 * NDEF codec for Time Served box tags — PURE functions (BUILD_V1 §9.1/§9.2).
 *
 * Operates on raw NDEF record structures (TNF + type + payload bytes) so it is
 * unit-testable on plain Node without `react-native-nfc-manager`. The record
 * shape is structurally compatible with nfc-manager's `NdefRecord`: what
 * `registerTagEvent` / `getNdefMessage` deliver can be passed straight into
 * `decodeBoxTag`, and what `encodeBoxTagMessage` returns can be passed straight
 * into `Ndef.encodeMessage`.
 *
 * Tag layout (§9.1): NDEF message = URI record `timeserved://box/<uuid>?v=1`
 * + text record with the box label. Box identity = the UUID in the payload,
 * never the hardware UID.
 */

import type { TagPayload } from '../../TagReader';

// ---------------------------------------------------------------------------
// Raw NDEF record shape (structural subset of nfc-manager's NdefRecord)
// ---------------------------------------------------------------------------

export interface RawNdefRecord {
  tnf: number;
  /** Android delivers byte arrays; iOS sometimes strings ('U', 'T'). */
  type: number[] | string;
  payload: number[];
}

/** TNF 0x01 — NFC Forum well-known type. */
export const TNF_WELL_KNOWN = 0x01;
/** TNF 0x00 — empty record (factory-blank NDEF-formatted tags). */
export const TNF_EMPTY = 0x00;

const RTD_URI_BYTE = 0x55; // 'U'
const RTD_TEXT_BYTE = 0x54; // 'T'

/** URI scheme prefix that scopes a tag to this app (§9.2 stage 1). */
export const TAG_URI_PREFIX = 'timeserved://box/';

/** Payload format version this reader/writer speaks (§9.1). */
export const SUPPORTED_TAG_VERSION = 1;

// ---------------------------------------------------------------------------
// UTF-8 helpers (hand-rolled: Hermes lacks TextEncoder/TextDecoder, and the
// codec must stay dependency-free to run on Node)
// ---------------------------------------------------------------------------

export function utf8Encode(text: string): number[] {
  const out: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0) as number; // for..of iterates code points
    if (cp <= 0x7f) {
      out.push(cp);
    } else if (cp <= 0x7ff) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp <= 0xffff) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f)
      );
    }
  }
  return out;
}

export function utf8Decode(bytes: readonly number[]): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i] & 0xff;
    let cp: number;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if (b0 < 0xe0) {
      cp = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b0 < 0xf0) {
      cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      cp =
        ((b0 & 0x07) << 18) |
        ((bytes[i + 1] & 0x3f) << 12) |
        ((bytes[i + 2] & 0x3f) << 6) |
        (bytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Record-level helpers
// ---------------------------------------------------------------------------

function isRecordType(record: RawNdefRecord, rtdByte: number, rtdChar: string): boolean {
  if (record.tnf !== TNF_WELL_KNOWN) return false;
  const t = record.type;
  if (typeof t === 'string') return t === rtdChar;
  return t.length === 1 && t[0] === rtdByte;
}

export function isUriRecord(record: RawNdefRecord): boolean {
  return isRecordType(record, RTD_URI_BYTE, 'U');
}

export function isTextRecord(record: RawNdefRecord): boolean {
  return isRecordType(record, RTD_TEXT_BYTE, 'T');
}

/**
 * NFC Forum RTD-URI identifier-code prefix table (byte 0 of a URI payload).
 * Index 0 = no abbreviation — the only code our own scheme can use; the rest
 * exist so foreign tags decode to a readable summary.
 */
const URI_PREFIXES = [
  '', 'http://www.', 'https://www.', 'http://', 'https://', 'tel:', 'mailto:',
  'ftp://anonymous:anonymous@', 'ftp://ftp.', 'ftps://', 'sftp://', 'smb://',
  'nfs://', 'ftp://', 'dav://', 'news:', 'telnet://', 'imap:', 'rtsp://',
  'urn:', 'pop:', 'sip:', 'sips:', 'tftp:', 'btspp://', 'btl2cap://',
  'btgoep://', 'tcpobex://', 'irdaobex://', 'file://', 'urn:epc:id:',
  'urn:epc:tag:', 'urn:epc:pat:', 'urn:epc:raw:', 'urn:epc:', 'urn:nfc:',
];

/** Decode an RTD-URI payload (identifier code byte + UTF-8 rest) to a string. */
export function decodeUriPayload(payload: readonly number[]): string {
  if (payload.length === 0) return '';
  const prefix = URI_PREFIXES[payload[0]] ?? '';
  return prefix + utf8Decode(payload.slice(1));
}

/**
 * Decode an RTD-Text payload. Status byte: bit 7 = UTF-16 flag (we only emit
 * and reliably decode UTF-8; UTF-16 falls back to a best-effort empty result),
 * bits 5..0 = IANA language-code length.
 */
export function decodeTextPayload(payload: readonly number[]): string | undefined {
  if (payload.length === 0) return undefined;
  const status = payload[0];
  const isUtf16 = (status & 0x80) !== 0;
  const langLength = status & 0x3f;
  const textBytes = payload.slice(1 + langLength);
  if (isUtf16) {
    // Rare in the wild and never produced by us; decode UTF-16BE (with BOM check).
    let bytes = textBytes;
    let littleEndian = false;
    if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
      littleEndian = true;
      bytes = bytes.slice(2);
    } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      bytes = bytes.slice(2);
    }
    let out = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      out += String.fromCharCode(littleEndian ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
  }
  return utf8Decode(textBytes);
}

// ---------------------------------------------------------------------------
// Encoding (write path, §9.3) — records for `Ndef.encodeMessage`
// ---------------------------------------------------------------------------

export interface BoxTagContent {
  readonly boxUuid: string;
  readonly label: string;
  readonly version: number;
}

export function buildBoxUri(boxUuid: string, version: number): string {
  return `${TAG_URI_PREFIX}${boxUuid.toLowerCase()}?v=${version}`;
}

/**
 * Build the two-record NDEF message for a box tag: URI record
 * `timeserved://box/<uuid>?v=<version>` + text record with the label.
 * Both tags of a box carry the IDENTICAL message (§9.1).
 */
export function encodeBoxTagMessage(content: BoxTagContent): RawNdefRecord[] {
  const uriRecord: RawNdefRecord = {
    tnf: TNF_WELL_KNOWN,
    type: [RTD_URI_BYTE],
    // Identifier code 0x00 = no abbreviation (custom scheme).
    payload: [0x00, ...utf8Encode(buildBoxUri(content.boxUuid, content.version))],
  };
  const textRecord: RawNdefRecord = {
    tnf: TNF_WELL_KNOWN,
    type: [RTD_TEXT_BYTE],
    // Status 0x02 = UTF-8, language-code length 2 ('en').
    payload: [0x02, 0x65, 0x6e, ...utf8Encode(content.label)],
  };
  return [uriRecord, textRecord];
}

// ---------------------------------------------------------------------------
// Decoding — the §9.2 three-stage detection
// ---------------------------------------------------------------------------

/**
 * Outcome of running detection over one NDEF message. Reading is always
 * interaction-free (§9.2): only `ours` is ever surfaced; every other kind is
 * dropped (at most a debug log), NEVER a user prompt.
 */
export type TagDecodeResult =
  /** Stage 1 failed: no `timeserved://box/` URI record — not our tag. */
  | { readonly kind: 'not-ours' }
  /** Stages 1–3 passed: a well-formed Time Served payload. */
  | { readonly kind: 'ours'; readonly payload: TagPayload }
  /** Our prefix, but an unknown MAJOR format version — newer app wrote it. */
  | { readonly kind: 'unsupported-version'; readonly version: number }
  /** Our prefix, but the payload fails plausibility (stage 3). */
  | { readonly kind: 'malformed'; readonly reason: string };

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Stage-3 plausibility: well-formed lowercase-normalizable UUID v4. */
export function isUuidV4(value: string): boolean {
  return UUID_V4_RE.test(value.toLowerCase());
}

/**
 * Three-stage detection (§9.2) over one NDEF message:
 *  1. scope — message contains a URI record with the `timeserved://box/` prefix,
 *     else `not-ours` (ignore silently);
 *  2. parse — extract `<box-uuid>`, `?v=` and the text-record label;
 *  3. plausibility — UUID v4 well-formed, version supported. Unknown MAJOR
 *     versions are reported as `unsupported-version` so callers can drop them
 *     gracefully (debug log, no user prompt).
 */
export function decodeBoxTag(
  records: readonly RawNdefRecord[] | null | undefined
): TagDecodeResult {
  if (!records || records.length === 0) return { kind: 'not-ours' };

  // Stage 1 — app-scope check.
  let uri: string | undefined;
  for (const record of records) {
    if (!isUriRecord(record)) continue;
    const candidate = decodeUriPayload(record.payload);
    if (candidate.startsWith(TAG_URI_PREFIX)) {
      uri = candidate;
      break;
    }
  }
  if (uri === undefined) return { kind: 'not-ours' };

  // Stage 2 — parse uuid, version and label.
  const rest = uri.slice(TAG_URI_PREFIX.length);
  const queryIndex = rest.indexOf('?');
  const uuidPart = (queryIndex === -1 ? rest : rest.slice(0, queryIndex)).trim();
  const query = queryIndex === -1 ? '' : rest.slice(queryIndex + 1);

  let versionRaw: string | undefined;
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq !== -1 && pair.slice(0, eq) === 'v') {
      versionRaw = pair.slice(eq + 1);
      break;
    }
  }

  let label: string | undefined;
  for (const record of records) {
    if (isTextRecord(record)) {
      label = decodeTextPayload(record.payload);
      break;
    }
  }

  // Stage 3 — plausibility.
  if (!isUuidV4(uuidPart)) {
    return { kind: 'malformed', reason: `box uuid is not a well-formed UUID v4: "${uuidPart}"` };
  }
  if (versionRaw === undefined || versionRaw === '') {
    return { kind: 'malformed', reason: 'missing ?v= format-version marker' };
  }
  const version = Number(versionRaw);
  if (!Number.isFinite(version)) {
    return { kind: 'malformed', reason: `unparsable format version: "${versionRaw}"` };
  }
  const major = Math.trunc(version);
  if (major !== SUPPORTED_TAG_VERSION) {
    return { kind: 'unsupported-version', version };
  }

  const payload: TagPayload = {
    boxUuid: uuidPart.toLowerCase(),
    ...(label !== undefined && label !== '' ? { label } : {}),
    version: major,
  };
  return { kind: 'ours', payload };
}

// ---------------------------------------------------------------------------
// Wizard-side helpers (write path, §9.3)
// ---------------------------------------------------------------------------

/**
 * Content classification of a tag the wizard is holding: what is on it,
 * ignoring writability (lock state comes from the NDEF status, a native
 * concern combined by AndroidTagWriter).
 */
export type NdefContentKind =
  | { readonly kind: 'blank' }
  | { readonly kind: 'ours'; readonly payload: TagPayload }
  | { readonly kind: 'foreign'; readonly summary: string };

/** Human-readable one-liner for a foreign NDEF message (overwrite warning). */
export function summarizeForeign(records: readonly RawNdefRecord[]): string {
  for (const record of records) {
    if (isUriRecord(record)) {
      const uri = decodeUriPayload(record.payload);
      if (uri !== '') return uri;
    }
  }
  for (const record of records) {
    if (isTextRecord(record)) {
      const text = decodeTextPayload(record.payload);
      if (text !== undefined && text !== '') return text;
    }
  }
  const n = records.length;
  return `${n} NDEF record${n === 1 ? '' : 's'}`;
}

/**
 * Classify what an NDEF message holds, for the wizard's tag-state report
 * (§9.3 step 2). A message that is empty or all-empty-records is `blank`;
 * a Time Served payload (any version) is `ours` when currently readable,
 * everything else `foreign`. An unsupported-version or malformed Time Served
 * URI is reported as foreign so the wizard warns before overwriting instead
 * of silently clobbering a newer tag.
 */
export function classifyNdefContent(
  records: readonly RawNdefRecord[] | null | undefined
): NdefContentKind {
  if (!records || records.length === 0) return { kind: 'blank' };
  const meaningful = records.filter((r) => r.tnf !== TNF_EMPTY || r.payload.length > 0);
  if (meaningful.length === 0) return { kind: 'blank' };

  const decoded = decodeBoxTag(records);
  if (decoded.kind === 'ours') return { kind: 'ours', payload: decoded.payload };
  return { kind: 'foreign', summary: summarizeForeign(records) };
}

/**
 * Read-back verification (§9.3): does the message on the tag now carry exactly
 * the content we intended to write?
 */
export function verifyReadBack(
  records: readonly RawNdefRecord[] | null | undefined,
  intended: BoxTagContent
): boolean {
  const decoded = decodeBoxTag(records);
  if (decoded.kind !== 'ours') return false;
  return (
    decoded.payload.boxUuid === intended.boxUuid.toLowerCase() &&
    decoded.payload.version === intended.version &&
    (decoded.payload.label ?? '') === intended.label
  );
}
