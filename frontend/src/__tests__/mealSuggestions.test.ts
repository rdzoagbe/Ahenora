import { suggestWeek, localizedMealTitle, localizedMealIngredients, RECIPE_IDS, resolveRecipeId } from '../mealSuggestions';
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

describe('resolveRecipeId', () => {
  it('recovers the recipe from a meal saved before recipe ids existed', () => {
    expect(resolveRecipeId(null, 'Spaghetti Bolognese')).toBe('bolognese');
    expect(resolveRecipeId(undefined, 'Chicken Curry')).toBe('chicken_curry');
  });

  it('recovers it whatever language the meal was saved in', () => {
    expect(resolveRecipeId(null, 'Spaghettis bolognaise')).toBe('bolognese');
    expect(resolveRecipeId(null, 'Espaguetis boloñesa')).toBe('bolognese');
    expect(resolveRecipeId(null, 'Curry de poulet')).toBe('chicken_curry');
  });

  it('shrugs off accents, case and punctuation', () => {
    expect(resolveRecipeId(null, 'ESPAGUETIS BOLONESA')).toBe('bolognese');
    expect(resolveRecipeId(null, "Shepherd's Pie")).toBe('shepherds_pie');
  });

  it('prefers a stored id over guessing from the title', () => {
    expect(resolveRecipeId('tacos', 'Spaghetti Bolognese')).toBe('tacos');
  });

  it('returns null rather than guessing at a meal we do not ship', () => {
    // A wrong method for someone else's dinner is worse than no method.
    expect(resolveRecipeId(null, "Mum's Sunday roast")).toBeNull();
    expect(resolveRecipeId(null, 'Spaghetti with something else')).toBeNull();
    expect(resolveRecipeId(null, '')).toBeNull();
  });

  it('lets an old meal re-translate once its recipe is recovered', () => {
    expect(localizedMealTitle(null, 'Spaghettis bolognaise', 'en')).toBe('Spaghetti Bolognese');
    expect(localizedMealTitle(null, "Mum's Sunday roast", 'fr')).toBe("Mum's Sunday roast");
  });
});

describe('a West African shopping list', () => {
  // The list that exposed the gap: the library only knew a European pantry, so
  // a household shopping for yam, okra, garden eggs and corn flour was offered
  // shepherd's pie, BLTs and minestrone.
  const LIST = [
    'Sweet potato', "Yam's", 'Porc ribs', 'Corn flour', 'Okro', 'Bell peppers',
    'Garden eggs', 'Tomatoes', 'Rice', 'Chicken thighs', 'Maïs', 'Beef',
  ];

  it('proposes mostly dishes from that kitchen', () => {
    const week = suggestWeek(LIST, 'en');
    const african = week.filter((s) =>
      ['jollof_rice', 'chicken_yassa', 'groundnut_stew', 'okra_soup', 'yam_tomato', 'red_red',
       'garden_egg_stew', 'grilled_tilapia', 'attieke_fish', 'banku_okra', 'peanut_spinach',
       'sweet_potato_chicken'].includes(s.recipeId),
    );
    expect(african.length).toBeGreaterThanOrEqual(4);
  });

  it('actually uses the ingredients that were bought', () => {
    const week = suggestWeek(LIST, 'en');
    const used = new Set(week.flatMap((s) => s.haveLabels));
    for (const staple of ['yam', 'okra', 'corn flour', 'sweet potato']) {
      expect(Array.from(used)).toContain(staple);
    }
  });

  it('never claims the family has something they did not buy', () => {
    const week = suggestWeek(LIST, 'en');
    const claimed = new Set(week.flatMap((s) => s.haveLabels));
    // These were all wrongly claimed before: "garden eggs" read as eggs,
    // "sweet potato" as potatoes, "corn flour" as corn.
    expect(claimed.has('eggs')).toBe(false);
    expect(claimed.has('potatoes')).toBe(false);
    expect(claimed.has('corn')).toBe(false);
  });

  it('still reads the list written in French', () => {
    const week = suggestWeek(
      ['Igname', 'Gombo', 'Farine de maïs', 'Patate douce', 'Tomates', 'Riz', 'Poulet'],
      'fr',
    );
    const used = new Set(week.flatMap((s) => s.haveLabels));
    expect(Array.from(used)).toContain('igname');
    expect(Array.from(used)).toContain('gombo');
  });

  it('does not confuse a specific ingredient for its generic namesake', () => {
    expect(new Set(suggestWeek(['Sweet potato'], 'en').flatMap((s) => s.haveLabels)).has('potatoes')).toBe(false);
    expect(new Set(suggestWeek(['Potatoes'], 'en').flatMap((s) => s.haveLabels)).has('potatoes')).toBe(true);
    expect(new Set(suggestWeek(['Corn flour'], 'en').flatMap((s) => s.haveLabels)).has('corn')).toBe(false);
    expect(new Set(suggestWeek(['Corn'], 'en').flatMap((s) => s.haveLabels)).has('corn')).toBe(true);
  });
});
