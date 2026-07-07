/**
 * Pure-codec tests for the §9.2 three-stage detection and §9.3 write helpers.
 * Runs on plain Node — mocks only raw NDEF record byte/TNF structures, never
 * nfc-manager APIs (the codec is the part that must stay portable).
 */
import { describe, expect, it } from 'vitest';

import {
  buildBoxUri,
  classifyNdefContent,
  decodeBoxTag,
  decodeTextPayload,
  decodeUriPayload,
  encodeBoxTagMessage,
  isUuidV4,
  summarizeForeign,
  TAG_URI_PREFIX,
  TNF_EMPTY,
  TNF_WELL_KNOWN,
  utf8Decode,
  utf8Encode,
  verifyReadBack,
} from './ndef';
import type { RawNdefRecord } from './ndef';
import { TagReadDeduper } from './dedupe';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

function utf8(text: string): number[] {
  return utf8Encode(text);
}

/** Raw URI record exactly as Android delivers it (byte-array type). */
function uriRecord(uri: string, identifierCode = 0x00): RawNdefRecord {
  return { tnf: TNF_WELL_KNOWN, type: [0x55], payload: [identifierCode, ...utf8(uri)] };
}

/** Raw text record: status byte (UTF-8, lang len 2) + 'en' + text. */
function textRecord(text: string): RawNdefRecord {
  return { tnf: TNF_WELL_KNOWN, type: [0x54], payload: [0x02, 0x65, 0x6e, ...utf8(text)] };
}

function validMessage(label = 'Küche'): RawNdefRecord[] {
  return [uriRecord(`${TAG_URI_PREFIX}${UUID}?v=1`), textRecord(label)];
}

describe('utf8 helpers', () => {
  it('round-trips ascii, umlauts and astral code points', () => {
    for (const s of ['box', 'Küche', 'Wohnzimmer 🔒', 'ß€']) {
      expect(utf8Decode(utf8Encode(s))).toBe(s);
    }
  });
});

