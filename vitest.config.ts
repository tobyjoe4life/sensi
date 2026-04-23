/// <reference types="vitest" />
/**
 * sensi M1 Step 5 — Vitest configuration for main-process unit tests.
 *
 * Tests run under plain Node, not Electron, so any `electron` imports must
 * be mocked at the test level (`vi.mock('electron', ...)`). The `@providers`
 * and `@shared` aliases mirror vite.config.mts and root tsconfig.json so the
 * shared type modules and the standard-cloud-models registry resolve from
 * test files just like they do from production code.
 *
 * Coverage is reported via the v8 provider against the M1 surface only —
 * no need to instrument the entire 14k-line main process tree, just the
 * MiniMax additive edits and the M1 step 4 classes/methods.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@shared':    path.resolve(__dirname, './electron/shared'),
      '@providers': path.resolve(__dirname, './electron/providers'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['electron/__tests__/**/*.test.ts'],
    // Exclude renderer/Vite-side test directories — those will be added
    // separately if/when we wire up Playwright or React Testing Library.
    exclude: ['node_modules/**', 'dist/**', 'dist-electron/**', 'release/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      // Restrict instrumentation to the M1 surface so the report focuses on
      // the new code without drowning in untested upstream paths.
      include: [
        'electron/providers/types.ts',
        'electron/shared/standardCloudModels.ts',
        'electron/services/CredentialsManager.ts',
      ],
      // LLMHelper.ts is excluded because it pulls in heavy native deps
      // (sharp, @google/genai, etc.) that we partially mock — instrumenting
      // the whole file would skew the coverage number. The MiniMax edits
      // there are exercised functionally via the unit tests in this suite,
      // and tracked manually in the M1 task report.
      exclude: ['**/__tests__/**', '**/*.d.ts'],
    },
  },
});
