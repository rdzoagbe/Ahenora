import type { Card } from './api';
import { isoWeek } from './utils/date';

/**
 * What was ticked off, as the Done card on Home and the completed-history
 * screen read it. Pure functions, kept apart from the screens so the fold,
 * the counting and the week labels can be tested without rendering.
 */
export type TFunc = (key: string, params?: Record<string, string | number>) => string;

function sameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function completedAt(card: Card): number | null {
  if (!card.completed_at) return null;
  const time = new Date(card.completed_at).getTime();
  return Number.isNaN(time) ? null : time;
}

/** "11:40" for today, "yesterday", else "6 Oct". */
export function doneWhen(iso: string | null | undefined, t: TFunc, lang: string, now = new Date()): string {
  if (!iso) return '';
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return '';
  if (sameLocalDay(when, now)) return when.toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (sameLocalDay(when, yesterday)) return t('done_yesterday');
  return when.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
}

/** Completed cards, newest first, and how many of them were in the last 7 days. */
export function completedForHome(cards: Card[], now = new Date()): { done: Card[]; weekCount: number } {
  const done = cards
    .filter((c) => c.status === 'DONE' && completedAt(c) !== null)
    .sort((a, b) => (completedAt(b) as number) - (completedAt(a) as number));
  const weekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const weekCount = done.filter((c) => (completedAt(c) as number) >= weekAgo).length;
  return { done, weekCount };
}

export interface WeekGroup { key: string; label: string; cards: Card[] }

/** Completed cards grouped by ISO week, newest week first: "This week",
 *  "Last week", then "Week N". */
export function groupByWeek(cards: Card[], t: TFunc, now = new Date()): WeekGroup[] {
  const weekKey = (d: Date) => {
    const { week } = isoWeek(d);
    // An ISO week belongs to the year of its Thursday, so the first days of
    // January can be week 52 or 53 of the year before.
    const thursday = new Date(d);
    thursday.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
    return { key: `${thursday.getFullYear()}-${String(week).padStart(2, '0')}`, week };
  };
  const thisKey = weekKey(now).key;
  const lastKey = weekKey(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)).key;

  const groups = new Map<string, WeekGroup>();
  const sorted = cards
    .filter((c) => completedAt(c) !== null)
    .sort((a, b) => (completedAt(b) as number) - (completedAt(a) as number));
  for (const card of sorted) {
    const { key, week } = weekKey(new Date(card.completed_at as string));
    let group = groups.get(key);
    if (!group) {
      const label = key === thisKey ? t('hist_this_week')
        : key === lastKey ? t('hist_last_week')
        : t('hist_week', { n: week });
      group = { key, label, cards: [] };
      groups.set(key, group);
    }
    group.cards.push(card);
  }
  return [...groups.values()];
}
