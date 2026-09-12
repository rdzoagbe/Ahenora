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
    // Somebody wrote to support. This fell through to the default and landed
    // on the Feed — the screen the app already opens on — so the notification
    // said a request had arrived and gave no way to find it. The inbox lives
    // on the admin screen; `support` tells it to open there rather than at
    // the top of a page of charts.
    case 'support_ticket':
      return { pathname: '/metrics', params: { support: '1' } };
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
    // The digest and the weekly recap are both about "everything", which is
    // what the Feed is.
    case 'morning_digest':
    case 'daily_tip':
    case 'sunday_recap':
      return { pathname: '/(tabs)/feed' };
    // These name a specific screen, and landing anywhere else makes the tap
    // useless: a dinner nudge you have to go and find is not a nudge.
    case 'dinner_reminder':
      return { pathname: '/(tabs)/kitchen' };
    case 'calendar_nightly':
      return { pathname: '/(tabs)/calendar' };
    case 'allowance_reminder':
      return { pathname: '/(tabs)/kids' };
    // Money leaving, and the only person who can act on it. This fell through
    // to the default and opened the Feed — reported within hours of shipping:
    // "I received a notification that payment fails but when I clicked it
    // didn't open to show me." Exactly what the support_ticket comment above
    // already describes, which is the embarrassing part: the trap was written
    // down and two new types were added without reading it.
    case 'billing_alert':
      return { pathname: '/metrics', params: { billing: '1' } };
    // '/(tabs)/kids', not '/(tabs)/family': the tab READS "Family" and the
    // route is kids. Written as /family first, and tsc said nothing because
    // these paths are plain strings — it would have shipped as a second tap
    // going nowhere, inside the fix for the first one.
    //
    // A vaccination lives on a child's record; a document lives in the vault.
    // The server types the push by which it found, so the tap can land on the
    // screen that actually holds the thing.
    case 'due_vaccinations':
      return { pathname: '/(tabs)/kids' };
    case 'due_documents':
      return { pathname: '/(tabs)/vault' };
    // Both at once. Neither screen is right, so send them where the whole
    // household is rather than guessing and being wrong half the time.
    case 'due_dates':
      return { pathname: '/(tabs)/kids' };
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
