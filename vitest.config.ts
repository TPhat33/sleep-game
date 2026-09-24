process.env.TZ = 'Asia/Bangkok';

import { defineConfig, mergeConfig } from 'vitest/config';

import viteConfig from './vite.config.ts';

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: ['tests/unit/**/*.test.ts'],
      setupFiles: ['tests/setup.ts'],
      restoreMocks: true,
      coverage: {
        provider: 'v8',
        include: ['src/core/**', 'src/platform/**', 'src/audio/**', 'src/store/**'],
        thresholds: {
          'src/core/**': { lines: 90, branches: 85 },
        },
      },
    },
  }),
);
