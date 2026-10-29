import type { MealPlan, ShoppingItem } from './api';

/**
 * What the top of the Kitchen says. Pure, so it can be tested without a
 * screen.
 *
 * The final design Roland chose (2026-10-26) opens the Kitchen on tonight:
 * what is for dinner, the days that follow as a strip of tiles with a
 * picture each, and what still has to be bought. The planner, the ideas,
 * the camera and the recipes stay below, where they were.
 */

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Today's weekday key, the way the Kitchen files meals ("friday"). */
export function dayKey(now: Date): string {
  return WEEKDAYS[now.getDay()];
}

/** The n days after today, as weekday keys, in order. */
export function daysAfter(now: Date, n: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= n; i++) out.push(WEEKDAYS[(now.getDay() + i) % 7]);
  return out;
}

/** The meal planned for a day: dinner first, else whatever is there. */
export function mealOn(meals: MealPlan[], day: string): MealPlan | null {
  const planned = meals.filter((m) => (m.day || '').toLowerCase() === day);
  return planned.find((m) => m.meal_type === 'dinner') || planned[0] || null;
}

export type MealIcon = 'pizza' | 'chicken' | 'fish' | 'soup' | 'salad' | 'sandwich' | 'egg' | 'pasta' | 'pot';

const ICON_WORDS: [MealIcon, RegExp][] = [
  ['pizza', /pizza/i],
  ['chicken', /chicken|poulet|pollo|hähnchen|haehnchen|huhn|wings|drumstick|turkey|dinde|pavo|pute/i],
  ['fish', /fish|poisson|pescado|fisch|salmon|saumon|salmón|lachs|tuna|thon|atún|thunfisch|cod|cabillaud|bacalao|kabeljau/i],
  ['soup', /soup|soupe|sopa|suppe|broth|bouillon|caldo|ramen|pho|chowder|stew|ragoût|guiso|eintopf/i],
  ['salad', /salad|salade|ensalada|salat/i],
  ['sandwich', /sandwich|burger|hamburguesa|wrap|panini|toast|croque|bocadillo/i],
  ['egg', /\begg|omelet|omelette|œuf|oeuf|huevo|\bei\b|eier|frittata|tortilla/i],
  ['pasta', /pasta|spaghetti|penne|lasagn|tagliatelle|linguine|macaroni|nudeln|noodle|nouilles|fideos|gnocchi|ravioli/i],
];

/**
 * A picture for a dish, from its name — one of a handful of Lucide icons the
 * app already ships, never an emoji (different on every phone). Anything we
 * cannot place gets the cooking pot, which is true of every dinner.
 */
export function mealIcon(title: string | null | undefined): MealIcon {
  const name = (title || '').trim();
  for (const [icon, words] of ICON_WORDS) if (words.test(name)) return icon;
  return 'pot';
}

/** What still has to be bought, in the order it was added. */
export function stillToBuy(items: ShoppingItem[]): ShoppingItem[] {
  return items.filter((i) => !i.checked);
}
