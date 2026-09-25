#!/usr/bin/env node
// Generates placeholder sprites for every dreams.json/visitors.json entry:
// a soft rounded blob in the theme's palette, no people/faces/scary shapes
// (spec §15's content constraint), as an SVG so it scales cleanly. Real
// artwork replaces these later — same "placeholder now" pattern as
// gen-icons.mjs and the M1 placeholder voice clips (plan §2.1 Q3).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONTENT_DIR = fileURLToPath(new URL('../src/content/', import.meta.url));
const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

const DREAM_COLORS = { amber: '#C98A3E', ember: '#A4502D', moss: '#6E6A34' };
const VISITOR_COLOR = '#E3B25A'; // firefly token — visitors have no color field

function blobSvg(hex) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="34" r="20" fill="${hex}" />
  <ellipse cx="26" cy="26" rx="7" ry="5" fill="${hex}" fill-opacity="0.35" />
</svg>
`;
}

function writeSprites(jsonFile, outSubdir, colorFor) {
  const items = JSON.parse(readFileSync(CONTENT_DIR + jsonFile, 'utf8'));
  const outDir = PUBLIC_DIR + outSubdir + '/';
  mkdirSync(outDir, { recursive: true });
  for (const item of items) {
    const svg = blobSvg(colorFor(item));
    writeFileSync(outDir + item.id + '.svg', svg);
  }
  console.log(`wrote ${items.length} sprite(s) to public/${outSubdir}/`);
}

writeSprites('dreams.json', 'dreams', (d) => DREAM_COLORS[d.color]);
writeSprites('visitors.json', 'visitors', () => VISITOR_COLOR);
