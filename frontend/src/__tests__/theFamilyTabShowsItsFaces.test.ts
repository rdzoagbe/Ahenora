/**
 * The Family tab, as Roland chose it on 2026-11-18 (the proposal of
 * 2026-11-09): the household's own faces over the title, each person's face
 * framed in their colour, today's jobs on a child's tile, "Choose a face" for
 * a child with none, and "Whose turn?" told in faces.
 */
import fs from 'fs';
import path from 'path';
import type { FamilyMember, Turn } from '../api';
import { childTileLine, headerFaces, headerShowsFaces, needsFace } from '../familyScreen';
import { turnIdeaFor, turnOrderFrom, TURN_IDEAS } from '../whoseTurn';
import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const person = (over: Partial<FamilyMember>): FamilyMember =>
  ({ member_id: 'm', name: 'Ama', role: 'Child', stars: 0, ...over } as FamilyMember);
const t = (key: string, params?: Record<string, string | number>) =>
  (TRANSLATIONS.fr[key] || key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ''));

describe("a child's tile", () => {
  it("says the stars and today's jobs", () => {
    expect(childTileLine(person({ stars: 12 }), { done: 2, total: 3 }, t)).toBe("★ 12 · 2/3 aujourd'hui");
  });

  it('keeps the line it had when the wheel asks nothing today, or the count did not load', () => {
    expect(childTileLine(person({ stars: 12, age: 8 }), { done: 0, total: 0 }, t)).toBe('8 ans · 12★');
    expect(childTileLine(person({ stars: 12 }), undefined, t)).toBe('12★');
  });

  it('never shows fewer than no stars', () => {
    expect(childTileLine(person({ stars: -3 }), { done: 0, total: 2 }, t)).toBe("★ 0 · 0/2 aujourd'hui");
  });
});

describe('a face to choose', () => {
  it('is offered to a child or teen with no picture, and to nobody else', () => {
    expect(needsFace(person({ avatar: '' }))).toBe(true);
    expect(needsFace(person({ role: 'Teen', avatar: null }))).toBe(true);
    expect(needsFace(person({ avatar: 'face:girl-bob' }))).toBe(false);
    expect(needsFace(person({ role: 'Parent', avatar: '' }))).toBe(false);
  });

  it('is a button on the tile for a parent, not for a helper', () => {
    const screen = read('app', '(tabs)', 'kids.tsx');
    expect(screen).toContain('const offerFace = isKid && needsFace(m) && !viewerIsHelper;');
    expect(screen).toContain('testID={`child-choose-face-${m.member_id}`}');
    // 44 high: a button inside a tile still has to be found by a thumb.
    expect(screen).toMatch(/tileFaceBtn: \{[^}]*minHeight: 44/);
    // A screen reader cannot reach a button inside a button: the tile offers it as an action.
    expect(screen).toContain("accessibilityActions={offerFace ? [{ name: 'chooseFace', label: t('fam_choose_face') }] : undefined}");
    // Only the newest load's job counts are kept.
    expect(screen).toContain('if (jobsSeq !== jobsSeqRef.current) return;');
  });

  it('saves nothing until "Choose", and "Later" leaves the letter', () => {
    const sheet = read('src', 'components', 'FacePickerSheet.tsx');
    expect(sheet).toContain('onPick={setPicked}');
    expect(sheet).toContain("const saved = await api.updateFamilyMember(member.member_id, { avatar: picked ?? '' });");
    // A save that comes back after the sheet moved to another child must not shut that child's sheet.
    expect(sheet).toContain('if (openFor.current === member.member_id) onClose();');
    expect(sheet).toMatch(/testID="face-sheet-later"[^>]*onPress=\{onClose\}/);
    expect(sheet).toContain('disabled={!changed || saving}');
  });
});

