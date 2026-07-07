/**
 * In-memory SecureKeyValueStore for tests and the emulator dev harness.
 * Obviously not secure — never wire it into a production build.
 */
import type { SecureKeyValueStore } from './SecureKeyValueStore';

export class InMemorySecureStore implements SecureKeyValueStore {
  private readonly entries = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  /** Test helper: everything currently stored (copies, not live). */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.entries);
  }

  /** Test helper: wipe all entries. */
  clear(): void {
    this.entries.clear();
  }
}
