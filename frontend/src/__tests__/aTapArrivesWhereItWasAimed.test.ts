/**
 * A tapped notification has to end up on the screen it named — not merely be
 * pushed at it.
 *
 * Reported as "no notification I click on takes me to the place where it's
 * located". The routing table was right; what was missing was any check that
 * the navigation actually happened. These pin the comparison that check rests
 * on, because getting it wrong fails in both directions: too strict and every
 * tap is retried until it gives up, too loose and a stomped navigation is
 * recorded as a success.
 */
import * as fs from 'fs';
import * as path from 'path';

import { normalizeRoutePath, paramsMatchTarget, routeMatchesTarget, targetForNotification } from '../notificationRouting';

describe('A route path is compared without its groups', () => {
  it('strips an expo-router group segment', () => {
    expect(normalizeRoutePath('/(tabs)/feed')).toBe('/feed');
  });

  it('leaves a plain path alone', () => {
    expect(normalizeRoutePath('/conversation')).toBe('/conversation');
  });

  it('keeps nested segments below a group', () => {
    expect(normalizeRoutePath('/(tabs)/kids/detail')).toBe('/kids/detail');
  });

  it('survives a trailing or doubled slash', () => {
    expect(normalizeRoutePath('/feed/')).toBe('/feed');
    expect(normalizeRoutePath('//feed')).toBe('/feed');
  });

  it('turns the root into the root', () => {
    expect(normalizeRoutePath('/')).toBe('/');
  });
});

describe('A digest that names one thing opens that thing', () => {
  it('carries the card through when the server named one', () => {
    // The report that would not go away. The digest landed on the Feed, which
    // is the screen the app opens on anyway, so a tap that worked was
    // indistinguishable from launching the app — and "1 thing still open from
    // earlier" named a single item then landed on a screen showing today,
    // where something from last week is not what the eye finds.
    const target = targetForNotification({ type: 'morning_digest', card_id: 'c_old' });
    expect(target).toEqual({ pathname: '/(tabs)/feed', params: { cardId: 'c_old' } });
  });

  it('still lands on the Feed when the day was several things', () => {
    expect(targetForNotification({ type: 'morning_digest' }))
      .toEqual({ pathname: '/(tabs)/feed' });
  });

  it('leaves the weekly recap and the quiet-day tip alone', () => {
    // These really are about everything, and about nothing in particular.
    expect(targetForNotification({ type: 'sunday_recap', card_id: 'c1' }))
      .toEqual({ pathname: '/(tabs)/feed' });
    expect(targetForNotification({ type: 'daily_tip' }))
      .toEqual({ pathname: '/(tabs)/feed' });
  });
});

describe('Arrival is judged on where the router says we are', () => {
  it('counts the grouped target as reached when the pathname is ungrouped', () => {
    // This is the whole point: router.push('/(tabs)/feed') reports '/feed'
    // afterwards. Comparing the two raw strings would never match and the tap
    // would be re-pushed four times and then abandoned.
    expect(routeMatchesTarget('/feed', '/(tabs)/feed')).toBe(true);
  });

  it('does not count a different tab as reached', () => {
    expect(routeMatchesTarget('/feed', '/(tabs)/vault')).toBe(false);
  });

  it('treats a missing pathname as not yet arrived', () => {
    expect(routeMatchesTarget(null, '/(tabs)/feed')).toBe(false);
    expect(routeMatchesTarget(undefined, '/(tabs)/feed')).toBe(false);
    expect(routeMatchesTarget('', '/(tabs)/feed')).toBe(false);
  });

  it('matches every destination the routing table can name', () => {
    // A target the arrival check can never confirm is a tap that retries and
    // gives up, so each one is checked against the pathname it produces.
    const cases: [unknown, string][] = [
      [{ type: 'morning_digest' }, '/feed'],
      [{ type: 'morning_digest', card_id: 'c1' }, '/feed'],
      [{ type: 'shopping_added' }, '/kitchen'],
      [{ type: 'due_documents' }, '/vault'],
      [{ type: 'vault_doc' }, '/vault'],
      [{ type: 'calendar_nightly' }, '/calendar'],
      [{ type: 'dinner_reminder' }, '/kitchen'],
      [{ type: 'family_joined' }, '/kids'],
      [{ type: 'billing_alert' }, '/metrics'],
      [{ type: 'support_ticket' }, '/metrics'],
      [{ type: 'chat', thread: 't1' }, '/conversation'],
      [{ type: 'santa_draw', draw_id: 'd1' }, '/santa'],
      [{ type: 'gift_pot', pot_id: 'p1' }, '/gift-pot'],
      [{ type: 'task_assigned', card_id: 'c1' }, '/feed'],
    ];
    for (const [data, arrivedAt] of cases) {
      const target = targetForNotification(data);
      expect(target).not.toBeNull();
      expect(routeMatchesTarget(arrivedAt, target!.pathname)).toBe(true);
    }
  });
});

