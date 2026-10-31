import type { CustodyConfig, FamilyMember, MealPlan } from './api';
import { isoWeek } from './utils/date';
import type { HeroScene } from './homeHeroArt';

/**
 * What the top of Home says about the people in it. Pure, so it can be tested
 * without a screen.
 *
 * Roland, 2026-10-23, on the redesign: "if I was a mom or dad, I'd have a hard
 * time with this. It's not very family oriented." So Home now opens on the
 * family — their faces, and whose week it is said as a sentence — before the
 * day's list. The week number and its parity stay in the grey day line for a
 * co-parent who reads a judgment by it; the sentence is for everyone else.
 */

type TFunc = (key: string, params?: Record<string, string | number>) => string;

/** A child or a teen: the people a custody schedule is about. */
export function isChild(m: FamilyMember): boolean {
  const standing = (m.standing || m.role || '').toLowerCase();
  return standing === 'child' || standing === 'teen';
}

/** "Ama", "Ama and Leo", "Ama, Leo and Kofi" — in the app's own language. */
export function joinNames(names: string[], t: TFunc): string {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} ${t('home_and')} ${names[names.length - 1]}`;
}

const firstName = (name: string) => (name || '').trim().split(/\s+/)[0] || '';

/**
 * "Ama and Leo are with you this week", or "… with the other parent this
 * week". Null when there is nothing true to say: no schedule, no children, or
 * a plan with the children's side put away.
 */
export function custodySentence(
  members: FamilyMember[],
  custody: CustodyConfig | null | undefined,
  now: Date | null,
  t: TFunc,
): string | null {
  if (!now || !custody?.enabled) return null;
  const kids = members.filter(isChild).map((m) => firstName(m.name)).filter(Boolean);
  if (kids.length === 0) return null;
  const { even } = isoWeek(now);
  const ours = custody.our_weeks === 'even' ? even : !even;
  const names = joinNames(kids, t);
  const count = kids.length === 1 ? 'one' : 'many';
  if (ours) return t(`home_custody_ours_${count}`, { names });
  const where = custody.away_label.trim()
    ? t('custody_away_named', { who: custody.away_label.trim() })
    : t('custody_away');
  return t(`home_custody_away_${count}`, { names, where });
}

/** Everyone in the household, you first, then the other adults, then the children. */
export function familyFaces(members: FamilyMember[]): FamilyMember[] {
  const rank = (m: FamilyMember) => (m.is_me ? 0 : isChild(m) ? 2 : 1);
  return [...members].sort((a, b) => rank(a) - rank(b));
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Tonight's meal from the week's plan: the dinner if one is planned, otherwise
 * whatever is planned for today. Meals are filed by English weekday name
 * ("friday"), which is how the Kitchen writes them.
 */
export function dinnerTonight(meals: MealPlan[], now: Date | null): MealPlan | null {
  if (!now) return null;
  const today = WEEKDAYS[now.getDay()];
  const todays = meals.filter((m) => (m.day || '').toLowerCase() === today);
  return todays.find((m) => m.meal_type === 'dinner') || todays[0] || null;
}

/**
 * Each person's colour, so a row says whose it is before you read the
 * initials: one of the brand's four tile hues, never the orange, which is how
 * the app says "do this" and "overdue". Given in the order the faces sit on
 * Home (you first), so the same person keeps the same colour on every row.
 * A name nobody in the household carries (an old card, a typed name) still
 * gets a steady colour, from the letters of the name.
 */
export const PERSON_TONES = [
  { bg: 'blue', fg: 'blueText' },
  { bg: 'lavender', fg: 'lavenderText' },
  { bg: 'mint', fg: 'mintText' },
  { bg: 'gold', fg: 'goldText' },
] as const;
export type PersonTone = (typeof PERSON_TONES)[number];

export function personTone(name: string, members: FamilyMember[]): PersonTone {
  const wanted = (name || '').trim().toLowerCase();
  const faces = familyFaces(members);
  const at = faces.findIndex((m) => {
    const full = (m.name || '').trim().toLowerCase();
    return full === wanted || firstName(full) === wanted;
  });
  if (at >= 0) return PERSON_TONES[at % PERSON_TONES.length];
  let sum = 0;
  for (const ch of wanted) sum += ch.charCodeAt(0);
  return PERSON_TONES[sum % PERSON_TONES.length];
}

/**
 * Which picture greets a household at the top of Home.
 *
 * Read from who is in it, never from a name: a name says nothing reliable
 * about whether someone is a mum or a dad, so one adult with children gets the
 * children on their own, which is right for either. Two adults or more with
 * children get the whole family; a grandparent is someone whose own stated
 * relationship says so. Without children (or with their side of the app put
 * away) it is a couple, or one person at home. Helpers are not the household.
 */
export function homeHeroScene(members: FamilyMember[], kidsHidden: boolean): HeroScene {
  const helper = (m: FamilyMember) => (m.standing || '').toLowerCase() === 'helper';
  const adults = members.filter((m) => !isChild(m) && !helper(m));
  const kids = kidsHidden ? [] : members.filter(isChild);
  const me = members.find((m) => m.is_me);
  if (kids.length > 0) {
    if (me && /grand/i.test(me.role || '')) return 'grandparent';
    return adults.length >= 2 ? 'family' : 'children';
  }
  return adults.length >= 2 ? 'couple' : 'solo';
}
