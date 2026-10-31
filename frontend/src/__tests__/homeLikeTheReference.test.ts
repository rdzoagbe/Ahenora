/**
 * Home looks like the reference Roland chose.
 *
 * Roland, 2026-10-31, holding his reference next to the shipped Home: "this is
 * the exact view I wanted to have". This pins the shape of it:
 *
 *  - the greeting is to the family, with the time of day as a sun or a moon,
 *    and one line under it;
 *  - a tall family picture, with the day's card laid over its bottom edge;
 *  - the card is titled with the date and says how many things the day holds;
 *  - each row is a coloured tile for what it is, the title, when and who, and
 *    a chevron, with no checkbox (ticking off is in the sheet the row opens);
 *  - four quick actions under the day, each wired to something real;
 *  - a calm day shows no "nothing needs you" card;
 *  - each kind of household has its own picture slot, chosen from who is in
 *    it and never from a name, and no children are drawn where there are none;
 *  - every tile colour is legible, and every new string exists in all four
 *    languages.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { QUICK_TILE, TILE, tileFor } from '../homeTiles';
import { HERO_SCENES, HOME_HERO_ART, heroHasPicture } from '../homeHeroArt';
import { homeHeroScene } from '../homeFamily';
import type { CardType, FamilyMember } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const feed = read('app', '(tabs)', 'feed.tsx');

function luminance(hex: string): number {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('the order of the screen', () => {
  it('greeting, picture, the day, then the quick actions', () => {
    const order = [
      'styles.greet}',
      '<HomeHero',
      'testID="home-today-card"',
      '<HomeQuickActions',
      '<FamilyPulse',
      'testID="feed-capture-input"',
    ].map((needle) => feed.indexOf(needle));
    order.forEach((at) => expect(at).toBeGreaterThan(-1));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('greets the family (or you, when you live alone), with a sun by day and a moon in the evening', () => {
    expect(feed).toMatch(/const greetName = heroScene === 'solo'/);
    expect(feed).toMatch(/: t\('home_family'\);/);
    expect(feed).toMatch(/\? <Moon /);
    expect(feed).toMatch(/: <Sun /);
    expect(feed).toMatch(/evening \? t\('home_tagline_evening'\) : t\('home_tagline_day'\)/);
  });

  it('renders no time of day before the clock is known, so the web page hydrates cleanly', () => {
    expect(feed).toMatch(/const greetingWord = hour === null\s*\? ''/);
    expect(feed).toMatch(/const dateTitle = now\s*\?/);
  });

  it('lays the card over the bottom of the picture only when there is one', () => {
    expect(feed).toMatch(/showFamilyPicture && styles\.dayCardOverHero/);
  });

  it('titles the card with the date and counts the day under it', () => {
    expect(feed).toMatch(/\{dateTitle\}<\/Text>/);
    expect(feed).toMatch(/t\('home_things_many', \{ n: roomCards\.length \}\)/);
  });
});

describe('a row of the day', () => {
  const row = feed.slice(feed.indexOf('function TaskRow'), feed.indexOf('const ANN_SEEN_KEY'));

  it('starts with a tile in the colour of what it is, and ends with a chevron', () => {
    expect(row).toMatch(/const \{ icon, tile \} = tileFor\(card\);/);
    expect(row).toMatch(/backgroundColor: tile\.solid/);
    expect(row).toMatch(/<ChevronRight /);
  });

  it('has no checkbox: the row opens the card, and the card is ticked off there', () => {
    expect(row).not.toMatch(/feed-card-complete-/);
    expect(feed).toMatch(/testID="feed-complete-card"/);
  });

  it('gives every kind of card a tile, and imported events their own', () => {
    const types: CardType[] = ['SIGN_SLIP', 'RSVP', 'TASK', 'BIRTHDAY', 'SCHOOL', 'APPOINTMENT', 'VACATION'];
    types.forEach((type) => expect(tileFor({ type }).tile.solid).toMatch(/^#[0-9A-F]{6}$/i));
    expect(tileFor({ type: 'APPOINTMENT' }).icon).toBe('calendar');
    expect(tileFor({ type: 'SIGN_SLIP' }).icon).toBe('sign');
    expect(tileFor({ type: 'TASK' }).icon).toBe('task');
    expect(tileFor({ type: 'APPOINTMENT', source: 'CALENDAR' }).icon).toBe('imported');
  });
});

describe('the quick actions', () => {
  const qa = read('src', 'components', 'HomeQuickActions.tsx');

  it('are four, each doing something real', () => {
    ['event', 'chore', 'meal', 'scan'].forEach((k) => expect(qa).toMatch(new RegExp(`key: '${k}'`)));
    expect(feed).toMatch(/onEvent=\{openNewEvent\}/);
    expect(feed).toMatch(/type: 'APPOINTMENT'/);
    expect(feed).toMatch(/params: \{ add: 'chore' \}/);
    expect(feed).toMatch(/params: \{ view: 'meal' \}/);
    expect(feed).toMatch(/onScan=\{\(\) => setShowCamera\(true\)\}/);
  });

  it('offer a chore only where the children\'s side is on, and a task otherwise', () => {
    expect(qa).toMatch(/kidsShown \? t\('home_qa_chore'\) : t\('home_qa_task'\)/);
    expect(feed).toMatch(/kidsShown=\{!kidsHidden && members\.some\(isChild\)\}/);
  });

  it('land "Add chore" on the chore sheet, once', () => {
    const kids = read('app', '(tabs)', 'kids.tsx');
    expect(kids).toMatch(/if \(askedAdd !== 'chore'\) return;\s*openChoreSheet\(\);\s*router\.setParams\(\{ add: undefined \} as never\);/);
  });
});

describe('a calm day', () => {
  it('shows no "nothing needs you" card', () => {
    expect(read('src', 'components', 'FamilyPulse.tsx')).toMatch(/if \(count === 0\) return null;/);
  });
});

describe('the picture', () => {
  const hero = read('src', 'components', 'HomeHero.tsx');

  it('has a slot per kind of household, each empty until there is art the household owns', () => {
    expect(Object.keys(HOME_HERO_ART).sort()).toEqual([...HERO_SCENES].sort());
    HERO_SCENES.forEach((scene) => expect(HOME_HERO_ART[scene]).toEqual({ light: null, dark: null }));
    expect(hero).toMatch(/const art = dark \? HOME_HERO_ART\[scene\]\.dark : HOME_HERO_ART\[scene\]\.light;/);
  });

  it('never draws children into a household that has none', () => {
    expect(heroHasPicture('couple', false)).toBe(false);
    expect(heroHasPicture('solo', true)).toBe(false);
    expect(heroHasPicture('family', false)).toBe(true);
    expect(heroHasPicture('children', true)).toBe(true);
  });
});

describe('which picture a household gets', () => {
  const m = (over: Partial<FamilyMember>): FamilyMember =>
    ({ member_id: over.name || 'x', family_id: 'f', name: 'X', role: 'parent', stars: 0, ...over }) as FamilyMember;
  const me = m({ name: 'Jordan', standing: 'owner', is_me: true });
  const sam = m({ name: 'Sam', standing: 'parent', role: 'co-parent' });
  const ama = m({ name: 'Ama', standing: 'child', role: 'child' });
  const nanny = m({ name: 'Efua', standing: 'helper', role: 'helper' });

  it('two adults with children: the whole family', () => {
    expect(homeHeroScene([me, sam, ama], false)).toBe('family');
  });

  it('one adult with children: the children, which is right for a mum or a dad alike', () => {
    expect(homeHeroScene([me, ama], false)).toBe('children');
    expect(homeHeroScene([me, ama, nanny], false)).toBe('children');
  });

  it('a grandparent, when their own relationship says so', () => {
    expect(homeHeroScene([m({ name: 'Nana', standing: 'owner', is_me: true, role: 'Grandmother' }), ama], false)).toBe('grandparent');
  });

  it('without children, or with their side put away: a couple, or one person', () => {
    expect(homeHeroScene([me, sam], false)).toBe('couple');
    expect(homeHeroScene([me], false)).toBe('solo');
    expect(homeHeroScene([me, ama], true)).toBe('solo');
  });

  it('never reads a name to decide', () => {
    expect(read('src', 'homeFamily.ts').slice(read('src', 'homeFamily.ts').indexOf('export function homeHeroScene'))).not.toMatch(/\.name\b/);
  });
});

describe('the tile colours', () => {
  it.each(Object.entries(TILE))('%s: a white glyph on the solid colour reads at 3:1 or better', (_name, tile) => {
    expect(contrast(tile.solid, '#FFFFFF')).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(TILE))('%s: the solid colour as ink on its soft tile reads at 3:1 or better', (_name, tile) => {
    expect(contrast(tile.solid, tile.soft)).toBeGreaterThanOrEqual(3);
  });

  it('gives the four quick actions four different colours', () => {
    const solids = Object.values(QUICK_TILE).map((tile) => tile.solid);
    expect(new Set(solids).size).toBe(4);
  });
});

describe('every new string exists in all four languages', () => {
  const KEYS = [
    'home_family', 'home_tagline_day', 'home_tagline_evening', 'home_things_none', 'home_things_one',
    'home_things_many', 'home_quick_actions', 'home_qa_event', 'home_qa_chore', 'home_qa_task',
    'home_qa_meal', 'home_qa_scan',
  ];
  it.each(KEYS)('%s', (key) => {
    LANGS.forEach((lang) => {
      expect(`${lang}.${key}: ${(TRANSLATIONS[lang] as Record<string, string>)[key] ?? ''}`).not.toMatch(/: $/);
    });
  });

  it('keeps the count in the many form', () => {
    LANGS.forEach((lang) => {
      expect((TRANSLATIONS[lang] as Record<string, string>).home_things_many).toContain('{n}');
    });
  });
});
