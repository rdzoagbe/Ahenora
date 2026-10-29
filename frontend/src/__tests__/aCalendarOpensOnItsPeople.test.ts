/**
 * The calendar opens on its people.
 *
 * The final design Roland chose (2026-10-26) for the calendar: a row of the
 * household's faces to read the month one person at a time, a dot in each
 * person's colour on the days they have something, each event on a card in
 * that person's colour with their face on it, and the week ahead under the
 * month — Today, Tomorrow, then the date. This pins:
 *
 *  - the row is Home's order (you, the other adults, the children) and the
 *    children leave it when the household puts that side away;
 *  - a card is a person's by their name or their first name, the same rule
 *    that colours it on Home, so it is never one colour and another's;
 *  - narrowing to a person keeps only their cards; "Everyone" keeps all;
 *  - a day's dots are one per colour, in the cards' order, three at most,
 *    with a card nobody is named on counted as the household's;
 *  - the screen reads the week ahead only while today is the day it opened
 *    on, and asks for one day alone once a day is picked;
 *  - every new string exists in all four languages.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { calendarPeople, dayTones, firstNameOf, isTheirs, onlyTheirs } from '../calendarPeople';
import { PERSON_TONES } from '../homeFamily';
import type { FamilyMember } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const screen = read('app', '(tabs)', 'calendar.tsx');

const member = (member_id: string, name: string, over: Partial<FamilyMember> = {}): FamilyMember =>
  ({ member_id, family_id: 'fam', name, role: 'parent', stars: 0, ...over } as FamilyMember);
const jordan = member('m_me', 'Jordan Mensah', { is_me: true, standing: 'owner' });
const sam = member('m_sam', 'Sam Mensah', { standing: 'parent' });
const ama = member('m_ama', 'Ama Mensah', { role: 'child', standing: 'child' });
const leo = member('m_leo', 'Leo', { role: 'child', standing: 'child' });
const household = [leo, sam, ama, jordan];

const card = (assignee?: string) => ({ assignee });

describe('the row of faces', () => {
  it('is Home’s order: you, the other adults, the children', () => {
    expect(calendarPeople(household, false).map((m) => m.member_id)).toEqual(['m_me', 'm_sam', 'm_leo', 'm_ama']);
  });

  it('leaves the children off when the household has put that side away', () => {
    expect(calendarPeople(household, true).map((m) => m.member_id)).toEqual(['m_me', 'm_sam']);
  });

  it('skips a member with no name, who has no chip to show', () => {
    expect(calendarPeople([...household, member('m_x', '  ')], false).map((m) => m.member_id)).not.toContain('m_x');
  });

  it('shows first names on the chips', () => {
    expect(firstNameOf('Ama Mensah')).toBe('Ama');
    expect(firstNameOf('  Leo ')).toBe('Leo');
    expect(firstNameOf('')).toBe('');
  });
});

describe('whose a card is', () => {
  it('is theirs by full name or first name, whatever the casing', () => {
    expect(isTheirs(card('Ama Mensah'), ama)).toBe(true);
    expect(isTheirs(card('ama'), ama)).toBe(true);
    expect(isTheirs(card('AMA MENSAH'), ama)).toBe(true);
  });

  it('is not theirs for a sibling, a stranger, or nobody', () => {
    expect(isTheirs(card('Leo'), ama)).toBe(false);
    expect(isTheirs(card('Grandma'), ama)).toBe(false);
    expect(isTheirs(card(''), ama)).toBe(false);
    expect(isTheirs(card(undefined), ama)).toBe(false);
  });

  it('narrows to one person, and "Everyone" keeps all', () => {
    const cards = [card('Ama'), card('Leo'), card(), card('Ama Mensah')];
    expect(onlyTheirs(cards, ama)).toEqual([card('Ama'), card('Ama Mensah')]);
    expect(onlyTheirs(cards, null)).toBe(cards);
  });
});

describe('the dots under a day', () => {
  const tones = (names: (string | undefined)[]) => dayTones(names.map(card), household);

  it('are one per colour, in the order the cards come', () => {
    const [a, b] = tones(['Ama', 'Leo', 'Ama']);
    expect(tones(['Ama', 'Leo', 'Ama'])).toHaveLength(2);
    expect(a).not.toEqual(b);
    expect(PERSON_TONES).toContainEqual(a);
    expect(PERSON_TONES).toContainEqual(b);
  });

  it('count a card nobody is named on as the household’s, once', () => {
    expect(tones([undefined, undefined])).toEqual([null]);
    expect(tones(['Ama', undefined])).toEqual([expect.objectContaining({ bg: expect.any(String) }), null]);
  });

  it('stop at three', () => {
    expect(tones(['Jordan', 'Sam', 'Ama', 'Leo', undefined])).toHaveLength(3);
  });

  it('are nothing for a day with nothing on it', () => {
    expect(tones([])).toEqual([]);
  });
});

describe('the screen', () => {
  it('reads the week ahead only while today is the day it opened on', () => {
    expect(screen).toContain('const weekAhead = selectedDay === todayKey;');
    expect(screen).toContain('groupByDay(visibleCards, null).filter((g) => g.day >= todayKey && g.day <= horizonKey)');
    expect(screen).toContain('return groupByDay(visibleCards, selectedDay);');
  });

  it('narrows the month and the list, and never the agenda panel', () => {
    expect(screen).toContain('const visibleCards = useMemo(() => onlyTheirs(cards, person), [cards, person]);');
    // The dots and the groups come from the narrowed list; the sharing
    // panel still reads `cards`, because it answers a different question.
    expect(screen).toContain('visibleCards.forEach((card) => {');
    expect(screen).toMatch(/const ahead = cards\n\s+\.filter/);
  });

  it('offers the row of faces from two people, and a chip per person', () => {
    expect(screen).toContain('people.length > 1 ? (');
    expect(screen).toContain('testID="calendar-person-all"');
    expect(screen).toContain('testID={`calendar-person-${m.member_id}`}');
    expect(screen).toContain("{m.is_me ? t('home_you') : firstNameOf(m.name)}");
  });

  it('colours a card and its dot the way Home colours the person', () => {
    expect(screen).toContain('const tone = who ? personTone(who, members) : null;');
    expect(screen).toContain('tone ? { backgroundColor: ui[tone.bg] } : styles.eventCardPlain');
    expect(screen).toContain('tone ? ui[tone.fg] : ui.orange');
  });

  it('heads a week by its days, and a picked day by its name alone', () => {
    expect(screen).toContain('{weekAhead || !selectedDay ? (');
    expect(screen).toContain("if (diffDays === 0) return t('feed_today');");
    expect(screen).toContain("{weekAhead ? t('cal_next_days') : selectedDay ? formatDayFull(selectedDay) : t('upcoming')}");
  });

  it('says every new thing in all four languages', () => {
    for (const key of ['cal_everyone', 'cal_next_days', 'cal_week_empty']) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
    }
  });
});
