import { fileURLToPath, URL } from 'node:url';
import { execSync } from 'node:child_process';

import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

import { cspPlugin } from './vite-plugin-csp.ts';

function buildId(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return `dev-${String(Date.now())}`;
  }
}

// Release hygiene (plan §6 M5): a production build only bundles spike.html
// when VITE_INCLUDE_SPIKE=1 is explicitly set — unset (the default) means a
// release build never ships the M0 platform-spike page at all. This only
// affects `vite build`; `vite dev` serves spike.html on request regardless,
// same as any other file in the project root.
const includeSpike = process.env.VITE_INCLUDE_SPIKE === '1';

export default defineConfig({
  base: './',
  plugins: [vue(), cspPlugin()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __BUILD_ID__: JSON.stringify(buildId()),
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...(includeSpike ? { spike: fileURLToPath(new URL('./spike.html', import.meta.url)) } : {}),
      },
    },
  },
});
