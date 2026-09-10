/**
 * Dark phones opening ahenora.com got a half-dark page.
 *
 * The web export is rendered light at build time. If the OS is dark,
 * useColorScheme() says so on the very first client render, React hydrates
 * the light DOM against a dark tree and does not repair the class names that
 * differ — so everything that never re-rendered stayed light and everything
 * that did went dark: white task titles on white cards. Seen in the
 * screenshot sweep of 2026-09-07, invisible in every pass/fail harness
 * because they all run with a light OS.
 *
 * The rule: on the web the OS scheme is read only after mount, so the first
 * client render agrees with the export and the second paints the whole tree.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const STORE = readFileSync(join(__dirname, '..', 'store.tsx'), 'utf8');

describe('web dark mode and hydration', () => {
  it('reads the OS scheme only after mount on the web', () => {
    expect(STORE).toMatch(/useState\(Platform\.OS !== 'web'\)/);
    expect(STORE).toMatch(/setSchemeReady\(true\)/);
    expect(STORE).toMatch(/schemeReady && \(rawScheme === 'light' \|\| rawScheme === 'dark'\)/);
  });

  it('still honours an explicit choice immediately', () => {
    // A stored 'dark' takes effect through setAppearanceMode after load,
    // which re-renders the tree — that path was never the broken one.
    expect(STORE).toMatch(/if \(value === 'system' \|\| value === 'dark' \|\| value === 'light'\)/);
  });
});
