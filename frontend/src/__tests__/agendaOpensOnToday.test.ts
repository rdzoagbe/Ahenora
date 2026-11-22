/**
 * The Agenda opens on today.
 *
 * Roland chose this page on 2026-11-22, from a design he asked to be made as
 * simple and airy as its empty-day frame. Before it, opening the Agenda showed
 * a painting of a calendar, the month's name twice, a full month grid, and no
 * event at all until you scrolled. What is held here:
 *
 *  - the page opens on the week, and remembers if somebody prefers the month;
 *  - today's date sits where the painting was, and goes back to today;
 *  - one Add in the corner; importing and custody are two links at the foot;
 *  - the faces are one button beside the day's name;
 *  - an event leads with its time, today has a line where the day has got to,
 *    and what comes after the shown day is one card;
 *  - nothing here decides that an event which has gone by was done.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { hasClock, isEarlier, minutesUntil, nextAfter, nowIndex, to24, untilParts, weekRangeLabel } from '../agendaDay';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const screen = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'calendar.tsx'), 'utf8');

const at = (h: number, m = 0) => new Date(2026, 10, 22, h, m, 0, 0);
const timed = (h: number, m = 0) => ({ due_date: at(h, m).toISOString(), time_set: true });
const allDay = () => ({ due_date: at(12).toISOString(), time_set: false });

describe('where the day has got to', () => {
  const now = at(14, 10);

  it('puts the line before the first event still to come', () => {
    expect(nowIndex([timed(10), timed(15, 30), timed(17)], now)).toBe(1);
  });

  it('puts it first when nothing has happened yet, and last when everything has', () => {
    expect(nowIndex([timed(15, 30), timed(17)], now)).toBe(0);
    expect(nowIndex([timed(8), timed(10)], now)).toBe(2);
  });

  it('draws no line on a day with nothing on it', () => {
    expect(nowIndex([], now)).toBe(-1);
  });

  it('never counts an all-day event as gone by', () => {
    // The day is not over, and a date passing is not a job done.
    expect(hasClock(allDay())).toBe(false);
    expect(isEarlier(allDay(), at(23, 59))).toBe(false);
    expect(nowIndex([allDay(), timed(10)], now)).toBe(2);
    expect(nowIndex([allDay(), timed(16)], now)).toBe(1);
  });

  it('says an event has gone by only once its time has', () => {
    expect(isEarlier(timed(10), now)).toBe(true);
    expect(isEarlier(timed(15, 30), now)).toBe(false);
    expect(isEarlier({ due_date: 'not a date' }, now)).toBe(false);
    expect(isEarlier({}, now)).toBe(false);
  });
});

describe('how soon', () => {
  const now = at(14, 10);

  it('counts the minutes to an event still to come', () => {
    expect(minutesUntil(timed(15, 30), now)).toBe(80);
    expect(minutesUntil(timed(14, 10), now)).toBeNull();
    expect(minutesUntil(timed(10), now)).toBeNull();
    expect(minutesUntil(allDay(), now)).toBeNull();
  });

  it('reads as hours and minutes, within the day', () => {
    expect(untilParts(80)).toEqual({ h: 1, m: 20 });
    expect(untilParts(45)).toEqual({ h: 0, m: 45 });
    expect(untilParts(12 * 60 + 1)).toBeNull();
    expect(untilParts(null)).toBeNull();
  });
});

describe('what comes next', () => {
  const key = (c: { due_date?: string | null }) => (c.due_date || '').slice(0, 10);
  const on = (day: string, hour: string, title: string) => ({ due_date: `${day}T${hour}:00.000Z`, title });
  const cards = [
    on('2026-11-24', '11:00', 'bank'),
    on('2026-11-23', '18:30', 'parents'),
    on('2026-11-23', '08:30', 'trip'),
    on('2026-11-22', '17:00', 'football'),
    on('2026-11-10', '09:00', 'long ago'),
  ];

  it('is the soonest event after the shown day', () => {
    expect(nextAfter(cards, '2026-11-22', '2026-11-22', key)?.title).toBe('trip');
    expect(nextAfter(cards, '2026-11-23', '2026-11-22', key)?.title).toBe('bank');
  });

  it('is never from the past: looking back, what is next is today\u2019s', () => {
    expect(nextAfter(cards, '2026-11-05', '2026-11-22', key)?.title).toBe('football');
  });

  it('is nothing when nothing is ahead', () => {
    expect(nextAfter(cards, '2026-11-24', '2026-11-22', key)).toBeNull();
    expect(nextAfter([], '2026-11-22', '2026-11-22', key)).toBeNull();
  });
});

describe('how the week and the time are written', () => {
  const week = (y: number, m: number, d: number) =>
    Array.from({ length: 7 }, (_, i) => new Date(y, m, d + i));

  it('names one month once', () => {
    expect(weekRangeLabel(week(2026, 10, 16), 'en-GB')).toBe('16 – 22 November');
  });

  it('names both months when the week crosses them', () => {
    const label = weekRangeLabel(week(2026, 10, 30), 'en-GB');
    expect(label).toMatch(/^30 Nov\S* – 6 Dec\S*$/);
  });

  it('is empty for no days', () => {
    expect(weekRangeLabel([], 'en-GB')).toBe('');
  });

  it('counts to 24 where the language does', () => {
    expect(to24('3:30', 'PM')).toBe('15:30');
    expect(to24('12:05', 'AM')).toBe('00:05');
    expect(to24('12:00', 'PM')).toBe('12:00');
    expect(to24('8:30', 'AM')).toBe('08:30');
    expect(to24('', '')).toBe('');
  });
});

describe('the screen', () => {
  it('opens on the week, and remembers the month if that was chosen', () => {
    expect(screen).toContain("useState<'month' | 'week'>('week')");
    expect(screen).toContain('AsyncStorage.getItem(CAL_VIEW_KEY)');
    expect(screen).toContain('AsyncStorage.setItem(CAL_VIEW_KEY, next)');
    expect(screen).toContain('testID="cal-view-toggle"');
  });

  it('puts today where the painting was, and it leads back to today', () => {
    expect(screen).toContain('testID="calendar-today"');
    expect(screen).toContain('onPress={goToday}');
    expect(screen).toContain('setSelectedDay(dateKey(d));');
  });

  it('keeps importing and custody as two links at the foot', () => {
    expect(screen).toContain('testID="calendar-sync-card-button"');
    expect(screen).toContain("t('cal_import_short')");
    expect(screen).toContain('testID="custody-setup"');
    // Custody is a parent's to set, and not where the household has put the
    // children's side away.
    expect(screen).toContain('{isParent && !kidsHidden ? (');
    // The pill that sat over every family's week is gone.
    expect(screen).not.toContain("t('custody_setup')");
  });

  it('still lets a sync be stopped', () => {
    expect(screen).toContain('testID="cancel-calendar-sync"');
    expect(screen).toContain('onPress={cancelSync}');
  });

  it('leads an event with its time, and draws the line only on today', () => {
    expect(screen).toContain('const lineAt = weekAhead ? nowIndex(group.items, now) : -1;');
    expect(screen).toContain('{index === lineAt ? nowLine : null}');
    expect(screen).toContain('{lineAt === group.items.length ? nowLine : null}');
    expect(screen.indexOf('style={styles.eventTime}')).toBeLessThan(screen.indexOf('testID={`calendar-card-${card.card_id}`}'));
  });

  it('shows one card for what comes next, under the day', () => {
    expect(screen).toContain('testID="calendar-next-up"');
    expect(screen).toContain('nextAfter(visibleCards, selectedDay, todayKey, cardDateKey)');
  });

  it('offers to add to an empty day, by its name', () => {
    expect(screen).toContain('testID="calendar-empty-add"');
    expect(screen).toContain("t('cal_add_for', { day: weekdayOf(selectedDay) })");
    expect(screen).toContain('testID="calendar-empty-sync"');
  });

  it('reads an event out whole, since the time column is hidden from a screen reader', () => {
    expect(screen).toContain('accessibilityLabel={spoken}');
  });

  it('says every new thing in all four languages', () => {
    const keys = ['cal_back_to_today', 'cal_week_n_see_month', 'cal_fold_to_week', 'cal_whose', 'cal_now', 'cal_past',
      'cal_in_min', 'cal_in_hm', 'cal_next_up', 'cal_nothing_today', 'cal_nothing_on', 'cal_free_day', 'cal_add_for',
      'cal_import_short'];
    for (const key of keys) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
      expect(screen).toContain(`'${key}'`);
    }
  });
});
