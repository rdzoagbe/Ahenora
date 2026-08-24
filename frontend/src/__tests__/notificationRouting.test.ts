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

  it('opens the Family hub for stars, rewards, joins and the teen loop', () => {
    for (const type of ['star_milestone', 'teen_approval', 'teen_star', 'reward_redeemed', 'family_joined', 'invite_accepted']) {
      expect(targetForNotification({ type })).toEqual({ pathname: '/(tabs)/kids' });
    }
  });

  it('never returns null for a real push (an unknown type still lands on the Feed)', () => {
    expect(targetForNotification({ type: 'something_new' })).toEqual({ pathname: '/(tabs)/feed' });
    expect(targetForNotification({})).toEqual({ pathname: '/(tabs)/feed' });
  });
});
