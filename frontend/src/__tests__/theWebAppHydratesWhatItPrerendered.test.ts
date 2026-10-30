/**
 * The web app hydrates what it prerendered.
 *
 * The web app is static HTML, prerendered in English with no URL
 * parameters, which the browser then hydrates. Anything the first client
 * render reads from the browser that the prerender could not — the
 * language, a URL parameter — makes the two trees differ, and React throws
 * the hydrated tree away and renders the screen again from scratch (error
 * #418). Every French-locale visitor hit that on every tab. Roland, 2026-10-30:
 * yes to fixing it. This pins:
 *
 *  - the hook that applies such a value only once hydrated, through React's
 *    own useSyncExternalStore with a server snapshot;
 *  - the store applying the device language through it, English meanwhile;
 *  - a chosen language (the account's, or a picked one) still winning;
 *  - the Kitchen's asked-for view going through the same hook.
 */
import fs from 'fs';
import path from 'path';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const hook = read('src', 'hooks', 'useClientValue.ts');
const store = read('src', 'store.tsx');
const kitchen = read('app', '(tabs)', 'kitchen.tsx');

describe('a value the prerender could not know', () => {
  it('is applied once the page is hydrated, by React’s own mechanism', () => {
    expect(hook).toContain("import { useSyncExternalStore } from 'react';");
    expect(hook).toContain('useSyncExternalStore(subscribeToNothing, () => value, () => duringHydration)');
  });

  it('is how the device language reaches the store, English until then', () => {
    expect(store).toContain("const deviceLang = useClientValue(detectDeviceLang(), 'en' as Lang);");
    expect(store).toContain('const [chosenLang, setLangState] = useState<Lang | null>(null);');
    expect(store).toContain('const lang: Lang = chosenLang ?? deviceLang;');
    expect(store).not.toContain('useState<Lang>(detectDeviceLang)');
  });

  it('still lets the account’s own language, or a picked one, win', () => {
    // refreshUser and setLang keep writing the chosen language.
    expect((store.match(/setLangState\(u\.language as Lang\)/g) || []).length).toBeGreaterThanOrEqual(2);
    expect(store).toContain('setLangState(l);');
  });

  it('is how the Kitchen reads its asked-for view', () => {
    expect(kitchen).toContain('const askedView = useClientValue(rawAskedView, undefined);');
  });
});
