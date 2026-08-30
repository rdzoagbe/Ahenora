/**
 * A Google OAuth client belongs to exactly one platform.
 *
 * An Android client is bound to the package name and signing fingerprint, and
 * Google refuses it outright when the request comes from iOS. Both OAuth call
 * sites passed only `androidClientId` and `webClientId`, and sign-in additionally
 * passed the Android one as the generic `clientId` — so on iOS the Google button
 * would have opened a sheet that failed every single time.
 *
 * A sign-in door that cannot open is an App Review rejection under Guideline
 * 2.1, not a papercut, and it would have been the reviewer's first tap.
 *
 * Source-level on purpose: the rule is about what these files are allowed to
 * contain, which survives refactors of the components.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SIGN_IN = readFileSync(join(__dirname, '..', '..', 'app', 'index.tsx'), 'utf8');
const CALENDAR = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'calendar.tsx'), 'utf8');

describe('iOS Google OAuth', () => {
  it('sign-in reads an iOS client id of its own', () => {
    expect(SIGN_IN).toContain('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
  });

  it('calendar sync reads one too', () => {
    expect(CALENDAR).toContain('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID');
  });

  it('never falls back to a hard-coded client when the iOS one is absent', () => {
    // The whole failure mode was a client from another platform being used
    // because it happened to be in scope. An empty value must disable the
    // feature, never silently borrow.
    const decl = SIGN_IN.slice(
      SIGN_IN.indexOf('const iosClientId'),
      SIGN_IN.indexOf('const googleAvailable'));
    expect(decl).not.toMatch(/FALLBACK/);
    expect(decl).not.toMatch(/apps\.googleusercontent\.com/);
  });

  it('hides the sign-in button instead of offering a door that cannot open', () => {
    expect(SIGN_IN).toContain('googleAvailable');
    // Gated on availability, not merely disabled-looking.
    expect(SIGN_IN).toMatch(/\{googleAvailable \? \(/);
  });

  it('does not offer a returning Google user a one-tap door that cannot open', () => {
    expect(SIGN_IN).toMatch(/loginHint\.method === 'google' && !googleAvailable/);
  });

  it('calendar refuses to open the sheet rather than failing inside it', () => {
    expect(CALENDAR).toMatch(/!googleCalendarAvailable/);
  });

  it('leaves every other platform exactly as it was', () => {
    // The availability gate must be iOS-specific; a bare truthiness check would
    // silently disable Google on Android and web too.
    expect(SIGN_IN).toMatch(/Platform\.OS !== 'ios' \|\| Boolean\(iosClientId\)/);
    expect(CALENDAR).toMatch(/Platform\.OS !== 'ios' \|\| Boolean\(iosClientId\)/);
  });
});
