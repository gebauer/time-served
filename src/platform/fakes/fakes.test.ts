/**
 * FakeTagReader / FakeTagWriter tests — plain Node, no native modules
 * (that they run here is the point of the fakes).
 */
import { describe, expect, it } from 'vitest';

import type { TagPayload, TagState, TagWriteRequest } from '../TagReader';
import { encodeBoxTagMessage, TNF_WELL_KNOWN, utf8Encode } from '../android/nfc/ndef';
import { FakeTagReader, FakeTagWriter } from './index';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const PAYLOAD: TagPayload = { boxUuid: UUID, label: 'Küche', version: 1 };

function writeRequest(overrides: Partial<TagWriteRequest> = {}): TagWriteRequest {
  return { boxUuid: UUID, label: 'Küche', version: 1, lock: false, ...overrides };
}

describe('FakeTagReader', () => {
  it('emits simulated payloads to subscribers while started', async () => {
    const reader = new FakeTagReader();
    const seen: TagPayload[] = [];
    reader.subscribe((p) => seen.push(p));
    await reader.start();
    reader.simulateTag(PAYLOAD);
    expect(seen).toEqual([PAYLOAD]);
  });

  it('does not emit before start or after stop, and unsubscribe works', async () => {
    const reader = new FakeTagReader();
    const seen: TagPayload[] = [];
    const unsubscribe = reader.subscribe((p) => seen.push(p));

    reader.simulateTag(PAYLOAD); // not started yet
    await reader.start();
    await reader.stop();
    reader.simulateTag(PAYLOAD); // stopped
    expect(seen).toEqual([]);

    await reader.start();
    unsubscribe();
    reader.simulateTag(PAYLOAD); // unsubscribed
    expect(seen).toEqual([]);
  });

  it('start rejects and isAvailable reports false when NFC is scripted off', async () => {
    const reader = new FakeTagReader();
    reader.available = false;
    await expect(reader.isAvailable()).resolves.toBe(false);
    await expect(reader.start()).rejects.toThrow(/unavailable/);
  });

  it('simulateRawScan runs the real detection: ours emits, foreign/malformed do not', async () => {
    const reader = new FakeTagReader();
    const seen: TagPayload[] = [];
    reader.subscribe((p) => seen.push(p));
    await reader.start();

    const ours = reader.simulateRawScan(encodeBoxTagMessage({ boxUuid: UUID, label: 'Büro', version: 1 }));
    expect(ours.kind).toBe('ours');
    expect(seen).toHaveLength(1);
    expect(seen[0].boxUuid).toBe(UUID);

    const foreign = reader.simulateRawScan([
      { tnf: TNF_WELL_KNOWN, type: [0x55], payload: [0x04, ...utf8Encode('example.com')] },
    ]);
    expect(foreign.kind).toBe('not-ours');

    const malformed = reader.simulateRawScan([
      { tnf: TNF_WELL_KNOWN, type: [0x55], payload: [0x00, ...utf8Encode('timeserved://box/nope?v=1')] },
    ]);
    expect(malformed.kind).toBe('malformed');

    expect(seen).toHaveLength(1); // still only the valid one
  });
});

describe('FakeTagWriter', () => {
  it('reports a queued tag state and writes on proceed (no lock by default)', async () => {
    const writer = new FakeTagWriter();
    writer.queueTag({ kind: 'blank' });

    const states: TagState[] = [];
    const request = writeRequest();
    const step = writer.beginWriteStep(request, (s) => states.push(s));
    const result = await step.proceed();

    expect(states).toEqual([{ kind: 'blank' }]);
    expect(result).toEqual({ ok: true, verified: true, locked: false });
    expect(writer.writes).toEqual([request]);
  });

  it('locks ONLY when request.lock === true (§9.4)', async () => {
    const writer = new FakeTagWriter();
    writer.queueTag({ kind: 'blank' });
    const step = writer.beginWriteStep(writeRequest({ lock: true }), () => {});
    await expect(step.proceed()).resolves.toEqual({ ok: true, verified: true, locked: true });
  });

  it('supports presenting the tag AFTER the step started waiting', async () => {
    const writer = new FakeTagWriter();
    const states: TagState[] = [];
    const step = writer.beginWriteStep(writeRequest(), (s) => states.push(s));
    const pending = step.proceed(); // waits for a tag like the real writer

    writer.presentTag({ kind: 'foreign', summary: 'https://example.com' });
    await expect(pending).resolves.toEqual({ ok: true, verified: true, locked: false });
    expect(states).toEqual([{ kind: 'foreign', summary: 'https://example.com' }]);
  });

  it('refuses to write a locked-foreign tag', async () => {
    const writer = new FakeTagWriter();
    writer.queueTag({ kind: 'locked-foreign' });
    const step = writer.beginWriteStep(writeRequest(), () => {});
    await expect(step.proceed()).resolves.toEqual({ ok: false, error: 'write-failed' });
    expect(writer.writes).toEqual([]);
  });

  it('cancel aborts cleanly: proceed reports tag-lost, no state is delivered', async () => {
    const writer = new FakeTagWriter();
    const states: TagState[] = [];
    const step = writer.beginWriteStep(writeRequest(), (s) => states.push(s));
    step.cancel();
    writer.queueTag({ kind: 'blank' }); // arrives after cancel — goes to the queue
    await expect(step.proceed()).resolves.toEqual({ ok: false, error: 'tag-lost' });
    expect(states).toEqual([]);
    expect(writer.writes).toEqual([]);
  });

  it('failNextProceed forces the scripted error exactly once', async () => {
    const writer = new FakeTagWriter();
    writer.queueTag({ kind: 'blank' });
    writer.queueTag({ kind: 'blank' });
    writer.failNextProceed('verify-failed');

    const step1 = writer.beginWriteStep(writeRequest(), () => {});
    await expect(step1.proceed()).resolves.toEqual({ ok: false, error: 'verify-failed' });

    const step2 = writer.beginWriteStep(writeRequest(), () => {});
    await expect(step2.proceed()).resolves.toEqual({ ok: true, verified: true, locked: false });
  });
});