describe('the faces over the title', () => {
  const family = [
    person({ member_id: 'c1', name: 'Ama' }),
    person({ member_id: 'p1', name: 'Camille', role: 'Parent', is_me: true }),
    person({ member_id: 'p2', name: 'Sam', role: 'Parent' }),
    person({ member_id: 'c2', name: 'Léo' }),
    person({ member_id: 'c3', name: 'Isaiah' }),
    person({ member_id: 'x', name: '  ' }),
  ];

  it('are four at most, you first, with the rest counted', () => {
    const { shown, more } = headerFaces(family);
    expect(shown.map((m) => m.name)).toEqual(['Camille', 'Sam', 'Ama', 'Léo']);
    expect(more).toBe(1);
  });

  it('give way to the painting until somebody has a picture', () => {
    const screen = read('app', '(tabs)', 'kids.tsx');
    expect(screen).toContain('if (!headerShowsFaces(faces.shown)) return undefined;');
    expect(screen).toContain('art={SECTION_ART.family}');
    const face = (name: string) => person({ member_id: name, name, avatar: 'face:girl-bob' });
    const letter = (name: string) => person({ member_id: name, name, avatar: '' });
    // One face among letters is still a row of letters.
    expect(headerShowsFaces([face('a'), letter('b'), letter('c')])).toBe(false);
    expect(headerShowsFaces([face('a'), face('b'), letter('c')])).toBe(true);
    expect(headerShowsFaces([face('a')])).toBe(true);
    expect(headerShowsFaces([letter('a')])).toBe(false);
    expect(headerShowsFaces([])).toBe(false);
  });

  it('are read once, as names', () => {
    const faces = read('src', 'components', 'FamilyFaces.tsx');
    expect(faces).toMatch(/accessible\s+accessibilityRole="image"\s+accessibilityLabel=\{label\}/);
  });
});

describe('whose turn, in faces', () => {
  const kids = [person({ member_id: 'a', name: 'Ama' }), person({ member_id: 'b', name: 'Léo' }), person({ member_id: 'c', name: 'Isaiah' })];
  const turn = { turn_id: 't', name: 'Place devant', member_ids: ['a', 'b', 'c'], current_member_id: 'b', next_member_id: 'c', history: [] } as unknown as Turn;

  it('draws the order from whose turn it is, round to who has just been', () => {
    expect(turnOrderFrom(turn, kids).map((m) => m.name)).toEqual(['Léo', 'Isaiah', 'Ama']);
  });

  it('marks nobody as "now" when whose turn it is points at somebody who left', () => {
    const card = read('src', 'components', 'WhoseTurnCard.tsx');
    expect(card).toContain('const firstIsNow = order[0]?.member_id === turn.current_member_id;');
    expect(card).toContain('k === 0 && firstIsNow &&');
    const gone = { ...turn, current_member_id: 'zz' } as unknown as Turn;
    expect(turnOrderFrom(gone, kids).map((m) => m.name)).toEqual(['Ama', 'Léo', 'Isaiah']);
  });

  it('says how many more take turns when the faces stop at four', () => {
    const card = read('src', 'components', 'WhoseTurnCard.tsx');
    expect(card).toContain('{order.length > 4 ? <Text style={styles.stripMore}>+{order.length - 4}</Text> : null}');
    // And is no empty stop for a screen reader when there is nothing to say.
    expect(card).toContain('accessible={orderLabel.length > 0}');
  });

  it('leaves out somebody who has left the family', () => {
    expect(turnOrderFrom(turn, kids.slice(0, 2)).map((m) => m.name)).toEqual(['Léo', 'Ama']);
  });

  it('knows a starter by its name in any language, and nothing else', () => {
    expect(turnIdeaFor('Place devant')).toBe('turn_idea_front_seat');
    expect(turnIdeaFor('  front seat ')).toBe('turn_idea_front_seat');
    expect(turnIdeaFor('Wer deckt den Tisch')).toBeNull();
    expect(turnIdeaFor('')).toBeNull();
  });

  it('gives every starter its picture and its second line, in four languages', () => {
    const card = read('src', 'components', 'WhoseTurnCard.tsx');
    for (const key of TURN_IDEAS) {
      expect(card).toContain(`${key}: { Icon:`);
      for (const lang of ['en', 'es', 'fr', 'de'] as const) {
        expect([lang, key, !!TRANSLATIONS[lang][`${key}_sub`]]).toEqual([lang, key, true]);
      }
    }
  });
});

describe('the new words', () => {
  it('exist in every language', () => {
    const keys = ['turn_intro', 'turn_one_tap', 'turn_last_short', 'fam_today_n_of_m', 'fam_choose_face',
      'fam_faces_a11y', 'face_sheet_title', 'face_sheet_body', 'face_sheet_later', 'face_sheet_choose', 'face_sheet_failed'];
    for (const lang of ['en', 'es', 'fr', 'de'] as const) {
      for (const key of keys) expect([lang, key, !!TRANSLATIONS[lang][key]]).toEqual([lang, key, true]);
    }
  });
});
