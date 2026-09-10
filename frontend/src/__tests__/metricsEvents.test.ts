/**
 * An event the app logs and the server has never heard of is counted nowhere.
 *
 * /api/metrics/event checks the name against an allowlist and answers 200 to
 * anything else — correctly, because a telemetry call must never break the
 * feature it measures. The cost is that a client-only addition fails silently:
 * the app fires the event on every open, the server drops it, the Metrics
 * screen shows nothing, and there is no error anywhere to notice.
 *
 * That very nearly shipped here. `vault_open` was added to the vault screen to
 * settle whether anyone actually finds the vault — the question a whole
 * navigation change had been argued from without a number — and it would have
 * recorded nothing at all.
 *
 * A third end has to agree too: the Metrics screen only renders events it has
 * a label for, so a counted event with no label is data nobody sees.
 */
import { readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const SERVER = readFileSync(join(ROOT, '..', 'backend', 'server.py'), 'utf8');
const METRICS = readFileSync(join(ROOT, 'app', 'metrics.tsx'), 'utf8');

/** Every event the app actually fires, read out of the source that fires it. */
const clientEvents = (): string[] => {
  const out = execSync(
    `grep -rho "logEvent('[a-z_]*')" ${JSON.stringify(join(ROOT, 'app'))} ${JSON.stringify(join(ROOT, 'src'))} || true`,
    { encoding: 'utf8' });
  return [...new Set([...out.matchAll(/logEvent\('([a-z_]+)'\)/g)].map((m) => m[1]))].sort();
};

/** Every name the server will actually record. */
const serverEvents = (): string[] => {
  const block = SERVER.slice(SERVER.indexOf('ALLOWED_EVENTS = {'),
                             SERVER.indexOf('async def _bump_metric'));
  return [...new Set([...block.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]))].sort();
};

/** Every event the Metrics screen has words for. */
const labelledEvents = (): string[] => {
  const block = METRICS.slice(METRICS.indexOf('const EVENT_LABELS'),
                              METRICS.indexOf('const EVENT_ORDER'));
  return [...new Set([...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]))].sort();
};

describe('the three ends of an event', () => {
  it('finds the events at all', () => {
    // Guards the greps themselves: if any of these silently returned nothing,
    // every check below would pass by measuring an empty set.
    expect(clientEvents().length).toBeGreaterThanOrEqual(10);
    expect(serverEvents().length).toBeGreaterThanOrEqual(10);
    expect(labelledEvents().length).toBeGreaterThanOrEqual(10);
  });

  it('logs nothing the server will not record', () => {
    const missing = clientEvents().filter((e) => !serverEvents().includes(e));
    expect(missing).toEqual([]);
  });

  it('shows every event it logs', () => {
    // Counted but unlabelled is data nobody ever sees.
    const unlabelled = clientEvents().filter((e) => !labelledEvents().includes(e));
    expect(unlabelled).toEqual([]);
  });

  it('counts vault visits, not only vault saves', () => {
    // The specific gap this file was written for: every other tab counted its
    // opens, so "nobody finds the vault" could be asserted and not checked.
    expect(clientEvents()).toContain('vault_open');
    expect(serverEvents()).toContain('vault_open');
    expect(labelledEvents()).toContain('vault_open');
    for (const tab of ['feed_open', 'kids_open', 'calendar_open']) {
      expect(clientEvents()).toContain(tab);
    }
  });
});
