/**
 * Icon generator.
 *
 *   node tools/make-icons.js
 *
 * Writes icons/icon{16,48,128}.png. The extension ships with no dependencies
 * and no build step, so rather than committing binary blobs nobody can edit,
 * the icons are drawn here with a small PNG encoder built on Node's zlib.
 * Change the geometry below and re-run to regenerate all three sizes.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { crc32 } = require('./lib/crc32');

/* ------------------------------------------------------------ PNG encoding */

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

/** Encode RGBA pixel data (width * height * 4 bytes) as a PNG. */
function encodePNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ------------------------------------------------------------- icon shape */

const BACKGROUND = [22, 32, 42, 255]; // #16202a
const BELL = [245, 166, 35, 255]; // #f5a623

/** Signed-distance helpers, all in 0..1 space with y running downward. */
function insideRoundedRect(x, y, radius) {
  const dx = Math.max(Math.abs(x - 0.5) - (0.5 - radius), 0);
  const dy = Math.max(Math.abs(y - 0.5) - (0.5 - radius), 0);
  return Math.hypot(dx, dy) <= radius;
}

function insideCircle(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) <= r;
}

/** The bell: handle, dome, flared skirt, rim and clapper. */
function insideBell(x, y) {
  if (insideCircle(x, y, 0.5, 0.215, 0.055)) return true; // handle
  if (insideCircle(x, y, 0.5, 0.46, 0.215) && y <= 0.46) return true; // dome

  if (y > 0.46 && y <= 0.655) {
    // Skirt flares outward as it descends.
    const t = (y - 0.46) / (0.655 - 0.46);
    const halfWidth = 0.215 + t * 0.085;
    if (Math.abs(x - 0.5) <= halfWidth) return true;
  }

  if (y > 0.655 && y <= 0.715 && Math.abs(x - 0.5) <= 0.325) return true; // rim
  if (insideCircle(x, y, 0.5, 0.795, 0.068)) return true; // clapper

  return false;
}

/** Render one size, supersampling 4x4 per pixel for smooth edges. */
function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = 4;

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let bgHits = 0;
      let bellHits = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px + (sx + 0.5) / samples) / size;
          const y = (py + (sy + 0.5) / samples) / size;
          if (!insideRoundedRect(x, y, 0.2)) continue;
          bgHits += 1;
          if (insideBell(x, y)) bellHits += 1;
        }
      }

      const total = samples * samples;
      const offset = (py * size + px) * 4;
      if (bgHits === 0) continue; // transparent outside the rounded square

      const bellRatio = bellHits / bgHits;
      for (let c = 0; c < 3; c += 1) {
        rgba[offset + c] = Math.round(
          BACKGROUND[c] * (1 - bellRatio) + BELL[c] * bellRatio
        );
      }
      rgba[offset + 3] = Math.round(255 * (bgHits / total));
    }
  }

  return encodePNG(size, size, rgba);
}

/* ------------------------------------------------------------------- main */

const outputDir = path.join(__dirname, '..', 'icons');
fs.mkdirSync(outputDir, { recursive: true });

for (const size of [16, 48, 128]) {
  const file = path.join(outputDir, `icon${size}.png`);
  fs.writeFileSync(file, renderIcon(size));
  console.log(`wrote ${path.relative(path.join(__dirname, '..'), file)} (${size}x${size})`);
}
