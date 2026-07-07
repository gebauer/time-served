/**
 * Read-dedupe for the two-tags-per-box design (CLAUDE.md §4): both tags carry
 * the identical payload, and dropping the phone into the box can graze both
 * within a second or two. Two reads of the SAME box uuid inside the window
 * collapse into a single emit; a different uuid always emits immediately.
 *
 * The window is measured from the last EMITTED read (it does not slide on
 * suppressed reads), so a phone resting on a tag that re-triggers discovery
 * emits at most once per window rather than never again.
 *
 * Pure TS so it is unit-testable on Node (documented in docs/DEVICE_TESTS.md §J4).
 */

export const TAG_READ_DEDUPE_WINDOW_MS = 3_000;

export class TagReadDeduper {
  private lastUuid: string | undefined;
  private lastEmittedAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly windowMs: number = TAG_READ_DEDUPE_WINDOW_MS,
    private readonly now: () => number = Date.now
  ) {}

  /** True if this read should be emitted; records it as emitted if so. */
  shouldEmit(boxUuid: string, at: number = this.now()): boolean {
    if (boxUuid === this.lastUuid && at - this.lastEmittedAt < this.windowMs) {
      return false;
    }
    this.lastUuid = boxUuid;
    this.lastEmittedAt = at;
    return true;
  }

  reset(): void {
    this.lastUuid = undefined;
    this.lastEmittedAt = Number.NEGATIVE_INFINITY;
  }
}
