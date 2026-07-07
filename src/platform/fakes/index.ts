/**
 * Fakes for the emulator dev harness (J8) and tests — pure TS, no native
 * imports (CLAUDE.md §6). Emulators have no NFC; these stand in for the
 * Android adapters behind the same platform seams.
 */
export { FakeTagReader } from './FakeTagReader';
export { FakeTagWriter } from './FakeTagWriter';
