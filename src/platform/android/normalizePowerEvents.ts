/**
 * Pure normalization of raw power-event candidates into the clean stream the
 * PowerStateProvider contract promises ("no STARTED twice in a row without STOPPED
 * between"). Pure TS on purpose — unit-tested on plain Node, used by
 * AndroidPowerStateProvider which merges two native sources that overlap:
 *
 *  - expo-battery's batteryStateDidChange (app foreground), and
 *  - the FGS receiver (powerDisconnected + batteryHeartbeat).
 *
 * An unplug, for example, can surface twice (FGS receiver AND expo-battery); the
 * normalizer collapses that to a single CHARGING_STOPPED.
 *
 * Rules (documented per J5 spec):
 *  - CHARGING_STARTED is emitted only when the last known state is not already
 *    "charging"; a duplicate STARTED is dropped.
 *  - CHARGING_STOPPED is emitted only when the last known state is not already
 *    "not-charging"; a duplicate STOPPED is dropped. From the initial "unknown"
 *    state a STOPPED IS emitted — a subscriber that missed the start must still
 *    hear about the unplug (reconciliation input).
 *  - CHARGING_HEARTBEAT always passes through and does NOT touch the dedupe state:
 *    heartbeats imply charging, but letting them set state="charging" would swallow
 *    a later real CHARGING_STARTED that the session machine needs to enter ACTIVE
 *    (heartbeats can arrive first when the FGS is still running from a previous
 *    session).
 *  - Timestamps pass through unchanged in every case (contract: native observation
 *    times are authoritative).
 */
import type { PowerEvent } from '../PowerStateProvider';

export type ChargeState = 'unknown' | 'charging' | 'not-charging';

export interface NormalizationResult {
  /** Dedupe state after this candidate. */
  readonly state: ChargeState;
  /** The event to forward, or null when the candidate is a duplicate. */
  readonly emit: PowerEvent | null;
}

/** Single-step normalization — pure, for tests and for the stateful wrapper below. */
export function normalizePowerEvent(
  state: ChargeState,
  candidate: PowerEvent,
): NormalizationResult {
  switch (candidate.type) {
    case 'CHARGING_STARTED':
      return state === 'charging'
        ? { state, emit: null }
        : { state: 'charging', emit: candidate };
    case 'CHARGING_STOPPED':
      return state === 'not-charging'
        ? { state, emit: null }
        : { state: 'not-charging', emit: candidate };
    case 'CHARGING_HEARTBEAT':
      return { state, emit: candidate };
  }
}

export interface PowerEventNormalizer {
  /** Returns the event to forward, or null when the candidate was a duplicate. */
  push(candidate: PowerEvent): PowerEvent | null;
}

/** Stateful convenience wrapper; one instance per subscription. */
export function createPowerEventNormalizer(): PowerEventNormalizer {
  let state: ChargeState = 'unknown';
  return {
    push(candidate: PowerEvent): PowerEvent | null {
      const result = normalizePowerEvent(state, candidate);
      state = result.state;
      return result.emit;
    },
  };
}
