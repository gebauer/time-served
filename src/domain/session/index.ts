/**
 * Session state machine (BUILD_V1 §6/§7) — public surface of `domain/session`.
 *
 * J9 wiring consumes:
 * - `createSessionEngine(deps)` → `{ getState, dispatch(event) }` — the one
 *   entry point for all domain events;
 * - `reconcile(machineState, deps)` if it needs reconciliation outside the
 *   engine (the engine already runs it on APP_RESUMED);
 * - `reduce` / `Effect` / `Transition` for tests and tooling.
 */
export { createSessionEngine, type SessionEngine, type SessionEngineDeps } from './engine';
export { reconcile, type ReconcileDeps, type ReconcileResult } from './reconcile';
export { reduce, type Effect, type Transition } from './reducer';
