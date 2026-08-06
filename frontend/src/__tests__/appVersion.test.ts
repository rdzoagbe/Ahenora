/**
 * The version the store shows and the version the app believes it is.
 *
 * These are two different files, and only one of them reaches Google Play.
 * `frontend/android/` is committed — a bare workflow — so EAS builds from
 * build.gradle, and `expo prebuild`, which is what would normally copy
 * app.json's version down into it, is never run here because it rewrites
 * tracked files.
 *
 * So they drift, silently, and the only symptom is a number on a store listing
 * that nobody checks until a release is half out the door: app.json said
 * 1.0.2, and every bundle uploaded to Play reported 1.0.0.
 *
 * Nothing enforces this but this test.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function appJsonVersion(): string {
  const app = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));
  return app.expo.version;
}

function gradleVersionName(): string {
  const gradle = readFileSync(join(ROOT, 'android', 'app', 'build.gradle'), 'utf8');
  const match = gradle.match(/^\s*versionName\s+"([^"]+)"/m);
  if (!match) throw new Error('no versionName in build.gradle');
  return match[1];
}

describe('the version people actually see', () => {
  it('is the same in app.json and in the Android build', () => {
    expect(gradleVersionName()).toBe(appJsonVersion());
  });

  it('looks like a version', () => {
    expect(appJsonVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('has release notes written for it', () => {
    // Shipping a version with no "what's new" entry means the update notice
    // stays silent on the one launch it exists to speak up on.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WHATS_NEW } = require('../whatsNew');
    expect(WHATS_NEW[appJsonVersion()]?.length).toBeGreaterThan(0);
  });
});
