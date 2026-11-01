/**
 * Home: next up, the week, and "now".
 *
 * Roland, 2026-11-01, picking between three designs: "Go with A with B's
 * touches". A puts the week as a strip and the next thing in a card of its
 * own; B adds a line where "now" is and crosses out what is already done.
 * The strip runs from today through the next six days. This pins the rules
 * (src/homeDay.ts) and how Home uses them.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { dayKey, dayRows, doneToday, isTimed, nextUp, nowLineAt, weekAhead, weekPlans } from '../homeDay';
import type { Card } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const feed = read('app', '(tabs)', 'feed.tsx');

// Saturday 31 October 2026, 15:15 local time.
const NOW = new Date(2026, 9, 31, 15, 15);
const at = (h: number, m = 0, day = 31) => new Date(2026, 9, day, h, m).toISOString();
let n = 0;
function card(over: Partial<Card>): Card {
  n += 1;
  return { card_id: `c${n}`, family_id: 'f', type: 'TASK', title: `Card ${n}`, status: 'OPEN', ...over } as Card;
}

describe('the week', () => {
  it('runs from today through the next six days, across a month end', () => {
    expect(weekAhead(NOW).map(dayKey)).toEqual([
      '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06',
    ]);
  });

  it("puts one dot per person with something on, three at most, and nothing from outside the week", () => {
    const week = weekAhead(NOW);
    const nov = (d: number, h: number) => new Date(2026, 10, d, h).toISOString();
    const plans = weekPlans([
      card({ due_date: nov(3, 10), assignee: 'Ama' }),
      card({ due_date: nov(3, 11), assignee: 'Ama' }),
      card({ due_date: nov(3, 12), assignee: 'Leo' }),
      card({ due_date: nov(3, 13), assignee: 'Roland' }),
      card({ due_date: nov(3, 14), assignee: 'Sam' }),
      card({ due_date: nov(5, 9) }),
      card({ due_date: nov(5, 9), status: 'DONE', assignee: 'Leo' }),
      card({ due_date: at(9, 0, 27), assignee: 'Ama' }),
      card({ due_date: nov(9, 9), assignee: 'Ama' }),
    ], week);
    expect(plans['2026-11-03']).toEqual(['Ama', 'Leo', 'Roland']);
    expect(plans['2026-11-05']).toEqual(['']);
    expect(plans['2026-11-04']).toEqual([]);
    expect(Object.keys(plans)).toHaveLength(7);
  });
});

describe('next up', () => {
  it('is the earliest timed thing today that has not started', () => {
    const past = card({ due_date: at(9), time_set: true, title: 'School run' });
    const soon = card({ due_date: at(18), time_set: true, title: 'Football' });
    const later = card({ due_date: at(20), time_set: true, title: 'Homework' });
    expect(nextUp([later, past, soon], NOW)?.title).toBe('Football');
  });

  it('is never something untimed, finished or on another day', () => {
    expect(nextUp([
      card({ due_date: at(12), time_set: false }),
      card({ due_date: at(18), time_set: true, status: 'DONE' }),
      card({ due_date: at(18, 0, 1 + 31), time_set: true }),
      card({}),
    ], NOW)).toBeNull();
  });

  it('reads a card from before the time flag as timed unless it sits at midnight', () => {
    expect(isTimed(card({ due_date: at(18) }))).toBe(true);
    expect(isTimed(card({ due_date: at(0) }))).toBe(false);
    expect(isTimed(card({ due_date: at(18), time_set: false }))).toBe(false);
    expect(isTimed(card({}))).toBe(false);
  });
});

describe('the rest of the day', () => {
  const school = card({ due_date: at(9), time_set: true, status: 'DONE', title: 'School run' });
  const slip = card({ due_date: at(12), time_set: false, title: 'Sign the slip' });
  const football = card({ due_date: at(18), time_set: true, title: 'Football' });
  const homework = card({ due_date: at(20), time_set: true, title: 'Homework' });
  const anytime = card({ title: 'Call the plumber' });

  it('lists timed things in order with the finished ones among them, then the day, then no date', () => {
    const rows = dayRows([anytime, homework, slip, football], [school], null);
    expect(rows.map((r) => [r.card.title, r.done])).toEqual([
      ['School run', true], ['Football', false], ['Homework', false], ['Sign the slip', false], ['Call the plumber', false],
    ]);
  });

  it('leaves out the card already shown as next up', () => {
    const rows = dayRows([football, homework], [school], football.card_id);
    expect(rows.map((r) => r.card.title)).toEqual(['School run', 'Homework']);
  });

  it('only counts as done what was due today and is finished', () => {
    const yesterday = card({ due_date: at(9, 0, 30), status: 'DONE' });
    expect(doneToday([school, football, yesterday], NOW).map((c) => c.title)).toEqual(['School run']);
  });

  it('draws "now" before the first timed thing still to come', () => {
    const rows = dayRows([homework, slip, football], [school], null);
    expect(nowLineAt(rows, NOW)).toBe(1);
  });

  it('draws "now" after the last timed thing when they are all past, and nowhere on an untimed day', () => {
    expect(nowLineAt(dayRows([slip], [school], null), NOW)).toBe(1);
    expect(nowLineAt(dayRows([slip, anytime], [], null), NOW)).toBe(-1);
  });
});

describe('the screen', () => {
  it('opens the Calendar on the day tapped in the week', () => {
    expect(feed).toMatch(/onPick=\{\(key\) => router\.navigate\(\{ pathname: '\/\(tabs\)\/calendar', params: \{ day: key \} \} as never\)\}/);
  });

  it('opens the next thing in its sheet, with a countdown', () => {
    expect(feed).toMatch(/countdown=\{relativeDue\(next\.due_date, t\)\}/);
    expect(feed).toMatch(/onOpen=\{\(\) => setSelectedCard\(next\)\}/);
  });

  it('draws the "now" line where the rules put it', () => {
    expect(feed).toMatch(/\{index === nowAt \? <NowLine styles=\{styles\} \/> : null\}/);
    expect(feed).toMatch(/\{nowAt === visibleRows\.length \? <NowLine styles=\{styles\} \/> : null\}/);
  });

  it('crosses out a finished row and does not make it a button', () => {
    const row = feed.slice(feed.indexOf('function TaskRow'), feed.indexOf('function NowLine'));
    expect(row).toMatch(/dayRowDone: \{ textDecorationLine: 'line-through' \}|done && styles\.dayRowDone/);
    expect(feed).toMatch(/dayRowDone: \{ textDecorationLine: 'line-through' \}/);
    const finished = row.slice(row.indexOf('if (done)'), row.indexOf('return (\n    <PressScale'));
    expect(finished).toMatch(/testID=\{`feed-done-row-\$\{card\.card_id\}`\}/);
    expect(finished).not.toMatch(/PressScale|onPress/);
  });

  it('gives a household without children the week in place of the stars tile', () => {
    const tiles = read('src', 'components', 'HomeDay.tsx');
    expect(tiles).toMatch(/kids && kids\.length > 0\s*\? \{ key: 'stars'/);
    expect(feed).toMatch(/const kidsStars = kidsHidden\s*\? null/);
  });

  it('leaves out the "Also today" heading when next up was the only thing left', () => {
    expect(feed).toMatch(/\{next && !loading && rows\.length === 0 \? null : \(/);
  });

  it('does not say the shopping list twice', () => {
    expect(feed).toMatch(/shopping=\{\[\]\}/);
  });
});

describe('every new string exists in all four languages', () => {
  const KEYS = [
    'home_next_up', 'home_open', 'home_also_today', 'home_now', 'home_done_mark', 'home_has_plans',
    'home_tile_dinner', 'home_tile_plan_dinner', 'home_tile_shopping', 'home_tile_items_one',
    'home_tile_items_many', 'home_tile_nothing_to_buy', 'home_tile_stars', 'home_tile_week',
    'home_tile_plans_one', 'home_tile_plans_many',
  ];
  it.each(KEYS)('%s', (key) => {
    LANGS.forEach((lang) => {
      expect(`${lang}.${key}: ${(TRANSLATIONS[lang] as Record<string, string>)[key] ?? ''}`).not.toMatch(/: $/);
    });
  });
});
