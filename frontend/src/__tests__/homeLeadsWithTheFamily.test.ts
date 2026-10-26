/**
 * Home opens on the family.
 *
 * Roland, 2026-10-23, on the redesign: "if I was a mom or dad, I'd have a hard
 * time with this. It's not very family oriented." The final design he chose
 * puts the family at the top of Home. This pins the pieces of it:
 *
 *  - whose week it is reads as a sentence with the children's names, in the
 *    family's own words for the other home, and says nothing when there is
 *    nothing true to say;
 *  - everyone's face is on Home, you first, and opens the same page the
 *    Family tab opens;
 *  - tonight's planned meal is on Home, and an unplanned evening shows nothing;
 *  - the day's list shows three before "See all";
 *  - the picture is drawn in the repo, not fetched from anywhere;
 *  - every new string exists in all four languages.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS, translate } from '../i18n';
import { custodySentence, dinnerTonight, familyFaces, joinNames } from '../homeFamily';
import { memberRoute } from '../memberRoute';
import type { CustodyConfig, FamilyMember, MealPlan } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const en = (key: string, params?: Record<string, string | number>) => translate('en', key, params);
const fr = (key: string, params?: Record<string, string | number>) => translate('fr', key, params);

function member(over: Partial<FamilyMember>): FamilyMember {
  return { member_id: over.name || 'm', family_id: 'fam', name: 'Someone', role: 'parent', stars: 0, ...over } as FamilyMember;
}
const ama = member({ member_id: 'm_ama', name: 'Ama Mensah', role: 'child', standing: 'child' });
const leo = member({ member_id: 'm_leo', name: 'Leo', role: 'child', standing: 'child' });
const kofi = member({ member_id: 'm_kofi', name: 'Kofi', role: 'teen', standing: 'teen', user_id: 'u_kofi' });
const me = member({ member_id: 'm_me', name: 'Jordan', role: 'parent', standing: 'owner', is_me: true });
const sam = member({ member_id: 'm_sam', name: 'Sam', role: 'co-parent', standing: 'parent' });

// Friday 23 October 2026 is in ISO week 43, an odd week.
const FRIDAY_ODD = new Date(2026, 9, 23, 15, 0);
const custody = (over: Partial<CustodyConfig> = {}): CustodyConfig => ({ enabled: true, our_weeks: 'odd', away_label: '', ...over });

describe('whose week it is, as a sentence', () => {
  it('names the children on our weeks', () => {
    expect(custodySentence([me, ama, leo], custody(), FRIDAY_ODD, en)).toBe('Ama and Leo are with you this week');
    expect(custodySentence([me, ama], custody(), FRIDAY_ODD, en)).toBe('Ama is with you this week');
  });

  it("uses the family's own word for the other home, and a plain one otherwise", () => {
    expect(custodySentence([ama, leo], custody({ our_weeks: 'even', away_label: 'Dad' }), FRIDAY_ODD, en))
      .toBe('Ama and Leo are with Dad this week');
    expect(custodySentence([ama, leo], custody({ our_weeks: 'even' }), FRIDAY_ODD, en))
      .toBe('Ama and Leo are with the other parent this week');
    expect(custodySentence([ama, leo], custody({ our_weeks: 'even' }), FRIDAY_ODD, fr))
      .toBe("Ama et Leo sont chez l'autre parent cette semaine");
  });

  it('counts teens as children and joins three names', () => {
    expect(joinNames(['Ama', 'Leo', 'Kofi'], en)).toBe('Ama, Leo and Kofi');
    expect(custodySentence([ama, leo, kofi], custody(), FRIDAY_ODD, en)).toBe('Ama, Leo and Kofi are with you this week');
  });

  it('says nothing when there is nothing true to say', () => {
    expect(custodySentence([me, ama], custody({ enabled: false }), FRIDAY_ODD, en)).toBeNull();
    expect(custodySentence([me, ama], null, FRIDAY_ODD, en)).toBeNull();
    expect(custodySentence([me, sam], custody(), FRIDAY_ODD, en)).toBeNull();
    expect(custodySentence([me, ama], custody(), null, en)).toBeNull();
  });
});

describe("everyone's face is on Home", () => {
  it('puts you first, then the other adults, then the children', () => {
    expect(familyFaces([ama, sam, leo, me]).map((m) => m.member_id)).toEqual(['m_me', 'm_sam', 'm_ama', 'm_leo']);
  });

  it('opens the same page, with the same thread, as the Family tab', () => {
    expect(memberRoute(sam).params.thread).toBe('adults');
    expect(memberRoute(kofi).params.thread).toBe('u_kofi');
    expect(memberRoute(ama)).toEqual({ pathname: '/member', params: { id: 'm_ama', name: 'Ama Mensah', role: 'child', thread: '' } });
    expect(read('app', '(tabs)', 'kids.tsx')).toMatch(/router\.push\(memberRoute\(m\)\)/);
    expect(read('app', '(tabs)', 'feed.tsx')).toMatch(/onOpenMember=\{\(m\) => router\.push\(memberRoute\(m\)\)\}/);
  });
});

describe("tonight's dinner is on Home", () => {
  const meal = (over: Partial<MealPlan>): MealPlan =>
    ({ meal_id: over.title || 'x', family_id: 'fam', day: 'friday', meal_type: 'dinner', title: 'Jollof rice', ingredients: [], ...over }) as MealPlan;

  it("prefers the evening meal, and falls back to anything planned today", () => {
    const lunch = meal({ title: 'Soup', meal_type: 'lunch' });
    const dinner = meal({ title: 'Jollof rice' });
    expect(dinnerTonight([lunch, dinner], FRIDAY_ODD)?.title).toBe('Jollof rice');
    expect(dinnerTonight([lunch], FRIDAY_ODD)?.title).toBe('Soup');
  });

  it('shows nothing on an evening nobody planned', () => {
    expect(dinnerTonight([meal({ day: 'saturday' })], FRIDAY_ODD)).toBeNull();
    expect(dinnerTonight([], FRIDAY_ODD)).toBeNull();
    expect(dinnerTonight([meal({})], null)).toBeNull();
  });
});

describe('the screen', () => {
  const feed = read('app', '(tabs)', 'feed.tsx');

  it('renders the family band above the day, and dinner under it', () => {
    const band = feed.indexOf('<FamilyBand');
    const today = feed.indexOf("accessibilityRole=\"header\">{t('feed_today')}");
    const dinner = feed.indexOf('<DinnerTonight');
    expect(band).toBeGreaterThan(-1);
    expect(band).toBeLessThan(today);
    expect(dinner).toBeGreaterThan(today);
  });

  it('keeps the children off Home on a plan with their side put away', () => {
    expect(feed).toMatch(/members=\{kidsHidden \? members\.filter\(\(m\) => !isChild\(m\)\) : members\}/);
    expect(feed).toMatch(/const showFamilyPicture = !kidsHidden && members\.some\(isChild\);/);
    expect(feed).toMatch(/const custodyLine = kidsHidden \? null :/);
  });

  it('shows three of the day before "See all"', () => {
    expect(feed).toMatch(/const TASK_CAP = 3;/);
  });

  it('says the schedule once: no "· with you" in the day line when the sentence shows', () => {
    expect(feed).toMatch(/feedWeekLine\(now, t, kidsHidden \|\| custodyLine \? null : subscription\?\.custody\)/);
  });

  it('draws the picture in the repo instead of fetching one', () => {
    const band = read('src', 'components', 'FamilyBand.tsx');
    const urls = band.match(/https?:\/\/[^\s"'`]+/g) || [];
    expect(urls.filter((u) => !u.startsWith('http://www.w3.org/2000/svg'))).toEqual([]);
  });
});

describe('every new string exists in all four languages', () => {
  const KEYS = [
    'home_and', 'home_you', 'home_custody_ours_one', 'home_custody_ours_many',
    'home_custody_away_one', 'home_custody_away_many', 'home_illustration_label', 'home_dinner_tonight',
  ];
  it.each(KEYS)('%s', (key) => {
    LANGS.forEach((lang) => {
      expect(`${lang}.${key}: ${(TRANSLATIONS[lang] as Record<string, string>)[key] ?? ''}`).not.toMatch(/: $/);
    });
  });
});
