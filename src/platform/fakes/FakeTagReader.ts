/**
 * FakeTagReader — `TagReader` for emulators and the J8 dev harness
 * (emulators have no NFC; JOBS.md §J4). Pure TS, no native imports.
 *
 * The harness drives it via `simulateTag` (inject an already-parsed payload)
 * or `simulateRawScan` (inject raw NDEF records — runs the exact same pure
 * §9.2 three-stage detection as AndroidTagReader, so foreign/malformed tags
 * are dropped just like on device). Unlike the Android reader it does NOT
 * dedupe repeated reads: the harness wants deterministic, direct control.
 */

import type { TagListener, TagPayload, TagReader } from '../TagReader';
import { decodeBoxTag } from '../android/nfc/ndef';
import type { RawNdefRecord, TagDecodeResult } from '../android/nfc/ndef';

export class FakeTagReader implements TagReader {
  private readonly listeners = new Set<TagListener>();
  private running = false;

  /** Harness knob: pretend NFC is missing/disabled. */
  available = true;

  async start(): Promise<void> {
    if (!this.available) {
      throw new Error('NFC is unavailable or disabled on this device (FakeTagReader)');
    }
    this.running = true; // idempotent
  }

  async stop(): Promise<void> {
    this.running = false; // idempotent
  }

  subscribe(listener: TagListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async isAvailable(): Promise<boolean> {
    return this.available;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Inject a parsed payload, as if a valid tag had been read. No-op unless started. */
  simulateTag(payload: TagPayload): void {
    if (!this.running) return;
    for (const listener of this.listeners) {
      listener(payload);
    }
  }

  /**
   * Inject raw NDEF records and run the real §9.2 detection over them.
   * Emits only when detection yields `ours`; returns the decode result so
   * harness/tests can assert why nothing was emitted.
   */
  simulateRawScan(records: readonly RawNdefRecord[]): TagDecodeResult {
    const result = decodeBoxTag(records);
    if (result.kind === 'ours') {
      this.simulateTag(result.payload);
    }
    return result;
  }
}
