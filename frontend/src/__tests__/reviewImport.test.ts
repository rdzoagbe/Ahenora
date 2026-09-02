/**
 * The review step: what a sync proposes, and what the person does about it.
 *
 * Sync used to write every event straight into the calendar and then announce
 * a total — "23 imported". A count of work already done is not something a
 * person can act on. Now the events are staged and the app shows a list they
 * can edit.
 *
 * Source-level, like the other guideline checks in this suite: these assert the
 * contract between the screen and the server, which is what breaks silently.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', '..', ...p), 'utf8');
const SHEET = read('src', 'components', 'ReviewImportSheet.tsx');
const CALENDAR = read('app', '(tabs)', 'calendar.tsx');
const API = read('src', 'api.ts');
const I18N = read('src', 'i18n.ts');

describe('import goes through review', () => {
  it('both calendar syncs ask the server to stage, not to write', () => {
    expect(CALENDAR).toContain('api.importGoogleCalendar(accessToken, 30, true)');
    expect(CALENDAR).toContain('api.importMicrosoftCalendar(accessToken, 30, true)');
  });

  it('review is an explicit argument, not a server-side default', () => {
    // An older build cannot open the review list. If the server defaulted to
    // staging, that build would import into a queue nobody could reach — the
    // events would simply vanish.
    expect(API).toMatch(/importGoogleCalendar:\s*\(access_token: string, days = 30, review = false\)/);
    expect(API).toMatch(/importMicrosoftCalendar:\s*\(access_token: string, days = 30, review = false\)/);
  });

  it('opens the list instead of announcing a total', () => {
    expect(CALENDAR).toContain('if (result.imported > 0) setReviewOpen(true);');
    expect(CALENDAR).toContain('<ReviewImportSheet');
  });

  it('still reports plainly when a sync found nothing', () => {
    // The empty case has nothing to review, so the old message is right.
    expect(CALENDAR).toContain("else Alert.alert(t('cal_calendar_synced'), syncSummary(result));");
  });
});

describe('the review sheet', () => {
  it('starts with everything kept', () => {
    // "These are mine" is the common answer. Starting from nothing selected
    // makes the honest answer the most work, and people tap Keep all blind.
    expect(SHEET).toContain('initial[c.candidate_id] = true;');
  });

  it('sends the unticked ones as drops, not merely as unkept', () => {
    // Leaving them out would keep them queued forever and the list would
    // reappear on the next sync.
    expect(SHEET).toContain('const droppedIds = items.filter((c) => !keep[c.candidate_id])');
    expect(SHEET).toContain('drop: droppedIds,');
  });

  it('asks about sharing once, after the picking step', () => {
    expect(SHEET).toContain("const [step, setStep] = useState<'pick' | 'share'>('pick')");
    expect(SHEET).toContain("setStep('share')");
  });

  it('offers everyone, one person, or nobody', () => {
    for (const id of ['review-share-all', 'review-share-none']) {
      expect(SHEET).toContain(id);
    }
    expect(SHEET).toContain('review-share-${m.member_id}');
  });

  it('never offers to hand something to yourself', () => {
    expect(SHEET).toContain('m.filter((x) => x.name !== user?.name)');
  });

  it('cannot be double-submitted', () => {
    expect(SHEET).toContain('if (busy) return;');
  });

  it('translates every string it renders, in all four languages', () => {
    const keys = Array.from(SHEET.matchAll(/t\('([a-z0-9_]+)'/g)).map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(8);
    for (const key of new Set(keys)) {
      const hits = I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || [];
      expect(`${key}:${hits.length}`).toBe(`${key}:4`);
    }
  });
});

describe('putting an event on a date', () => {
  it('tapping the selected day again opens the create sheet on it', () => {
    // Every calendar people already use lets you touch a date to add to it.
    // Here the gesture only filtered a list, and the way in was a separate
    // button you had to notice.
    expect(CALENDAR).toContain('if (selectedDay === key) {');
    expect(CALENDAR).toContain('openAddEventOn(date);');
  });

  it('the first tap still just shows the day', () => {
    // Opening a create sheet before the person has seen what is on that day
    // talks over the answer to the question they asked by tapping.
    expect(CALENDAR).toContain('selectDayOnly(key, date);');
  });

  it('the button and the day-tap share one prefill path', () => {
    // Two constructions of "noon on the chosen day" is how they drift apart.
    const opener = CALENDAR.slice(
      CALENDAR.indexOf('const openAddEventOn'),
      CALENDAR.indexOf('const openAddEvent ='));
    expect(opener).toContain('base.setHours(12, 0, 0, 0);');
    expect(CALENDAR).toContain('openAddEventOn(selectedDay ?');
  });

  it('the + prefills the day being looked at, not today', () => {
    const capture = read('src', 'components', 'GlobalCapture.tsx');
    expect(capture).toContain('selectedCalendarDayAt()');
    expect(capture).not.toContain('due_date: new Date().toISOString()');
  });

  it('the shared day is cleared when the calendar goes away', () => {
    // Otherwise "+" on another screen inherits a date from a screen nobody
    // is looking at.
    expect(CALENDAR).toContain('return () => setSelectedCalendarDay(null);');
  });

  it('builds the day at noon, not midnight', () => {
    // Midnight local sent as UTC lands on the previous day west of Greenwich,
    // so an event added on the 14th shows up on the 13th.
    const bridge = read('src', 'calendarSelection.ts');
    expect(bridge).toContain('date.setHours(hour, 0, 0, 0);');
    expect(bridge).toContain('hour = 12');
  });
});

describe('a birthday actually repeats', () => {
  const MODAL = read('src', 'components', 'AddCardModal.tsx');

  it('yearly is offered', () => {
    expect(MODAL).toContain("'none', 'daily', 'weekly', 'monthly', 'yearly'");
    expect(API).toContain("'monthly' | 'yearly'");
  });

  it('picking BIRTHDAY implies it', () => {
    expect(MODAL).toContain("if (typ.key === 'BIRTHDAY') setRecurrence('yearly');");
  });

  it('and leaving BIRTHDAY takes it back', () => {
    // Otherwise a dentist appointment quietly inherits "every year".
    expect(MODAL).toContain("else if (recurrence === 'yearly') setRecurrence('none');");
  });

  it('is translated everywhere', () => {
    const hits = I18N.match(/^\s*rec_yearly:/gm) || [];
    expect(hits).toHaveLength(4);
  });
});

describe('the waiting count is visible', () => {
  it('shows a pill when something is pending', () => {
    expect(CALENDAR).toContain('calendar-pending-review');
    expect(CALENDAR).toContain('pendingCount > 0 && !reviewOpen');
  });

  it('refreshes on focus and after a review', () => {
    expect(CALENDAR).toContain('load(); refreshPending();');
    expect(CALENDAR).toContain('setReviewOpen(false); load(); refreshPending();');
  });

  it('a failed count never breaks the calendar', () => {
    expect(CALENDAR).toContain('.catch(() => setPendingCount(0));');
  });
});
