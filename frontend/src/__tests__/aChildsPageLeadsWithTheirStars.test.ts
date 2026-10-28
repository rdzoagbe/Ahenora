/**
 * A child's page opens on the child.
 *
 * The final design Roland chose (2026-10-26) for the kids' page: the child's
 * face and stars in their own colour, what they are saving for as a bar, what
 * they have earned and not yet been given with a "Use it", and the buttons a
 * parent presses to say well done. The chores and treats themselves stay on
 * the Family tab, a link away. This pins:
 *
 *  - the goal is the cheapest treat out of reach; when every treat is within
 *    reach it is the week, unless the week is already cashed in; else nothing;
 *  - only this child's pending treats are "earned and ready", oldest first;
 *  - the page shows the top for a child and not for a teen or a parent;
 *  - "Use it" asks the server to mark the treat handed over and only then
 *    reloads; "+1 Well done!" is written to the ledger as those words;
 *  - the child's colour is the same one they have on Home;
 *  - every new string exists in all four languages, with the same placeholders.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS, translate } from '../i18n';
import { earnedAndReady, savingFor } from '../kidPage';
import type { FamilyMember, Redemption, Reward } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const page = read('app', 'member.tsx');
const top = read('src', 'components', 'KidPageTop.tsx');

const kid = (over: Partial<FamilyMember> = {}): FamilyMember =>
  ({ member_id: 'm_ama', family_id: 'fam', name: 'Ama', role: 'child', stars: 54, ...over } as FamilyMember);
const reward = (title: string, cost_stars: number, over: Partial<Reward> = {}): Reward =>
  ({ reward_id: `r_${title}`, family_id: 'fam', title, cost_stars, created_at: '2026-10-01', ...over } as Reward);
const owed = (member_id: string, created_at: string, status: Redemption['status'] = 'pending'): Redemption =>
  ({ redemption_id: `rd_${member_id}_${created_at}`, family_id: 'fam', member_id, reward_title: 'Movie night',
     cost_stars: 20, status, created_at } as Redemption);

describe('what the child is saving for', () => {
  const zoo = reward('Trip to the zoo', 60);
  const movie = reward('Movie night', 20);
  const bike = reward('Bike', 200);

  it('is the cheapest treat they cannot yet afford', () => {
    expect(savingFor(kid(), [bike, zoo, movie])).toEqual(
      { kind: 'reward', title: 'Trip to the zoo', icon: null, have: 54, need: 60 });
  });

  it('is the treat even when a weekly target is set — every child has one', () => {
    // The server hands a default target to a child never given one, so a
    // week-first rule would mean no child ever saw a treat here.
    expect(savingFor(kid({ weekly_target: 35, week_earned: 20 }), [zoo])?.kind).toBe('reward');
  });

  it('is the week when every treat is within reach, or there are none', () => {
    expect(savingFor(kid({ stars: 500, weekly_target: 10, week_earned: 7 }), [bike, zoo, movie]))
      .toEqual({ kind: 'week', have: 7, need: 10 });
    expect(savingFor(kid({ weekly_target: 10, week_earned: 7 }), [])).toEqual({ kind: 'week', have: 7, need: 10 });
  });

  it('but a week already cashed in is not a goal any more', () => {
    expect(savingFor(kid({ weekly_target: 10, week_earned: 12, week_claimed: true }), [])).toBeNull();
  });

  it('is nothing with no treat out of reach and no week to measure', () => {
    expect(savingFor(kid({ stars: 500 }), [bike, zoo, movie])).toBeNull();
  });

  it('never shows a negative week', () => {
    expect(savingFor(kid({ weekly_target: 10, week_earned: -3 }), [])).toEqual({ kind: 'week', have: 0, need: 10 });
  });
});

describe('what the child has earned and not yet been given', () => {
  it('is only their own pending treats, oldest first', () => {
    const list = [
      owed('m_ama', '2026-10-27T10:00:00Z'),
      owed('m_leo', '2026-10-26T10:00:00Z'),
      owed('m_ama', '2026-10-25T10:00:00Z'),
      owed('m_ama', '2026-10-24T10:00:00Z', 'fulfilled'),
    ];
    expect(earnedAndReady(list, 'm_ama').map((r) => r.created_at))
      .toEqual(['2026-10-25T10:00:00Z', '2026-10-27T10:00:00Z']);
  });
});

describe('the page', () => {
  it('shows the top for a child, and the plain header for everyone else', () => {
    expect(page).toContain("{kind === 'kid' ? (\n          <KidPageTop");
    expect(page).toContain("{kind !== 'kid' ? (\n        <View style={styles.header}>");
  });

  it('colours the child the way Home does', () => {
    expect(page).toContain('tone={personTone(displayName, members)}');
    expect(top).toContain('const tint = ui[tone.bg];');
  });

  it('links to the Family tab for the jobs and treats themselves', () => {
    expect(page).toContain("onEditJobs={() => router.push('/(tabs)/kids')}");
    expect(top).toContain("testID=\"kid-edit-jobs\"");
  });

  it('marks a treat handed over on the server, and reloads only after', () => {
    const fn = page.slice(page.indexOf('const useReward = useCallback'), page.indexOf('}, [busy, loadMember, t]);'));
    expect(fn).toContain('await api.fulfilRedemption(r.redemption_id);');
    expect(fn.indexOf('fulfilRedemption')).toBeLessThan(fn.indexOf('await loadMember()'));
    expect(fn).not.toMatch(/setOwed\(/);
  });

  it('writes "+1 Well done!" to the ledger as those words', () => {
    expect(top).toContain("onPress={() => onGive(1, t('hub_well_done'))}");
    expect(page).toMatch(/reason: reason \|\| t\('kids_parent_added_stars'\)/);
  });

  it('draws the bar from the goal and never past full', () => {
    expect(top).toContain('Math.min(1, goal.need > 0 ? goal.have / goal.need : 0)');
    expect(top).toContain('accessibilityRole="progressbar"');
  });
});

describe("today's jobs", () => {
  const api = read('src', 'api.ts');

  it('are read for this device\'s today', () => {
    expect(api).toMatch(/memberJobs: \(member_id: string\) =>/);
    expect(api).toContain("`/family/members/${member_id}/jobs?timezone=${encodeURIComponent(deviceTimeZone() || '')}`");
  });

  it('are on the page, and absent rather than "0 of 0" when the read failed', () => {
    expect(page).toContain('api.memberJobs(id).then(setJobs).catch(() => setJobs(null));');
    expect(page).toContain('jobs={jobs?.jobs ?? []}');
    expect(top).toContain('{jobs.length > 0 ? (');
  });

  it('a tick pays through the wheel, then re-reads everything', () => {
    const fn = page.slice(page.indexOf('const doJob = useCallback'), page.indexOf('// The picture is one PATCH away'));
    expect(fn).toContain('if (busy || job.done) return;');
    expect(fn).toContain('await api.completeChore(job.chore_id);');
    expect(fn.indexOf('completeChore')).toBeLessThan(fn.indexOf('await loadMember()'));
  });

  it('a tick drops the cached roster, so the star count re-reads', () => {
    const fn = api.slice(api.indexOf('completeChore: (id: string) => {'), api.indexOf('deleteChore:'));
    expect(fn).toContain("cache.invalidate('familyMembers');");
  });

  it('a done tile cannot be ticked twice', () => {
    expect(top).toContain('disabled={j.done || busy}');
    expect(top).toContain('accessibilityState={{ checked: j.done, disabled: j.done || busy }}');
  });
});

describe('every new string exists in all four languages', () => {
  const keys = ['hub_edit_jobs', 'hub_saving_for', 'hub_this_week', 'hub_stars_to_go', 'hub_week_done',
    'hub_earned_ready', 'hub_use_it', 'hub_say_well_done', 'hub_well_done',
    'hub_todays_jobs', 'hub_jobs_done', 'hub_job_done', 'hub_star_to_go'];

  it.each(keys)('%s', (key) => {
    for (const lang of LANGS) {
      const text = translate(lang, key, { n: 6 });
      expect(text).not.toBe(key);
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it('says how many stars are left, in each language', () => {
    for (const lang of LANGS) expect(translate(lang, 'hub_stars_to_go', { n: 6 })).toContain('6');
  });

  it('says "1 more star", not "1 more stars"', () => {
    expect(top).toContain("left === 1 ? t('hub_star_to_go')");
    expect(translate('en', 'hub_star_to_go')).toBe('Only 1 more star to go');
  });

  it('counts the jobs done, in each language', () => {
    for (const lang of LANGS) {
      const text = translate(lang, 'hub_jobs_done', { done: 1, total: 3 });
      expect(text).toContain('1');
      expect(text).toContain('3');
    }
  });
});
