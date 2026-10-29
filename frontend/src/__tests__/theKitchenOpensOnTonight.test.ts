/**
 * The Kitchen opens on tonight.
 *
 * The final design Roland chose (2026-10-26): "What's cooking" over the
 * tab, then tonight's dinner as a card, the days that follow as a strip of
 * tiles with a picture each (a dashed "Plan" where nothing is), and what
 * still has to be bought, before the planner, the ideas and the camera that
 * were already there. This pins:
 *
 *  - today and the days after it are the weekday keys the Kitchen files
 *    meals under, in order, wrapping past Sunday;
 *  - a day's meal is its dinner first, else whatever is planned;
 *  - a dish gets a picture from its name in all four languages, and the
 *    cooking pot when nothing fits;
 *  - "to buy" is the unchecked items, in the order they were added;
 *  - the screen draws the three new pieces on the Meals half and the
 *    preview hands over to the List half;
 *  - every new string exists in all four languages.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';
import { dayKey, daysAfter, mealIcon, mealOn, stillToBuy } from '../kitchenWeek';
import type { MealPlan, ShoppingItem } from '../api';

const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];
const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', '..', ...p), 'utf8');
const screen = read('app', '(tabs)', 'kitchen.tsx');

const meal = (day: string, title: string, meal_type = 'dinner'): MealPlan =>
  ({ meal_id: `m_${day}_${title}`, family_id: 'fam', day, meal_type, title, ingredients: [], created_at: '2026-10-01' } as MealPlan);
const item = (name: string, checked = false): ShoppingItem =>
  ({ item_id: `i_${name}`, family_id: 'fam', name, category: 'other', checked, added_by: 'Sam', created_at: '2026-10-01' } as ShoppingItem);

describe('the days', () => {
  const friday = new Date('2026-10-30T18:00:00'); // a Friday

  it('names today the way the Kitchen files meals', () => {
    expect(dayKey(friday)).toBe('friday');
    expect(dayKey(new Date('2026-11-01T09:00:00'))).toBe('sunday');
  });

  it('runs the days after today in order, past Sunday', () => {
    expect(daysAfter(friday, 4)).toEqual(['saturday', 'sunday', 'monday', 'tuesday']);
    expect(daysAfter(friday, 7)).toHaveLength(7);
  });

  it('picks the dinner for a day, else whatever is planned, else nothing', () => {
    const meals = [meal('saturday', 'Pancakes', 'breakfast'), meal('saturday', 'Pizza night'), meal('sunday', 'Soup', 'lunch')];
    expect(mealOn(meals, 'saturday')?.title).toBe('Pizza night');
    expect(mealOn(meals, 'sunday')?.title).toBe('Soup');
    expect(mealOn(meals, 'monday')).toBeNull();
    expect(mealOn([meal('Monday', 'Pasta')], 'monday')?.title).toBe('Pasta');
  });
});

describe('a picture for a dish', () => {
  it('reads the name in all four languages', () => {
    expect(mealIcon('Pizza night')).toBe('pizza');
    expect(mealIcon('Roast chicken')).toBe('chicken');
    expect(mealIcon('Poulet rôti')).toBe('chicken');
    expect(mealIcon('Pollo al horno')).toBe('chicken');
    expect(mealIcon('Hähnchen mit Reis')).toBe('chicken');
    expect(mealIcon('Grilled salmon')).toBe('fish');
    expect(mealIcon('Soupe à l’oignon')).toBe('soup');
    expect(mealIcon('Ensalada César')).toBe('salad');
    expect(mealIcon('Burgers')).toBe('sandwich');
    expect(mealIcon('Omelette')).toBe('egg');
    expect(mealIcon('Spaghetti bolognese')).toBe('pasta');
  });

  it('is the cooking pot when nothing fits, and never throws on nothing', () => {
    expect(mealIcon('Jollof rice')).toBe('pot');
    expect(mealIcon('')).toBe('pot');
    expect(mealIcon(null)).toBe('pot');
  });
});

describe('what still has to be bought', () => {
  it('is the unchecked items in the order they were added', () => {
    const items = [item('Peppers'), item('Apples', true), item('Plantain'), item('Milk')];
    expect(stillToBuy(items).map((i) => i.name)).toEqual(['Peppers', 'Plantain', 'Milk']);
    expect(stillToBuy([])).toEqual([]);
  });
});

describe('the screen', () => {
  it('opens on what’s cooking', () => {
    expect(screen).toContain("title={t('kitchen_whats_cooking')}");
    expect(screen).toContain('testID="kitchen-tonight"');
    expect(screen).toContain('testID="kitchen-week"');
    expect(screen).toContain('testID="kitchen-to-buy"');
  });

  it('plans a day from its tile, within what the plan allows', () => {
    expect(screen).toContain('testID={`kitchen-plan-${day}`}');
    expect(screen).toContain("onPress={() => (canPlanMeal ? planDay(day) : promptUpgrade('meal_planner'))}");
  });

  it('hands the shopping preview over to the list', () => {
    expect(screen).toContain('testID="kitchen-to-buy-all"');
    expect(screen).toContain("onPress={() => selectView('shop')}");
    expect(screen).toContain('stillToBuy(shopItems).slice(0, 4)');
  });

  it('says every new thing in all four languages', () => {
    for (const key of ['kitchen_whats_cooking', 'kitchen_tonight', 'kitchen_nothing_tonight', 'kitchen_plan',
      'kitchen_to_buy', 'kitchen_to_buy_one', 'kitchen_see_all', 'kitchen_min', 'shop_added_by']) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
    }
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.kitchen_tonight).toContain('{day}');
      expect(table.kitchen_to_buy).toContain('{n}');
      expect(table.kitchen_min).toContain('{n}');
    }
  });
});
