/**
 * Every API the app can call, and whether anything in the app calls it.
 *
 * This exists because of a whole feature that was half-built and nobody
 * noticed: the Chore Wheel listed, completed, rotated and deleted chores, and
 * `createChore` was never wired to anything. The section only rendered once a
 * chore existed, and nothing could make the first one — a feature that could
 * only ever be emptied. Rewards were the same shape: the Feed counted "4
 * rewards" in its footer against a screen that had been removed, with no way
 * to add, edit, redeem or delete one.
 *
 * Neither showed up as a bug. Nothing crashed, no test failed, and the only
 * symptom was an empty box. So this test asks the question directly: for every
 * method on `api`, is there a screen or component that calls it?
 *
 * A method with no caller is not automatically wrong — some are built ahead of
 * the screen that will use them. It just has to be a decision somebody made,
 * which is what the list below is: each entry is a backend capability that
 * deliberately has no way in yet. Adding a method without a caller fails this
 * test until it is either wired up or named here.
 */

import fs from 'fs';
import path from 'path';

const ROOT = path.join(__dirname, '..', '..');
const API = fs.readFileSync(path.join(ROOT, 'src', 'api.ts'), 'utf8');

/**
 * Backend capabilities with no way into them from the app.
 *
 * Keep this list shrinking. Each line is something a household cannot reach.
 */
const NO_SCREEN_YET: Record<string, string> = {
  changeSubscription: 'Plan changes go through the store, not the app.',
  conflicts: 'Calendar conflict detection — no screen designed yet.',
  createCarpool: 'Carpool: backend only, never designed.',
  createTemplate: 'Task templates: the Feed loads them, nothing manages them.',
  deleteTemplate: 'Task templates: see createTemplate.',
  toggleTemplate: 'Task templates: see createTemplate.',
  deleteAllowance: 'Pocket money can be set and paid; stopping it has no control.',
  deleteGiftPot: 'Gift pots are closed, not deleted, from the pot screen.',
  unshareGiftPot: 'Sharing a pot is one-way in the app today.',
  removeContribution: 'A contribution is corrected by the contributor, not removed by the owner.',
  getExpenseSummary: 'Expenses show per month; the summary endpoint is unused.',
  listCalendarContacts: 'Built for a share-with picker that the calendar does not have.',
  reportLite: 'A lighter weekly report the app never asks for.',
  reuseShoppingHistory: 'History rows are re-added item by item instead.',
  setVaultExpiry: 'Document expiry: scans propose one, nothing edits it afterwards.',
  setWeekendGoal: 'Retired when the week became one target for everyone.',
  sharedWithCoparent: 'Server-side filter with no screen behind it.',
  testNotification: 'A debug endpoint, deliberately not in the app.',
  verifyMemberPin: 'Kid mode verifies through exitKidSession instead — the feature works, this method is redundant.',
  voiceTranscribe: 'Voice capture transcribes through the scan path today.',
};

/** Method names declared on the exported `api` object. */
function apiMethodNames(): string[] {
  const names = new Set<string>();
  const re = /^ {2}([a-zA-Z_]\w*): (?:async )?\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(API))) names.add(m[1]);
  return [...names].sort();
}

/** Everything a screen or component could call it from. */
function appSources(): string {
  const dirs = [path.join(ROOT, 'app'), path.join(ROOT, 'src')];
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && full !== path.join(ROOT, 'src', 'api.ts')) {
        parts.push(fs.readFileSync(full, 'utf8'));
      }
    }
  };
  dirs.forEach(walk);
  return parts.join('\n');
}

describe('every API the app ships has a way into it', () => {
  const methods = apiMethodNames();
  const sources = appSources();
  const called = (name: string) => new RegExp(`\\bapi\\.${name}\\b`).test(sources);

  it('found the api surface at all', () => {
    // If the regex above stops matching, every method reads as unused and the
    // test passes vacuously — the failure mode that makes guards worthless.
    expect(methods.length).toBeGreaterThan(150);
    expect(methods).toContain('createChore');
    expect(methods).toContain('createReward');
  });

  it('has no method that is unreachable without somebody having said so', () => {
    const orphans = methods.filter((m) => !called(m) && !(m in NO_SCREEN_YET));
    expect(orphans).toEqual([]);
  });

  it('does not keep excuses for methods that are now wired up', () => {
    // The other direction: once something gets a screen, its line here has to
    // go, or the list stops describing anything.
    const stale = Object.keys(NO_SCREEN_YET).filter((m) => called(m));
    expect(stale).toEqual([]);
  });

  it('every excuse names a method that still exists', () => {
    const gone = Object.keys(NO_SCREEN_YET).filter((m) => !methods.includes(m));
    expect(gone).toEqual([]);
  });

  it('the features this test was written for are wired up', () => {
    for (const name of ['createChore', 'createRoutine', 'createReward', 'updateReward',
                        'deleteReward', 'redeemReward']) {
      expect(called(name)).toBe(true);
    }
  });
});