describe('A notification about one document opens that document', () => {
  it('carries the document id the push has always sent', () => {
    // "Roland shared a document with you" opened the Vault and stopped there,
    // leaving the reader to find the thing they had just been told about on a
    // screen that may hold dozens. The id was in the push all along.
    expect(targetForNotification({ type: 'vault_doc', doc_id: 'd_1' }))
      .toEqual({ pathname: '/(tabs)/vault', params: { docId: 'd_1' } });
  });

  it('still opens the Vault when no document was named', () => {
    expect(targetForNotification({ type: 'vault_doc' }))
      .toEqual({ pathname: '/(tabs)/vault' });
  });

  it('opens the document when a renewal sweep found exactly one', () => {
    // Written when this sweep could not name one. It can now: when a single
    // document is due, the Vault is the right screen and the reader should
    // not then have to find the document on it.
    expect(targetForNotification({ type: 'due_documents', doc_id: 'd_1' }))
      .toEqual({ pathname: '/(tabs)/vault', params: { docId: 'd_1' } });
  });

  it('leaves a sweep covering several on the Vault itself', () => {
    expect(targetForNotification({ type: 'due_documents' }))
      .toEqual({ pathname: '/(tabs)/vault' });
  });
});

describe('Arrival means the params landed too, not just the path', () => {
  it('accepts a target that asked for nothing', () => {
    expect(paramsMatchTarget({}, undefined)).toBe(true);
    expect(paramsMatchTarget(null, undefined)).toBe(true);
  });

  it('refuses when the param the target named is missing', () => {
    // The bug this exists for: a startup redirect to /feed matches the digest
    // tap's pathname exactly while dropping its cardId. A path-only check
    // called that arrived, dropped the held target, and the card never
    // opened — the original complaint, reintroduced by its own fix.
    expect(paramsMatchTarget({}, { cardId: 'c1' })).toBe(false);
    expect(paramsMatchTarget(null, { cardId: 'c1' })).toBe(false);
  });

  it('accepts when it is there', () => {
    expect(paramsMatchTarget({ cardId: 'c1' }, { cardId: 'c1' })).toBe(true);
  });

  it('refuses when it is there but different', () => {
    expect(paramsMatchTarget({ cardId: 'c2' }, { cardId: 'c1' })).toBe(false);
  });

  it('ignores extra params the router carries of its own', () => {
    // Demanding an exact match would make arrival impossible.
    expect(paramsMatchTarget({ cardId: 'c1', screen: 'feed' }, { cardId: 'c1' })).toBe(true);
  });

  it('copes with a param that arrives as an array', () => {
    expect(paramsMatchTarget({ cardId: ['c1'] }, { cardId: 'c1' })).toBe(true);
  });

  it('compares every param a target named, not just the first', () => {
    expect(paramsMatchTarget({ thread: 't1' }, { thread: 't1', title: 'Keigh' })).toBe(false);
    expect(paramsMatchTarget({ thread: 't1', title: 'Keigh' }, { thread: 't1', title: 'Keigh' }))
      .toBe(true);
  });
});

/**
 * The audit, held as a test.
 *
 * "If I get a notification about a meal, it takes me to the meal and opens the
 * meal with the recipe. If I get a notification about a task, it goes to the
 * task, opens the task, and I see what is in there to check whether it's done."
 *
 * Landing on the right PAGE was never the standard. These pin the second half:
 * that the thing the message named is the thing that opens.
 */
