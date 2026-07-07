/**
 * Seal-scheduler triggers (J10). V1 decision: FOREGROUND-ONLY triggers, no
 * WorkManager/expo-background-task —
 *
 *  - at app launch (services bootstrap calls attachSealTriggers),
 *  - whenever the app returns to the foreground (AppState → 'active'),
 *  - a light timer that fires when the local seal hour (~12:00) passes while
 *    the app is open.
 *
 * Why no background task: sealing is lazy by design — a day only needs to be
 * uploaded *eventually*, and every pipeline step is idempotent, so "next time
 * the user opens the app" is a perfectly good trigger. Expo SDK 57's
 * expo-background-task (WorkManager, ≥15-min granularity, OS-discretionary)
 * adds a native module + config plugin for a marginal freshness win; on the
 * OEM-killed-process worst case it is not reliable either. Revisit in J11 if
 * "seal without opening the app" becomes a requirement.
 *
 * This module imports react-native and must only be pulled in from the
 * composition root (services.ts) — never from tests or domain/ui code.
 */
import { AppState } from 'react-native';

import type { Clock, EpochMs } from '../../domain/types';
import { nextSealInstant } from './sealTiming';

export interface SealTriggerDeps {
  readonly runOnce: () => Promise<unknown>;
  readonly clock: Clock;
  readonly timeZone: () => string;
  /** Re-read per scheduling — the Settings value is tunable. */
  readonly sealHourLocal: () => number;
  /** Debounce between trigger-driven runs (default 60 s). */
  readonly minIntervalMs?: number;
}

export function attachSealTriggers(deps: SealTriggerDeps): () => void {
  const minInterval = deps.minIntervalMs ?? 60_000;
  let lastRunAt: EpochMs | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let detached = false;

  function maybeRun(): void {
    const now = deps.clock.now();
    if (lastRunAt !== undefined && now - lastRunAt < minInterval) return;
    lastRunAt = now;
    void deps.runOnce();
  }

  function schedule(): void {
    if (detached) return;
    if (timer !== undefined) clearTimeout(timer);
    const now = deps.clock.now();
    const at = nextSealInstant(now, deps.timeZone(), deps.sealHourLocal());
    // Wall-clock delay; +5 s slack so we land safely past the boundary. RN
    // timers do not fire in the background — the AppState trigger covers that.
    timer = setTimeout(() => {
      maybeRun();
      schedule();
    }, at - now + 5_000);
  }

  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      maybeRun();
      schedule(); // re-anchor: the timer slept while backgrounded
    }
  });

  maybeRun(); // launch trigger
  schedule();

  return () => {
    detached = true;
    subscription.remove();
    if (timer !== undefined) clearTimeout(timer);
  };
}
