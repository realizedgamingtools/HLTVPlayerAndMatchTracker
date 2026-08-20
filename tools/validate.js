/**
 * Release checks.
 *
 *   node tools/validate.js
 *
 * Catches the class of mistake that unit tests cannot: a manifest that points
 * at a file that does not exist, a script with a syntax error that only shows
 * up when Chrome loads it, or a permission added without a note in the README.
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const problems = [];
const notes = [];

function fail(message) {
  problems.push(message);
}

function exists(relative) {
  return fs.existsSync(path.join(ROOT, relative));
}

/* --------------------------------------------------------------- manifest */

const manifestPath = path.join(ROOT, 'manifest.json');
let manifest;

try {
  manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  notes.push(`manifest.json parsed (v${manifest.version}, manifest_version ${manifest.manifest_version})`);
} catch (error) {
  fail(`manifest.json is not valid JSON: ${error.message}`);
  console.error(problems.join('\n'));
  process.exit(1);
}

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) fail('version must be x.y.z');

/* ------------------------------------------- every referenced file exists */

const referenced = new Set();

function reference(relative, label) {
  if (!relative) return;
  referenced.add(relative);
  if (!exists(relative)) fail(`${label} references a missing file: ${relative}`);
}

reference(manifest.background && manifest.background.service_worker, 'background.service_worker');
reference(manifest.action && manifest.action.default_popup, 'action.default_popup');

for (const [size, file] of Object.entries(manifest.icons || {})) {
  reference(file, `icons.${size}`);
}
for (const [size, file] of Object.entries((manifest.action && manifest.action.default_icon) || {})) {
  reference(file, `action.default_icon.${size}`);
}

for (const [index, script] of (manifest.content_scripts || []).entries()) {
  for (const file of script.js || []) reference(file, `content_scripts[${index}].js`);
  for (const file of script.css || []) reference(file, `content_scripts[${index}].css`);
  if (!Array.isArray(script.matches) || script.matches.length === 0) {
    fail(`content_scripts[${index}] has no matches`);
  }
}

notes.push(`${referenced.size} manifest file references resolved`);

/* --------------------------------------------------- javascript parses ok */

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(relative));
    else if (entry.name.endsWith('.js')) out.push(relative);
  }
  return out;
}

const scripts = [...walk('src'), ...walk('tools'), ...walk('test')];
for (const relative of scripts) {
  const source = fs.readFileSync(path.join(ROOT, relative), 'utf8');
  try {
    // Compile without running: catches syntax errors in every shipped script.
    new vm.Script(source, { filename: relative });
  } catch (error) {
    fail(`${relative} has a syntax error: ${error.message}`);
  }
}
notes.push(`${scripts.length} JavaScript files compiled cleanly`);

/* ---------------------------------------- popup script tags resolve too */

const popupPath = manifest.action && manifest.action.default_popup;
if (popupPath && exists(popupPath)) {
  const html = fs.readFileSync(path.join(ROOT, popupPath), 'utf8');
  const popupDir = path.posix.dirname(popupPath);
  const assetPattern = /(?:src|href)\s*=\s*"([^"]+)"/g;
  let asset;
  let checked = 0;
  while ((asset = assetPattern.exec(html)) !== null) {
    const target = asset[1];
    if (/^(https?:|data:|#)/.test(target)) continue;
    const resolved = path.posix.normalize(path.posix.join(popupDir, target));
    checked += 1;
    if (!exists(resolved)) fail(`${popupPath} references a missing asset: ${target}`);
  }
  notes.push(`${checked} popup asset references resolved`);
}

/* --------------------------------------------------- permission hygiene */

const declared = new Set(manifest.permissions || []);
const EXPECTED = new Set(['storage', 'notifications']);

for (const permission of declared) {
  if (!EXPECTED.has(permission)) {
    fail(`unexpected permission "${permission}" — document it in the README before shipping`);
  }
}
for (const permission of EXPECTED) {
  if (!declared.has(permission)) fail(`missing expected permission "${permission}"`);
}
if (manifest.host_permissions && manifest.host_permissions.length > 0) {
  fail('host_permissions should stay empty until Phase 3 background fetching');
}
notes.push(`permissions reviewed: ${[...declared].join(', ')}`);

/* ------------------------------------------------------------------ report */

for (const note of notes) console.log(`  ok    ${note}`);

if (problems.length > 0) {
  console.log('');
  for (const problem of problems) console.log(`  FAIL  ${problem}`);
  console.log(`\n${problems.length} problem(s) found`);
  process.exit(1);
}

console.log('\nAll release checks passed.');
