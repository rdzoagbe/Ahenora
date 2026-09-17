/**
 * A card wears the icon the server gave it.
 *
 * Roland: "a birthday has a cake, cleaning a broom, bed laying, car pool a
 * car, and these show at the left side of each event or task." The server
 * stores a key and guesses it from the title (backend/card_icons.py); the app
 * draws the key, on the feed card, in the calendar's day list, and biggest of
 * all in kid mode, and lets a person pick another on the add sheet.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { CARD_ICONS, glyphFor } from '../cardIcons';

const src = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const app = (...p: string[]) => readFileSync(join(__dirname, '..', '..', 'app', ...p), 'utf8');
const BACKEND = readFileSync(join(__dirname, '..', '..', '..', 'backend', 'card_icons.py'), 'utf8');
const I18N = src('i18n.ts');

function inEveryLanguage(key: string): number {
  return I18N.split('\n').filter((l) => new RegExp(`^\\s*["']?${key}["']?:`).test(l)).length;
}

/** The server's ICONS dict, read from its source so the two cannot drift. */
function serverIcons(): { key: string; glyph: string }[] {
  const block = BACKEND.slice(BACKEND.indexOf('ICONS = {'), BACKEND.indexOf('_GLYPH_TO_KEY'));
  return [...block.matchAll(/"([a-z]+)":\s*"([^"]+)"/g)].map((m) => ({ key: m[1], glyph: m[2] }));
}

describe('the app and the server agree on what an icon is', () => {
  it('has the same twenty keys, the same glyphs, in the same order', () => {
    const server = serverIcons();
    expect(server.length).toBe(20);
    expect(CARD_ICONS.map((i) => i.key)).toEqual(server.map((i) => i.key));
    expect(CARD_ICONS.map((i) => i.glyph)).toEqual(server.map((i) => i.glyph));
  });

  it('draws a known key and nothing for an unknown or missing one', () => {
    expect(glyphFor('birthday')).toBe('🎂');
    expect(glyphFor('car')).toBe('🚗');
    expect(glyphFor(null)).toBeNull();
    expect(glyphFor(undefined)).toBeNull();
    expect(glyphFor('')).toBeNull();
    // A key a newer server might send that this app does not know yet.
    expect(glyphFor('rocket')).toBeNull();
  });

  it('names every icon in all four languages', () => {
    for (const item of CARD_ICONS) {
      expect(inEveryLanguage(item.labelKey)).toBe(4);
    }
    for (const key of ['addcard_icon', 'addcard_icon_hint', 'addcard_icon_none']) {
      expect(inEveryLanguage(key)).toBe(4);
    }
  });
});

describe('where the icon shows', () => {
  it('sits beside the title on a feed card, and only when there is one', () => {
    const card = src('components', 'SmartCard.tsx');
    expect(card).toContain("glyphFor(card.icon)");
    expect(card).toContain('testID={`card-icon-${card.card_id}`}');
    // No icon, no tile: the card renders as it did before icons existed.
    expect(card).toMatch(/\{glyph \? \(/);
  });

  it('sits between the colour bar and the title in the calendar day list', () => {
    const calendar = app('(tabs)', 'calendar.tsx');
    expect(calendar).toContain('testID={`calendar-icon-${card.card_id}`}');
    const bar = calendar.indexOf('styles.eventBar, { backgroundColor: color }');
    const icon = calendar.indexOf('calendar-icon-');
    const title = calendar.indexOf('styles.eventTitle, { flexShrink: 1 }');
    expect(bar).toBeGreaterThan(0);
    expect(icon).toBeGreaterThan(bar);
    expect(title).toBeGreaterThan(icon);
  });

  it('is biggest in kid mode, where the picture does the reading', () => {
    const kid = app('kid.tsx');
    expect(kid).toContain('testID={`kid-chore-icon-${c.card_id}`}');
    const size = /choreIconGlyph: \{ fontSize: (\d+)/.exec(kid);
    const feed = /iconGlyph: \{ fontSize: (\d+)/.exec(src('components', 'SmartCard.tsx'));
    expect(Number(size?.[1])).toBeGreaterThan(Number(feed?.[1]));
  });

  it('is hidden from the screen reader, which already reads the title', () => {
    for (const file of [src('components', 'SmartCard.tsx'), app('(tabs)', 'calendar.tsx'), app('kid.tsx')]) {
      expect(file).toContain('accessibilityElementsHidden');
    }
  });
});

describe('choosing one on the add sheet', () => {
  const modal = src('components', 'AddCardModal.tsx');

  it('shows the live guess in a tile beside the title and opens a picker on tap', () => {
    expect(modal).toContain('testID="icon-tile"');
    expect(modal).toContain('api.guessCardIcon(trimmedTitle, type)');
    expect(modal).toContain('testID="icon-picker"');
    expect(modal).toContain('testID="icon-none"');
    expect(modal).toContain('testID={`icon-${item.key}`}');
  });

  it('sends the icon only when a person chose, on create and on edit alike', () => {
    // undefined = nobody chose: leave it out and the server guesses, and a
    // guessed icon keeps following the title on later edits.
    // null = "no icon": sent as "" which the server reads as no icon, no guessing.
    const rule = "...(iconChoice !== undefined ? { icon: iconChoice ?? '' } : {})";
    expect(modal.split(rule).length - 1).toBe(2);
  });

  it('does not re-ask the server on an edit whose title has not changed', () => {
    // The card's own icon (possibly chosen by somebody) is the answer then;
    // re-guessing would show a guess that is not what is saved.
    expect(modal).toContain("titleUnchanged = !!editCard && trimmedTitle === (editCard.title || '').trim()");
    expect(modal).toMatch(/if \(!visible \|\| iconChoice !== undefined \|\| titleUnchanged/);
  });

  it('never fails a save because the hint could not load', () => {
    const start = modal.indexOf('api.guessCardIcon(');
    const after = modal.slice(start, start + 400);
    expect(after).toMatch(/catch \{/);
  });
});
