/**
 * What to say after a pull-to-refresh.
 *
 * Roland, on the Calendar: "when I pull down I do not get the popup that says
 * what's been imported — that's why I think it's not working."
 *
 * The gesture worked. The spinner turned, everything reloaded, and the screen
 * said nothing at all — so on a day when nothing had changed there was no way
 * to tell the difference between a refresh that ran and a refresh that never
 * fired. He concluded the feature was broken, which is a fair reading of the
 * evidence he had.
 *
 * The repository already had the principle written down, one layer up, in the
 * test that fixed what refresh RELOADS:
 *
 *   "A spinner that runs, finishes, and leaves the screen saying the same
 *    thing is worse than no spinner. It is an answer, and the answer is wrong."
 *
 * That was about the data being incomplete. This is the same sentence about
 * the person: an answer nobody can hear is not an answer.
 *
 * So: count what the screen holds before and after, and say which of three
 * things happened. Kept as a pure function because the interesting part is the
 * decision, not the toast — and because "nothing changed" has to be a SPOKEN
 * outcome rather than a silence, which is the whole bug.
 */

export interface RefreshSnapshot {
  /** Everything the screen lists — events, tasks, whatever it is about. */
  items: number;
  /** Things arrived but not yet decided on: events proposed by a sync or a
   *  scan, waiting for a keep-or-discard. Absent on screens with no such idea. */
  waiting?: number;
}

export interface RefreshOutcome {
  key: string;
  params?: Record<string, string>;
}

/**
 * Three outcomes, in the order a person cares about them.
 *
 * Something waiting on a DECISION outranks something merely new, because it
 * is the one that needs them. New items come next. "Up to date" is last and
 * is never skipped: it is the answer that was missing.
 *
 * A drop in either count is still "up to date" rather than "3 fewer". A
 * co-parent ticking things off is not news, and a refresh that reported
 * subtractions would read as though this device had lost something.
 */
export function refreshOutcome(
  before: RefreshSnapshot, after: RefreshSnapshot,
): RefreshOutcome {
  const newlyWaiting = (after.waiting ?? 0) - (before.waiting ?? 0);
  if (newlyWaiting > 0) {
    return { key: 'refresh_waiting', params: { n: String(newlyWaiting) } };
  }
  const arrived = after.items - before.items;
  if (arrived > 0) {
    return arrived === 1
      ? { key: 'refresh_one_new' }
      : { key: 'refresh_many_new', params: { n: String(arrived) } };
  }
  return { key: 'refresh_up_to_date' };
}

/**
 * Drop a waiting-count the screen is not currently showing.
 *
 * A screen can load more than it displays. The Family tab loads the teen
 * approvals whether or not the approvals card is on screen — open one child's
 * profile and the card is gone, because it sits behind the same gate as the
 * roster it belongs to.
 *
 * A refresh there must not announce "2 waiting for you to decide". The count
 * is true, but it points at a card the person cannot see from where they are
 * standing, and a prompt to decide something invisible is worse than no
 * prompt: it reads as a bug, which is exactly the complaint this whole
 * feature exists to answer.
 *
 * Only the waiting-count is dropped. Items are what the screen is a list of,
 * so they are always its own news.
 */
export function onlyWhatIsOnScreen(
  snapshot: RefreshSnapshot, showsWaiting: boolean,
): RefreshSnapshot {
  return showsWaiting ? snapshot : { items: snapshot.items };
}
