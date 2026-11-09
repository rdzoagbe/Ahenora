/**
 * "Whose turn?" — the rules the card shows, kept apart from the card so they
 * can be tested on their own. The server decides whose turn it is; these only
 * say it, and say it the same way everywhere.
 */
import type { FamilyMember, Turn } from './api';
import { firstNameOf } from './calendarPeople';

/** Who can be in a rotation: the children and teens, as the Family tab lists them. */
export function turnPeople(members: FamilyMember[]): FamilyMember[] {
  return members.filter((m) => ['child', 'teen'].includes(m.role?.toLowerCase() ?? ''));
}

/**
 * The one-tap starters, as translation keys. Picked because they are the
 * fights a parent referees most days: the car, the screen, the menu.
 */
export const TURN_IDEAS = ['turn_idea_front_seat', 'turn_idea_film', 'turn_idea_dinner', 'turn_idea_table'] as const;

/** Tapping a person adds them at the end of the order, or takes them out. */
export function toggleInOrder(order: string[], memberId: string): string[] {
  return order.includes(memberId) ? order.filter((m) => m !== memberId) : [...order, memberId];
}

/** First name only: "Léo", not "Léo Dzoagbe", on a line read across a room. */
export const firstName = firstNameOf;

export function nameOf(members: FamilyMember[], id: string | null | undefined): string {
  const m = members.find((x) => x.member_id === id);
  return m ? firstName(m.name) : '';
}

/**
 * What the card shows straight after "done", before the server answers. The
 * server's reply replaces it; a 409 means someone else moved it first and the
 * list is read again rather than guessed.
 */
export function advanceLocally(turn: Turn, by: string, now: Date = new Date()): Turn {
  const order = turn.member_ids;
  const current = turn.current_member_id;
  if (!current || order.length < 2) return turn;
  const next = order[(order.indexOf(current) + 1) % order.length];
  const after = order[(order.indexOf(next) + 1) % order.length];
  return {
    ...turn,
    current_member_id: next,
    next_member_id: after,
    history: [{ member_id: current, at: now.toISOString(), by }, ...turn.history].slice(0, 10),
  };
}

type Translate = (key: string, params?: Record<string, string | number>) => string;

/** "1 h ago", in the same words as the Family tab's "Latest". */
export function turnWhen(iso: string, t: Translate, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const mins = Math.max(0, Math.round((now - then) / 60000));
  if (mins < 1) return t('when_now');
  if (mins < 60) return t('when_minutes', { n: String(mins) });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t('when_hours', { n: String(hours) });
  return t('when_days', { n: String(Math.round(hours / 24)) });
}
