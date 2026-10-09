/**
 * What was ticked off is found from the page it was ticked off on.
 *
 * Roland, 2026-10-08, on the shipped Stage 2 Home: "too charged". And on
 * 2026-10-09, choosing the lighter design with history: it should be "easy
 * for users to find what they have removed from the feed page instead of it
 * hiding in the settings page". This pins the pieces of that:
 *
 *  - a pile of overdue work is one row in the Family pulse, not one each;
 *  - the Done card lists the newest completions and counts the week;
 *  - the history screen groups by week and labels this week and last week;
 *  - Home carries the Done card and the door to the history, Settings only a
 *    link, and every new string exists in all four languages.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { planPulseRows, OVERDUE_FOLD, MAX_PULSE_ROWS } from '../pulseRows';
import { completedForHome, groupByWeek, doneWhen } from '../completedHistory';
import type { Card } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');

const t = (key: string, params?: Record<string, string | number>) =>
  `${key}${params ? ' ' + Object.values(params).join(',') : ''}`;

let n = 0;
function card(over: Partial<Card> = {}): Card {
  n += 1;
  return {
    card_id: `c${n}`, family_id: 'fam', type: 'TASK', title: `Card ${n}`, status: 'OPEN',
    source: 'MANUAL', recurrence: 'NONE' as Card['recurrence'], reminder_minutes: 0, created_at: '2026-10-01T00:00:00Z',
    ...over,
  } as Card;
}
const due = (c: Card) => (c.due_date ? new Date(c.due_date).getTime() : null);
const at = (iso: string, over: Partial<Card> = {}) => card({ due_date: iso, ...over });

describe('a pile of overdue work is one row in the Family pulse', () => {
  it('folds three or more overdue cards into one group, oldest first', () => {
    const overdue = [at('2026-10-05T09:00:00Z'), at('2026-04-24T17:00:00Z'), at('2026-10-05T11:15:00Z')];
    const { rows, more, needing } = planPulseRows(overdue, [], due);
    expect(OVERDUE_FOLD).toBe(3);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('overdue_group');
    const group = rows[0] as { kind: 'overdue_group'; cards: Card[] };
    expect(group.cards.map((c) => c.due_date)).toEqual([
      '2026-04-24T17:00:00Z', '2026-10-05T09:00:00Z', '2026-10-05T11:15:00Z',
    ]);
    expect(more).toBe(0);
    expect(needing).toBe(3);
  });

  it('keeps one or two overdue cards as rows of their own, because the names are the summary', () => {
    const { rows } = planPulseRows([at('2026-10-05T09:00:00Z'), at('2026-10-06T09:00:00Z')], [], due);
    expect(rows.map((r) => r.kind)).toEqual(['overdue', 'overdue']);
  });

  it('lists handed-over work after the overdue row, and counts the rest behind +N', () => {
    const overdue = [at('2026-10-05T09:00:00Z'), at('2026-10-04T09:00:00Z'), at('2026-10-03T09:00:00Z')];
    const handed = [card(), card(), card(), card(), card()];
    const { rows, more, needing } = planPulseRows(overdue, handed, due);
    expect(rows.map((r) => r.kind)).toEqual(['overdue_group', 'handed', 'handed', 'handed']);
    expect(rows).toHaveLength(MAX_PULSE_ROWS);
    expect(more).toBe(2);
    expect(needing).toBe(8);
  });

  it('shows a card that is both overdue and handed to you once, as handed', () => {
    const both = at('2026-10-01T09:00:00Z');
    const { rows, needing } = planPulseRows([both, at('2026-10-02T09:00:00Z')], [both], due);
    expect(rows.map((r) => r.kind)).toEqual(['overdue', 'handed']);
    expect(needing).toBe(2);
  });
});

describe('the Done card on Home', () => {
  const now = new Date('2026-10-09T12:00:00Z');

  it('lists completed cards newest first and counts the last seven days', () => {
    const cards = [
      card({ status: 'DONE', completed_at: '2026-10-08T11:40:00Z', title: 'Medication' }),
      card({ status: 'OPEN', title: 'Still open' }),
      card({ status: 'DONE', completed_at: '2026-10-09T08:15:00Z', title: 'School run' }),
      card({ status: 'DONE', completed_at: '2026-09-20T08:15:00Z', title: 'Old' }),
      card({ status: 'DONE', completed_at: null, title: 'No time recorded' }),
    ];
    const { done, weekCount } = completedForHome(cards, now);
    expect(done.map((c) => c.title)).toEqual(['School run', 'Medication', 'Old']);
    expect(weekCount).toBe(2);
  });

  it('says when in the words a person would use', () => {
    expect(doneWhen('2026-10-09T11:40:00Z', t, 'en-GB', new Date('2026-10-09T15:00:00Z'))).toMatch(/11:40|12:40|13:40/);
    expect(doneWhen('2026-10-08T11:40:00Z', t, 'en-GB', new Date('2026-10-09T15:00:00Z'))).toBe('done_yesterday');
    expect(doneWhen('2026-10-01T11:40:00Z', t, 'en-GB', new Date('2026-10-09T15:00:00Z'))).toMatch(/1 Oct/);
    expect(doneWhen(null, t, 'en-GB')).toBe('');
  });
});

describe('the history screen groups by week', () => {
  it('labels this week and last week, then the week number, newest first', () => {
    const now = new Date('2026-10-09T12:00:00Z'); // Friday of ISO week 41
    const groups = groupByWeek([
      card({ status: 'DONE', completed_at: '2026-09-22T10:00:00Z', title: 'week 39' }),
      card({ status: 'DONE', completed_at: '2026-10-07T10:00:00Z', title: 'this week' }),
      card({ status: 'DONE', completed_at: '2026-09-30T10:00:00Z', title: 'last week' }),
      card({ status: 'DONE', completed_at: '2026-10-05T10:00:00Z', title: 'this week too' }),
    ], t, now);
    expect(groups.map((g) => g.label)).toEqual(['hist_this_week', 'hist_last_week', 'hist_week 39']);
    expect(groups[0].cards.map((c) => c.title)).toEqual(['this week', 'this week too']);
  });
});

describe('where things live', () => {
  const feed = read('app', '(tabs)', 'feed.tsx');
  const settings = read('app', '(tabs)', 'settings.tsx');
  const layout = read('app', '_layout.tsx');
  const server = read('..', 'backend', 'server.py');

  it('Home carries the Done card and the door to the whole record', () => {
    expect(feed).toContain('<DoneCard');
    expect(feed).toContain("router.push('/history'");
    // Ticked cards no longer sit greyed inside Today.
    expect(feed).not.toContain('DoneRow');
    // And overdue is said once: the pill under the greeting is gone.
    expect(feed).not.toContain('calmPill');
  });

  it('Settings only links to the history now', () => {
    expect(settings).toContain("router.push('/history'");
    expect(settings).not.toContain('expandHistory');
    expect(settings).not.toContain("api.listCards('DONE')");
  });

  it('the history screen is a registered route', () => {
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'app', 'history.tsx'))).toBe(true);
    expect(layout).toContain('<Stack.Screen name="history" />');
  });

  it('the server lists what you hid and can show it again', () => {
    expect(server).toContain('@app.get("/api/activity/hidden")');
    expect(server).toContain('@app.post("/api/activity/{activity_id}/unhide")');
  });

  it('every new string exists in all four languages', () => {
    const keys = [
      'pulse_overdue_n', 'pulse_overdue_oldest',
      'done_title', 'done_this_week', 'done_this_week_one', 'done_undo', 'done_see_all', 'done_yesterday',
      'hist_title', 'hist_this_week', 'hist_last_week', 'hist_week', 'hist_empty',
      'hist_hidden_title', 'hist_hidden_sub', 'hist_unhide', 'set_completed_history_sub',
    ];
    expect(LANGS.length).toBeGreaterThanOrEqual(4);
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      for (const key of keys) {
        expect(`${lang}:${key}:${typeof table[key]}`).toBe(`${lang}:${key}:string`);
        expect(table[key].trim().length).toBeGreaterThan(0);
      }
      // The collapsed row under Today says what is inside it now.
      expect(table.feed_household).not.toMatch(/^(Household|Hogar|Le foyer|Haushalt)$/);
    }
  });
});
