/**
 * Platform fakes for the dev harness (CLAUDE.md §6). This index intentionally
 * exports ONLY J5's power/runtime fakes — J4 adds the tag-reader fakes and the
 * coordinator merges this file.
 */
export { FakePowerStateProvider } from './FakePowerStateProvider';
// The SessionRuntime fake already ships with the domain test kit (J2) — re-exported
// here so platform consumers have one import point for fakes.
export { FakeSessionRuntime } from '../../domain/testing/fakes';
