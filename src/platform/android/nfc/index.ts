/**
 * Android NFC adapters (J4). `AndroidTagReader` / `AndroidTagWriter` are the
 * native implementations of the `TagReader` / `TagWriter` seams; `ndef.ts` and
 * `dedupe.ts` are pure and shared with the fakes/tests.
 */
export { AndroidTagReader } from './AndroidTagReader';
export { AndroidTagWriter } from './AndroidTagWriter';
export {
  TAG_URI_PREFIX,
  SUPPORTED_TAG_VERSION,
  buildBoxUri,
  encodeBoxTagMessage,
  decodeBoxTag,
  classifyNdefContent,
  verifyReadBack,
} from './ndef';
export type { RawNdefRecord, TagDecodeResult, NdefContentKind, BoxTagContent } from './ndef';
export { TagReadDeduper, TAG_READ_DEDUPE_WINDOW_MS } from './dedupe';
