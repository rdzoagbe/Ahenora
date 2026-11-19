#!/usr/bin/env node
/**
 * Which packages with NATIVE code change between two versions of the app.
 *
 *   node scripts/list-native-versions.js main          # main vs. this checkout
 *   node scripts/list-native-versions.js main HEAD     # main vs. a commit
 *
 * Exit 0: no native package changed. Exit 1: some did (listed), so this change
 * needs new binaries on both stores before its JavaScript ships. Exit 2: could
 * not tell.
 *
 * Why it exists: frontend/scripts/check-native-deps.js guards the NAMES of
 * native packages. It cannot see a new VERSION of one we already ship, and a
 * version moves native code just as surely: expo 57.0.8 -> 57.0.32 moves
 * expo-modules-core 57.0.7 -> 57.0.25. See runbooks/STORE-BUILD-checklist.md.
 *
 * Versions come from the two package-lock.json files, read through git, so the
 * answer does not depend on what happens to be installed, and it sees every
 * install path, nested copies included (node_modules/expo/node_modules/...).
 * Whether a package is native is read from the installed tree, with the same
 * markers check-native-deps.js uses (expo-module.config.json, android/, ios/),
 * plus a .podspec at the package's root. react-native itself has none of the
 * first three (its code is in ReactAndroid/ and React/), so without the podspec
 * marker 0.86.0 -> 0.86.3 went unreported on 2026-11-13.
 * A changed package that is not installed here cannot be classified and is
 * reported as such, never assumed safe.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const FRONTEND = path.join(REPO, 'frontend');
const LOCK = 'frontend/package-lock.json';
const MARKERS = ['expo-module.config.json', 'android', 'ios'];
// Packages with no native code of their own that GENERATE the native build:
// the Gradle plugin and codegen for Android, and the config plugins that
// write the iOS project (there is no committed ios/; EAS prebuilds it). A new
// version of one changes the binary as surely as a native module does.
const NATIVE_BUILD_TOOLS = new Set([
  '@react-native/gradle-plugin', '@react-native/codegen',
  '@expo/config-plugins', '@expo/prebuild-config',
]);
const isNative = (dir) =>
  MARKERS.some((m) => fs.existsSync(path.join(dir, m)))
  || fs.readdirSync(dir).some((f) => f.endsWith('.podspec'));

function die(msg) {
  console.error(`list-native-versions: ${msg}`);
  process.exit(2);
}

function lockAt(ref) {
  try {
    const text = ref
      ? execFileSync('git', ['show', `${ref}:${LOCK}`], { cwd: REPO, encoding: 'utf8', maxBuffer: 1 << 28 })
      : fs.readFileSync(path.join(REPO, LOCK), 'utf8');
    return JSON.parse(text).packages || {};
  } catch (e) {
    return die(`cannot read ${LOCK} at ${ref || 'the working tree'}: ${e.message.split('\n')[0]}`);
  }
}

// The installed packages by name: all of them, and the native ones.
function installedNames() {
  const all = new Set();
  const names = new Set();
  const seen = new Set();
  const walk = (modules) => {
    if (!fs.existsSync(modules)) return;
    for (const entry of fs.readdirSync(modules)) {
      if (entry.startsWith('.')) continue;
      const dirs = entry.startsWith('@')
        ? fs.readdirSync(path.join(modules, entry)).map((s) => path.join(modules, entry, s))
        : [path.join(modules, entry)];
      for (const dir of dirs) {
        if (seen.has(dir) || !fs.existsSync(path.join(dir, 'package.json'))) continue;
        seen.add(dir);
        const { name } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        all.add(name);
        if (NATIVE_BUILD_TOOLS.has(name) || isNative(dir)) names.add(name);
        walk(path.join(dir, 'node_modules'));
      }
    }
  };
  const top = path.join(FRONTEND, 'node_modules');
  if (!fs.existsSync(top)) die('frontend/node_modules is missing: run `cd frontend && npm ci` first.');
  walk(top);
  return { all, native: names };
}

const nameOf = (lockPath) => lockPath.slice(lockPath.lastIndexOf('node_modules/') + 'node_modules/'.length);

const [baseRef, headRef] = process.argv.slice(2);
if (!baseRef) die('usage: node scripts/list-native-versions.js <base-ref> [<head-ref>]');

const base = lockAt(baseRef);
const head = lockAt(headRef);
const { all: installed, native } = installedNames();

const changed = [];
const unknown = [];
for (const p of new Set([...Object.keys(base), ...Object.keys(head)])) {
  if (!p.includes('node_modules/')) continue;
  const from = base[p] && base[p].version;
  const to = head[p] && head[p].version;
  if (from === to) continue;
  const name = nameOf(p);
  const line = `${p}: ${from || '(none)'} -> ${to || '(removed)'}`;
  if (native.has(name)) changed.push(line);
  else if (!installed.has(name)) unknown.push(line);
}

const against = `${baseRef} -> ${headRef || 'working tree'}`;
if (changed.length === 0 && unknown.length === 0) {
  console.log(`No native package changed (${against}).`);
  process.exit(0);
}
if (changed.length) {
  console.log(`Native packages that change (${against}): new binaries needed.`);
  for (const l of changed.sort()) console.log(`  ${l}`);
}
if (unknown.length) {
  console.log('Changed, but not installed here, so not classified. Check each by hand:');
  for (const l of unknown.sort()) console.log(`  ${l}`);
}
process.exit(1);
