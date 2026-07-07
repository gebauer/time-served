import { defineConfig } from 'vitest/config';

/**
 * Domain tests run on PLAIN NODE — no React Native, no native modules. That this
 * works at every milestone is the proof the architecture stayed portable
 * (CLAUDE.md §8/§9). Data-layer contract tests against real WatermelonDB get their
 * own jest environment in J3; this config is for src/domain/**.
 */
export default defineConfig({
  test: {
    include: [
      'src/domain/**/*.test.ts',
      'src/data/**/*.test.ts',
      // J4: pure NDEF codec + fakes tests — no native modules, plain Node.
      'src/platform/**/*.test.ts',
    ],
    environment: 'node',
  },
});
