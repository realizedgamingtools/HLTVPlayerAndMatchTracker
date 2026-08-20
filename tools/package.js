/**
 * Release packager.
 *
 *   node tools/package.js
 *
 * Writes dist/hltv-player-match-tracker-<version>.zip with manifest.json at the archive
 * root, which is what Chrome and Edge expect. Runs the release checks first so
 * a broken manifest cannot be packaged.
 *
 * ZIP is written by hand for the same reason the icons are: the extension has
 * no dependencies, and a store-compatible archive is a few dozen lines of
 * deflate plus a central directory.
 */
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { crc32 } = require('./lib/crc32');

const ROOT = path.join(__dirname, '..');

/** Everything the browser loads. Tests, tooling and docs stay out. */
const INCLUDE = ['manifest.json', 'icons', 'src'];

/* ------------------------------------------------------------ zip writing */

/** MS-DOS date/time, as ZIP has stored timestamps since 1989. */
function dosDateTime(date) {
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function buildZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf8');
    const compressed = zlib.deflateRawSync(entry.data, { level: 9 });
    const { time, day } = dosDateTime(entry.date);
    const checksum = crc32(entry.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field length

    localParts.push(local, nameBytes, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(8, 10); // deflate
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attributes
    central.writeUInt32LE(0, 38); // external attributes
    central.writeUInt32LE(offset, 42); // offset of local header

    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory
  end.writeUInt16LE(0, 4); // disk number
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([...localParts, centralDirectory, end]);
}

/* ------------------------------------------------------------------- main */

// Never package something that fails its own release checks.
execFileSync(process.execPath, [path.join(__dirname, 'validate.js')], { stdio: 'inherit' });

function collect(relative, out = []) {
  const absolute = path.join(ROOT, relative);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) {
    out.push({
      // ZIP entries always use forward slashes, on every platform.
      name: relative.split(path.sep).join('/'),
      data: fs.readFileSync(absolute),
      date: stat.mtime
    });
    return out;
  }
  for (const child of fs.readdirSync(absolute).sort()) {
    collect(path.join(relative, child), out);
  }
  return out;
}

const entries = INCLUDE.flatMap((item) => collect(item));
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

const distDir = path.join(ROOT, 'dist');
fs.mkdirSync(distDir, { recursive: true });
const outputPath = path.join(distDir, `hltv-player-match-tracker-${manifest.version}.zip`);
fs.writeFileSync(outputPath, buildZip(entries));

const size = fs.statSync(outputPath).size;
console.log(`\nPackaged ${entries.length} files into dist/${path.basename(outputPath)} (${size} bytes)`);
for (const entry of entries) console.log(`  ${entry.name}`);
