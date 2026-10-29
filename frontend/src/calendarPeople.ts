import type { Card, FamilyMember } from './api';
import { familyFaces, isChild, personTone, PersonTone } from './homeFamily';

/**
 * Whose calendar it is. Pure, so it can be tested without a screen.
 *
 * The final design Roland chose (2026-10-26) opens the calendar on the
 * people in it: a row of faces to narrow the month to one person, a dot in
 * each person's colour on the days they have something, and each event on
 * a card in that person's colour. The colours are the ones Home gives
 * everyone, so a parent moving between the two screens sees the same
 * person in the same colour.
 */

const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase();
const first = (s: string | null | undefined) => norm(s).split(/\s+/)[0] || '';

/** "Ama" for "Ama Mensah": what fits on a chip. */
export function firstNameOf(name: string | null | undefined): string {
  return (name || '').trim().split(/\s+/)[0] || '';
}

/**
 * The people the calendar can be narrowed to, in Home's order: you first,
 * then the other adults, then the children. The children stay off the row
 * when the household has put that side away (Duo, or the setting).
 */
export function calendarPeople(members: FamilyMember[], kidsHidden: boolean): FamilyMember[] {
  return familyFaces(members).filter((m) => norm(m.name) && (!kidsHidden || !isChild(m)));
}

/**
 * Whether a card is this person's. An assignee is a typed name, so it is
 * theirs when it is their name or their first name — the same rule that
 * gives the card its colour on Home, so a card can never be coloured as one
 * person and filed under another.
 */
export function isTheirs(card: Pick<Card, 'assignee'>, member: FamilyMember): boolean {
  const who = norm(card.assignee);
  if (!who) return false;
  const full = norm(member.name);
  return who === full || first(full) === who;
}

/** The cards to show: everyone's, or one person's. */
export function onlyTheirs<T extends Pick<Card, 'assignee'>>(cards: T[], member: FamilyMember | null): T[] {
  return member ? cards.filter((c) => isTheirs(c, member)) : cards;
}

/**
 * The dots under a day: one per colour with something on that day, in the
 * order the cards come, three at most. Null stands for a card nobody is
 * named on — the household's, drawn in the brand colour as before.
 */
export function dayTones(cards: Pick<Card, 'assignee'>[], members: FamilyMember[]): (PersonTone | null)[] {
  const out: (PersonTone | null)[] = [];
  const seen = new Set<string>();
  for (const card of cards) {
    const who = (card.assignee || '').trim();
    const tone = who ? personTone(who, members) : null;
    const key = tone ? tone.fg : '';
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tone);
    if (out.length === 3) break;
  }
  return out;
}
