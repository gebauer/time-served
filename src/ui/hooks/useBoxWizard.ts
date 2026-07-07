/**
 * useBoxWizard — the "Register new box" flow (BUILD_V1 §9.3) over the TagWriter
 * seam. All wizard state lives here; the screen only renders it.
 *
 * Flow: details (box UUID generated ONCE, box created with origin='own') →
 * per-tag write step (live TagState, foreign-overwrite warning, write → verify)
 * → explicit lock question (§9.4: default NO, irreversibility spelled out; a
 * "yes" runs a SECOND write step with lock=true against the still-present tag,
 * because lock bits are set within a write engagement per the TagWriter
 * contract) → "write another tag?" loop (identical payload each time).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import type { BoxId } from '../../domain/types';
import type { TagState, TagWriteResult } from '../../platform/TagReader';
import { useAppServices } from '../services/AppServicesContext';

export type WriteError = 'write-failed' | 'verify-failed' | 'lock-failed' | 'tag-lost';

export type WizardPhase =
  | { readonly step: 'details' }
  | {
      readonly step: 'write';
      readonly tag:
        | { readonly kind: 'waiting' }
        | { readonly kind: 'detected'; readonly state: TagState }
        | { readonly kind: 'writing' }
        | { readonly kind: 'error'; readonly error: WriteError };
    }
  | { readonly step: 'lock-question' }
  | { readonly step: 'locking' }
  | { readonly step: 'lock-error' }
  | { readonly step: 'another'; readonly lastTagLocked: boolean };

export interface BoxWizard {
  readonly phase: WizardPhase;
  readonly writtenCount: number;
  readonly boxLabel: string;
  /** Step 1 → create the box (UUID generated once) and start the first tag. */
  submitDetails(label: string, location: string): Promise<void>;
  /** Write the detected tag (also the explicit foreign-overwrite confirmation). */
  confirmWrite(): void;
  /** Retry after a failed write (starts a fresh write step). */
  retryWrite(): void;
  /** §9.4 lock dialog answer. */
  answerLock(lock: boolean): void;
  /** Continue after a failed lock (tag is written, just not locked). */
  acceptUnlocked(): void;
  /** Loop: write another tag with the identical payload. */
  writeAnotherTag(): void;
  /** Abort whatever step is active (screen unmount / cancel button). */
  cancel(): void;
}

const PAYLOAD_VERSION = 1;

export function useBoxWizard(): BoxWizard {
  const { repositories, tagWriter, ids, events } = useAppServices();
  const [phase, setPhase] = useState<WizardPhase>({ step: 'details' });
  const [writtenCount, setWrittenCount] = useState(0);
  const [boxLabel, setBoxLabel] = useState('');

  const boxIdRef = useRef<BoxId | undefined>(undefined);
  const labelRef = useRef('');
  const stepRef = useRef<{ proceed: () => Promise<TagWriteResult>; cancel: () => void }>(
    undefined,
  );
  const mountedRef = useRef(true);
  useEffect(
    () => () => {
      mountedRef.current = false;
      stepRef.current?.cancel();
    },
    [],
  );

  const startWriteStep = useCallback(
    (lock: boolean) => {
      const boxUuid = boxIdRef.current;
      if (boxUuid === undefined) return;
      stepRef.current?.cancel();
      if (!lock) setPhase({ step: 'write', tag: { kind: 'waiting' } });
      stepRef.current = tagWriter.beginWriteStep(
        { boxUuid, label: labelRef.current, version: PAYLOAD_VERSION, lock },
        (state) => {
          if (!mountedRef.current || lock) return;
          setPhase({ step: 'write', tag: { kind: 'detected', state } });
        },
      );
    },
    [tagWriter],
  );

  const submitDetails = useCallback(
    async (label: string, location: string) => {
      const trimmed = label.trim();
      if (trimmed.length === 0) return;
      // reason: designated creation point of the box UUID (generated once, §9.3)
      const id = ids.newId() as BoxId;
      boxIdRef.current = id;
      labelRef.current = trimmed;
      setBoxLabel(trimmed);
      await repositories.boxes.create({
        id,
        label: trimmed,
        location: location.trim().length > 0 ? location.trim() : undefined,
        countMode: 'charging',
        origin: 'own',
      });
      events.notify();
      startWriteStep(false);
    },
    [ids, repositories, events, startWriteStep],
  );

  const confirmWrite = useCallback(() => {
    const step = stepRef.current;
    if (step === undefined) return;
    setPhase({ step: 'write', tag: { kind: 'writing' } });
    void step.proceed().then((result) => {
      if (!mountedRef.current) return;
      if (result.ok) {
        setWrittenCount((count) => count + 1);
        setPhase({ step: 'lock-question' });
      } else {
        setPhase({ step: 'write', tag: { kind: 'error', error: result.error } });
      }
    });
  }, []);

  const retryWrite = useCallback(() => startWriteStep(false), [startWriteStep]);

  const answerLock = useCallback(
    (lock: boolean) => {
      if (!lock) {
        setPhase({ step: 'another', lastTagLocked: false });
        return;
      }
      setPhase({ step: 'locking' });
      startWriteStep(true);
      const step = stepRef.current;
      if (step === undefined) return;
      void step.proceed().then((result) => {
        if (!mountedRef.current) return;
        if (result.ok && result.locked) {
          setPhase({ step: 'another', lastTagLocked: true });
        } else {
          setPhase({ step: 'lock-error' });
        }
      });
    },
    [startWriteStep],
  );

  const acceptUnlocked = useCallback(() => {
    setPhase({ step: 'another', lastTagLocked: false });
  }, []);

  const writeAnotherTag = useCallback(() => startWriteStep(false), [startWriteStep]);

  const cancel = useCallback(() => {
    stepRef.current?.cancel();
    stepRef.current = undefined;
  }, []);

  return {
    phase,
    writtenCount,
    boxLabel,
    submitDetails,
    confirmWrite,
    retryWrite,
    answerLock,
    acceptUnlocked,
    writeAnotherTag,
    cancel,
  };
}
