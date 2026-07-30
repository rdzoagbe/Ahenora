import type { SuggestLang } from './mealSuggestions';

/**
 * How much of each ingredient to buy, per person.
 *
 * The cooking methods deliberately carry no quantities, because the same
 * recipe feeds two people or six. Rather than freeze one household size into
 * the steps, amounts live here per person and are multiplied by however many
 * the family is cooking for.
 *
 * Amounts are held at the ingredient level rather than per recipe. A gram of
 * chicken is a gram of chicken whichever dish it lands in, and 57 numbers stay
 * correct as recipes are added where 250 per-recipe numbers would rot. It is a
 * shopping guide, not a pastry formula — and the UI says so.
 */

type Unit = 'g' | 'ml' | 'count' | 'taste';

interface PerPerson {
  unit: Unit;
  /** Amount for one person. Ignored for 'taste'. */
  amount: number;
  /** Round to this multiple so the result reads like a shopping list. */
  step?: number;
}

const PER_PERSON: Record<string, PerPerson> = {
  // Proteins
  chicken: { unit: 'g', amount: 150, step: 50 },
  beef: { unit: 'g', amount: 150, step: 50 },
  ground_beef: { unit: 'g', amount: 125, step: 50 },
  pork: { unit: 'g', amount: 150, step: 50 },
  fish: { unit: 'g', amount: 150, step: 50 },
  salmon: { unit: 'g', amount: 140, step: 50 },
  shrimp: { unit: 'g', amount: 120, step: 50 },
  bacon: { unit: 'g', amount: 40, step: 25 },
  ham: { unit: 'g', amount: 40, step: 25 },
  sausage: { unit: 'count', amount: 2 },
  tuna: { unit: 'g', amount: 60, step: 25 },
  eggs: { unit: 'count', amount: 2 },

  // Carbohydrates
  pasta: { unit: 'g', amount: 100, step: 50 },
  noodles: { unit: 'g', amount: 90, step: 50 },
  rice: { unit: 'g', amount: 75, step: 25 },
  potato: { unit: 'g', amount: 200, step: 100 },
  sweet_potato: { unit: 'g', amount: 200, step: 100 },
  yam: { unit: 'g', amount: 250, step: 100 },
  cassava: { unit: 'g', amount: 150, step: 50 },
  corn_flour: { unit: 'g', amount: 100, step: 50 },
  bread: { unit: 'count', amount: 2 },
  tortilla: { unit: 'count', amount: 2 },

  // Pulses
  beans: { unit: 'g', amount: 100, step: 50 },
  chickpeas: { unit: 'g', amount: 100, step: 50 },
  lentils: { unit: 'g', amount: 80, step: 25 },
  peas: { unit: 'g', amount: 60, step: 25 },

  // Vegetables
  tomato: { unit: 'count', amount: 2 },
  onion: { unit: 'count', amount: 0.5 },
  garlic: { unit: 'count', amount: 1 },
  pepper: { unit: 'count', amount: 0.5 },
  carrot: { unit: 'count', amount: 1 },
  broccoli: { unit: 'g', amount: 150, step: 50 },
  spinach: { unit: 'g', amount: 80, step: 25 },
  lettuce: { unit: 'count', amount: 0.5 },
  mushroom: { unit: 'g', amount: 60, step: 25 },
  cucumber: { unit: 'count', amount: 0.5 },
  zucchini: { unit: 'count', amount: 1 },
  avocado: { unit: 'count', amount: 0.5 },
  corn: { unit: 'g', amount: 60, step: 25 },
  okra: { unit: 'g', amount: 120, step: 50 },
  garden_egg: { unit: 'count', amount: 2 },
  plantain: { unit: 'count', amount: 1 },

  // Dairy
  cheese: { unit: 'g', amount: 40, step: 25 },
  mozzarella: { unit: 'g', amount: 60, step: 25 },
  cream: { unit: 'ml', amount: 50, step: 25 },
  milk: { unit: 'ml', amount: 100, step: 50 },
  butter: { unit: 'g', amount: 15, step: 10 },

  // Store cupboard
  tomato_sauce: { unit: 'ml', amount: 150, step: 50 },
  coconut: { unit: 'ml', amount: 100, step: 50 },
  peanut: { unit: 'g', amount: 40, step: 25 },
  soy_sauce: { unit: 'ml', amount: 15, step: 5 },
  palm_oil: { unit: 'ml', amount: 15, step: 5 },
  lemon: { unit: 'count', amount: 0.5 },

  // Seasonings — an amount here would be false precision.
  curry: { unit: 'taste', amount: 0 },
  chili: { unit: 'taste', amount: 0 },
  ginger: { unit: 'taste', amount: 0 },
  basil: { unit: 'taste', amount: 0 },
};

const TO_TASTE: Record<SuggestLang, string> = {
  en: 'to taste',
  es: 'al gusto',
  fr: 'selon le goût',
  de: 'nach Geschmack',
};

/** Round up to the nearest step, so a shopping list never comes up short. */
const roundUp = (value: number, step: number) => Math.ceil(value / step) * step;

/** 0.5 reads better as ½ than as "0.5 onion". */
const formatCount = (value: number): string => {
  const rounded = Math.round(value * 2) / 2;
  if (rounded <= 0) return '';
  const whole = Math.floor(rounded);
  const half = rounded - whole >= 0.5;
  if (whole === 0) return '½';
  return half ? `${whole}½` : String(whole);
};

