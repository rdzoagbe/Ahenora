import { logTiming } from './api';

/**
 * How long things actually take, measured on real devices.
 *
 * "Smooth" was an assumption: nothing recorded how long the app took to become
 * usable, or how long a tab took to appear, so a regression would have reached
 * us as a review rather than as a number.
 *
 * Deliberately built from `Date.now()` and nothing else — no native module, no
 * new dependency — so the whole thing ships over the air like any other JS
 * change. A performance tool that requires a store release to deploy is a tool
 * that arrives after the problem.
 */

// Set when the JS bundle is first evaluated, which is the earliest moment this
// code can observe. It is NOT the moment the user tapped the icon: the native
// splash and bundle load happen before any of this exists, so what is measured
// is "bundle start → first usable screen", and that is what the name has to
// mean when someone reads the chart.
const bundleStart = Date.now();

let coldStartReported = false;

/**
 * Call when the first screen a person can actually act on has rendered.
 *
 * Reports once per launch. Called again — a re-render, a second screen
 * mounting — it does nothing, because the second number would be smaller and
 * would quietly drag the average down.
 */
export function reportColdStart(): void {
  if (coldStartReported) return;
  coldStartReported = true;
  logTiming('cold_start', Date.now() - bundleStart);
}

const pending = new Map<string, number>();

/** Start timing something. A second start for the same key replaces the first. */
export function markStart(key: string): void {
  pending.set(key, Date.now());
}

/**
 * Finish a timing and report it under `name`.
 *
 * Silently does nothing when there is no matching start: a screen reached by a
 * route the instrumentation does not know about should not report a duration
 * measured from the wrong moment.
 */
export function markEnd(key: string, name: 'tab_switch' | 'screen_load'): void {
  const started = pending.get(key);
  if (started === undefined) return;
  pending.delete(key);
  logTiming(name, Date.now() - started);
}

/** Test seam: forget everything measured so far. */
export function resetPerfForTests(): void {
  coldStartReported = false;
  pending.clear();
}
