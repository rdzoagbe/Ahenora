/**
 * The tap-router: which screen a tapped notification opens, by its data.type.
 * Until this existed, tapping any notification just left you wherever you were —
 * "Roland assigned you the school run" opened the app to the last screen seen.
 */
import { targetForNotification } from '../notificationRouting';

describe('targetForNotification', () => {
  it('opens the conversation for a chat push, carrying the thread', () => {
    const t = targetForNotification({ type: 'chat', thread: 'dm:~a~b', title: 'Keigh' });
    expect(t).toEqual({ pathname: '/conversation', params: { thread: 'dm:~a~b', title: 'Keigh' } });
  });

  it('falls back to the Feed for a chat push with no thread', () => {
    expect(targetForNotification({ type: 'chat' })).toEqual({ pathname: '/(tabs)/feed' });
  });

  it('opens the Feed for task / card / note events', () => {
    for (const type of ['task_assigned', 'new_card', 'shared_card', 'card_reminder', 'handoff_note', 'announcement']) {
      expect(targetForNotification({ type })).toEqual({ pathname: '/(tabs)/feed' });
    }
  });

  it('carries the card id so the Feed can open the thing the push was about', () => {
    // The reported bug: the tap DID navigate, to the Feed, which is the screen
    // the app already opens on — so tapping "Roland handed you the school run"
    // was indistinguishable from just opening the app. The server was already
    // sending card_id; this map was dropping it.
    for (const type of ['task_assigned', 'new_card', 'shared_card', 'card_reminder']) {
      expect(targetForNotification({ type, card_id: 'card_123' }))
        .toEqual({ pathname: '/(tabs)/feed', params: { cardId: 'card_123' } });
    }
  });

  it('still opens the Feed when a card push arrives without an id', () => {
    // Older app builds and any push written before card_id existed.
    expect(targetForNotification({ type: 'task_assigned' }))
      .toEqual({ pathname: '/(tabs)/feed' });
  });

  it('does not invent a card for events that are not about one', () => {
    // A hand-off note is about the day and an announcement is to the household;
    // neither has a card to open, so neither should carry a param.
    for (const type of ['handoff_note', 'announcement']) {
      expect(targetForNotification({ type, card_id: 'card_123' }))
        .toEqual({ pathname: '/(tabs)/feed' });
    }
  });

  it('opens the Family hub for stars, rewards, joins and the teen loop', () => {
    for (const type of ['star_milestone', 'teen_approval', 'teen_star', 'reward_redeemed', 'family_joined', 'invite_accepted']) {
      expect(targetForNotification({ type })).toEqual({ pathname: '/(tabs)/kids' });
    }
  });

  it('never returns null for a real push (an unknown type still lands on the Feed)', () => {
    expect(targetForNotification({ type: 'something_new' })).toEqual({ pathname: '/(tabs)/feed' });
    expect(targetForNotification({})).toEqual({ pathname: '/(tabs)/feed' });
  });

  it('sends each daily reminder to the screen it is about', () => {
    // These arrive from the server now, and a tap that lands on the Feed makes
    // the notification useless: a dinner nudge you then have to go and find is
    // not a nudge.
    expect(targetForNotification({ type: 'dinner_reminder' }))
      .toEqual({ pathname: '/(tabs)/kitchen' });
    expect(targetForNotification({ type: 'calendar_nightly' }))
      .toEqual({ pathname: '/(tabs)/calendar' });
    expect(targetForNotification({ type: 'allowance_reminder' }))
      .toEqual({ pathname: '/(tabs)/kids' });
  });

  it('keeps the round-ups on the Feed, which is the screen about everything', () => {
    ['morning_digest', 'daily_tip', 'sunday_recap'].forEach((type) => {
      expect(targetForNotification({ type })).toEqual({ pathname: '/(tabs)/feed' });
    });
  });
});

/**
 * The two types added on 12 September, and the trap they both fell into.
 *
 * Reported by Roland within hours of shipping: "I received a notification that
 * payment fails but when I clicked it didn't open to show me." Neither
 * `billing_alert` nor the due-date reminder had a case here, so both hit the
 * default and opened the Feed — the screen the app already opens on, so the tap
 * looked like nothing had happened at all.
 *
 * The routing file's own comment on `support_ticket` describes that exact
 * failure. It was written down, and two new push types were added without
 * anyone reading it. Hence the last test in this block: every future type is
 * held to having a destination that is not the default.
 */
describe('a notification that reports something must not then hide it', () => {
  it('takes a billing alert to the billing section, not the Feed', () => {
    expect(targetForNotification({ type: 'billing_alert', kind: 'BILLING_ISSUE' }))
      .toEqual({ pathname: '/metrics', params: { billing: '1' } });
  });

  it('takes a vaccination reminder to the household', () => {
    // A vaccination lives on a child's record, which is reached from there.
    expect(targetForNotification({ type: 'due_vaccinations' }))
      .toEqual({ pathname: '/(tabs)/kids' });
  });

  it('takes a document expiry to the vault', () => {
    expect(targetForNotification({ type: 'due_documents' }))
      .toEqual({ pathname: '/(tabs)/vault' });
  });

  it('sends a mixed reminder somewhere honest rather than guessing', () => {
    // One push covering a vaccination AND a document cannot open both.
    expect(targetForNotification({ type: 'due_dates' }))
      .toEqual({ pathname: '/(tabs)/kids' });
  });

  it('routes every push type the server can send', () => {
    // The list the server actually emits. A type missing from the switch falls
    // through to the Feed, which is indistinguishable from a broken tap — so
    // adding a push without adding a destination fails here rather than in
    // somebody's hand.
    // Each with the payload the server actually sends it with. `chat` and
    // `gift_pot` fall back to the Feed when their id is missing, which is
    // correct behaviour and not what this check is about — passing them bare
    // put them in the failure list and made the fixture, not the router, wrong.
    const serverSends = [
      'support_ticket',
      'task_assigned', 'new_card', 'shared_card', 'card_reminder',
      'handoff_note', 'announcement',
      'morning_digest', 'daily_tip', 'sunday_recap',
      'dinner_reminder', 'calendar_nightly', 'allowance_reminder',
      'family_invite', 'family_joined', 'invite_accepted',
      'star_milestone', 'teen_approval', 'teen_star', 'reward_redeemed',
      'billing_alert', 'due_vaccinations', 'due_documents', 'due_dates',
    ];
    const withPayload: Record<string, unknown>[] = [
      ...serverSends.map((type) => ({ type })),
      { type: 'chat', thread: 'dm:~a~b' },
      { type: 'gift_pot', pot_id: 'pot_1' },
    ];
    const fallback = targetForNotification({ type: 'a-type-nobody-sends' });
    const landsOnFallback = withPayload
      .filter((d) => JSON.stringify(targetForNotification(d)) === JSON.stringify(fallback))
      .map((d) => String(d.type));
    // The digest and the recap are ABOUT everything, so the Feed is right for
    // them; they are named here so the check cannot be satisfied by widening.
    expect(landsOnFallback.sort()).toEqual([
      'announcement', 'card_reminder', 'daily_tip', 'handoff_note',
      'morning_digest', 'new_card', 'shared_card', 'sunday_recap',
      'task_assigned',
    ]);
  });
});
