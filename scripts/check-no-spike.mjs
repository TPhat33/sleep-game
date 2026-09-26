#!/usr/bin/env node
// Release hygiene (plan §6 M5): fails the build if dist/ contains the M0
// platform-spike page or its bundle. Run after `vite build` with
// VITE_INCLUDE_SPIKE unset (vite.config.ts only bundles spike.html when
// that var is '1').
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const DIST_DIR = fileURLToPath(new URL('../dist/', import.meta.url));
const SPIKE_HTML = path.join(DIST_DIR, 'spike.html');
const ASSETS_DIR = path.join(DIST_DIR, 'assets');

if (!existsSync(DIST_DIR)) {
  console.error(`check-no-spike: ${DIST_DIR} does not exist — run the build first.`);
  process.exit(1);
}

const problems = [];

if (existsSync(SPIKE_HTML)) {
  problems.push('dist/spike.html exists');
}

if (existsSync(ASSETS_DIR)) {
  const spikeAssets = readdirSync(ASSETS_DIR).filter((name) => name.startsWith('spike-'));
  for (const name of spikeAssets) problems.push(`dist/assets/${name} exists`);
}

if (problems.length > 0) {
  console.error('check-no-spike: release build must not include the platform spike:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('(set VITE_INCLUDE_SPIKE=1 only for internal/QA builds, never for release)');
  process.exit(1);
}

console.log('check-no-spike: OK — no spike page/assets in dist/.');
