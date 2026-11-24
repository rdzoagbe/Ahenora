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
  // Redesign Roland approved on 2026-11-24 ("redesign as this"): tonight
  // leads with one Cook button, the week is one list of days, the shopping
  // list is no longer repeated inside Meals, and what is left to buy sits
  // in the corner where the painting was.
  it('opens on the menu, tonight first', () => {
    expect(screen).toContain("title={t(view === 'shop' ? 'kit_title_list' : view === 'spend' ? 'kit_title_spend' : 'kit_title_meals')}");
    expect(screen).toContain('testID="kitchen-tonight"');
    expect(screen).toContain('testID="kitchen-tonight-cook"');
    expect(screen).toContain('testID="kitchen-week"');
  });

  it('puts the tabs in the order they are used: meals, list, spending', () => {
    const meal = screen.indexOf("['meal', t('kit_tab_meals')]");
    const shop = screen.indexOf("['shop', t('kit_tab_list')]");
    const spend = screen.indexOf("['spend', t('kit_tab_spending')]");
    expect(meal).toBeGreaterThan(0);
    expect(shop).toBeGreaterThan(meal);
    expect(spend).toBeGreaterThan(shop);
  });

  it('plans a day from its line, within what the plan allows', () => {
    expect(screen).toContain('testID={`kitchen-plan-${day}`}');
    expect(screen).toContain("onPress={() => (canPlanMeal ? planDay(day) : promptUpgrade('meal_planner'))}");
  });

  it('shows every dish of a day, each with its way to cook it and its bin', () => {
    expect(screen).toContain('dishes.length > 0 ? dishes.map(mealRow)');
    expect(screen).toContain('testID={cookId(m)}');
    expect(screen).toContain('onPress={() => deleteMeal(m.meal_id)}');
    expect(screen).toContain('onPress={() => deleteMeal(tonight.meal_id)}');
    // Breakfast or lunch today is not lost behind tonight's card.
    expect(screen).toContain('alsoToday.map(mealRow)');
  });

  it('says what is left to buy in the corner, and that corner opens the list', () => {
    const tile = screen.slice(screen.indexOf('testID="kitchen-to-buy"'), screen.indexOf('showAdd={false}'));
    expect(tile).toContain("onPress={() => selectView('shop')}");
    expect(tile).toContain('{uncheckedItems.length}');
    // No second copy of the list inside Meals.
    expect(screen).not.toContain('kitchen-to-buy-all');
    expect(screen).not.toContain('stillToBuy(shopItems)');
  });

  it('has one main button a tab: the picker, or the receipt camera on Spending', () => {
    const header = screen.slice(screen.indexOf('<ScreenHeader'), screen.indexOf('<View style={styles.tabs}>'));
    expect(header).toContain('showAdd={false}');
    expect(header).toContain('testID="tab-add"');
    expect(header).toContain('onPress={openQuickAdd}');
    expect(header).toContain('testID="exp-scan-receipt"');
    expect(header).toContain('onPress={() => spendScan.current?.()}');
  });

  it('keeps the small options as links at the foot, none of them lost', () => {
    for (const id of ['meal-add', 'meal-sync', 'meal-history', 'recipe-ai-open', 'meal-clear-all', 'kitchen-keep-awake',
      'shop-history', 'shop-clear-done', 'shop-select-mode', 'shop-clear-all']) {
      expect([id, screen.includes(`testID="${id}"`)]).toEqual([id, true]);
    }
    const spending = read('src', 'components', 'SpendingView.tsx');
    expect(spending).toContain('testID="exp-add-open"');
    expect(spending).toContain('testID="exp-scan-file"');
    // Standing alone (the old /expenses address) it keeps its own buttons.
    expect(spending).toContain('{!scan && !embedded ? (');
  });

  it('puts the receipt camera away while a read receipt is being checked', () => {
    expect(screen).toContain("right={view === 'spend' ? (spendState === 'review' ? null : (");
    const spending = read('src', 'components', 'SpendingView.tsx');
    expect(spending).toContain("onScanning?.(reviewing ? 'review' : scanning ? 'reading' : 'idle');");
  });

  it('draws no emoji for an aisle: a dot and its name', () => {
    expect(screen).not.toContain('AISLE_EMOJI');
    expect(screen).toContain('styles.aisleDot');
  });

  it('says every new thing in all four languages', () => {
    for (const key of ['kitchen_whats_cooking', 'kitchen_tonight', 'kitchen_nothing_tonight', 'kitchen_plan',
      'kitchen_to_buy', 'kitchen_to_buy_one', 'kitchen_see_all', 'kitchen_min', 'shop_added_by',
      'kit_title_meals', 'kit_title_list', 'kit_title_spend', 'kit_tile_to_buy', 'kit_tile_open', 'kit_week_planned',
      'kit_plan_meal', 'kit_recipe_ready', 'kit_no_recipe_yet', 'kit_cook', 'kit_ideas_tile', 'kit_capture_tile',
      'kit_foot_to_list', 'kit_foot_saved', 'kit_foot_ask', 'kit_foot_screen_on', 'kit_foot_screen_is_on',
      'kit_foot_past', 'kit_to_buy_head', 'kit_in_basket', 'kit_ticket', 'kit_foot_add_shop', 'kit_foot_import', 'kit_foot_add_meal']) {
      for (const lang of LANGS) {
        expect([lang, key, typeof (TRANSLATIONS[lang] as Record<string, unknown>)[key]]).toEqual([lang, key, 'string']);
      }
    }
    for (const lang of LANGS) {
      const table = TRANSLATIONS[lang] as Record<string, string>;
      expect(table.kitchen_tonight).toContain('{day}');
      expect(table.kitchen_to_buy).toContain('{n}');
      expect(table.kitchen_min).toContain('{n}');
      expect(table.kit_tile_open).toContain('{n}');
      expect(table.kit_week_planned).toContain('{n}');
      expect(table.kit_week_planned).toContain('{total}');
    }
  });
});