describe('decodeBoxTag — three-stage detection (§9.2)', () => {
  it('accepts a valid payload (URI + text record)', () => {
    const result = decodeBoxTag(validMessage('Küche'));
    expect(result).toEqual({
      kind: 'ours',
      payload: { boxUuid: UUID, label: 'Küche', version: 1 },
    });
  });

  it('normalizes an uppercase uuid to lowercase', () => {
    const result = decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${UUID.toUpperCase()}?v=1`), textRecord('A')]);
    expect(result.kind).toBe('ours');
    if (result.kind === 'ours') expect(result.payload.boxUuid).toBe(UUID);
  });

  it('ignores a foreign URI silently (stage 1: not-ours)', () => {
    // https:// via the standard prefix abbreviation byte 0x04
    const foreign = { tnf: TNF_WELL_KNOWN, type: [0x55], payload: [0x04, ...utf8('example.com')] };
    expect(decodeBoxTag([foreign, textRecord('hello')])).toEqual({ kind: 'not-ours' });
  });

  it('treats a text-only or empty message as not-ours', () => {
    expect(decodeBoxTag([textRecord('just text')])).toEqual({ kind: 'not-ours' });
    expect(decodeBoxTag([])).toEqual({ kind: 'not-ours' });
    expect(decodeBoxTag(null)).toEqual({ kind: 'not-ours' });
    expect(decodeBoxTag(undefined)).toEqual({ kind: 'not-ours' });
  });

  it('accepts a uri-only message (label optional)', () => {
    const result = decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${UUID}?v=1`)]);
    expect(result).toEqual({ kind: 'ours', payload: { boxUuid: UUID, version: 1 } });
    if (result.kind === 'ours') expect(result.payload.label).toBeUndefined();
  });

  it('rejects a malformed uuid (stage 3)', () => {
    const result = decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}not-a-uuid?v=1`)]);
    expect(result.kind).toBe('malformed');
  });

  it('rejects a non-v4 uuid (stage 3)', () => {
    // version nibble 1 instead of 4
    const v1uuid = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
    const result = decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${v1uuid}?v=1`)]);
    expect(result.kind).toBe('malformed');
  });

  it('drops an unknown MAJOR version gracefully (v=2 → unsupported-version, no prompt)', () => {
    const result = decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${UUID}?v=2`), textRecord('A')]);
    expect(result).toEqual({ kind: 'unsupported-version', version: 2 });
  });

  it('accepts a minor-version bump within major 1 (v=1.5)', () => {
    const result = decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${UUID}?v=1.5`)]);
    expect(result.kind).toBe('ours');
    if (result.kind === 'ours') expect(result.payload.version).toBe(1);
  });

  it('rejects a missing or unparsable ?v= marker', () => {
    expect(decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${UUID}`)]).kind).toBe('malformed');
    expect(decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${UUID}?v=`)]).kind).toBe('malformed');
    expect(decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${UUID}?v=abc`)]).kind).toBe('malformed');
  });

  it('finds v among other query params', () => {
    const result = decodeBoxTag([uriRecord(`${TAG_URI_PREFIX}${UUID}?x=1&v=1`)]);
    expect(result.kind).toBe('ours');
  });

  it('handles string-typed record types ("U"/"T") as some platforms deliver them', () => {
    const records: RawNdefRecord[] = [
      { tnf: TNF_WELL_KNOWN, type: 'U', payload: [0x00, ...utf8(`${TAG_URI_PREFIX}${UUID}?v=1`)] },
      { tnf: TNF_WELL_KNOWN, type: 'T', payload: [0x02, 0x65, 0x6e, ...utf8('Büro')] },
    ];
    expect(decodeBoxTag(records)).toEqual({
      kind: 'ours',
      payload: { boxUuid: UUID, label: 'Büro', version: 1 },
    });
  });
});

describe('encodeBoxTagMessage / round-trip (§9.1)', () => {
  it('encodes URI + text records that decode back to the same payload', () => {
    const records = encodeBoxTagMessage({ boxUuid: UUID, label: 'Schlafzimmer', version: 1 });
    expect(records).toHaveLength(2);
    expect(records[0].tnf).toBe(TNF_WELL_KNOWN);
    expect(records[0].type).toEqual([0x55]);
    expect(records[0].payload[0]).toBe(0x00); // no URI abbreviation for a custom scheme
    expect(records[1].type).toEqual([0x54]);

    expect(decodeBoxTag(records)).toEqual({
      kind: 'ours',
      payload: { boxUuid: UUID, label: 'Schlafzimmer', version: 1 },
    });
  });

  it('builds the exact §9.1 URI', () => {
    expect(buildBoxUri(UUID.toUpperCase(), 1)).toBe(`timeserved://box/${UUID}?v=1`);
  });
});

describe('classifyNdefContent (wizard tag-state, §9.3)', () => {
  it('classifies empty / all-empty-record messages as blank', () => {
    expect(classifyNdefContent(null)).toEqual({ kind: 'blank' });
    expect(classifyNdefContent([])).toEqual({ kind: 'blank' });
    expect(classifyNdefContent([{ tnf: TNF_EMPTY, type: [], payload: [] }])).toEqual({ kind: 'blank' });
  });

  it('classifies our payload as ours', () => {
    const result = classifyNdefContent(validMessage('Flur'));
    expect(result.kind).toBe('ours');
  });

  it('classifies foreign NDEF as foreign with a readable summary', () => {
    const foreign = [{ tnf: TNF_WELL_KNOWN, type: [0x55], payload: [0x04, ...utf8('example.com')] }];
    expect(classifyNdefContent(foreign)).toEqual({ kind: 'foreign', summary: 'https://example.com' });
  });

  it('classifies a malformed/newer Time Served tag as foreign (warn before overwrite)', () => {
    const newer = [uriRecord(`${TAG_URI_PREFIX}${UUID}?v=2`)];
    const result = classifyNdefContent(newer);
    expect(result.kind).toBe('foreign');
  });

  it('summarizes text-only foreign messages by their text, others by record count', () => {
    expect(summarizeForeign([textRecord('shopping list')])).toBe('shopping list');
    expect(summarizeForeign([{ tnf: 0x02, type: utf8('text/x-vcard'), payload: utf8('BEGIN:VCARD') }])).toBe(
      '1 NDEF record'
    );
  });
});

