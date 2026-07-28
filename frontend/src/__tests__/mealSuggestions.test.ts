import { suggestWeek, localizedMealTitle, localizedMealIngredients, RECIPE_IDS } from '../mealSuggestions';
import { RECIPE_METHODS, recipeMethod } from '../recipeSteps';

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

  it('re-renders a saved suggestion in the language being read now', () => {
    // A plan built in French must read as English after the user switches.
    const fr = suggestWeek(['pasta', 'ground beef'], 'fr').find((s) => s.recipeId === 'bolognese')!;
    expect(fr.title).toBe('Spaghettis bolognaise');
    expect(localizedMealTitle('bolognese', fr.title, 'en')).toBe('Spaghetti Bolognese');
    expect(localizedMealTitle('bolognese', fr.title, 'de')).toBe('Spaghetti Bolognese');
    expect(localizedMealIngredients('bolognese', fr.allLabels, 'en')).toContain('ground beef');
  });

  it('leaves a meal the user typed themselves untouched', () => {
    expect(localizedMealTitle(null, "Grandma's stew", 'fr')).toBe("Grandma's stew");
    expect(localizedMealTitle(undefined, 'Leftovers', 'de')).toBe('Leftovers');
    expect(localizedMealIngredients(null, ['whatever'], 'es')).toEqual(['whatever']);
  });

  it('falls back to the stored text if the recipe id is unknown', () => {
    // A plan saved by a newer build whose recipe we no longer ship.
    expect(localizedMealTitle('removed_recipe', 'Mystery dinner', 'en')).toBe('Mystery dinner');
    expect(localizedMealIngredients('removed_recipe', ['rice'], 'fr')).toEqual(['rice']);
  });
});

describe('recipe methods', () => {
  it('ships a method for every recipe in the library', () => {
    const missing = RECIPE_IDS.filter((id) => !RECIPE_METHODS[id]);
    expect(missing).toEqual([]);
  });

  it('ships every method in all four languages, with real steps', () => {
    for (const id of RECIPE_IDS) {
      const method = RECIPE_METHODS[id];
      expect(method.minutes).toBeGreaterThan(0);
      for (const lang of ['en', 'es', 'fr', 'de'] as const) {
        const steps = method.steps[lang];
        expect(Array.isArray(steps)).toBe(true);
        expect(steps.length).toBeGreaterThanOrEqual(3);
        // An untranslated placeholder is worse than no translation at all.
        steps.forEach((s) => expect(s.trim().length).toBeGreaterThan(10));
      }
      // Every language should describe the same number of steps.
      const counts = (['en', 'es', 'fr', 'de'] as const).map((l) => method.steps[l].length);
      expect(new Set(counts).size).toBe(1);
    }
  });

  it('returns nothing for a typed meal or a recipe we no longer ship', () => {
    expect(recipeMethod(null, 'en')).toBeNull();
    expect(recipeMethod(undefined, 'fr')).toBeNull();
    expect(recipeMethod('removed_recipe', 'de')).toBeNull();
  });

  it('returns the method in the language asked for', () => {
    const fr = recipeMethod('bolognese', 'fr');
    const en = recipeMethod('bolognese', 'en');
    expect(fr!.steps[0]).toContain('pâtes');
    expect(en!.steps[0]).toContain('pasta');
    expect(fr!.minutes).toBe(en!.minutes);
  });
});
