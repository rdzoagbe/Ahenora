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
    // A hand-off note is a message about the day, written to be read. It
    // lives on the Feed among everything else, so the note it names is the
    // one that opens rather than leaving the reader to find which of several
    // they were just told about.
    case 'handoff_note':
      return d.note_id
        ? { pathname: '/(tabs)/feed', params: { noteId: String(d.note_id) } }
        : { pathname: '/(tabs)/feed' };
    // An announcement is addressed to the household and has no detail behind
    // it — the notification already carried the whole message.
    case 'announcement':
      return { pathname: '/(tabs)/feed' };
    // The morning digest usually summarises the day, and the Feed is what
    // "everything" means. But when the day is ONE thing — or when the whole
    // message is "1 thing still open from earlier" — the server names that
    // card, and then the tap opens it.
    //
    // This is the report that would not go away: "no notification takes me to
    // where it's located". The routing was never wrong. The digest landed on
    // the Feed, which is the screen the app opens on anyway, so a tap that
    // worked was indistinguishable from launching the app — and a backlog item
    // from last week is not on a Feed showing today, so the one notification
    // that named a single thing led to a screen without it.
    case 'morning_digest':
      return d.card_id
        ? { pathname: '/(tabs)/feed', params: { cardId: String(d.card_id) } }
        : { pathname: '/(tabs)/feed' };
    // The weekly recap really is about everything, and the quiet-day tip is
    // about nothing in particular.
    case 'daily_tip':
    case 'sunday_recap':
      return { pathname: '/(tabs)/feed' };
    // These name a specific screen, and landing anywhere else makes the tap
    // useless: a dinner nudge you have to go and find is not a nudge.
    // "Dinner tonight: lasagne" opened the Kitchen with the evening still to
    // find on it. A reminder you then have to go looking through is not a
    // reminder, it is a second errand — so the meal it names opens, with its
    // recipe, which is the thing the cook actually needs at 17:30.
    case 'dinner_reminder':
      return d.meal_id
        ? { pathname: '/(tabs)/kitchen', params: { mealId: String(d.meal_id) } }
        : { pathname: '/(tabs)/kitchen' };
    // "Tomorrow" opened on TODAY — the one day the message is not about — so
    // the reader arrived and saw nothing they had just been told about. When
    // tomorrow holds exactly one thing, that thing opens; otherwise the day
    // does, which is what the message described.
    case 'calendar_nightly':
      return d.card_id
        ? { pathname: '/(tabs)/calendar', params: { cardId: String(d.card_id), day: String(d.day || '') } }
        : d.day
          ? { pathname: '/(tabs)/calendar', params: { day: String(d.day) } }
          : { pathname: '/(tabs)/calendar' };
    // "Keigh added milk and bread to the list" landed on the Feed, which has no
    // shopping list on it. The server sends this one to PARENTS only — the
    // people who then have to go and buy the thing — so the tap dropping them
    // one tab away from the list is the whole of its usefulness lost. Kitchen
    // opens on the shopping view, so no parameter is needed to get there.
    case 'shopping_added':
      return { pathname: '/(tabs)/kitchen' };
    // "Your Secret Santa is drawn" also landed on the Feed, and this one is
    // worse: the whole point is to find out who you are buying for, and the
    // draw is a screen the Feed cannot show.
    //
    // The push carries draw_id and the route reads drawId. Adding a case
    // without renaming it would have shipped a fix that navigated to a Santa
    // screen with nothing to open — a tap that looks like it worked and does
    // not, which is harder to notice than landing on the Feed was.
    case 'santa_draw':
      return d.draw_id
        ? { pathname: '/santa', params: { drawId: String(d.draw_id) } }
        : { pathname: '/(tabs)/feed' };
    case 'allowance_reminder':
      return { pathname: '/(tabs)/kids' };
    // The "send me a test notification" button lives in Settings. Tapping what
    // it produces fell through to the Feed — so the one notification a person
    // sends deliberately, to check that taps work, was itself a tap that went
    // nowhere. Back to the screen the button is on.
    case 'notification_test':
      return { pathname: '/(tabs)/settings' };
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
    // A vaccination lives on ONE child's record, among several children. The
    // Family screen was the right screen and the reader still had to go
    // looking — being told is not being shown. The member screen loads
    // entirely from the id, so that is all a notification needs to carry.
    case 'due_vaccinations':
      return d.member_id
        ? { pathname: '/member', params: { id: String(d.member_id) } }
        : { pathname: '/(tabs)/kids' };
    // "Roland shared a document with you" is about ONE document, and until now
    // the tap opened the Vault and stopped there — leaving the reader to find
    // the thing they had just been told about, on a screen that may hold
    // dozens. The push has always carried doc_id; nothing read it.
    case 'vault_doc':
      return d.doc_id
        ? { pathname: '/(tabs)/vault', params: { docId: String(d.doc_id) } }
        : { pathname: '/(tabs)/vault' };
    // A renewal sweep is about several documents at once, so the Vault itself
    // is the honest destination.
    // Same for a document renewal: one document among dozens.
    case 'due_documents':
      return d.doc_id
        ? { pathname: '/(tabs)/vault', params: { docId: String(d.doc_id) } }
        : { pathname: '/(tabs)/vault' };
    // Both at once. Neither screen is right, so send them where the whole
    // household is rather than guessing and being wrong half the time.
    case 'due_dates':
      return { pathname: '/(tabs)/kids' };
    // A star milestone is about one child, and their record is where the
    // stars are and where a reward is given — which is exactly what the
    // message suggests doing next.
    case 'star_milestone':
      return d.member_id
        ? { pathname: '/member', params: { id: String(d.member_id) } }
        : { pathname: '/(tabs)/kids' };
    // A star waiting on approval and a reward just redeemed both happen ON
    // somebody, and their record is where the decision gets made: approve the
    // star, see what the reward cost. The Family screen was one step short.
    case 'teen_approval':
    case 'teen_star':
    case 'reward_redeemed':
      return d.member_id
        ? { pathname: '/member', params: { id: String(d.member_id) } }
        : { pathname: '/(tabs)/kids' };
    // These really are about the household rather than one person in it:
    // somebody joined, an invitation was accepted.
    case 'family_invite':
    case 'family_joined':
    case 'invite_accepted':
      return { pathname: '/(tabs)/kids' };
    default:
      return { pathname: '/(tabs)/feed' };
  }
}

