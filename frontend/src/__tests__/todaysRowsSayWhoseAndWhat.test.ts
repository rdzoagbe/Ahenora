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
 *  - the kind is the first words of the grey line, coloured only where it
 *    changes what you do (a slip to sign, an invitation to answer);
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
  it('gives a title two lines', () => {
    expect(feed).toMatch(/styles\.taskTitle, \{ flexShrink: 1 \}\]\} numberOfLines=\{2\}>\{card\.title\}/);
  });

  it('draws no kind pill', () => {
    expect(feed).not.toMatch(/statusPill/);
    expect(feed).not.toMatch(/function statusCopy/);
  });

  it('says the kind in the grey line, in colour only where it changes what you do', () => {
    const kind = feed.slice(feed.indexOf('function rowKind'), feed.indexOf('function TaskRow'));
    expect(kind).toMatch(/SIGN_SLIP'\) return \{ label: t\('feed_status_sign'\), color: ui\.orangeText \}/);
    expect(kind).toMatch(/RSVP'\) return \{ label: t\('feed_status_rsvp'\), color: ui\.lavenderText \}/);
    ['BIRTHDAY', 'SCHOOL', 'APPOINTMENT', 'VACATION'].forEach((type) => {
      expect(kind).toMatch(new RegExp(`'${type}'\\) return \\{ label: [^}]*color: ui\\.muted \\}`));
    });
    expect(feed).toMatch(/\{kind \? <Text style=\{\[styles\.taskKind, \{ color: kind\.color \}\]\}>\{kind\.label\}<\/Text> : null\}/);
  });

  it("colours the initials with the assignee's own colour", () => {
    expect(feed).toMatch(/tone=\{card\.assignee\?\.trim\(\) \? personTone\(card\.assignee, members\) : null\}/);
    expect(feed).toMatch(/backgroundColor: ui\[tone\.bg\], borderColor: ui\[tone\.fg\]/);
  });
});
