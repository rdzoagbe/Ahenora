/**
 * Pulling down must refresh everything opening the tab would.
 *
 * The Calendar had a pull-to-refresh that called `load()` while its focus
 * effect called `load()` AND `refreshPending()` — so the count of events
 * waiting for review was updated by switching tabs and not by the gesture
 * whose entire job is updating things. The custody shading was worse: it comes
 * off the subscription, which the gesture refreshed not at all, so a co-parent
 * changing the alternating-week schedule left the other parent's month grid
 * wrong until the app was restarted.
 *
 * A spinner that runs, finishes, and leaves the screen saying the same thing
 * is worse than no spinner. It is an answer, and the answer is wrong.
 *
 * Written against EVERY tab rather than the Calendar alone, because the bug is
 * not a Calendar bug — it is what happens whenever a screen grows a second
 * loader and only one of its two callers learns about it. The focus effect is
 * the working definition of "everything this screen needs"; the refresh
 * handler has to match it.
 */
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const TABS = join(__dirname, '..', '..', 'app', '(tabs)');

const screens = () =>
  readdirSync(TABS)
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => [f, readFileSync(join(TABS, f), 'utf8')] as const);

/** The body of the first useFocusEffect(...) call, or null. */
function focusBody(src: string): string | null {
  const at = src.indexOf('useFocusEffect(');
  if (at < 0) return null;
  const end = src.indexOf('\n\n', at);
  return src.slice(at, end < 0 ? at + 400 : end);
}

/** The body of `const handleRefresh = useCallback(...)`, or null. */
function refreshBody(src: string): string | null {
  const at = src.indexOf('const handleRefresh');
  if (at < 0) return null;
  const end = src.indexOf('\n  }, [', at);
  return src.slice(at, end < 0 ? at + 900 : end);
}

/** Zero-argument calls that look like a loader, e.g. `load()`, `refreshX()`. */
function loaderCalls(body: string): string[] {
  const found = new Set<string>();
  // The lookbehind keeps `someRef.current()` from reading as a loader called
  // "current" — a property call is not a function this screen owns.
  for (const m of body.matchAll(/(?<![.\w])([a-z][A-Za-z0-9]*)\s*\(\s*\)/g)) {
    const name = m[1];
    // Calls that are plumbing rather than loads.
    if (['useCallback', 'useFocusEffect', 'useEffect', 'setRefreshing'].includes(name)) continue;
    found.add(name);
  }
  return [...found].sort();
}

describe('every tab that can be pulled down', () => {
  const withBoth = screens()
    .map(([name, src]) => [name, focusBody(src), refreshBody(src)] as const)
    .filter(([, focus, refresh]) => focus && refresh);

  it('finds the screens at all', () => {
    // A matcher that quietly found nothing would make the check below pass on
    // an empty set, which is how this kind of test usually dies.
    expect(withBoth.length).toBeGreaterThanOrEqual(1);
  });

  it.each(withBoth.map(([name]) => name))(
    '%s refreshes on a pull everything it refreshes on focus',
    (name) => {
      const [, focus, refresh] = withBoth.find(([n]) => n === name)!;
      const missed = loaderCalls(focus!).filter((fn) => !refresh!.includes(`${fn}(`));
      expect([name, missed]).toEqual([name, []]);
    },
  );
});

describe('the Calendar specifically', () => {
  const calendar = readFileSync(join(TABS, 'calendar.tsx'), 'utf8');

  it('refreshes the custody schedule too', () => {
    // Custody shading is drawn from the subscription, which no loader on this
    // screen touches — so it is invisible to the check above and needs saying
    // out loud. A co-parent switching the alternating weeks must not leave the
    // other parent looking at a wrong month until they restart the app.
    expect(refreshBody(calendar)).toContain('refreshSubscription');
  });

  it('picks up a scan captured from the global +', () => {
    // A scan lands as a CANDIDATE, not a card — so the one capture whose whole
    // result lives in the review count was the one that changed nothing.
    const at = calendar.indexOf('if (dataVersion)');
    expect(calendar.slice(at, at + 120)).toContain('refreshPending()');
  });
});
