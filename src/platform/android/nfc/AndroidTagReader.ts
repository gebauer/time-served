/**
 * AndroidTagReader — `TagReader` adapter over react-native-nfc-manager
 * (BUILD_V1 §8.1/§9.2, CLAUDE.md §2).
 *
 * Foreground reader mode via `registerTagEvent`; every discovered NDEF message
 * runs the pure three-stage detection from `ndef.ts` (scope prefix → parse →
 * plausibility incl. `?v=`). Only well-formed Time Served payloads are emitted;
 * foreign tags are ignored silently, unsupported/malformed payloads are dropped
 * with a debug log — reading is ALWAYS interaction-free, never a prompt (§9.2).
 *
 * Hard platform fact (CLAUDE.md §4): Android only dispatches tags with the
 * screen on and the device unlocked. "Unlock → connect cable → place in box"
 * is part of the product; nothing here can (or tries to) work around that.
 *
 * Box RESOLUTION is not this class's job: it emits the parsed TagPayload and
 * the J9 wiring decides known-box vs auto-create-foreign.
 *
 * Two tags per box carry the identical payload, so reads of the same uuid
 * within TAG_READ_DEDUPE_WINDOW_MS collapse into one emit (see dedupe.ts and
 * docs/DEVICE_TESTS.md §J4).
 */

import NfcManager, { NfcEvents } from 'react-native-nfc-manager';
import type { TagEvent } from 'react-native-nfc-manager';

import type { TagListener, TagReader } from '../../TagReader';
import { TagReadDeduper } from './dedupe';
import { decodeBoxTag } from './ndef';

export class AndroidTagReader implements TagReader {
  private readonly listeners = new Set<TagListener>();
  private readonly deduper = new TagReadDeduper();
  private running = false;
  private nfcStarted = false;

  /** Lazily initialize the native NFC manager once per process. */
  private async ensureNfcStarted(): Promise<void> {
    if (this.nfcStarted) return;
    await NfcManager.start();
    this.nfcStarted = true;
  }

  async start(): Promise<void> {
    if (this.running) return; // idempotent
    if (!(await this.isAvailable())) {
      throw new Error('NFC is unavailable or disabled on this device');
    }
    await this.ensureNfcStarted();
    NfcManager.setEventListener(NfcEvents.DiscoverTag, (tag: TagEvent) => {
      this.onTagDiscovered(tag);
    });
    await NfcManager.registerTagEvent();
    this.running = true;
    this.deduper.reset();
  }

  async stop(): Promise<void> {
    if (!this.running) return; // idempotent
    this.running = false;
    NfcManager.setEventListener(NfcEvents.DiscoverTag, null);
    try {
      await NfcManager.unregisterTagEvent();
    } catch {
      // Already unregistered / NFC turned off meanwhile — stopping must not throw.
    }
  }

  subscribe(listener: TagListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      if (!(await NfcManager.isSupported())) return false;
      return await NfcManager.isEnabled();
    } catch {
      return false;
    }
  }

  /** §9.2 detection over one discovered tag. Interaction-free by construction. */
  private onTagDiscovered(tag: TagEvent): void {
    const result = decodeBoxTag(tag?.ndefMessage);
    switch (result.kind) {
      case 'not-ours':
        return; // stage 1 failed — not our tag, ignore silently
      case 'unsupported-version':
        // Newer MAJOR format — drop gracefully, never a user prompt (§9.1).
        console.debug(`[AndroidTagReader] ignoring tag with unsupported format version v=${result.version}`);
        return;
      case 'malformed':
        console.debug(`[AndroidTagReader] ignoring malformed Time Served tag: ${result.reason}`);
        return;
      case 'ours': {
        if (!this.deduper.shouldEmit(result.payload.boxUuid)) return;
        for (const listener of this.listeners) {
          listener(result.payload);
        }
        return;
      }
    }
  }
}
