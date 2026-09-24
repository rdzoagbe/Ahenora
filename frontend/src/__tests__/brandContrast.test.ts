/**
 * Every ink in the brand palette stays readable on every surface it sits on.
 *
 * The rebrand (stage 1) replaced both palettes — the theme's and Kit's — with
 * warmer values. A contrast sweep once found 162 pieces of unreadable text,
 * nearly all of them an accent colour used as ink, so each pair a screen
 * actually draws is held here at the WCAG bar: 4.5:1 for text, 3:1 for a
 * control's outline. A later tweak that makes a colour "look nicer" and fails
 * a reader fails here first.
 */
import fs from 'fs';
import path from 'path';

import { darkTheme, lightTheme } from '../theme';

function lum(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Kit's static (light) palette, read from the file so the test needs no store. */
function kitLight(): Record<string, string> {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'Kit.tsx'), 'utf8');
  const block = src.slice(src.indexOf('export const UI = {'), src.indexOf('export type UIColors'));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s+(\w+): '(#[0-9A-Fa-f]{6})'/gm)) out[m[1]] = m[2];
  return out;
}

function kitDark(): Record<string, string> {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'Kit.tsx'), 'utf8');
  const block = src.slice(src.indexOf('if (!dark) return'), src.indexOf('}, [dark, theme]'));
  const out: Record<string, string> = {};
  for (const m of block.matchAll(/^\s+(\w+): '(#[0-9A-Fa-f]{6})'/gm)) out[m[1]] = m[2];
  return out;
}

describe('the theme', () => {
  for (const theme of [lightTheme, darkTheme]) {
    const c = theme.colors;
    const surfaces = { bg: c.bg, card: c.card, bgSoft: c.bgSoft };
    it(`${theme.mode}: body text and muted text read at 4.5:1 on every surface`, () => {
      for (const [name, surface] of Object.entries(surfaces)) {
        expect([`text on ${name}`, ratio(c.text, surface)]).toEqual([`text on ${name}`, expect.any(Number)]);
        expect(ratio(c.text, surface)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c.textMuted, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${theme.mode}: soft text (inactive controls) reads at 3:1`, () => {
      for (const surface of Object.values(surfaces)) {
        expect(ratio(c.textSoft, surface)).toBeGreaterThanOrEqual(3);
      }
    });
    it(`${theme.mode}: accent ink, success and danger read as text on the page and on cards`, () => {
      for (const surface of [c.bg, c.card]) {
        expect(ratio(c.accentInk, surface)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c.success, surface)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(c.danger, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });
    it(`${theme.mode}: the primary button's label reads on it`, () => {
      expect(ratio(c.primaryText, c.primary)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("Kit's palette", () => {
  const L = kitLight();
  const D = kitDark();

  it('has one brand orange, the same as the theme', () => {
    expect(L.orange).toBe(lightTheme.colors.accent);
  });

  it('every *Text ink reads on white and on its own tint', () => {
    const pairs: [string, string][] = [
      ['orangeText', 'orangeSoft'], ['mintText', 'mint'], ['lavenderText', 'lavender'],
      ['goldText', 'gold'], ['blueText', 'blue'],
    ];
    for (const [ink, tint] of pairs) {
      expect([ink, ratio(L[ink], '#FFFFFF') >= 4.5]).toEqual([ink, true]);
      expect([ink, tint, ratio(L[ink], L[tint]) >= 4.5]).toEqual([ink, tint, true]);
    }
    expect(ratio(L.muted, L.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(L.muted, L.soft)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(L.danger, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
  });

  it('white on the deep orange is a readable button', () => {
    expect(ratio('#FFFFFF', L.orangeDeep)).toBeGreaterThanOrEqual(4.5);
  });

  it('a checkbox outline is findable (3:1) and a done tick reads', () => {
    expect(ratio(L.checkLine, '#FFFFFF')).toBeGreaterThanOrEqual(3);
    expect(ratio(L.checkLine, L.bg)).toBeGreaterThanOrEqual(3);
    expect(ratio(L.doneTick, L.doneFill)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(D.checkLine, darkTheme.colors.card)).toBeGreaterThanOrEqual(3);
    expect(ratio(D.doneTick, D.doneFill)).toBeGreaterThanOrEqual(4.5);
  });

  it('dark *Text inks read on the dark card', () => {
    for (const ink of ['orangeText', 'mintText', 'lavenderText', 'goldText', 'blueText', 'danger']) {
      expect([ink, ratio(D[ink], darkTheme.colors.card) >= 4.5]).toEqual([ink, true]);
    }
  });
});

describe('the card-type colours in the add sheet', () => {
  it('each reads on white', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'AddCardModal.tsx'), 'utf8');
    const block = src.slice(src.indexOf('const TYPES'), src.indexOf('];', src.indexOf('const TYPES')));
    const colours = [...block.matchAll(/color: '(#[0-9A-Fa-f]{6})'/g)].map((m) => m[1]);
    expect(colours.length).toBeGreaterThanOrEqual(7);
    for (const c of colours) expect([c, ratio(c, '#FFFFFF') >= 4.5]).toEqual([c, true]);
  });
});
