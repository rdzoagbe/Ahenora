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