/**
 * A route path with its expo-router group segments removed, so a target can be
 * compared with the `usePathname()` the router reports after navigating.
 *
 * `router.push('/(tabs)/feed')` lands on the pathname `/feed`: groups are an
 * organisational device in the file tree and never appear in the URL. Without
 * this the arrival check below could never match, and every tap would look
 * like it had failed and be retried until it gave up.
 */
export function normalizeRoutePath(pathname: string): string {
  const cleaned = pathname
    .split('/')
    .filter((seg) => seg.length > 0 && !(seg.startsWith('(') && seg.endsWith(')')))
    .join('/');
  return '/' + cleaned;
}

/** True when the router has actually arrived at `target`. */
export function routeMatchesTarget(current: string | null | undefined, target: string): boolean {
  if (!current) return false;
  return normalizeRoutePath(current) === normalizeRoutePath(target);
}

/**
 * True when the params a target asked for are the ones actually on screen.
 *
 * The pathname alone is not arrival. A startup redirect to `/feed` lands on
 * the same pathname as a digest tap aimed at `/(tabs)/feed?cardId=...`, so a
 * pathname-only check calls it arrived, drops the held target, and the card
 * never opens — the exact symptom the whole held-target mechanism exists to
 * fix, reintroduced by the check meant to confirm it. Found in review.
 *
 * Only the params the target NAMED are compared: expo-router carries others
 * of its own, and demanding an exact match would make arrival impossible.
 */
export function paramsMatchTarget(
  current: Record<string, unknown> | null | undefined,
  wanted?: Record<string, string>,
): boolean {
  if (!wanted) return true;
  const have = current || {};
  return Object.entries(wanted).every(([key, value]) => {
    const found = have[key];
    // A param can arrive as a string or, on a repeated key, an array.
    const flat = Array.isArray(found) ? found[0] : found;
    return flat !== undefined && String(flat) === value;
  });
}
