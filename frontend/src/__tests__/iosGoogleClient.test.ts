/**
 * A Google OAuth client belongs to exactly one platform.
 *
 * An Android client is bound to the package name and signing fingerprint, and
 * Google refuses it outright when the request comes from iOS. The first design
 * fixed that by reading an iOS-only env var and refusing any fallback — and
 * that is what crashed the calendar for every iPhone on the first day an OTA
 * reached one: the OTA build had no iOS id, so the Google hook was called on
 * iOS with no client at all and expo-auth-session threw inside render.
 *
 * The rule now: every platform presents its OWN client, from one module, and
 * the value is never empty. Source-level on purpose: the rule is about what
 * these files are allowed to contain, which survives refactors.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SIGN_IN = readFileSync(join(__dirname, '..', '..', 'app', 'index.tsx'), 'utf8');
const CALENDAR = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'calendar.tsx'), 'utf8');
const IDS = readFileSync(join(__dirname, '..', 'googleClientIds.ts'), 'utf8');

describe('iOS Google OAuth', () => {
  it('both screens take every client id from the one shared module', () => {
    expect(SIGN_IN).toMatch(/import \{ googleClientIds \} from '\.\.\/src\/googleClientIds'/);
    expect(CALENDAR).toMatch(/import \{ googleClientIds \} from '\.\.\/\.\.\/src\/googleClientIds'/);
    expect(SIGN_IN).toMatch(/\.\.\.googleClientIds\(\)/);
    expect(CALENDAR).toMatch(/\.\.\.googleClientIds\(\)/);
  });

  it('no screen reads a Google client id from the environment on its own', () => {
    // The crash came from two screens with two policies. One module, one policy.
    for (const src of [SIGN_IN, CALENDAR]) {
      expect(src).not.toMatch(/EXPO_PUBLIC_GOOGLE_(IOS|ANDROID|WEB)_CLIENT_ID/);
      expect(src).not.toMatch(/apps\.googleusercontent\.com/);
    }
  });

  it('the shared module has an iOS client of its own, never borrowed', () => {
    expect(IDS).toContain('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
    const ios = IDS.slice(IDS.indexOf('GOOGLE_IOS_CLIENT_ID ='), IDS.indexOf('googleClientIdForPlatform'));
    expect(ios).toMatch(/apps\.googleusercontent\.com/);
    // The fallback must be a distinct client, not the Android or web one.
    const ids = IDS.match(/243255248169-[a-z0-9]+\.apps\.googleusercontent\.com/g) ?? [];
    expect(new Set(ids).size).toBe(3);
  });

  it('never withholds a platform key from the hook', () => {
    // This conditional spread was the crash: it hid the *button* on iOS while
    // the hook underneath it was still called with no client and threw.
    expect(SIGN_IN).not.toMatch(/\.\.\.\(iosClientId \? \{ iosClientId \} : \{\}\)/);
    expect(CALENDAR).not.toMatch(/\.\.\.\(iosClientId \? \{ iosClientId \} : \{\}\)/);
  });

  it('sign-in still hides the button rather than offering a door that cannot open', () => {
    expect(SIGN_IN).toContain('googleAvailable');
    expect(SIGN_IN).toMatch(/\{googleAvailable \? \(/);
    expect(SIGN_IN).toMatch(/loginHint\.method === 'google' && !googleAvailable/);
  });

  it('calendar checks availability before opening the sheet, not inside it', () => {
    expect(CALENDAR).toMatch(/!googleCalendarAvailable/);
  });
});
