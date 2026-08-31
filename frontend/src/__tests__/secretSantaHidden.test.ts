/**
 * Secret Santa is hidden until it is in season.
 *
 * It works; it is simply out of season, and a feature nobody can act on for
 * three months is a menu row that costs attention and an unexplained screen in
 * front of an App Store reviewer.
 *
 * The flag hides ENTRY POINTS only. Routes, API and stored draws stay live, so
 * a household that already made one can still reach it by link, and flipping
 * the switch back destroys nothing.
 *
 * Source-level, because what matters is that no entry point exists that bypasses
 * the flag — a property of the files, which survives refactors of the components.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const FEATURES = read('features.ts');
const MORE_SHEET = read('components/MoreSheet.tsx');
const GIFTING = read('components/GiftingStrip.tsx');

describe('Secret Santa visibility', () => {
  it('is off', () => {
    expect(FEATURES).toMatch(/export const SECRET_SANTA_ENABLED = false/);
  });

  it('is a plain boolean, not a date window', () => {
    // A calendar trigger reveals a feature whether or not anyone is ready for
    // it: no announcement, no support note, nobody watching. Turning it on
    // should be a decision someone makes.
    const decl = FEATURES.slice(FEATURES.indexOf('export const SECRET_SANTA_ENABLED'));
    expect(decl).not.toMatch(/Date|getMonth|now\(\)/);
  });

  it('gates the More menu row', () => {
    expect(MORE_SHEET).toContain('SECRET_SANTA_ENABLED');
    // The row is dropped from the list, not merely styled away.
    expect(MORE_SHEET).toMatch(/\.\.\.\(SECRET_SANTA_ENABLED \?/);
  });

  it('gates the Feed gifting card', () => {
    expect(GIFTING).toContain('SECRET_SANTA_ENABLED');
  });

  it('leaves no route or API call removed', () => {
    // Hiding is not deleting: the screens and endpoints stay, so existing
    // draws survive and revealing it later needs no rewrite.
    const api = read('api.ts');
    expect(api).toContain("request<SantaDraw[]>('/santa')");
  });

  it('draws nothing when there is only one thing to choose between', () => {
    // A segmented control with one option is a control that does nothing.
    expect(GIFTING).toContain('showSegments');
  });
});
