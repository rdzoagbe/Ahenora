/**
 * The blast radius of a bad render.
 *
 * There was a boundary, inside TabScreen, wrapping a tab's scrollable content.
 * Modals are siblings of TabScreen rather than children, so none of them were
 * covered — nor the tab layout, nor the store, nor the router. A throw in any
 * of those was an app that would not start.
 *
 * These are source-level checks on purpose. What matters is not that a class
 * component catches (React guarantees that) but WHERE the boundary sits and
 * what it is allowed to depend on — and both are structural facts a rendering
 * test would not pin down.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('the root error boundary', () => {
  const layout = read('app/_layout.tsx');
  const boundary = read('src/components/RootErrorBoundary.tsx');

  it('wraps the app at all', () => {
    expect(layout).toContain('<RootErrorBoundary>');
  });

  it('sits OUTSIDE the store provider', () => {
    // The store is where a bad update most often lands, and a fallback that
    // needs the store cannot render when the store is what threw.
    const openBoundary = layout.indexOf('<RootErrorBoundary>');
    const openStore = layout.indexOf('<StoreProvider>');
    expect(openBoundary).toBeGreaterThan(-1);
    expect(openStore).toBeGreaterThan(-1);
    expect(openBoundary).toBeLessThan(openStore);
  });

  it('depends on nothing that could be the thing that crashed', () => {
    // No store, no theme, no context. Its whole job is to work when the rest
    // does not. Comments are stripped first: this file EXPLAINS why it avoids
    // useStore, and the first version of this test failed on its own prose.
    const code = boundary
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\buseStore\b/);
    expect(code).not.toMatch(/\buseUI\b/);
    expect(code).not.toMatch(/from '\.\/Kit'/);
    // And it must not import the store module at all.
    expect(code).not.toMatch(/from '\.\.\/store'/);
  });

  it('still speaks the language of whoever is holding the phone', () => {
    // Settings live in the store, so the device is the only source available.
    expect(boundary).toContain('detectDeviceLang');
    expect(boundary).toContain('translate(');
  });

  it('does not show a stack trace to a parent', () => {
    // The message is a developer's, and in a shipped app it is noise to the
    // reader and a hint to anybody else.
    expect(boundary).toMatch(/__DEV__ \?/);
  });

  it('offers a way back', () => {
    expect(boundary).toContain('root-error-retry');
  });

  it('has its copy in all four languages', () => {
    const i18n = read('src/i18n.ts');
    for (const key of ['err_app_crashed', 'err_something_wrong', 'err_try_again']) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || [])).toHaveLength(4);
    }
  });
});

describe('the native-dependency gate', () => {
  it('records what the shipped binaries were built from', () => {
    const manifest = JSON.parse(read('native-modules.json'));
    expect(Array.isArray(manifest.nativeDependencies)).toBe(true);
    // If this is ever empty the check passes vacuously, which is the failure
    // mode that makes a guard worthless.
    expect(manifest.nativeDependencies.length).toBeGreaterThan(20);
  });

  it('runs in CI, not just when somebody remembers', () => {
    const workflow = fs.readFileSync(
      path.join(ROOT, '..', '.github', 'workflows', 'frontend-ci-eas-update.yml'), 'utf8');
    expect(workflow).toContain('check-native-deps.js');
  });
});
