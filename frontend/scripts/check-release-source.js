#!/usr/bin/env node
/**
 * A store build may only come from a real checkout, not a downloaded folder.
 *
 * On 2026-09-08 a production AAB (build 56, 1.1.0) was made by running
 * `eas build` inside `Household-COO-main` — the folder GitHub's "Download ZIP"
 * button produces. `eas build` uploads the DIRECTORY YOU RUN IT IN; it does not
 * fetch anything from GitHub. That folder was a copy taken on 2 September, so
 * the bundle shipped to Google Play was the app as it stood six days earlier:
 * the old five-seat tab bar with the centre ＋, the microphone that had been
 * removed on 3 September, and — because the Gradle wiring added that morning
 * was not in it either — no Firebase, which is the whole reason Android had
 * never received a push. The build did not fail. Nothing said the source was
 * stale. It installed, looked wrong, and could not receive a notification.
 *
 * The tell is that a ZIP has no `.git`, so EAS records no commit for the
 * build and leaves EAS_BUILD_GIT_COMMIT_HASH empty. A real checkout — which
 * is what the "EAS Build (Android)" workflow always uses — always has one.
 *
 * So: release profiles require a commit. Development builds are exempt,
 * because building a dev client from a scratch directory is normal work and
 * never reaches a single user.
 *
 * Runs on Expo's build server as the `eas-build-pre-install` npm hook, before
 * dependencies are installed — so it uses Node built-ins only.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// The profiles that produce something a person can install. Kept as a list
// rather than "anything but development" so a new profile has to be thought
// about once, here, instead of silently inheriting an exemption.
const RELEASE_PROFILES = new Set(['production', 'preview', 'preview-ios', 'production-ios']);

const WORKFLOW = 'Actions › "EAS Build (Android)" › Run workflow';

function fail(lines) {
  console.error('\n' + '='.repeat(72));
  console.error('REFUSING TO BUILD: the source of this build cannot be trusted');
  console.error('='.repeat(72));
  for (const line of lines) console.error(line);
  console.error('='.repeat(72) + '\n');
  process.exit(1);
}

function main() {
  // Not on Expo's build servers (a local `npm test`, a CI lint job): nothing
  // to police. The guard exists to judge what was uploaded, and here nothing
  // was.
  if (!process.env.EAS_BUILD) return;

  const profile = (process.env.EAS_BUILD_PROFILE || '').trim();
  if (!RELEASE_PROFILES.has(profile)) {
    console.log(`[release-source] profile "${profile || '(none)'}" is not a release profile — not checked.`);
    return;
  }

  const commit = (process.env.EAS_BUILD_GIT_COMMIT_HASH || '').trim();
  if (!commit) {
    fail([
      `Profile "${profile}" builds something people install, and this upload`,
      'carries no git commit — which means it was built from a plain folder',
      'rather than a checkout. A downloaded ZIP has no history, so there is no',
      'way to tell how old it is. That is exactly how build 56 shipped code',
      'from six days earlier, with no Firebase and the old navigation.',
      '',
      'Build it from the repository instead, on GitHub:',
      `  ${WORKFLOW}`,
      '',
      'That runs on Expo the same way, from the exact commit on main.',
      'See docs/RELEASING.md.',
    ]);
  }

  // A release build must also carry the Android Firebase config, or the app
  // installs fine and can never receive a notification — silently, which is
  // the failure this repository has already paid for once. Gradle enforces it
  // too; saying it here means the reason arrives before a Java stack trace.
  const platform = (process.env.EAS_BUILD_PLATFORM || '').trim();
  if (platform === 'android') {
    const config = path.join(__dirname, '..', 'android', 'app', 'google-services.json');
    if (!fs.existsSync(config)) {
      fail([
        'android/app/google-services.json is missing from the uploaded source.',
        'Without it the app cannot obtain a push token, and every Android',
        'install is silent — with no error anywhere. It is committed on main.',
        '',
        `Build from the repository: ${WORKFLOW}`,
        'See docs/ANDROID_PUSH.md.',
      ]);
    }
  }

  console.log(`[release-source] ok — profile "${profile}", commit ${commit.slice(0, 12)}.`);
}

main();
