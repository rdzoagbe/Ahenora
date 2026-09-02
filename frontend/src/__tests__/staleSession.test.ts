/**
 * A revoked session must not leave the app looking signed in.
 *
 * 401 means two different things. On /auth/login it means "wrong password",
 * and signing a household out over a typo would be absurd — so the whole
 * /auth/ prefix was excluded from the global sign-out.
 *
 * /auth/me is under that prefix, and a 401 there means the opposite: the token
 * is dead. Excluding it left the app half-signed-in — the cached name and
 * email on screen while every request failed — with no way out but finding
 * Log out by hand. Observed in the wild the moment /auth/logout-everywhere
 * made a session revoked elsewhere an ordinary event.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const API = readFileSync(join(__dirname, '..', 'api.ts'), 'utf8');

// The decision, lifted out of the source so the cases can be exercised rather
// than described. Kept in step by the assertions below.
const CREDENTIAL_PATHS = ['/auth/', '/kid/'];
const SESSION_IS_GONE_PATHS = ['/auth/me'];
const signsOut = (path: string) =>
  !(CREDENTIAL_PATHS.some((p) => path.startsWith(p)) &&
    !SESSION_IS_GONE_PATHS.some((p) => path.startsWith(p)));

describe('a 401 on the session probe', () => {
  it('signs the app out', () => {
    expect(signsOut('/auth/me')).toBe(true);
  });

  it('and the source actually says so', () => {
    // The table above is only a model; this is the real thing.
    expect(API).toContain("SESSION_IS_GONE_PATHS = ['/auth/me']");
    expect(API).toContain('!SESSION_IS_GONE_PATHS.some');
  });
});

describe('a 401 that is not about the session', () => {
  it.each([
    ['/auth/login', 'a mistyped password'],
    ['/auth/register', 'an address already taken'],
    ['/auth/google', 'a rejected provider token'],
    ['/auth/reset-password', 'a spent reset code'],
  ])('%s keeps you signed in (%s)', (path) => {
    expect(signsOut(path)).toBe(false);
  });

  it('a lapsed kid session does not dump the parent on the landing screen', () => {
    // The kid screen restores the parent token itself; the global handler
    // firing here would clear it first and sign out a signed-in parent.
    expect(signsOut('/kid/home')).toBe(false);
  });
});

describe('everything else still signs out on 401', () => {
  it.each(['/cards', '/calendar/candidates', '/vault', '/subscription'])(
    '%s', (path) => expect(signsOut(path)).toBe(true));
});

describe('what signing out clears', () => {
  it('takes the offline copy with it', () => {
    // A revoked session must not leave a readable household behind, including
    // the remembered identity that would let a cold offline launch walk in.
    const branch = API.slice(
      API.indexOf('if (res.status === 401 && !isCredentialCheck)'),
      API.indexOf('if (res.status === 402)'));
    expect(branch).toContain('tokenStore.clear()');
    expect(branch).toContain('clearSnapshots()');
    expect(branch).toContain('cache.clear()');
    expect(branch).toContain('unauthorizedHandler()');
  });
});
