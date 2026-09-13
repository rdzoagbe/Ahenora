/**
 * Every notification preference the server obeys must have a switch.
 *
 * A preference the server reads and the screen never shows is one nobody can
 * turn back on — it is decided once, invisibly, and for good. That is how the
 * passport-and-vaccination alert came to be governed by a switch labelled for
 * chore reminders: not by anyone deciding it should be, but by nobody noticing
 * it had no switch of its own.
 *
 * Written against the LIST rather than the new key alone, so the next
 * preference added to the server cannot repeat it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const settings = readFileSync(
  join(__dirname, '..', '..', 'app', '(tabs)', 'settings.tsx'), 'utf8');
const server = readFileSync(
  join(__dirname, '..', '..', '..', 'backend', 'server.py'), 'utf8');

/** The keys public_notification_settings reports, minus its timestamp. */
function reportedPrefs(): string[] {
  const at = server.indexOf('def public_notification_settings');
  const body = server.slice(at, server.indexOf('\n\n\n', at));
  return [...body.matchAll(/"(\w+)": alerts_enabled/g)].map((m) => m[1]);
}

describe('the notification settings screen', () => {
  const prefs = reportedPrefs();

  it('finds the preferences at all', () => {
    // A parser that quietly matched nothing would make the check below pass on
    // an empty list — the usual way a test like this dies.
    expect(prefs.length).toBeGreaterThanOrEqual(3);
  });

  it.each(reportedPrefs())('offers a switch for %s', (pref) => {
    // Both halves: the row has to read the current value AND write it back.
    // A toggle wired to only one is a switch that either never reflects the
    // truth or never changes it.
    expect(settings).toContain(`notificationPrefs.${pref}`);
    expect(settings).toMatch(new RegExp(`updateNotificationPrefs\\(\\{\\s*${pref}:`));
  });

  it('starts every switch from a known state before the server answers', () => {
    // An undefined toggle renders as off, so a screen that loads slowly shows
    // every alert disabled and invites somebody to "fix" it by turning on what
    // was never off.
    const at = settings.indexOf('useState<NotificationSettings>');
    const initial = settings.slice(at, settings.indexOf(')', at));
    prefs.forEach((p) => expect([p, initial.includes(`${p}:`)]).toEqual([p, true]));
  });
});
