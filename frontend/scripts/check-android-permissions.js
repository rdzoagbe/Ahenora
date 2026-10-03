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

// Drawing over other apps. React Native's dev menu needs it, so the DEBUG
// manifest declares it; a release build has no business asking for it, and
// Google asks for a justification when it appears (audit, 2026-10-02).
if (/<uses-permission[^>]*android:name="android\.permission\.SYSTEM_ALERT_WINDOW"(?![^>]*tools:node="remove")[^>]*\/?>/.test(xml)) {
  problems.push('SYSTEM_ALERT_WINDOW is declared in the main (release) manifest; it belongs in src/debug only');
}

// The committed android/ folder is what builds, and app.json only mirrors it.
// Two settings drifted apart once already: the system bars were forced dark
// while the app follows the phone's setting.
const appJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo;
const strings = fs.readFileSync(
  path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml'), 'utf8');
const style = (strings.match(/name="expo_system_ui_user_interface_style"[^>]*>([^<]*)</) || [])[1];
if (style && appJson.userInterfaceStyle && style !== appJson.userInterfaceStyle) {
  problems.push(`strings.xml interface style "${style}" differs from app.json userInterfaceStyle "${appJson.userInterfaceStyle}"`);
}
const manifestPrefixes = [...xml.matchAll(/android:host="ahenora\.com"\s+android:pathPrefix="([^"]+)"/g)].map((m) => m[1]).sort();
const mirrored = ((appJson.android || {}).intentFilters || [])
  .flatMap((f) => f.data || []).filter((d) => d.host === 'ahenora.com').map((d) => d.pathPrefix).sort();
if (JSON.stringify(manifestPrefixes) !== JSON.stringify(mirrored)) {
  problems.push(`invitation link paths differ: manifest ${manifestPrefixes.join(',')} vs app.json ${mirrored.join(',')}`);
}

if (problems.length) {
  console.error('❌ Android permissions guard failed:\n  ' + problems.join('\n  '));
  console.error('\nSee android/NATIVE_CONFIG.md. Broad media/storage permissions must be');
  console.error('stripped with tools:node="remove" — the app uses the system photo picker.');
  process.exit(1);
}

console.log('✅ Android permissions guard passed — no unguarded broad media/storage permissions, no overlay permission, native config matches app.json.');
