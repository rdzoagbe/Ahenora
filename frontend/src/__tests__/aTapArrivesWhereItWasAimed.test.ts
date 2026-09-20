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
import { normalizeRoutePath, routeMatchesTarget, targetForNotification } from '../notificationRouting';

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
