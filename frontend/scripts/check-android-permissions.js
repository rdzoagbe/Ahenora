#!/usr/bin/env node
/**
 * CI guard against the committed-manifest permissions trap (see
 * android/NATIVE_CONFIG.md). Fails if the native AndroidManifest declares a
 * broad media/storage permission without a `tools:node="remove"` — the exact
 * thing that got the app rejected under Google's Photo/Video Permissions policy.
 */
const fs = require('fs');
const path = require('path');

const MANIFEST = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const FORBIDDEN = [
  'android.permission.READ_MEDIA_IMAGES',
  'android.permission.READ_MEDIA_VIDEO',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
];

const xml = fs.readFileSync(MANIFEST, 'utf8');
const problems = [];

// Escape every regex metacharacter (backslash included), not just dots.
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

for (const perm of FORBIDDEN) {
  // Match the <uses-permission ...> element for this permission, if any.
  const re = new RegExp(`<uses-permission[^>]*android:name="${escapeRegExp(perm)}"[^>]*/?>`, 'g');
  const matches = xml.match(re) || [];
  for (const m of matches) {
    if (!/tools:node\s*=\s*"remove"/.test(m)) {
      problems.push(`${perm} is declared WITHOUT tools:node="remove"`);
    }
  }
}

if (problems.length) {
  console.error('❌ Android permissions guard failed:\n  ' + problems.join('\n  '));
  console.error('\nSee android/NATIVE_CONFIG.md. Broad media/storage permissions must be');
  console.error('stripped with tools:node="remove" — the app uses the system photo picker.');
  process.exit(1);
}

console.log('✅ Android permissions guard passed — no unguarded broad media/storage permissions.');
