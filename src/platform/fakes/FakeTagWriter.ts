/**
 * FakeTagWriter — scriptable `TagWriter` for the J8 dev harness and tests
 * (emulators have no NFC). Pure TS, no native imports.
 *
 * Script the physical world, then run the wizard flow against it:
 *  - `queueTag(state)` — the next `beginWriteStep` "detects" this tag;
 *  - `presentTag(state)` — present a tag to an already-waiting step;
 *  - `failNextProceed(error)` — force the next `proceed()` to fail;
 *  - `writes` — log of successfully "written" requests for assertions.
 *
 * Semantics mirror AndroidTagWriter: locked-foreign tags refuse the write;
 * cancel() makes proceed() report `tag-lost`; lock bits are only "set" when
 * `request.lock === true` (§9.4 — never automatic).
 */

import type { TagState, TagWriteRequest, TagWriteResult, TagWriter } from '../TagReader';

type FailableError = 'write-failed' | 'verify-failed' | 'lock-failed' | 'tag-lost';

export class FakeTagWriter implements TagWriter {
  /** Tags waiting to be detected by future beginWriteStep calls. */
  private readonly tagQueue: TagState[] = [];
  /** Set when a step is waiting for a tag that has not been presented yet. */
  private waitingStep: ((state: TagState) => void) | undefined;
  private forcedError: FailableError | undefined;

  /** Successfully written requests, in order. */
  readonly writes: TagWriteRequest[] = [];

  queueTag(state: TagState): void {
    if (this.waitingStep) {
      const deliver = this.waitingStep;
      this.waitingStep = undefined;
      deliver(state);
      return;
    }
    this.tagQueue.push(state);
  }

  /** Alias for presenting a tag to a step that is already waiting. */
  presentTag(state: TagState): void {
    this.queueTag(state);
  }

  failNextProceed(error: FailableError): void {
    this.forcedError = error;
  }

  beginWriteStep(
    request: TagWriteRequest,
    onTagState: (state: TagState) => void
  ): { proceed: () => Promise<TagWriteResult>; cancel: () => void } {
    let cancelled = false;
    let abortDetection: (() => void) | undefined;

    const detection = new Promise<TagState | null>((resolve) => {
      abortDetection = () => resolve(null);
      const deliver = (state: TagState) => {
        if (cancelled) {
          resolve(null);
          return;
        }
        onTagState(state);
        resolve(state);
      };
      const queued = this.tagQueue.shift();
      if (queued !== undefined) {
        // Deliver asynchronously, like a real tag discovery.
        queueMicrotask(() => deliver(queued));
      } else {
        this.waitingStep = deliver;
      }
    });

    const proceed = async (): Promise<TagWriteResult> => {
      // Like the real writer: proceed waits for the tag if none arrived yet.
      const state = await detection;
      if (cancelled || state === null) {
        return { ok: false, error: 'tag-lost' };
      }
      if (this.forcedError !== undefined) {
        const error = this.forcedError;
        this.forcedError = undefined;
        return { ok: false, error };
      }
      if (state.kind === 'locked-foreign') {
        return { ok: false, error: 'write-failed' };
      }
      this.writes.push(request);
      return { ok: true, verified: true, locked: request.lock === true };
    };

    const cancel = (): void => {
      cancelled = true;
      if (this.waitingStep) {
        // The step stops waiting; a later queueTag goes to the queue instead.
        this.waitingStep = undefined;
      }
      abortDetection?.();
    };

    return { proceed, cancel };
  }
}
