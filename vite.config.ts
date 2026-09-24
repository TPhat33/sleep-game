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
        spike: fileURLToPath(new URL('./spike.html', import.meta.url)),
      },
    },
  },
});
