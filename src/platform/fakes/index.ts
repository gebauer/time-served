/**
 * Fakes for the emulator dev harness (J8) and tests — pure TS, no native
 * imports (CLAUDE.md §6). Emulators have no NFC and no real plug events; these
 * stand in for the Android adapters behind the same platform seams.
 */
export { FakeTagReader } from './FakeTagReader';
export { FakeTagWriter } from './FakeTagWriter';
export { FakePowerStateProvider } from './FakePowerStateProvider';
// The SessionRuntime fake already ships with the domain test kit (J2) — re-exported
// here so platform consumers have one import point for fakes.
export { FakeSessionRuntime } from '../../domain/testing/fakes';
