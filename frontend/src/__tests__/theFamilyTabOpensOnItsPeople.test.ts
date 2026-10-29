/**
 * The Family tab opens on its people.
 *
 * The final design Roland chose (2026-10-26): everyone as a tile in their
 * own colour — you, the other grown-ups, the children, the people who help —
 * then how the week is going (jobs done, stars earned, pocket money due),
 * then the latest thing that happened. The chores and treats sit behind a
 * second tab, "Jobs & treats", which is the child's page the tab already had.
 * This pins:
 *
 *  - "4 people" counts everyone with a name, whatever their role;
 *  - stars earned this week is the children's week, added up;
 *  - pocket money due is the soonest date with everything payable that day,
 *    or "due now" when one is already owed;
 *  - a child's line is their age and stars, or the stars alone;
 *  - the tiles keep every mark the rows carried (owed, invited, unread) and
 *    the same test ids the harnesses press;
 *  - every new string exists in all four languages.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { allowanceDue, childLine, peopleCount, starsEarnedThisWeek } from '../familyScreen';
import type { AllowanceConfig, FamilyMember } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const screen = read('app', '(tabs)', 'kids.tsx');
const t = (key: string, params?: Record<string, string | number>) =>
  Object.entries(params || {}).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), key);

const member = (member_id: string, name: string, over: Partial<FamilyMember> = {}): FamilyMember =>
  ({ member_id, family_id: 'fam', name, role: 'parent', stars: 0, ...over } as FamilyMember);
const jordan = member('m_me', 'Jordan', { is_me: true, is_founder: true });
const sam = member('m_sam', 'Sam');
const ama = member('m_ama', 'Ama', { role: 'child', standing: 'child', stars: 54, week_earned: 20, age: 9 });
const leo = member('m_leo', 'Leo', { role: 'child', standing: 'child', stars: 38, week_earned: 14 });
const allowance = (member_id: string, amount: number, next_due_at: string, is_due = false): AllowanceConfig =>
  ({ allowance_id: `a_${member_id}`, family_id: 'fam', member_id, amount, frequency: 'weekly',
     created_at: '2026-10-01', next_due_at, is_due } as AllowanceConfig);

describe('the numbers under the people', () => {
  it('counts everyone with a name', () => {
    expect(peopleCount([jordan, sam, ama, leo])).toBe(4);
    expect(peopleCount([jordan, member('m_x', '  ')])).toBe(1);
  });

  it('adds up the children’s week, and nobody else’s', () => {
    expect(starsEarnedThisWeek([jordan, sam, ama, leo])).toBe(34);
    expect(starsEarnedThisWeek([member('m_p', 'Sam', { week_earned: 99 })])).toBe(0);
    expect(starsEarnedThisWeek([member('m_k', 'Kofi', { role: 'child', week_earned: -3 })])).toBe(0);
  });

  it('says a child’s age and stars, or the stars alone', () => {
    expect(childLine(ama, t)).toBe('fam_years · 54★');
    expect(childLine(leo, t)).toBe('38★');
  });
});

describe('pocket money due', () => {
  const now = new Date('2026-10-29T10:00:00Z'); // a Thursday

  it('is nothing when nobody has an allowance', () => {
    expect(allowanceDue([], now)).toBeNull();
  });

  it('is the soonest date, with everything payable that day added up', () => {
    const due = allowanceDue([
      allowance('m_ama', 10, '2026-11-01T09:00:00Z'),
      allowance('m_leo', 5, '2026-11-01T18:00:00Z'),
      allowance('m_kofi', 7, '2026-11-08T09:00:00Z'),
    ], now);
    expect(due).toEqual({ amount: 15, dueAt: new Date('2026-11-01T09:00:00Z'), isDue: false });
  });

  it('is due now when one is already owed, whatever its date says', () => {
    const due = allowanceDue([
      allowance('m_ama', 10, '2026-10-25T09:00:00Z'),
      allowance('m_leo', 5, '2026-11-01T09:00:00Z', false),
    ], now);
    expect(due).toEqual({ amount: 10, dueAt: now, isDue: true });
    expect(allowanceDue([allowance('m_ama', 10, '2026-11-01T09:00:00Z', true)], now)?.isDue).toBe(true);
  });

  it('ignores an allowance with no readable date', () => {
    expect(allowanceDue([allowance('m_ama', 10, 'never')], now)).toBeNull();
  });
});

describe('the screen', () => {
  it('opens on everyone as tiles, in Home’s order and colours', () => {
    expect(screen).toContain('() => [...parents, ...(kidsHidden ? [] : children), ...helpers]');
    expect(screen).toContain('const tone = personTone(m.name, members);');
    expect(screen).toContain('style={[styles.tile, { width: tileWidth, backgroundColor: ui[tone.bg] }]}');
    expect(screen).toContain('{people.map(renderTile)}');
  });

  it('keeps the ids the harnesses press and the marks the rows carried', () => {
    expect(screen).toContain('testID={isKid ? `child-${m.member_id}` : `hub-member-${m.member_id}`}');
    expect(screen).toContain('testID="kids-add-child"');
    expect(screen).toContain('testID={`child-owed-${m.member_id}`}');
    expect(screen).toContain('testID={notJoined ? `hub-not-joined-${m.member_id}` : undefined}');
    expect(screen).toContain('testID={`hub-message-${m.member_id}`}');
  });

  it('has two halves, and a child opens the second', () => {
    expect(screen).toContain('testID="family-tab-people"');
    expect(screen).toContain('testID="family-tab-jobs"');
    expect(screen).toContain('onPress={() => (isKid ? openChild(m) : openMember(m))}');
  });

  it('says how the week is going, and only with a number to show', () => {
    expect(screen).toContain('if (!jobs && earned === 0 && !due) return null;');
    expect(screen).toContain('api.familyJobsWeek().then(setWeekJobs).catch(() => setWeekJobs(null));');
    expect(screen).toContain('api.listActivity(3).then(setLatest).catch(() => setLatest([]));');
    expect(screen).toContain('testID="family-week"');
    expect(screen).toContain('testID="family-latest"');
  });

  it('says every new thing in all four languages', () => {
    for (const key of ['fam_our_family', 'fam_people_count', 'fam_person_one', 'fam_tab_people', 'fam_tab_jobs',
      'fam_jobs_done', 'fam_n_of_m', 'fam_stars_earned', 'fam_allowance_due', 'fam_allowance_due_now', 'fam_latest', 'fam_years']) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
    }
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.fam_n_of_m).toContain('{done}');
      expect(table.fam_n_of_m).toContain('{total}');
      expect(table.fam_allowance_due).toContain('{day}');
      expect(table.fam_years).toContain('{n}');
      expect(table.fam_people_count).toContain('{n}');
    }
  });
});