describe('verifyReadBack (§9.3 read-back verification)', () => {
  const intended = { boxUuid: UUID, label: 'Küche', version: 1 };

  it('accepts the exact intended content', () => {
    expect(verifyReadBack(encodeBoxTagMessage(intended), intended)).toBe(true);
  });

  it('rejects a different uuid, label or version, and unreadable messages', () => {
    const otherUuid = 'a1b2c3d4-e5f6-4a0b-8c0d-1e2f3a4b5c6d';
    expect(verifyReadBack(encodeBoxTagMessage({ ...intended, boxUuid: otherUuid }), intended)).toBe(false);
    expect(verifyReadBack(encodeBoxTagMessage({ ...intended, label: 'Bad' }), intended)).toBe(false);
    expect(verifyReadBack([uriRecord(`${TAG_URI_PREFIX}${UUID}?v=2`)], intended)).toBe(false);
    expect(verifyReadBack(null, intended)).toBe(false);
  });
});

describe('payload decoding helpers', () => {
  it('decodes URI prefix abbreviation codes', () => {
    expect(decodeUriPayload([0x00, ...utf8('timeserved://box/x')])).toBe('timeserved://box/x');
    expect(decodeUriPayload([0x01, ...utf8('example.com')])).toBe('http://www.example.com');
    expect(decodeUriPayload([])).toBe('');
  });

  it('decodes UTF-8 text payloads with language codes', () => {
    expect(decodeTextPayload([0x02, 0x64, 0x65, ...utf8('Küche')])).toBe('Küche');
    expect(decodeTextPayload([])).toBeUndefined();
  });

  it('decodes UTF-16BE text payloads (foreign tags)', () => {
    // status: UTF-16 flag + lang len 2, 'en', then "Hi" as UTF-16BE
    expect(decodeTextPayload([0x82, 0x65, 0x6e, 0x00, 0x48, 0x00, 0x69])).toBe('Hi');
  });
});

describe('isUuidV4', () => {
  it('accepts v4 uuids in either case, rejects everything else', () => {
    expect(isUuidV4(UUID)).toBe(true);
    expect(isUuidV4(UUID.toUpperCase())).toBe(true);
    expect(isUuidV4('not-a-uuid')).toBe(false);
    expect(isUuidV4('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false); // v1
    expect(isUuidV4(`${UUID}x`)).toBe(false);
    expect(isUuidV4('')).toBe(false);
  });
});

describe('TagReadDeduper — two tags per box, one TAG_READ (CLAUDE.md §4)', () => {
  it('suppresses a same-uuid re-read inside the window, emits after it', () => {
    let t = 0;
    const dedupe = new TagReadDeduper(3_000, () => t);
    expect(dedupe.shouldEmit(UUID)).toBe(true);
    t = 1_500; // second tag of the same box grazed while placing the phone
    expect(dedupe.shouldEmit(UUID)).toBe(false);
    t = 2_999;
    expect(dedupe.shouldEmit(UUID)).toBe(false);
    t = 3_000;
    expect(dedupe.shouldEmit(UUID)).toBe(true);
  });

  it('does not slide the window on suppressed reads', () => {
    let t = 0;
    const dedupe = new TagReadDeduper(3_000, () => t);
    dedupe.shouldEmit(UUID);
    t = 2_000;
    dedupe.shouldEmit(UUID); // suppressed — must NOT restart the window
    t = 3_200;
    expect(dedupe.shouldEmit(UUID)).toBe(true);
  });

  it('always emits a different uuid immediately, and after reset()', () => {
    let t = 0;
    const other = 'a1b2c3d4-e5f6-4a0b-8c0d-1e2f3a4b5c6d';
    const dedupe = new TagReadDeduper(3_000, () => t);
    expect(dedupe.shouldEmit(UUID)).toBe(true);
    t = 100;
    expect(dedupe.shouldEmit(other)).toBe(true);
    t = 200;
    dedupe.reset();
    expect(dedupe.shouldEmit(other)).toBe(true);
  });
});