/**
 * Amount of one ingredient for a given number of people, as a display string.
 *
 * Returns null for ingredients with no entry, so a new ingredient shows its
 * name without a wrong number beside it.
 */
export function quantityFor(
  ingredientId: string,
  servings: number,
  lang: SuggestLang,
): string | null {
  const per = PER_PERSON[ingredientId];
  if (!per) return null;

  const people = Math.max(1, Math.min(20, Math.round(servings)));

  if (per.unit === 'taste') return TO_TASTE[lang];

  if (per.unit === 'count') {
    const formatted = formatCount(per.amount * people);
    return formatted ? `×${formatted}` : null;
  }

  const total = roundUp(per.amount * people, per.step || 25);
  // Past a kilo or a litre, the smaller unit stops being readable.
  if (per.unit === 'g' && total >= 1000) {
    return `${(total / 1000).toFixed(total % 1000 === 0 ? 0 : 1)} kg`;
  }
  if (per.unit === 'ml' && total >= 1000) {
    return `${(total / 1000).toFixed(total % 1000 === 0 ? 0 : 1)} L`;
  }
  return `${total} ${per.unit}`;
}

/** True when we can price an ingredient at all. Used to decide layout. */
export function hasQuantity(ingredientId: string): boolean {
  return ingredientId in PER_PERSON;
}

/**
 * A shopping-list-ready name for an ingredient: the amount attached the way a
 * human writes it. "400 g rice", "×4 eggs", or — for seasonings, which have no
 * sensible amount — just "curry" (not "to taste curry", which is junk on a
 * list). Returns the bare label for anything we can't price.
 */
export function shoppingNameFor(
  ingredientId: string,
  label: string,
  servings: number,
  lang: SuggestLang,
): string {
  const per = PER_PERSON[ingredientId];
  // No entry, or a "to taste" seasoning: the amount is meaningless on a list.
  if (!per || per.unit === 'taste') return label;
  const qty = quantityFor(ingredientId, servings, lang);
  if (!qty) return label;
  // Counts read after the item ("eggs ×4"); weights and volumes read before it.
  return per.unit === 'count' ? `${label} ${qty}` : `${qty} ${label}`;
}

/**
 * AI-generated recipes carry their own quantified ingredients, written for a
 * base number of servings and validated by the backend safety gate (unit
 * whitelist, per-unit sanity caps). This scales one of those amounts to the
 * servings the family chose and renders it the same way the curated
 * quantities render — counts as "×2", weights as "400 g".
 */
export interface AiIngredient {
  name: string;
  /** null means "to taste" — no amount to scale. */
  qty: number | null;
  unit: string;
}

// Small measures get localized labels; metric units read the same everywhere.
const UNIT_LABELS: Record<string, Record<SuggestLang, [string, string]>> = {
  tbsp: { en: ['tbsp', 'tbsp'], es: ['cda', 'cdas'], fr: ['c. à s.', 'c. à s.'], de: ['EL', 'EL'] },
  tsp: { en: ['tsp', 'tsp'], es: ['cdta', 'cdtas'], fr: ['c. à c.', 'c. à c.'], de: ['TL', 'TL'] },
  pinch: { en: ['pinch', 'pinches'], es: ['pizca', 'pizcas'], fr: ['pincée', 'pincées'], de: ['Prise', 'Prisen'] },
  clove: { en: ['clove', 'cloves'], es: ['diente', 'dientes'], fr: ['gousse', 'gousses'], de: ['Zehe', 'Zehen'] },
  can: { en: ['can', 'cans'], es: ['lata', 'latas'], fr: ['boîte', 'boîtes'], de: ['Dose', 'Dosen'] },
};

/** Round a scaled amount so it reads like a recipe, not a calculator. */
const roundScaled = (value: number): number => {
  if (value >= 100) return Math.round(value / 10) * 10;
  if (value >= 20) return Math.round(value / 5) * 5;
  return Math.round(value * 2) / 2;
};

export function formatAiQuantity(
  ing: AiIngredient,
  servings: number,
  baseServings: number,
  lang: SuggestLang,
): string | null {
  if (ing.qty === null || ing.unit === 'to taste') return TO_TASTE[lang];

  const scaled = (ing.qty * Math.max(1, servings)) / Math.max(1, baseServings);

  if (ing.unit === 'piece') {
    const formatted = formatCount(scaled);
    return formatted ? `×${formatted}` : null;
  }
  if (ing.unit === 'g' || ing.unit === 'ml') {
    const n = roundScaled(scaled);
    if (n <= 0) return null;
    if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)} ${ing.unit === 'g' ? 'kg' : 'L'}`;
    return `${n} ${ing.unit}`;
  }
  if (ing.unit === 'kg' || ing.unit === 'l') {
    const n = Math.round(scaled * 10) / 10;
    if (n <= 0) return null;
    return `${n} ${ing.unit === 'l' ? 'L' : 'kg'}`;
  }

  const labels = UNIT_LABELS[ing.unit];
  const formatted = formatCount(scaled);
  if (!formatted) return null;
  if (!labels) return formatted;
  const rounded = Math.round(scaled * 2) / 2;
  return `${formatted} ${labels[lang][rounded > 1 ? 1 : 0]}`;
}
