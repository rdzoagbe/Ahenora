/**
 * One camera, and everything it sees goes where it belongs:
 *   a recipe    -> a day of the week AND its ingredients on the list
 *   a list      -> the shopping list
 *   a receipt   -> the expenses (never for a helper, who cannot see money)
 *   a document  -> the vault drawer the scan chose, and a task
 * The Kitchen's own recipe capture puts the ingredients on the list too.
 */
import fs from 'fs';
import path from 'path';

import { TRANSLATIONS } from '../i18n';

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
const camera = read('components', 'CameraCaptureModal.tsx');
const LANGS = Object.keys(TRANSLATIONS) as (keyof typeof TRANSLATIONS)[];

describe('a recipe', () => {
  it('is planned for a day and its ingredients go on the list, in one tap', () => {
    const meal = camera.indexOf('api.addMealFromCapture(planDay, recipe, lang)');
    const list = camera.indexOf('api.bulkAddShopping(', meal);
    expect(meal).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(meal); // the meal first: a failure lists nothing
    expect(camera).toContain("t('cam_add_meal_and_list'");
  });

  it('starts on today, and can be left unplanned', () => {
    expect(camera).toContain('setMealDay(mealsLocked ? null : today())');
    expect(camera).toContain('[...DAYS, null]');
  });

  it('on a plan without the kitchen, still lists the ingredients and says why the days are locked', () => {
    expect(camera).toContain('testID="cam-meal-locked"');
    expect(camera).toContain("showUpgradePrompt('meal_planner'");
  });
});

describe('a receipt', () => {
  it('becomes an expense with the lines the reader was sure of', () => {
    expect(camera).toContain("result.kind === 'receipt' && result.receipt && !user?.is_helper");
    expect(camera).toContain('api.addExpense({');
    expect(camera).toContain('.filter((i) => !i.unsure)');
  });

  it('can still be filed as a document instead', () => {
    expect(camera).toContain('testID="cam-receipt-as-document"');
  });
});

describe('the Kitchen capture', () => {
  it('puts the ingredients on the list as well as planning the meal', () => {
    const kitchen = read('..', 'app', '(tabs)', 'kitchen.tsx');
    const meal = kitchen.indexOf('api.addMealFromCapture(captureDay, captured, suggestLang)');
    expect(meal).toBeGreaterThan(-1);
    expect(kitchen.indexOf('api.bulkAddShopping(names', meal)).toBeGreaterThan(meal);
  });
});

describe('every new camera string exists in every language', () => {
  const keys = [
    'cam_cook_on', 'cam_not_planned', 'cam_ingredients_to_list', 'cam_add_meal_and_list',
    'cam_add_meal_only', 'cam_done_title', 'cam_done_meal', 'cam_done_shopping',
    'cam_looks_like_receipt', 'cam_receipt_total', 'cam_receipt_mismatch', 'cam_receipt_lines',
    'cam_add_expense', 'cam_done_receipt', 'cam_receipt_shop_unknown',
    'cam_looks_like_shopping', 'cam_shopping_sub', 'cam_task_instead',
  ];
  it.each(LANGS)('%s', (lang) => {
    const table = TRANSLATIONS[lang] as Record<string, string>;
    expect(keys.filter((k) => !table[k])).toEqual([]);
    expect(table.cam_add_meal_and_list).toContain('{day}');
    expect(table.cam_add_expense).toContain('{amount}');
  });
});
