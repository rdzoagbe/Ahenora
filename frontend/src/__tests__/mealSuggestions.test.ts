import { suggestWeek } from '../mealSuggestions';

describe('suggestWeek', () => {
  it('always returns 7 dinners across the week', () => {
    const week = suggestWeek([], 'en');
    expect(week).toHaveLength(7);
    expect(new Set(week.map((s) => s.day)).size).toBe(7);
    expect(new Set(week.map((s) => s.recipeId)).size).toBe(7);
  });

  it('ranks meals you have ingredients for first, across languages', () => {
    // French + Spanish shopping items should still match.
    const week = suggestWeek(['Poulet', 'Riz', 'brócoli', 'ail'], 'en');
    const top = week[0];
    expect(top.matched).toBeGreaterThanOrEqual(3);
    // The grilled chicken & rice recipe should surface near the top.
    expect(week.slice(0, 3).map((s) => s.recipeId)).toContain('chicken_rice');
  });

  it('splits ingredients into have vs need and localizes titles', () => {
    const week = suggestWeek(['pasta', 'ground beef'], 'fr');
    const bolo = week.find((s) => s.recipeId === 'bolognese');
    expect(bolo).toBeTruthy();
    expect(bolo!.title).toBe('Spaghettis bolognaise');
    expect(bolo!.haveLabels.length).toBeGreaterThanOrEqual(2);
    expect(bolo!.haveLabels.length + bolo!.needLabels.length).toBe(bolo!.allLabels.length);
  });

  it('does not false-match substrings like egg in eggplant', () => {
    const week = suggestWeek(['eggplant'], 'en');
    const omelette = week.find((s) => s.recipeId === 'omelette');
    // eggplant must NOT count as eggs
    expect(omelette && omelette.haveLabels).not.toContain('eggs');
  });
});
