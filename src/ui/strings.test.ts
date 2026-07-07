import { describe, expect, it } from 'vitest';

import { fill, strings } from './strings';

/** Walk the strings tree and collect every leaf with its path. */
function leaves(node: unknown, path: string): { path: string; value: unknown }[] {
  if (typeof node === 'string') return [{ path, value: node }];
  if (Array.isArray(node)) {
    return node.flatMap((item, index) => leaves(item, `${path}[${index}]`));
  }
  if (typeof node === 'object' && node !== null) {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, `${path}.${key}`));
  }
  return [{ path, value: node }];
}

describe('strings table', () => {
  const all = leaves(strings, 'strings');

  it('contains only non-empty strings (i18n-ready shape)', () => {
    for (const { path, value } of all) {
      expect(typeof value, `${path} must be a string`).toBe('string');
      expect((value as string).trim().length, `${path} must not be empty`).toBeGreaterThan(0);
    }
  });

  it('has no leftover TODO/FIXME placeholders', () => {
    for (const { path, value } of all) {
      expect(String(value), `${path} looks unfinished`).not.toMatch(/TODO|FIXME|XXX/);
    }
  });

  it('pins the spec-mandated copy verbatim', () => {
    // BUILD_V1 §11 screen 1 (IDLE) and the exact consent meaning (JOBS.md J8).
    expect(strings.home.idleTitle).toBe('Leg dein Handy in eine Box');
    expect(strings.groups.consentLabel).toBe('Diese Gruppe darf meine täglichen Summen sehen');
    // §9.4: irreversibility spelled out, explicit question.
    expect(strings.wizard.lockQuestion).toContain('sperren');
    expect(strings.wizard.lockWarning).toContain('nicht rückgängig');
  });
});

describe('fill', () => {
  it('replaces named placeholders', () => {
    expect(fill('Hallo {name}, {count} neu', { name: 'Jan', count: 3 })).toBe(
      'Hallo Jan, 3 neu',
    );
  });

  it('leaves unknown placeholders untouched', () => {
    expect(fill('{missing} bleibt', {})).toBe('{missing} bleibt');
  });
});
