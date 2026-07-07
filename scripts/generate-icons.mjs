/**
 * App icon / splash generator (J11) — dependency-free (node:zlib only).
 * Regenerate with:  node scripts/generate-icons.mjs
 *
 * Design (flat, honest, no gradients): deep-slate ground, a charging box drawn
 * as lid bar + body; the body is split sun-yellow / moon-blue — the day-lock /
 * night-lock split that is the app's signature visual (BUILD_V1 §11 screen 2).
 * Colors come from src/ui/theme.ts (lightPalette.day / .night / .text).
 *
 * Outputs (paths referenced by app.config.ts):
 *  - assets/icon.png                     1024², full-bleed slate + glyph (iOS/base)
 *  - assets/android-icon-foreground.png  1024², glyph on transparent, safe-zone scaled
 *  - assets/android-icon-background.png  1024², solid slate
 *  - assets/android-icon-monochrome.png  1024², white glyph on transparent
 *  - assets/splash-icon.png              1024², glyph on transparent
 *  - assets/favicon.png                  64²,   miniature of the icon
 */
import { Buffer } from 'node:buffer';
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets');

// --- palette (mirrors src/ui/theme.ts) --------------------------------------
const SLATE = [0x1d, 0x25, 0x30]; // lightPalette.text — the "deep slate"
const YELLOW = [0xf5, 0xb9, 0x42]; // lightPalette.day
const BLUE = [0x4a, 0x6f, 0xa5]; // lightPalette.night
const LID = [0xc4, 0xcf, 0xdc]; // darkPalette.action (light slate)
const WHITE = [0xff, 0xff, 0xff];

// --- minimal PNG encoder (RGBA8, filter 0) -----------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 4)] = 0; // filter: none
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- SDF rendering ------------------------------------------------------------
/** Signed distance to a rounded rectangle (center cx/cy, half-extents hw/hh). */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(ox, oy) - r;
}

/** 0..1 coverage from an SDF value with ~1px anti-aliasing. */
const coverage = (d) => Math.min(1, Math.max(0, 0.5 - d));

/** Source-over composite of [r,g,b,alpha0..1] onto dst array. */
function over(dst, src) {
  const a = src[3];
  if (a <= 0) return;
  const outA = a + dst[3] * (1 - a);
  if (outA === 0) return;
  for (let i = 0; i < 3; i++) dst[i] = (src[i] * a + dst[i] * dst[3] * (1 - a)) / outA;
  dst[3] = outA;
}

/**
 * The box glyph in a virtual 1024-canvas, centered on (512, 532):
 * lid bar + body split yellow|blue. `scale` shrinks around the center
 * (adaptive-icon safe zone); `mono` renders everything white.
 */
function glyph(x, y, scale, mono) {
  const cx = 512;
  const cy = 532;
  const px = cx + (x - cx) / scale;
  const py = cy + (y - cy) / scale;
  const out = [0, 0, 0, 0];

  // Lid: wide thin bar (the slot the phone disappears into).
  const lid = coverage(sdRoundRect(px, py, 512, 318, 280, 38, 38));
  over(out, [...(mono ? WHITE : LID), lid]);

  // Body: rounded rect below the lid, split day|night at the center line.
  const body = coverage(sdRoundRect(px, py, 512, 592, 240, 200, 48));
  if (body > 0) {
    // Anti-aliased vertical split (2px blend).
    const t = Math.min(1, Math.max(0, (px - 512) / 2 + 0.5));
    const color = mono
      ? WHITE
      : [
          YELLOW[0] * (1 - t) + BLUE[0] * t,
          YELLOW[1] * (1 - t) + BLUE[1] * t,
          YELLOW[2] * (1 - t) + BLUE[2] * t,
        ];
    over(out, [...color, body]);
  }
  return out;
}

/** Render a scene(x, y) → [r,g,b,a0..1] into an RGBA buffer, 3×3 supersampled. */
function render(size, scene) {
  const px = Buffer.alloc(size * size * 4);
  const ss = 3;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) * 1024) / size;
          const v = ((y + (sy + 0.5) / ss) * 1024) / size;
          const c = scene(u, v);
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const n = ss * ss;
      const o = (y * size + x) * 4;
      px[o] = a > 0 ? Math.round(r / a) : 0;
      px[o + 1] = a > 0 ? Math.round(g / a) : 0;
      px[o + 2] = a > 0 ? Math.round(b / a) : 0;
      px[o + 3] = Math.round((a / n) * 255);
    }
  }
  return px;
}

// --- scenes -------------------------------------------------------------------
const sceneIcon = (x, y) => {
  const out = [...SLATE, 1];
  over(out, glyph(x, y, 0.82, false));
  return out;
};
const sceneForeground = (x, y) => glyph(x, y, 0.52, false); // adaptive safe zone
const sceneBackground = () => [...SLATE, 1];
const sceneMonochrome = (x, y) => glyph(x, y, 0.52, true);
const sceneSplash = (x, y) => glyph(x, y, 0.9, false);

// --- write --------------------------------------------------------------------
const outputs = [
  ['icon.png', 1024, sceneIcon],
  ['android-icon-foreground.png', 1024, sceneForeground],
  ['android-icon-background.png', 1024, sceneBackground],
  ['android-icon-monochrome.png', 1024, sceneMonochrome],
  ['splash-icon.png', 1024, sceneSplash],
  ['favicon.png', 64, sceneIcon],
];

for (const [name, size, scene] of outputs) {
  const path = join(OUT, name);
  writeFileSync(path, encodePng(size, size, render(size, scene)));
  console.log(`wrote ${path} (${size}×${size})`);
}
