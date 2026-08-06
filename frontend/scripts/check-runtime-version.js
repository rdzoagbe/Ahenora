#!/usr/bin/env node
/**
 * The OTA lane has to be the same lane at both ends.
 *
 * `eas update` publishes at the runtimeVersion in app.json. The installed app
 * reports the one baked into res/values/strings.xml, via the manifest's
 * EXPO_RUNTIME_VERSION meta-data. expo-updates applies an update only when the
 * two match — and when they do not, it does not error, warn, or retry. The
 * update simply never arrives, on every device, forever.
 *
 * That is exactly what happened here. app.json went to "2.0.0" on 2026-07-28
 * for the SDK 57 upgrade; strings.xml stayed "1.0.0" because this is a bare
 * workflow and `expo prebuild` — the thing that would have copied it across —
 * is deliberately never run, since it rewrites tracked native files. For nine
 * days every publish reported success and reached nobody. Three separate bug
 * fixes were shipped, re-tested by hand, and declared broken, because the
 * phone was still running a bundle from July.
 *
 * There was no signal anywhere: no failing build, no red check, no log line.
 * This is that signal.
 *
 * Run before every AAB, and in CI:  node scripts/check-runtime-version.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_JSON = path.join(ROOT, 'app.json');
const STRINGS = path.join(ROOT, 'android', 'app', 'src', 'main', 'res', 'values', 'strings.xml');
const GRADLE = path.join(ROOT, 'android', 'app', 'build.gradle');

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

const app = JSON.parse(fs.readFileSync(APP_JSON, 'utf8')).expo;
const strings = fs.readFileSync(STRINGS, 'utf8');
const gradle = fs.readFileSync(GRADLE, 'utf8');

const declared = strings.match(/<string name="expo_runtime_version">([^<]+)<\/string>/);
if (!declared) fail('No expo_runtime_version in strings.xml — expo-updates has no runtime to report.');

if (declared[1].trim() !== String(app.runtimeVersion).trim()) {
  fail(
    `Runtime version mismatch — every OTA update would be undeliverable.\n` +
    `    app.json  runtimeVersion : ${app.runtimeVersion}   (what "eas update" publishes AT)\n` +
    `    strings.xml              : ${declared[1]}   (what the installed app REPORTS)\n\n` +
    `  expo-updates only applies an update whose runtime matches the build's.\n` +
    `  Mismatched, updates are published successfully and silently reach nobody.\n\n` +
    `  Fix: set expo_runtime_version in\n` +
    `    android/app/src/main/res/values/strings.xml\n` +
    `  to ${app.runtimeVersion}. This is a NATIVE change — it needs a new AAB, never an OTA.`,
  );
}

// Same trap, different file: the version people read in the Play listing comes
// from build.gradle, not app.json, and drifted the same way (app.json said
// 1.0.2 while every uploaded bundle reported 1.0.0).
const versionName = gradle.match(/^\s*versionName\s+"([^"]+)"/m);
if (!versionName) fail('No versionName in android/app/build.gradle.');
if (versionName[1].trim() !== String(app.version).trim()) {
  fail(
    `Version name mismatch — the store would show the wrong version.\n` +
    `    app.json     version     : ${app.version}\n` +
    `    build.gradle versionName : ${versionName[1]}   (what Play actually displays)\n\n` +
    `  Fix: set versionName in android/app/build.gradle to ${app.version}.`,
  );
}

console.log(`✓ runtime ${app.runtimeVersion} and version ${app.version} agree across app.json, strings.xml and build.gradle`);
