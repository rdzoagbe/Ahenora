/**
 * Free keeps a taste, and a trial ends in a thank-you (Roland, 2026-10-15:
 * "I do not want users to feel trapped about having to jump straight to
 * payment after trial").
 *
 * The server decides what is counted (tests/test_free_keeps_a_taste.py). This
 * holds the app to the three promises that only the app can break:
 *   - opening Home never spends Free's monthly weekly report by itself;
 *   - the AI parts of the planner stay behind the paid plan, taste or not;
 *   - every word of the thank-you exists in all four languages and keeps the
 *     promise the trial was sold on: nothing is charged automatically.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
const feed = read('..', 'app', '(tabs)', 'feed.tsx');
const kitchen = read('..', 'app', '(tabs)', 'kitchen.tsx');
const card = read('components', 'TrialCard.tsx');
const LANGS = ['en', 'es', 'fr', 'de'] as const;
const table = (lang: string) => (TRANSLATIONS as unknown as Record<string, Record<string, string>>)[lang];

describe('the weekly report on Free', () => {
  it('is never fetched on its own unless this week is already the open one', () => {
    expect(feed).toContain('if (subscription && (!reportPlanLocked || reportOpenThisWeek)) {');
  });

  it('is fetched when the parent taps it, which is what spends the month', () => {
    const tap = feed.slice(feed.indexOf('const toggleReport = useCallback'));
    expect(tap.slice(0, 600)).toContain('api.weeklyReport()');
    expect(feed).toContain("onPress={() => (reportLocked ? promptUpgrade('weekly_report') : toggleReport())}");
  });
});

describe('the meal planner on Free', () => {
  it('opens for adding while the month lasts', () => {
    expect(kitchen).toContain('const canPlanMeal = !mealLocked || mealTasteLeft > 0;');
    expect(kitchen).toContain('testID="meal-taste-add"');
    expect(kitchen).toContain('testID="meal-taste-count"');
  });

  it('never adds more meals at once than the month has left', () => {
    expect(kitchen).toContain('.slice(0, mealLocked ? mealTasteLeft : undefined);');
  });

  it('keeps the AI recipe behind the paid plan, taste or not', () => {
    const ask = kitchen.slice(kitchen.indexOf('const askRecipeAI = useCallback'));
    expect(ask.slice(0, 500)).toContain("if (mealLocked) { promptUpgrade('meal_planner'); return; }");
  });
});

describe('the end of a trial', () => {
  it('thanks the family once, with what it used', () => {
    expect(card).toContain('api.trialRecap()');
    expect(card).toContain("testID={mode === 'thanks' ? 'trial-thanks' : 'trial-card'}");
    expect(card).toContain('`trial_thanks_ok:${endedAt}`');
  });

  it('has every word in all four languages', () => {
    const keys = [
      'trial_recap_title', 'trial_recap_meals', 'trial_recap_pocket_money', 'trial_recap_stars',
      'trial_recap_carpools', 'trial_recap_gift_pots', 'trial_recap_santa', 'trial_recap_documents',
      'trial_recap_chores', 'trial_recap_kid_chores', 'trial_recap_kid_chores_one',
      'trial_recap_kid_stars', 'trial_recap_kid_stars_one',
      'trial_thanks_title', 'trial_thanks_msg', 'trial_thanks_children', 'trial_thanks_ok',
      'taste_meal_left', 'taste_meal_spent', 'taste_report_free', 'taste_report_used',
    ];
    for (const lang of LANGS) {
      for (const k of keys) {
        expect([lang, k, typeof table(lang)[k]]).toEqual([lang, k, 'string']);
        expect(table(lang)[k].length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps every placeholder the card fills in', () => {
    for (const lang of LANGS) {
      const t = table(lang);
      for (const k of ['trial_thanks_msg', 'trial_card_msg']) {
        expect([lang, k, t[k].includes('{plan}'), t[k].includes('{price}')]).toEqual([lang, k, true, true]);
      }
      expect([lang, t.taste_meal_left.includes('{left}'), t.taste_meal_left.includes('{limit}')]).toEqual([lang, true, true]);
      expect([lang, t.taste_meal_spent.includes('{date}')]).toEqual([lang, true]);
    }
  });

  it('still says nothing is charged automatically', () => {
    expect(table('en').trial_thanks_msg).toContain('Nothing is charged automatically');
    expect(table('en').trial_card_msg).toContain('Nothing is charged automatically');
  });

  it('says on the Plans page exactly what the server gives', () => {
    const server = readFileSync(join(__dirname, '..', '..', '..', 'backend', 'server.py'), 'utf8');
    const meals = server.match(/"meal_planner": \{"limit": (\d+)\}/);
    const report = server.match(/"weekly_report": \{"limit": (\d+)\}/);
    expect(meals?.[1]).toBe('7');
    expect(report?.[1]).toBe('1');
    for (const lang of LANGS) {
      expect([lang, table(lang).pf_free_taste.includes('7')]).toEqual([lang, true]);
      expect([lang, table(lang).trial_thanks_msg.includes('7')]).toEqual([lang, true]);
    }
    expect(read('components', 'PricingView.tsx')).toContain("'pf_free_taste',");
  });

  it('names a recap line for every count the server can send', () => {
    const server = readFileSync(join(__dirname, '..', '..', '..', 'backend', 'server.py'), 'utf8');
    const block = server.slice(server.indexOf('TRIAL_RECAP_SOURCES = ('), server.indexOf('@app.get("/api/trial/recap")'));
    const keys = [...block.matchAll(/\("([a-z_]+)", "[a-z_]+", "[a-z_]+"/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(5);
    for (const k of keys) expect([k, typeof table('en')[`trial_recap_${k}`]]).toEqual([k, 'string']);
    // The kids' wedge: what the children did heads the list, on the server and on the card.
    expect(keys.slice(0, 2)).toEqual(['chores', 'stars']);
  });

  it('opens the recap with each child by name, busiest first', () => {
    expect(card).toContain("testID={`trial-recap-kid-${kid.member_id}`}");
    expect(card).toContain("kids.length === 0 || (it.key !== 'chores' && it.key !== 'stars')");
    expect(card).toContain("count('trial_recap_kid_chores', kid.chores)");
    expect(card).toContain("count('trial_recap_kid_stars', kid.stars)");
    const server = readFileSync(join(__dirname, '..', '..', '..', 'backend', 'server.py'), 'utf8');
    expect(server).toContain('kids.sort(key=lambda k: (-k["chores"], -k["stars"], k["name"]))');
    for (const lang of LANGS) {
      expect([lang, table(lang).trial_recap_kid_chores.includes('{n}')]).toEqual([lang, true]);
      expect([lang, table(lang).trial_recap_kid_stars.includes('{n}')]).toEqual([lang, true]);
    }
  });
});

describe('the count on screen after a taste is spent', () => {
  it('is read fresh, not from the cached subscription', () => {
    const api = read('api.ts');
    expect(api).toContain("request<MealPlan>('/meals', { method: 'POST', body: data }).finally(invalidateUsageCaches)");
    expect(api).toContain("request<WeeklyReport>('/report/weekly').finally(invalidateUsageCaches)");
  });
});
