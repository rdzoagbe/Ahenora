/**
 * The instrument that says whether the app is fast.
 *
 * An instrument that reports a number nobody experiences is worse than none:
 * it gets trusted. These tests hold the two properties that make the numbers
 * mean what their names say — cold start is reported once per launch, and a
 * duration is only reported when there was a matching start.
 */
import { reportColdStart, markStart, markEnd, resetPerfForTests } from '../perf';
import { readFileSync } from 'fs';
import { join } from 'path';

import { logTiming } from '../api';

jest.mock('../api', () => ({ logTiming: jest.fn() }));
const sent = logTiming as jest.Mock;

describe('cold start', () => {
  beforeEach(() => { sent.mockClear(); resetPerfForTests(); });

  it('is reported once', () => {
    reportColdStart();
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0][0]).toBe('cold_start');
  });

  it('is not reported again on a later render', () => {
    // A second number would be smaller — the bundle is already warm — and
    // would quietly drag the average down towards a launch nobody had.
    reportColdStart();
    reportColdStart();
    reportColdStart();
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('reports a plausible duration, not a timestamp', () => {
    reportColdStart();
    const ms = sent.mock.calls[0][1];
    expect(typeof ms).toBe('number');
    expect(ms).toBeGreaterThanOrEqual(0);
    // A Unix timestamp would be ~1.7e12. Catching that is the point.
    expect(ms).toBeLessThan(60_000);
  });
});

describe('a measured interval', () => {
  beforeEach(() => { sent.mockClear(); resetPerfForTests(); });

  it('reports only after a matching start', () => {
    markStart('tab:kids');
    markEnd('tab:kids', 'tab_switch');
    expect(sent).toHaveBeenCalledWith('tab_switch', expect.any(Number));
  });

  it('reports nothing when there was no start', () => {
    // A screen reached by a route the instrumentation does not know about
    // must not report a duration measured from some unrelated moment.
    markEnd('tab:never-started', 'tab_switch');
    expect(sent).not.toHaveBeenCalled();
  });

  it('does not report the same interval twice', () => {
    markStart('tab:kids');
    markEnd('tab:kids', 'tab_switch');
    markEnd('tab:kids', 'tab_switch');
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('keeps separate intervals apart', () => {
    markStart('tab:kids');
    markStart('tab:calendar');
    markEnd('tab:calendar', 'tab_switch');
    expect(sent).toHaveBeenCalledTimes(1);
    markEnd('tab:kids', 'tab_switch');
    expect(sent).toHaveBeenCalledTimes(2);
  });
});

describe('what it is wired to', () => {
  const read = (p: string) =>
    readFileSync(join(__dirname, '..', '..', p), 'utf8');

  it('ends cold start when the splash comes down, not when the bundle loads', () => {
    // The splash hiding is the first moment a person can see anything. Any
    // earlier and the number describes an experience nobody has.
    const layout = read('app/_layout.tsx');
    const effect = layout.slice(
      layout.indexOf('SplashScreen.hideAsync'),
      layout.indexOf('}, [fontsLoaded]);'));
    expect(effect).toContain('reportColdStart()');
  });

  it('ends a tab switch when the route changes, not when navigate returns', () => {
    // Timing the navigate call measures how long a function took to return,
    // which is always fast and never what the person felt.
    const tabs = read('app/(tabs)/_layout.tsx');
    expect(tabs).toContain("markEnd(`tab:${waiting}`, 'tab_switch')");
    expect(tabs).toContain('}, [pathname]);');
  });

  it('tracks the pending tab in a ref, so timing does not cause renders', () => {
    expect(read('app/(tabs)/_layout.tsx')).toContain('pendingTabRef = useRef');
  });

  it('adds no native dependency, so it still ships over the air', () => {
    // A performance tool that needs a store release to deploy arrives after
    // the problem it was built to catch.
    const perf = read('src/perf.ts');
    expect(perf).not.toMatch(/from '(expo-|react-native-)/);
    expect(perf).toContain('Date.now()');
  });
});
