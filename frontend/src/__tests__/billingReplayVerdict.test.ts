/**
 * A purchase that reached nobody, and whether anything can still be done.
 *
 * The replay runs twice a day and gives up down five different paths, every
 * one of them silently. So the admin screen showed the same row, with the same
 * first-day wording, whether we had never tried it or tried it forty times —
 * and the one question a person has to answer before they can act ("is this
 * recoverable at all?") had no answer anywhere in the app.
 *
 * The states are decided server-side, beside the replay that produces them
 * (REPLAY_STATES in backend/server.py, and tests/test_billing_cycle_and_replay
 * pins what each one means). What lives here is the words for them, and what
 * this file guards is that the two sets cannot drift: a state the screen has
 * never heard of would render as a shrug next to real money.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');
const METRICS = readFileSync(join(ROOT, 'app', 'metrics.tsx'), 'utf8');
const SERVER = readFileSync(join(ROOT, '..', 'backend', 'server.py'), 'utf8');

/** Every state the replay can record, read off the server itself. */
const STATES = (SERVER.match(/^REPLAY_STATES = \(([^)]*)\)/m)?.[1] ?? '')
  .split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);

describe('the verdict on an unmatched payment', () => {
  it('has words for every state the server can record', () => {
    expect(STATES.length).toBeGreaterThan(0);
    const verdict = METRICS.slice(METRICS.indexOf('function replayVerdict'),
                                  METRICS.indexOf('export default function MetricsScreen'));
    for (const state of STATES) {
      expect(verdict).toContain(`case '${state}':`);
    }
  });

  it('says the row has not been tried yet rather than nothing', () => {
    // Absent is a real state — the replay has not run since the event landed.
    // Falling through to an empty string would read as "we looked and found
    // nothing to say", which is the opposite of true.
    const verdict = METRICS.slice(METRICS.indexOf('function replayVerdict'),
                                  METRICS.indexOf('export default function MetricsScreen'));
    expect(verdict).toMatch(/default:\s*\n\s*return '[^']+'/);
  });

  it('separates money still owed from money already gone', () => {
    // The distinction that earns the space: no_account is a buyer to find;
    // not_entitled is a row to let go. If they ever said the same thing, a
    // recoverable payment would sit in a list of unrecoverable ones.
    const account = METRICS.slice(METRICS.indexOf("case 'no_account':"),
                                  METRICS.indexOf("case 'not_entitled':"));
    const lapsed = METRICS.slice(METRICS.indexOf("case 'not_entitled':"),
                                 METRICS.indexOf("case 'no_key':"));
    expect(account).toMatch(/RevenueCat/);
    expect(lapsed).toMatch(/Nothing to recover/);
    expect(account).not.toEqual(lapsed);
  });

  it('does not call a store test ping a lost payment', () => {
    // RevenueCat's dashboard "Send test event" button posts a real webhook
    // with a synthetic id belonging to nobody. It was filed as a purchase
    // that reached no household, so the red money banner stood for weeks
    // because somebody checked the endpoint was wired up — and a REAL lost
    // payment would have looked exactly the same, right next to it.
    const verdict = METRICS.slice(METRICS.indexOf('function replayVerdict'),
                                  METRICS.indexOf('export default function MetricsScreen'));
    // Checked before the retry wording, which is about finding a buyer.
    expect(verdict.indexOf('e.is_test')).toBeLessThan(verdict.indexOf('replay_attempts'));
    expect(verdict).toMatch(/Not a purchase, nothing owed/);
    // And the tag read at a glance is not the red one.
    expect(METRICS).toMatch(/e\.is_test \? 'store test' : 'reached nobody'/);
    expect(METRICS).toMatch(/e\.is_test \? ui\.muted : ui\.danger/);
  });

  it('tells the three billing states apart', () => {
    // Nothing ever arrived (an outage) · money reached nobody (a person to
    // find) · the only thing that arrived was a test (the endpoint working,
    // nothing sold). The third used to raise the second's alarm, and could
    // never clear, because the id is not a person.
    expect(METRICS).toContain('!billing.ever_received ?');
    expect(METRICS).toContain('billing.unmatched > 0 ?');
    expect(METRICS).toContain('billing.last_test_at ?');
  });

  it('shows the verdict only where somebody has to act', () => {
    // A matched event is a receipt, not a task. Putting a retry line under
    // every row buries the one row that needs a person.
    expect(METRICS).toMatch(/\{!e\.matched \? \(\s*\n\s*<Text[^>]*>\s*\n\s*\{replayVerdict\(e\)\}/);
  });
});

/**
 * The tag on a MATCHED event — the plan it moved the household to.
 *
 * Not every event moves one. CANCELLATION, BILLING_ISSUE, TRANSFER and TEST
 * record state and change nobody's plan, so the tag falls back to a word of
 * its own. That word used to be "applied", which on a BILLING_ISSUE — the one
 * row meaning a paying family's payment has just failed — reads as though
 * something was resolved.
 */
describe('the tag on a matched event', () => {
  /** The event types the server explicitly says change no plan. */
  const NO_PLAN_EVENTS = ['CANCELLATION', 'BILLING_ISSUE', 'TRANSFER', 'TEST'];

  it('still names the plan when the event set one', () => {
    expect(METRICS).toContain('e.plan ||');
  });

  it('does not claim anything was applied when no plan changed', () => {
    // The specific regression: a payment failure tagged "applied".
    const tag = METRICS.slice(METRICS.indexOf('e.matched ? (e.plan ||'),
                              METRICS.indexOf('e.matched ? (e.plan ||') + 160);
    expect(tag).not.toContain("'applied'");
  });

  it('says what the server says of the same event', () => {
    // The server logs `changes.get("plan", "unchanged")` for exactly these
    // events. Two names for one fact is how a screen and a log stop agreeing.
    expect(METRICS).toContain("'plan unchanged'");
    expect(SERVER).toContain('changes.get("plan", "unchanged")');
  });

  it('is reached by the events that carry no plan', () => {
    // Read off the server: these are the ones its own comment excludes from
    // both the premium and the downgrade lists, so `changes` gets no "plan"
    // key and the event stores None. If one of them starts setting a plan the
    // fallback stops applying to it, and this should be revisited.
    const block = SERVER.slice(SERVER.indexOf('if event_type in RC_PREMIUM_EVENTS'),
                               SERVER.indexOf('await database["families"].update_one',
                                              SERVER.indexOf('if event_type in RC_PREMIUM_EVENTS')));
    for (const ev of NO_PLAN_EVENTS) {
      expect(block).toContain(ev);
    }
    // and they are named in the comment that says they just record state,
    // not in a branch that assigns changes["plan"].
    expect(block).toMatch(/Other events \([^)]*\) just record state/);
  });
});
