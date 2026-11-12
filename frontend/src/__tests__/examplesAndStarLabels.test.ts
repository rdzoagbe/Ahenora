/**
 * Two things found on 2026-11-12, looking at the live app in French:
 *  - the empty Allergies field showed "Arachides — EpiPen dans le sac bleu"
 *    in a grey close to real text, which reads as a recorded allergy;
 *  - a child's star history said "Starting stars", in English.
 */
import fs from 'fs';
import path from 'path';
import { APP_STAR_REASON_KEYS, SERVER_STAR_REASONS, starReasonText } from '../starReason';
import { TRANSLATIONS } from '../i18n';

const root = path.join(__dirname, '..', '..');
const I18N = fs.readFileSync(path.join(root, 'src', 'i18n.ts'), 'utf8');
const MEMBER = fs.readFileSync(path.join(root, 'app', 'member.tsx'), 'utf8');
const SERVER = fs.readFileSync(path.join(root, '..', 'backend', 'server.py'), 'utf8');

describe('a health example is never mistaken for something recorded', () => {
  it('says it is an example, in every language', () => {
    const lines = I18N.split('\n').filter((l) => /^\s*(rec_ph_allergies|rec_med_ph_dose|rec_med_ph_times|rec_vax_ph_name):/.test(l));
    expect(lines).toHaveLength(16);
    for (const line of lines) expect(line).toMatch(/: '(e\.g\. |Ej\.: |Ex\. : |z\. B\. )/);
  });

  it('is in italics while the field is empty, with the italic face loaded', () => {
    // fontStyle alone is ignored on iOS for a custom font, so the face itself.
    expect(MEMBER).toContain('style={[styles.recInput, !draft && styles.recExample]}');
    expect(MEMBER).toContain("recExample: { fontFamily: 'Figtree_500Medium_Italic' },");
    const LAYOUT = fs.readFileSync(path.join(root, 'app', '_layout.tsx'), 'utf8');
    expect((LAYOUT.match(/Figtree_500Medium_Italic,/g) || []).length).toBe(2); // imported, and loaded
  });
});

describe('a star history line is in the reader\'s language', () => {
  const t = (k: string) => `T(${k})`;

  it('shows the server\'s fixed lines translated, and a parent\'s own words as typed', () => {
    expect(starReasonText('Starting stars', t, 'empty')).toBe('T(kids_starting_stars)');
    expect(starReasonText('Rangé sa chambre', t, 'empty')).toBe('Rangé sa chambre');
    expect(starReasonText('', t, 'empty')).toBe('T(empty)');
    expect(starReasonText(null, t, 'empty')).toBe('T(empty)');
  });

  it('knows every fixed line the server writes', () => {
    // Every capitalised literal on a line that writes a reason.
    const fixed = new Set<string>();
    for (const line of SERVER.split('\n').filter((l) => l.includes('"reason"'))) {
      for (const m of line.matchAll(/"([A-Z][A-Za-z ]+)"/g)) fixed.add(m[1]);
    }
    expect([...fixed].sort()).toEqual(Object.keys(SERVER_STAR_REASONS).sort());
  });

  it('knows every fixed line the app saves, in whatever language it was saved', () => {
    const files = ['app/member.tsx', 'app/(tabs)/kids.tsx', 'src/components/KidPageTop.tsx']
      .map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
    const saved = new Set<string>();
    for (const m of files.matchAll(/(?:reason: [^\n]*?|give\(\w+, )t\('([a-z_]+)'\)/g)) saved.add(m[1]);
    for (const m of files.matchAll(/reason: reason \|\| \(?[^\n]*?t\('([a-z_]+)'\)[^\n]*?t\('([a-z_]+)'\)/g)) { saved.add(m[1]); saved.add(m[2]); }
    for (const key of saved) expect([key, APP_STAR_REASON_KEYS.includes(key)]).toEqual([key, true]);
    // A French parent's "+3" read by an English-speaking co-parent.
    const fr = (TRANSLATIONS.fr as Record<string, string>).kids_parent_added_stars;
    expect(starReasonText(fr, t, 'empty')).toBe('T(kids_parent_added_stars)');
    expect(starReasonText('Bravo !', t, 'empty')).toBe('T(hub_well_done)');
  });

  it('has each translation in all four languages', () => {
    for (const key of Object.values(SERVER_STAR_REASONS)) {
      expect([key, (I18N.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length]).toEqual([key, 4]);
    }
  });

  it('is used wherever the history is shown', () => {
    expect(MEMBER).toContain("starReasonText(h.reason, t, 'hub_stars_adjustment')");
    expect(fs.readFileSync(path.join(root, 'app', '(tabs)', 'kids.tsx'), 'utf8'))
      .toContain("starReasonText(item.reason, t, 'kids_star_adjustment')");
  });
});
