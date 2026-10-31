/**
 * Every page has its picture.
 *
 * Roland, 2026-10-31, once Home had its painting: "not all the pages have the
 * images". Each part of the app shows its own painting, in the same style as
 * Home's, as a tile in the page header. This pins that:
 *
 *  - Calendar, Family, Kitchen (the meals, and the basket on the shopping
 *    list), Vault and Settings each pass their picture to the header;
 *  - every picture shipped is on disk and on the record of where it came from;
 *  - the picture sits beside the brand and the section's name, never beside
 *    the title, which keeps its full width;
 *  - screen readers skip it: it is decoration.
 */
import fs from 'fs';
import path from 'path';

import { SECTION_ART } from '../sectionArt';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const tab = (name: string) => read('app', '(tabs)', `${name}.tsx`);

describe('each page passes its picture to the header', () => {
  it.each([
    ['calendar', /art=\{SECTION_ART\.calendar\}/],
    ['kids', /art=\{SECTION_ART\.family\}/],
    ['kitchen', /art=\{view === 'shop' \? SECTION_ART\.shopping : SECTION_ART\.kitchen\}/],
    ['vault', /art=\{SECTION_ART\.vault\}/],
    ['settings', /art=\{SECTION_ART\.settings\}/],
  ])('%s', (name, pattern) => {
    expect(tab(name)).toMatch(pattern);
  });
});

describe('the pictures', () => {
  const art = read('src', 'sectionArt.ts');
  const record = read('assets', 'images', 'sections', 'README.md');

  it('are on disk and on the record of where they came from', () => {
    const files = [...art.matchAll(/require\('\.\.\/assets\/images\/sections\/([^']+)'\)/g)].map((m) => m[1]);
    expect(files.length).toBe(5);
    files.forEach((file) => {
      expect(fs.existsSync(path.join(__dirname, '..', '..', 'assets', 'images', 'sections', file))).toBe(true);
      expect(record).toMatch(new RegExp(`\\| \`${file.replace('.', '\\.')}\` \\| ChatGPT \\|[^\\n]*\\| 2026-`));
    });
  });

  it('leave the Vault without one until it is redone without words', () => {
    expect(SECTION_ART.vault).toBeNull();
    expect(SECTION_ART.calendar).toBeTruthy();
  });
});

describe('the header', () => {
  const kit = read('src', 'components', 'Kit.tsx');
  const header = kit.slice(kit.indexOf('export function ScreenHeader'), kit.indexOf('export function', kit.indexOf('export function ScreenHeader') + 10));

  it('puts the picture beside the brand and the section name, and the title under them at full width', () => {
    const top = header.indexOf('style={kit.headerTop}');
    const picture = header.indexOf('testID="screen-header-art"');
    const title = header.indexOf('{title}</Text>');
    expect(top).toBeGreaterThan(-1);
    expect(top).toBeLessThan(picture);
    expect(picture).toBeLessThan(title);
    expect(header).not.toMatch(/adjustsFontSizeToFit/);
  });

  it('hides the picture from screen readers', () => {
    expect(header).toMatch(/accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"\s+testID="screen-header-art"/);
  });
});
