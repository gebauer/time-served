/**
 * AndroidTagWriter — `TagWriter` adapter over react-native-nfc-manager.
 *
 * The registration wizard's SERVICE layer (BUILD_V1 §9.3) — no UI here.
 * Writing is never reactive: this class is only ever driven by the explicit
 * "Register new box" wizard. One `beginWriteStep` = one physical tag:
 *
 *   1. wait for a tag (`requestTechnology`), classify what is on it
 *      (blank / foreign NDEF / ours / locked-foreign) and report via
 *      `onTagState` — the wizard uses that to warn before overwriting;
 *   2. `proceed()` writes the NDEF message (URI + text record, identical for
 *      every tag of a box), verifies by READ-BACK, and only if
 *      `request.lock === true` sets the permanent lock bits (`makeReadOnly`).
 *      Locking is NEVER automatic — §9.4: irreversible, explicit user
 *      confirmation only, default is not to lock;
 *   3. `cancel()` aborts the step and releases the NFC tech request.
 *
 * Run the wizard with the passive AndroidTagReader stopped (J9 wiring):
 * a tech request and reader-mode dispatch must not compete for the same tag.
 */

import NfcManager, { Ndef, NdefStatus, NfcTech } from 'react-native-nfc-manager';
import type { NdefRecord } from 'react-native-nfc-manager';

import type { TagState, TagWriteRequest, TagWriteResult, TagWriter } from '../../TagReader';
import { classifyNdefContent, encodeBoxTagMessage, verifyReadBack } from './ndef';
import type { RawNdefRecord } from './ndef';

/** Our raw records are structurally valid NdefRecords; TS just cannot narrow
 *  `tnf: number` to the literal-union TNF type, hence the assertion. */
function toNativeRecords(records: RawNdefRecord[]): NdefRecord[] {
  return records as NdefRecord[];
}

interface DetectedTag {
  readonly state: TagState;
  /** True when the tag matched NdefFormatable (factory tag with no NDEF yet). */
  readonly needsFormat: boolean;
  /** True when the NDEF is not writable (locked). */
  readonly readOnly: boolean;
}

export class AndroidTagWriter implements TagWriter {
  beginWriteStep(
    request: TagWriteRequest,
    onTagState: (state: TagState) => void
  ): { proceed: () => Promise<TagWriteResult>; cancel: () => void } {
    let cancelled = false;

    // Waits for a tag, classifies it, reports state. Resolves null when the
    // step was cancelled or the tag vanished before detection completed.
    const detection: Promise<DetectedTag | null> = (async () => {
      try {
        const tech = await NfcManager.requestTechnology([NfcTech.Ndef, NfcTech.NdefFormatable]);
        if (cancelled) return null;

        if (tech === NfcTech.NdefFormatable) {
          // Factory tag without an NDEF message — blank by definition.
          const detected: DetectedTag = { state: { kind: 'blank' }, needsFormat: true, readOnly: false };
          onTagState(detected.state);
          return detected;
        }

        const tag = await NfcManager.getTag();
        let readOnly = false;
        try {
          const status = await NfcManager.ndefHandler.getNdefStatus();
          readOnly = status.status === NdefStatus.ReadOnly;
        } catch {
          // Status not readable on some tags; assume writable and let the
          // write itself fail if not.
        }

        const content = classifyNdefContent(tag?.ndefMessage);
        let state: TagState;
        if (content.kind === 'ours') {
          // A locked tag of OURS is still fully usable for reading; report it
          // as ours so the wizard can offer re-link/relabel (§9.3) — a write
          // attempt on it will fail cleanly.
          state = content;
        } else if (readOnly) {
          state = { kind: 'locked-foreign' };
        } else {
          state = content; // blank | foreign
        }
        onTagState(state);
        return { state, needsFormat: false, readOnly };
      } catch {
        // requestTechnology rejects on cancel / NFC off / tag lost.
        return null;
      }
    })();

    const proceed = async (): Promise<TagWriteResult> => {
      try {
        const detected = await detection;
        if (detected === null || cancelled) {
          return { ok: false, error: 'tag-lost' };
        }
        if (detected.readOnly) {
          // Locked tags cannot be (re)written — defensive; the wizard should
          // not offer proceed on locked-foreign at all.
          return { ok: false, error: 'write-failed' };
        }

        const content = {
          boxUuid: request.boxUuid,
          label: request.label,
          version: request.version,
        };
        const bytes = Ndef.encodeMessage(toNativeRecords(encodeBoxTagMessage(content)));

        // Write.
        try {
          if (detected.needsFormat) {
            await NfcManager.ndefFormatableHandlerAndroid.formatNdef(bytes, { readOnly: false });
            // After formatting, reconnect on the Ndef tech for read-back.
            await NfcManager.cancelTechnologyRequest();
            await NfcManager.requestTechnology(NfcTech.Ndef);
          } else {
            await NfcManager.ndefHandler.writeNdefMessage(bytes);
          }
        } catch {
          return { ok: false, error: 'write-failed' };
        }

        // Verify by read-back (§9.3) — never trust a write blindly.
        try {
          const readBack = await NfcManager.ndefHandler.getNdefMessage();
          if (!verifyReadBack(readBack?.ndefMessage, content)) {
            return { ok: false, error: 'verify-failed' };
          }
        } catch {
          return { ok: false, error: 'verify-failed' };
        }

        // Lock bits — ONLY on explicit request (§9.4). Irreversible.
        let locked = false;
        if (request.lock === true) {
          try {
            await NfcManager.ndefHandler.makeReadOnly();
            locked = true;
          } catch {
            return { ok: false, error: 'lock-failed' };
          }
        }

        return { ok: true, verified: true, locked };
      } finally {
        await NfcManager.cancelTechnologyRequest().catch(() => {});
      }
    };

    const cancel = (): void => {
      cancelled = true;
      // Aborts a pending requestTechnology and releases a held tag session.
      NfcManager.cancelTechnologyRequest().catch(() => {});
    };

    return { proceed, cancel };
  }
}
