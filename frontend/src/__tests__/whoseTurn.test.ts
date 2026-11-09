/**
 * Whose turn? — the card's side. The server keeps the order and refuses a tap
 * that would skip a child (tests/test_whose_turn.py); here, what the card says
 * and where it sits.
 */
import fs from 'fs';
import path from 'path';
import { advanceLocally, firstName, nameOf, toggleInOrder, turnPeople, turnWhen, TURN_IDEAS } from '../whoseTurn';
import type { FamilyMember, Turn } from '../api';

const kids = fs.readFileSync(path.join(__dirname, '..', '..', 'app', '(tabs)', 'kids.tsx'), 'utf8');
const card = fs.readFileSync(path.join(__dirname, '..', 'components', 'WhoseTurnCard.tsx'), 'utf8');
const i18n = fs.readFileSync(path.join(__dirname, '..', 'i18n.ts'), 'utf8');

const member = (member_id: string, name: string, role: string) =>
  ({ member_id, name, role, family_id: 'f', stars: 0 }) as FamilyMember;
const FAMILY = [
  member('m_dad', 'Roland Dzoagbe', 'parent'),
  member('m_ama', 'Ama Dzoagbe', 'child'),
  member('m_leo', 'Leo', 'child'),
  member('m_kofi', 'Kofi', 'teen'),
  member('m_nan', 'Esi', 'helper'),
];
const turn = (over: Partial<Turn> = {}): Turn => ({
  turn_id: 't1', name: 'Front seat', member_ids: ['m_ama', 'm_leo', 'm_kofi'],
  current_member_id: 'm_ama', next_member_id: 'm_leo', history: [],
  created_at: '2026-11-09T08:00:00Z', updated_at: '2026-11-09T08:00:00Z', ...over,
});

describe('who takes turns', () => {
  it('is the children and teens, never a parent or a helper', () => {
    expect(turnPeople(FAMILY).map((m) => m.member_id)).toEqual(['m_ama', 'm_leo', 'm_kofi']);
  });

  it('builds the order in the order people are tapped, and a second tap takes them out', () => {
    let order: string[] = [];
    order = toggleInOrder(order, 'm_leo');
    order = toggleInOrder(order, 'm_ama');
    expect(order).toEqual(['m_leo', 'm_ama']);
    expect(toggleInOrder(order, 'm_leo')).toEqual(['m_ama']);
  });

  it('says first names, read across a room', () => {
    expect(firstName('Ama Dzoagbe')).toBe('Ama');
    expect(nameOf(FAMILY, 'm_ama')).toBe('Ama');
    expect(nameOf(FAMILY, 'gone')).toBe('');
  });
});

describe('done', () => {
  it('passes it to the next person straight away and wraps round', () => {
    const now = new Date('2026-11-09T09:00:00Z');
    const a = advanceLocally(turn(), 'Roland', now);
    expect([a.current_member_id, a.next_member_id]).toEqual(['m_leo', 'm_kofi']);
    expect(a.history[0]).toEqual({ member_id: 'm_ama', at: now.toISOString(), by: 'Roland' });
    const c = advanceLocally(advanceLocally(a, 'Roland'), 'Roland');
    expect(c.current_member_id).toBe('m_ama');
  });

  it('sends whose turn the screen showed, so the server can refuse a second tap', () => {
    expect(card).toContain('await api.nextTurn(turn.turn_id, from)');
    expect(card).toContain('if (e?.status === 409)');
    // After a refusal the list is read again rather than guessed.
    expect(card).toMatch(/turn_already_moved'\), 'info'\);[\s\S]{0,500}load\(\);/);
  });
});

describe('when', () => {
  const t = (k: string, p?: Record<string, string | number>) => `${k}:${p?.n ?? ''}`;
  it('says it in the Family tab\'s own words', () => {
    const now = Date.parse('2026-11-09T12:00:00Z');
    expect(turnWhen('2026-11-09T11:59:40Z', t, now)).toBe('when_now:');
    expect(turnWhen('2026-11-09T11:30:00Z', t, now)).toBe('when_minutes:30');
    expect(turnWhen('2026-11-08T12:00:00Z', t, now)).toBe('when_days:1');
    expect(turnWhen('not a date', t, now)).toBe('');
  });
});

describe('the card', () => {
  it('sits with everyone on the Family tab, under "This week", not on one child\'s page', () => {
    const at = kids.indexOf('<WhoseTurnCard');
    expect(at).toBeGreaterThan(kids.indexOf('testID="family-week"'));
    expect(at).toBeLessThan(kids.indexOf('testID="family-latest"'));
    expect(kids).toContain('{!isFocused && !kidsHidden ? (\n                <WhoseTurnCard');
  });

  it('only appears when there are two to take turns, and never as an empty card after a failed read', () => {
    expect(card).toContain('if (people.length < 2 || turns === null || (failed && turns.length === 0)) return null;');
  });

  it('puts the turn back when "done" could not be saved', () => {
    expect(card).toContain('(r.turn_id === before.turn_id ? before : r)');
  });

  it('keeps everyone in the rotation when it is edited, child or not', () => {
    expect(card).toContain('setOrder(turn.member_ids.filter((id) => members.some((m) => m.member_id === id)));');
  });

  it('lets a helper say done but not change the rules', () => {
    expect(kids).toContain('canEdit={!viewerIsHelper}');
    expect(card).toContain('if (!canEdit) return;');
    expect(card).toMatch(/\{canEdit \? \(\s*<View style=\{styles\.ideas\}>/);
  });

  // Review of 2026-11-09, after release.
  it('a rename never sends whose turn it is, unless it was changed in the sheet, and then with what it showed', () => {
    expect(card).toContain('current !== editing.current_member_id');
    expect(card).toContain('seen_current_member_id: editing.current_member_id');
  });

  it('never hides a rotation, so every one can be opened and deleted', () => {
    expect(card).toContain('const shown = turns;');
  });

  it('reloads with the Family tab, so another parent\'s "Done" shows up', () => {
    expect(card).toContain('useEffect(() => { load(); }, [load, refreshKey, members]);');
  });

  it('stops a double tap before the screen re-renders', () => {
    expect(card).toContain('if (!from || inFlight.current.has(turn.turn_id)) return;');
  });

  it('puts the turn back on any refusal, a 409 included', () => {
    expect(card).toMatch(/setTurns\(\(prev\) => \(prev \?\? \[\]\)\.map\(\(r\) => \(r\.turn_id === before\.turn_id \? before : r\)\)\);\s*if \(e\?\.status === 409\)/);
  });

  it('never shows a blank name for whoever went last', () => {
    expect(card).toContain('turn.history.find((h) => nameOf(members, h.member_id))');
  });

  it('is worded in all four languages', () => {
    const keys = ['turn_title', 'turn_add', 'turn_empty', 'turn_idea_other', 'turn_now', 'turn_then', 'turn_last',
      'turn_done', 'turn_done_a11y', 'turn_new_title', 'turn_edit_title', 'turn_name_label', 'turn_name_placeholder',
      'turn_order_label', 'turn_order_help', 'turn_need_two', 'turn_current_label', 'turn_delete', 'turn_save',
      'turn_created', 'turn_already_moved', 'turn_save_failed', ...TURN_IDEAS];
    for (const key of keys) {
      expect((i18n.match(new RegExp(`^\\s*${key}:`, 'gm')) || []).length).toBe(4);
    }
    expect(i18n).toContain('turn_title: "À qui le tour ?"');
    expect(i18n).toContain('turn_idea_front_seat: "Place devant"');
  });
});
