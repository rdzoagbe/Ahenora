#!/usr/bin/env node
/**
 * A native module cannot arrive over the air.
 *
 * `eas update` ships JavaScript to apps that already exist. Adding a dependency
 * with native code and then publishing an update sends JS that reaches for
 * something the installed binary does not contain — and the failure is not a
 * missing feature, it is the app not starting. Every install, at once, until
 * another update is published and fetched.
 *
 * That is not hypothetical either. expo-audio was added for a voice recorder,
 * merged, and published as an OTA. The recorder's module was loaded during the
 * Feed's first render, so the home screen threw on launch and the app was dead
 * for everyone on Android. A test passed for the guard that was supposed to
 * make it survivable, because the guard was tested against a mock that threw a
 * JavaScript error — which is not what a missing native module does.
 *
 * The person who made that mistake believed the whole time that they had it
 * covered. So this is not a reminder; it is a gate.
 *
 * native-modules.json is the list of packages with native code that the SHIPPED
 * binaries were built from. Adding one to package.json fails this check until
 * the list is updated deliberately — and updating the list is the moment to
 * remember that a new binary has to go to the stores before the JS that needs
 * it goes anywhere.
 *
 * Run in CI, and before every build:  node scripts/check-native-deps.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = path.join(ROOT, 'package.json');
const MANIFEST = path.join(ROOT, 'native-modules.json');
const MODULES = path.join(ROOT, 'node_modules');

function fail(lines) {
  console.error('\n' + lines.join('\n') + '\n');
  process.exit(1);
}

/**
 * A package ships native code if it declares an Expo module or carries an
 * android/ or ios/ directory. Checked against what is actually installed
 * rather than guessed from the name: react-native-svg is native, and
 * react-native-web is not.
 */
function isNative(name) {
  const base = path.join(MODULES, name);
  for (const marker of ['expo-module.config.json', 'android', 'ios']) {
    if (fs.existsSync(path.join(base, marker))) return true;
  }
  return false;
}

const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
const declared = Object.keys(pkg.dependencies || {}).sort();

if (!fs.existsSync(MODULES)) {
  fail([
    'node_modules is missing, so native packages cannot be identified.',
    'Run `npm install` before this check.',
  ]);
}

const installed = declared.filter(isNative);

if (!fs.existsSync(MANIFEST)) {
  fail([
    'native-modules.json is missing.',
    '',
    'It records which native packages the shipped binaries were built from.',
    'Create it with the current set:',
    '',
    `  ${JSON.stringify({ nativeDependencies: installed }, null, 2)}`,
  ]);
}

const expected = (JSON.parse(fs.readFileSync(MANIFEST, 'utf8')).nativeDependencies || []).sort();

const added = installed.filter((n) => !expected.includes(n));
const removed = expected.filter((n) => !installed.includes(n));

if (added.length) {
  fail([
    'A NATIVE dependency was added. This cannot ship over the air.',
    '',
    `  added: ${added.join(', ')}`,
    '',
    'An over-the-air update sends JavaScript to binaries that already exist.',
    'They do not contain this module, so JS that reaches for it does not fail',
    'politely — the app stops starting, for everyone, until another update is',
    'published and fetched.',
    '',
    'If that is understood and intended:',
    '  1. Add it to frontend/native-modules.json',
    '  2. Build and ship a binary containing it, to BOTH stores',
    '  3. Only then let JavaScript that needs it reach anybody',
    '',
    'If it is not intended, remove the dependency.',
  ]);
}

if (removed.length) {
  fail([
    'A native dependency in native-modules.json is no longer installed.',
    '',
    `  missing: ${removed.join(', ')}`,
    '',
    'Removing native code is also a new binary, not an update. If it was taken',
    'out on purpose, drop it from frontend/native-modules.json in the same',
    'change.',
  ]);
}

console.log(`native dependencies agree with native-modules.json (${installed.length})`);
