/**
 * Every platform presents its OWN Google client, and never an empty one.
 *
 * The calendar threw on every iPhone on 2026-09-07 — the first day an
 * over-the-air update reached one. The OTA is built by GitHub Actions, which
 * had never been given the iOS client id, so on iOS the Google hook was called
 * with neither `iosClientId` nor `clientId` and expo-auth-session's invariant
 * threw inside render. The error boundary is what people saw.
 *
 * Two properties, both of which were violated by one screen or the other:
 * the id is never empty (a throw in render is a screen that will not open),
 * and it is never another platform's (Google rejects an Android client from
 * iOS outright).
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('google client ids', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  function load() {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../googleClientIds') as typeof import('../googleClientIds');
  }

  it('is never empty on any platform, even with no environment at all', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
    const m = load();
    for (const os of ['ios', 'android', 'web']) {
      expect(m.googleClientIdForPlatform(os)).toMatch(/\.apps\.googleusercontent\.com$/);
    }
  });

  it('never hands iOS the Android client', () => {
    // The exact wrong answer that "fall back to androidClientId" would give,
    // and that Google refuses with an error the person cannot act on.
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    const m = load();
    expect(m.googleClientIdForPlatform('ios')).not.toBe(m.GOOGLE_ANDROID_CLIENT_ID);
    expect(m.googleClientIdForPlatform('ios')).toBe(m.GOOGLE_IOS_CLIENT_ID);
  });

  it('lets the environment override a rotated client', () => {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = '  rotated-ios.apps.googleusercontent.com  ';
    const m = load();
    expect(m.GOOGLE_IOS_CLIENT_ID).toBe('rotated-ios.apps.googleusercontent.com');
  });

  it('gives the hook every key it might look up, so the invariant cannot fire', () => {
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    const m = load();
    const cfg = m.googleClientIds('ios');
    // expo-auth-session reads config[platformKey] ?? config.clientId. Both
    // must be present and non-empty for every platform.
    for (const key of ['clientId', 'iosClientId', 'androidClientId', 'webClientId'] as const) {
      expect(cfg[key]).toBeTruthy();
    }
  });
});

describe('the screens that call the Google hooks', () => {
  // A screen that builds its own config by hand is a screen that can drift
  // back to the shape that threw. Both must go through the module.
  it.each(['app/(tabs)/calendar.tsx', 'app/index.tsx'])('%s spreads googleClientIds()', (file) => {
    const src = read(file);
    expect(src).toMatch(/\.\.\.googleClientIds\(\)/);
    // And no longer decides on its own whether iOS is allowed a client.
    expect(src).not.toMatch(/\.\.\.\(iosClientId \? \{ iosClientId \} : \{\}\)/);
  });
});

describe('the root error boundary reports what it caught', () => {
  it('sends the crash to the admin panel, not just the console', () => {
    const src = read('src/components/RootErrorBoundary.tsx');
    expect(src).toContain('reportCrash(');
    // Reached lazily: the boundary's own module load must never depend on
    // api.ts, or a failure there would leave nothing to catch it.
    expect(src).not.toMatch(/^import .* from '\.\.\/api'/m);
    expect(src).toMatch(/require\('\.\.\/api'\)/);
  });

  it('still depends on nothing that could be the thing that crashed', () => {
    // api.ts is allowed: it imports no store, theme or context. The store is
    // the line that must never be crossed, because the store is what usually
    // threw.
    const api = read('src/api.ts');
    expect(api).not.toMatch(/from '\.\/store'/);
    expect(api).not.toMatch(/from '\.\.\/store'/);
  });
});
