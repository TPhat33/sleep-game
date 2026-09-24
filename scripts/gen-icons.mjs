#!/usr/bin/env node
// Generates placeholder app icons: a #0B0806 square with a centered #E3B25A
// (firefly amber) dot. Deterministic, no dependencies beyond Node's zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const OUT_DIR = fileURLToPath(new URL('../public/icons/', import.meta.url));
const BG = [0x0b, 0x08, 0x06];
const DOT = [0xe3, 0xb2, 0x5a];

function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = makeCrcTable());
  let crc = 0xffffffff;
  for (const byte of buf) {
    c = table[(crc ^ byte) & 0xff];
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function makeCrcTable() {
  const table = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function renderIcon(size) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.28;
  const glowR = size * 0.42;

  const raw = Buffer.alloc(size * (1 + size * 3));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // no filter
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let rgb = BG;
      if (dist < r) {
        rgb = DOT;
      } else if (dist < glowR) {
        const t = 1 - (dist - r) / (glowR - r);
        const k = t * t * 0.5;
        rgb = [
          Math.round(BG[0] + (DOT[0] - BG[0]) * k),
          Math.round(BG[1] + (DOT[1] - BG[1]) * k),
          Math.round(BG[2] + (DOT[2] - BG[2]) * k),
        ];
      }
      raw[o++] = rgb[0];
      raw[o++] = rgb[1];
      raw[o++] = rgb[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = deflateSync(raw);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of [192, 512]) {
  const png = renderIcon(size);
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  writeFileSync(file, png);
  console.log(`wrote ${file} (${png.length} bytes)`);
}
