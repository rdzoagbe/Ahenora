/**
 * A row on Home is read, not guessed at.
 *
 * On the shipped Home every row of the day ended in a coloured kind pill, and
 * on a phone the pill took the width the title needed: "Soccer …",
 * "Dentist…", "Swim c…" (seen in the browser on 2026-10-26, in English and
 * French). The final design Roland chose has no kind pills, titles that are
 * never cut short, and a colour per person. This pins that:
 *
 *  - a title gets two lines;
 *  - the grey line says when and who (since 2026-10-31 what a row is shows as
 *    its coloured tile, as in the reference Roland chose);
 *  - each person keeps one colour, in the order their faces sit on Home, and
 *    the brand orange is never a person's colour.
 */
import fs from 'fs';
import path from 'path';

import { PERSON_TONES, personTone } from '../homeFamily';
import type { FamilyMember } from '../api';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const feed = read('app', '(tabs)', 'feed.tsx');

function member(over: Partial<FamilyMember>): FamilyMember {
  return { member_id: over.name || 'm', family_id: 'fam', name: 'Someone', role: 'parent', stars: 0, ...over } as FamilyMember;
}
const me = member({ member_id: 'm_me', name: 'Jordan Mensah', standing: 'owner', is_me: true });
const sam = member({ member_id: 'm_sam', name: 'Sam', role: 'co-parent', standing: 'parent' });
const ama = member({ member_id: 'm_ama', name: 'Ama', role: 'child', standing: 'child' });
const leo = member({ member_id: 'm_leo', name: 'Leo', role: 'child', standing: 'child' });
const family = [leo, ama, sam, me];

describe('each person keeps one colour', () => {
  it('follows the order of the faces on Home: you, the other adults, the children', () => {
    expect(personTone('Jordan Mensah', family)).toBe(PERSON_TONES[0]);
    expect(personTone('Sam', family)).toBe(PERSON_TONES[1]);
    expect(personTone('Leo', family)).toBe(PERSON_TONES[2]);
    expect(personTone('Ama', family)).toBe(PERSON_TONES[3]);
  });

  it('knows a person by their first name, whatever the case', () => {
    expect(personTone('jordan', family)).toBe(PERSON_TONES[0]);
    expect(personTone('  AMA ', family)).toBe(PERSON_TONES[3]);
  });

  it('gives a name nobody carries a steady colour', () => {
    expect(personTone('Grandma Efua', family)).toBe(personTone('Grandma Efua', family));
    expect(PERSON_TONES).toContain(personTone('Grandma Efua', family));
  });

  it('never uses the orange, which means "do this"', () => {
    PERSON_TONES.forEach((tone) => {
      expect(tone.bg).not.toMatch(/orange/);
      expect(tone.fg).not.toMatch(/orange/);
    });
  });
});

describe('the row', () => {
  // Since 2026-10-31 the row follows the reference Roland chose ("this is the
  // exact view I wanted to have"): a coloured tile for what it is, the title,
  // then when and who in words. The person is said by name, not by a badge.
  it('gives a title two lines', () => {
    expect(feed).toMatch(/<Text style=\{styles\.dayRowTitle\} numberOfLines=\{2\}>\{card\.title\}<\/Text>/);
  });

  it('draws no kind pill', () => {
    expect(feed).not.toMatch(/statusPill/);
    expect(feed).not.toMatch(/function statusCopy/);
  });

  it('says when and who in the grey line', () => {
    expect(feed).toMatch(/const meta = \[when, who, privacy\]\.filter\(Boolean\)\.join\(' · '\);/);
    expect(feed).toMatch(/when=\{todayTimeLabel\(card, t, lang\)\}/);
  });
});
