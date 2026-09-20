/**
 * Every kind of push the server can send has a route of its own.
 *
 * The routing table has a `default` that lands on the Feed, which is also the
 * screen the app opens on — so a type nobody added a case for does not fail
 * loudly, it just produces a notification whose tap appears to do nothing.
 * That is how `billing_alert`, `shopping_added`, `santa_draw` and
 * `notification_test` each shipped broken in turn, and each was found by a
 * person tapping one rather than by a test.
 *
 * This reads the backend and fails when a push type has no case. Adding one is
 * a line in notificationRouting.ts; the point is that it cannot be forgotten.
 */
import * as fs from 'fs';
import * as path from 'path';

const SERVER = path.join(__dirname, '..', '..', '..', 'backend', 'server.py');
const ROUTING = path.join(__dirname, '..', 'notificationRouting.ts');

/**
 * Types the server builds at runtime rather than writing out, so no regex can
 * see them. Kept short and explained, because an entry here is a type this
 * guard is NOT watching.
 */
const BUILT_AT_RUNTIME = [
  // DAILY_PUSH_JOBS keys become `{"type": kind}` in run_daily_local_push.
  'morning_digest', 'dinner_reminder', 'sunday_recap', 'calendar_nightly',
  'allowance_reminder', 'due_dates', 'due_vaccinations', 'due_documents',
  // A builder may override the type: a quiet day sends the tip, not a digest.
  'daily_tip',
  // send_coparent_alert takes its type as an argument.
  'teen_approval', 'reward_redeemed', 'shared_card', 'handoff_note', 'announcement',
  // Sent by the gift-pot routes through the same helper.
  'gift_pot',
];

function typesSentByTheServer(): string[] {
  const src = fs.readFileSync(SERVER, 'utf8');
  const found = new Set<string>(BUILT_AT_RUNTIME);
  for (const m of src.matchAll(/"type":\s*"([a-z_]+)"/g)) found.add(m[1]);
  return [...found].sort();
}

function typesWithACase(): Set<string> {
  const src = fs.readFileSync(ROUTING, 'utf8');
  const cases = new Set<string>();
  for (const m of src.matchAll(/case '([a-z_]+)':/g)) cases.add(m[1]);
  return cases;
}

describe('Every push type the server sends has a case in the routing table', () => {
  it('finds the push types in the backend at all', () => {
    // If the backend is refactored so no literal type survives, the guard
    // above would pass by finding nothing. This is the canary for that.
    const sent = typesSentByTheServer();
    expect(sent.length).toBeGreaterThan(20);
    expect(sent).toContain('task_assigned');
    expect(sent).toContain('chat');
  });

  it('routes all of them explicitly, never by falling through to the Feed', () => {
    const cases = typesWithACase();
    const unrouted = typesSentByTheServer().filter((t) => !cases.has(t));
    expect(unrouted).toEqual([]);
  });

  it('has no case for a type the server cannot send', () => {
    // A stale case is harmless at runtime but is a lie about what the app
    // handles, and it hides the real one when a type is renamed.
    const sent = new Set(typesSentByTheServer());
    const stale = [...typesWithACase()].filter((t) => !sent.has(t));
    expect(stale).toEqual([]);
  });
});
