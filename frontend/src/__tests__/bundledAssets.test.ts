/**
 * The app's own pictures ship inside the app.
 *
 * Two full-screen backgrounds — the sign-in screen and the Sunday brief —
 * were loaded at runtime from `static.prod-images.emergentagent.com`, a
 * scaffolding vendor's bucket with a job id in the path. That is a dependency
 * on a stranger's uptime for the first screen anybody ever sees, and a request
 * to an outside party before the person has even signed in. If that bucket
 * were ever cleaned up, the sign-in screen would lose its background and the
 * Sunday brief — a transparent modal — would appear to float over whatever
 * was behind it.
 *
 * Source-level on purpose: the rule is about what these files are allowed to
 * contain, which survives any refactor of the components.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const SIGN_IN = readFileSync(join(ROOT, 'app', 'index.tsx'), 'utf8');
const SUNDAY = readFileSync(join(ROOT, 'src', 'components', 'SundayBriefModal.tsx'), 'utf8');

describe('backgrounds are bundled, not fetched', () => {
  it('no screen loads an image from the scaffolding vendor', () => {
    for (const source of [SIGN_IN, SUNDAY]) {
      expect(source).not.toMatch(/emergentagent/);
    }
  });

  it('both backgrounds are required from the app’s own assets', () => {
    expect(SIGN_IN).toMatch(/require\('\.\.\/assets\/images\/signin-bg\.jpg'\)/);
    expect(SUNDAY).toMatch(/require\('\.\.\/\.\.\/assets\/images\/sunday-brief-bg\.jpg'\)/);
  });

  it('the files they name actually exist', () => {
    // A require() of a missing asset fails the bundle, so this only guards
    // against the pair drifting apart in a commit that never gets bundled.
    for (const name of ['signin-bg.jpg', 'sunday-brief-bg.jpg']) {
      expect(existsSync(join(ROOT, 'assets', 'images', name))).toBe(true);
    }
  });

  it('the Sunday brief is reachable, or its background ships for nothing', () => {
    // Found by this very test: the modal existed — a finished 230-line
    // screen, a backend endpoint, an API method, a paid entitlement, and
    // Settings telling a paying household "Weekly brief: On" — and NOTHING
    // imported it. The bundler proved it: the asset it requires was absent
    // from the web export while the sign-in one was there, because an
    // unreachable module's assets are never emitted.
    const settings = readFileSync(join(ROOT, 'app', '(tabs)', 'settings.tsx'), 'utf8');
    expect(settings).toMatch(/import \{ SundayBriefModal \}/);
    expect(settings).toMatch(/<SundayBriefModal\s/);
    expect(settings).toContain('open-sunday-brief');
  });

  it('neither background is a remote URI any more', () => {
    // `source={{ uri: ... }}` is the shape that reaches the network. A
    // bundled asset is passed as the module itself.
    expect(SIGN_IN).not.toMatch(/source=\{\{\s*uri:\s*BG_/);
    expect(SUNDAY).not.toMatch(/source=\{\{\s*uri:\s*BG_/);
  });
});
