/**
 * Kid mode shows the child's jobs from the chore wheel, in the family's look.
 *
 * Roland, 2026-11-03: "Go with 3, the kid screen". The child's own screen
 * listed only tasks with their name on them; the daily jobs a parent sets up
 * (bed, table, homework) live on the chore wheel, so a child saw "nothing to
 * do" while their parent's page listed three jobs. It now reads like that
 * page: their colour and stars on top, what they are saving for, today's jobs
 * as tiles, rewards as tiles.
 *
 * A tile ticked here pays nothing until a grown-up approves it (the server
 * holds that rule: tests/test_a_child_ticks_their_own_jobs.py); the tile says
 * it is waiting, so waiting never looks like the tap failing.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const kid = read('app', 'kid.tsx');
const api = read('src', 'api.ts');
const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];

describe("the child's screen", () => {
  it("lists today's jobs as tiles and ticks one through the kid endpoint", () => {
    expect(kid).toMatch(/testID=\{`kid-job-\$\{j\.chore_id\}`\}/);
    expect(kid).toMatch(/onPress=\{\(\) => finishJob\(j\.chore_id\)\}/);
    expect(kid).toMatch(/await api\.kidFinishJob\(choreId\)/);
    expect(api).toMatch(/kidFinishJob: \(choreId: string\) =>\s*request<[^>]*>\(`\/kid\/jobs\/\$\{choreId\}\/done`, \{ method: 'POST' \}\)/);
  });

  it('says a ticked job is waiting for a grown-up, and does not let it be tapped again', () => {
    expect(kid).toMatch(/state === 'waiting' \? styles\.jobWaiting/);
    expect(kid).toMatch(/t\('kid_job_waiting'\)/);
    expect(kid).toMatch(/disabled=\{state !== 'open' \|\| busy\}/);
  });

  it('does not pretend a tick paid stars: the count only moves when the server says so', () => {
    const tick = kid.slice(kid.indexOf('const finishJob'), kid.indexOf('const spend'));
    expect(tick).not.toMatch(/stars:/);
    expect(tick).toMatch(/await load\(\)/);
  });

  it("asks the server for today in the device's own zone", () => {
    expect(api).toMatch(/kidHome: \(\) => request<KidHome>\(`\/kid\/home\?timezone=\$\{encodeURIComponent\(deviceTimeZone\(\) \|\| ''\)\}`\)/);
  });

  it('copes with a server that does not send jobs yet', () => {
    expect(kid).toMatch(/const jobs = home\.jobs \|\| \[\];/);
    expect(api).toMatch(/jobs\?: KidJob\[\];/);
  });

  it("opens on the child's colour, stars and what they are saving for", () => {
    expect(kid).toMatch(/testID="kid-top"/);
    expect(kid).toMatch(/testID="kid-stars"/);
    expect(kid).toMatch(/savingFor\(\{ stars: home\.stars \} as FamilyMember, home\.rewards\)/);
    expect(kid).toMatch(/testID="kid-saving-for"/);
  });

  it('keeps the way out behind a grown-up PIN', () => {
    expect(kid).toMatch(/testID="kid-exit"/);
    expect(kid).toMatch(/await api\.exitKidSession\(pin\.trim\(\)\)/);
  });
});

describe('every new string exists in all four languages', () => {
  it.each(['kid_job_waiting', 'kid_my_tasks'])('%s', (key) => {
    LANGS.forEach((lang) => {
      expect(`${lang}.${key}: ${(TRANSLATIONS[lang] as Record<string, string>)[key] ?? ''}`).not.toMatch(/: $/);
    });
  });
});
