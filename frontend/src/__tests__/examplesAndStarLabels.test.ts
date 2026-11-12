/**
 * Two things found on 2026-11-12, looking at the live app in French:
 *  - the empty Allergies field showed "Arachides — EpiPen dans le sac bleu"
 *    in a grey close to real text, which reads as a recorded allergy;
 *  - a child's star history said "Starting stars", in English.
 */
import fs from 'fs';
import path from 'path';
import { SERVER_STAR_REASONS, starReasonText } from '../starReason';

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

  it('is in italics while the field is empty', () => {
    expect(MEMBER).toContain('style={[styles.recInput, !draft && styles.recExample]}');
    expect(MEMBER).toContain("recExample: { fontStyle: 'italic' },");
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
    // "reason": "Starting stars", and `reason or ("Parent added stars" if …)`.
    const fixed = new Set<string>();
    for (const m of SERVER.matchAll(/"reason":\s*"([A-Z][^"]+)"/g)) fixed.add(m[1]);
    for (const m of SERVER.matchAll(/"reason":[^\n]*?\bor \(?"([A-Z][^"]+)"/g)) fixed.add(m[1]);
    for (const m of SERVER.matchAll(/else "(Parent [a-z]+ stars)"/g)) fixed.add(m[1]);
    expect([...fixed].sort()).toEqual(Object.keys(SERVER_STAR_REASONS).sort());
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
