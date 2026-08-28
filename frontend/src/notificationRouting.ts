/**
 * Where a tapped notification should take you, decided by its data.type. Pure
 * and dependency-free on purpose, so it is testable without the expo-notifications
 * / expo-constants chain that the rest of notifications.ts pulls in.
 *
 * Until this existed nothing read data.type on tap at all — every notification
 * just opened the app wherever it happened to be, so "Roland assigned you the
 * school run" landed you on whatever screen you last saw.
 */
export function targetForNotification(data: unknown): { pathname: string; params?: Record<string, string> } | null {
  const d = (data || {}) as Record<string, unknown>;
  const type = typeof d.type === 'string' ? d.type : '';
  switch (type) {
    case 'chat':
      return d.thread
        ? { pathname: '/conversation', params: { thread: String(d.thread), title: String(d.title || '') } }
        : { pathname: '/(tabs)/feed' };
    case 'gift_pot':
      return d.pot_id
        ? { pathname: '/gift-pot', params: { potId: String(d.pot_id) } }
        : d.card_id
          ? { pathname: '/gift-pot', params: { cardId: String(d.card_id), name: String(d.name || '') } }
          : { pathname: '/(tabs)/feed' };
    // These carry the card they are about, and dropping it was the whole
    // complaint: the tap DID navigate, to the Feed, which is the screen the app
    // already opens on — so opening "Roland handed you the school run" looked
    // identical to opening the app. Passing the id through lets the Feed open
    // the thing the notification was about.
    case 'task_assigned':
    case 'new_card':
    case 'shared_card':
    case 'card_reminder':
      return d.card_id
        ? { pathname: '/(tabs)/feed', params: { cardId: String(d.card_id) } }
        : { pathname: '/(tabs)/feed' };
    // No single card to open: a hand-off note is a message about the day, and
    // an announcement is addressed to the household.
    case 'handoff_note':
    case 'announcement':
      return { pathname: '/(tabs)/feed' };
    case 'family_invite':
    case 'family_joined':
    case 'invite_accepted':
    case 'star_milestone':
    case 'teen_approval':
    case 'teen_star':
    case 'reward_redeemed':
      return { pathname: '/(tabs)/kids' };
    default:
      return { pathname: '/(tabs)/feed' };
  }
}