describe('A notification opens the thing it is about, not the page it lives on', () => {
  it('opens the meal, with its recipe, for a dinner reminder', () => {
    // "Dinner tonight: lasagne" opened the Kitchen with the evening still to
    // find on it. A reminder you have to go looking through is a second errand.
    expect(targetForNotification({ type: 'dinner_reminder', meal_id: 'm_1' }))
      .toEqual({ pathname: '/(tabs)/kitchen', params: { mealId: 'm_1' } });
  });

  it('still opens the Kitchen when no meal was named', () => {
    expect(targetForNotification({ type: 'dinner_reminder' }))
      .toEqual({ pathname: '/(tabs)/kitchen' });
  });

  it('opens tomorrow, not today, for the nightly calendar', () => {
    // It opened on TODAY — the one day the message is not about — so the
    // reader arrived and saw none of what they had just been told.
    expect(targetForNotification({ type: 'calendar_nightly', day: '2026-09-22' }))
      .toEqual({ pathname: '/(tabs)/calendar', params: { day: '2026-09-22' } });
  });

  it('opens the single thing tomorrow holds, when it holds one', () => {
    expect(targetForNotification({ type: 'calendar_nightly', day: '2026-09-22', card_id: 'c1' }))
      .toEqual({ pathname: '/(tabs)/calendar', params: { cardId: 'c1', day: '2026-09-22' } });
  });

  it('opens the note a hand-off notification named', () => {
    expect(targetForNotification({ type: 'handoff_note', note_id: 'n_1' }))
      .toEqual({ pathname: '/(tabs)/feed', params: { noteId: 'n_1' } });
  });

  it('opens the task, where it can be read and ticked off', () => {
    // Already true, and pinned here so the audit covers it: the Feed's card
    // sheet carries the title, the day, the assignee, reschedule and Mark done.
    for (const type of ['task_assigned', 'new_card', 'card_reminder', 'shared_card']) {
      expect(targetForNotification({ type, card_id: 'c1' }))
        .toEqual({ pathname: '/(tabs)/feed', params: { cardId: 'c1' } });
    }
  });

  it('leaves an announcement on the Feed, because it carried its own message', () => {
    expect(targetForNotification({ type: 'announcement', note_id: 'n_1' }))
      .toEqual({ pathname: '/(tabs)/feed' });
  });
});

describe('Every screen a notification aims at can honour what it was sent', () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('the Kitchen opens the meal and clears the parameter after', () => {
    const kitchen = read('app/(tabs)/kitchen.tsx');
    expect(kitchen).toContain('mealId: notifiedMealId');
    expect(kitchen).toContain('generateRecipe(found)');
    expect(kitchen).toContain("router.setParams({ mealId: undefined })");
  });

  it('the Calendar moves to the day and opens the card', () => {
    const cal = read('app/(tabs)/calendar.tsx');
    expect(cal).toContain('setSelectedDay(notifiedDay)');
    expect(cal).toContain('setSelectedCard(found)');
  });

  it('the Feed unfolds the notes when one is named', () => {
    const feed = read('app/(tabs)/feed.tsx');
    expect(feed).toContain('noteId: notifiedNoteId');
    expect(feed).toContain('setExpandNotes(true)');
  });

  it('each of them releases its latch only when the parameter is gone', () => {
    // Releasing inline brings back the reappear-on-every-reload problem;
    // never releasing means a second tap on the same notification does
    // nothing. Both were found in review on other screens.
    for (const rel of ['app/(tabs)/kitchen.tsx', 'app/(tabs)/calendar.tsx', 'app/(tabs)/vault.tsx']) {
      expect(read(rel)).toMatch(/openedFromNotification\.current = null;/);
    }
  });
});

describe('A notification about one person opens that person', () => {
  it('opens the child whose vaccination is due', () => {
    // The Family screen was the right screen and the reader still had to go
    // looking among several children. Being told is not being shown.
    expect(targetForNotification({ type: 'due_vaccinations', member_id: 'm_1' }))
      .toEqual({ pathname: '/member', params: { id: 'm_1' } });
  });

  it('opens the document whose renewal is due', () => {
    expect(targetForNotification({ type: 'due_documents', doc_id: 'd_1' }))
      .toEqual({ pathname: '/(tabs)/vault', params: { docId: 'd_1' } });
  });

  it('opens the child who reached a star milestone', () => {
    // Their record is where the stars are and where a reward is given, which
    // is what the message suggests doing next.
    expect(targetForNotification({ type: 'star_milestone', member_id: 'm_2' }))
      .toEqual({ pathname: '/member', params: { id: 'm_2' } });
  });

  it('falls back to the Family screen when no one is named', () => {
    // A reminder covering several children, or an older push.
    expect(targetForNotification({ type: 'due_vaccinations' }))
      .toEqual({ pathname: '/(tabs)/kids' });
    expect(targetForNotification({ type: 'star_milestone', family_id: 'f1' }))
      .toEqual({ pathname: '/(tabs)/kids' });
  });

  it('leaves a mixed reminder on the Family screen', () => {
    // One push covering a vaccination AND a document cannot open both, and
    // guessing which half was meant is worse than showing the list.
    expect(targetForNotification({ type: 'due_dates', member_id: 'm_1' }))
      .toEqual({ pathname: '/(tabs)/kids' });
  });
});
