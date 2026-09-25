import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettierConfig from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const clockFiles = ['src/core/clock.ts', 'src/core/rng.ts', 'src/platform/**', 'src/spike/**'];
const platformFiles = ['src/platform/**'];
const coreFiles = ['src/core/**'];
const sceneFiles = ['src/scene/**', 'src/ui/screens/Pond.vue'];
const configFile = 'src/core/config.ts';

export default defineConfig(
  {
    ignores: [
      'dist',
      'coverage',
      'android',
      'ios',
      'playwright-report',
      'test-results',
      'public',
      'node_modules',
      '**/*.tsbuildinfo',
      'scripts/**/*.mjs',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
      globals: { ...globals.browser, ...globals.node, __BUILD_ID__: 'readonly' },
    },
  },
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  // Spec §0: every time-dependent module receives a Clock; never touch raw timers/Date.now
  // directly, and never use Math.random outside rng.ts, so tests stay deterministic.
  {
    files: ['src/**/*.ts', 'src/**/*.vue'],
    ignores: clockFiles,
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'setTimeout', message: 'Use an injected Clock instead of the global timer.' },
        { name: 'setInterval', message: 'Use an injected Clock instead of the global timer.' },
        { name: 'clearTimeout', message: 'Use an injected Clock instead of the global timer.' },
        { name: 'clearInterval', message: 'Use an injected Clock instead of the global timer.' },
        { name: 'requestAnimationFrame', message: 'Use the Pixi ticker or an injected Clock.' },
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Use clock.now() instead of Date.now().' },
        {
          object: 'performance',
          property: 'now',
          message: 'performance.now() stops advancing while iOS sleeps; use clock.now().',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'Use an injected Rng instead of Math.random().',
        },
        { object: 'window', property: 'setTimeout', message: 'Use an injected Clock instead.' },
        { object: 'window', property: 'setInterval', message: 'Use an injected Clock instead.' },
        { object: 'globalThis', property: 'setTimeout', message: 'Use an injected Clock instead.' },
        {
          object: 'globalThis',
          property: 'setInterval',
          message: 'Use an injected Clock instead.',
        },
      ],
    },
  },
  // Spec §0: every native call goes through the Platform interface.
  {
    files: ['src/**/*.ts', 'src/**/*.vue'],
    ignores: platformFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@capacitor/*'], message: 'Native calls must go through src/platform/.' },
            {
              group: ['@capacitor-community/*'],
              message: 'Native calls must go through src/platform/.',
            },
            { group: ['@capgo/*'], message: 'Native calls must go through src/platform/.' },
          ],
        },
      ],
    },
  },
  // Keep src/core pure: no framework, no DOM libs, no other layers.
  {
    files: coreFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['vue', 'pixi.js', 'idb'],
              message: 'src/core must stay framework/DOM-lib free.',
            },
            {
              group: [
                '**/ui/**',
                '**/scene/**',
                '**/audio/**',
                '**/platform/**',
                '**/store/**',
                '**/app/**',
              ],
              message: 'src/core cannot depend on other layers.',
            },
          ],
        },
      ],
    },
  },
  // Keep Pixi contained to the scene layer.
  {
    files: ['src/**/*.ts', 'src/**/*.vue'],
    ignores: sceneFiles,
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['pixi.js'], message: 'Pixi is only used in src/scene/.' }] },
      ],
    },
  },
  // No enums (spec favors string-literal unions).
  {
    files: ['src/**/*.ts', 'src/**/*.vue'],
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: 'TSEnumDeclaration', message: 'Use a string-literal union instead of enum.' },
      ],
    },
  },
  // Tunables live only in config.ts.
  {
    files: ['src/core/**', 'src/audio/**'],
    ignores: [configFile],
    rules: {
      '@typescript-eslint/no-magic-numbers': [
        'error',
        {
          ignore: [-1, 0, 1, 2, 100, 1000, 60000],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: false,
        },
      ],
    },
  },
  {
    files: ['src/**/*.ts', 'src/**/*.vue'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  // Tests may use fixtures/literals, call the platform/timer APIs directly,
  // and assert into fixed-shape arrays without re-deriving noUncheckedIndexedAccess guards.
  {
    files: ['tests/**/*.ts'],
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-magic-numbers': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['*.ts'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      'no-restricted-globals': 'off',
      'no-restricted-properties': 'off',
    },
  },
  // spec §3's file tree names screens Home.vue, Pond.vue, Sky.vue, etc. —
  // single words by design; they're routed by App.vue, never used as
  // arbitrary custom elements, so the HTML-tag-clash this rule guards
  // against doesn't apply here.
  {
    files: ['src/ui/screens/**/*.vue'],
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
  prettierConfig,
);
