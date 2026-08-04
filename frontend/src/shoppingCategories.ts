import { ingredientCategoryTerms } from './mealSuggestions';

/**
 * Work out which aisle a shopping item belongs to, from its name.
 *
 * The backend has always had thirteen categories and the app never sent one,
 * so every item stored "Other" and the category column was noise. A shopping
 * list sorted by aisle is most of what a shopping list is for.
 *
 * Recognition reuses the meal library's ingredient terms, which already cover
 * English, Spanish, French and German plus the spellings people actually
 * write, and adds the non-food items a family list carries.
 */

/** Must stay a subset of SHOPPING_CATEGORIES in the backend. */
export type ShoppingCategory =
  | 'Produce' | 'Dairy' | 'Meat' | 'Bakery' | 'Frozen' | 'Pantry'
  | 'Drinks' | 'Snacks' | 'Baby' | 'Household' | 'Health' | 'School' | 'Other';

/** Which aisle each meal-library ingredient sits in. */
const INGREDIENT_AISLE: Record<string, ShoppingCategory> = {
  chicken: 'Meat', beef: 'Meat', ground_beef: 'Meat', pork: 'Meat', fish: 'Meat',
  salmon: 'Meat', shrimp: 'Meat', bacon: 'Meat', ham: 'Meat', sausage: 'Meat', tuna: 'Meat',

  eggs: 'Dairy', cheese: 'Dairy', mozzarella: 'Dairy', cream: 'Dairy',
  butter: 'Dairy', milk: 'Dairy',

  bread: 'Bakery', tortilla: 'Bakery',

  pasta: 'Pantry', rice: 'Pantry', noodles: 'Pantry', beans: 'Pantry',
  chickpeas: 'Pantry', lentils: 'Pantry', peas: 'Pantry', soy_sauce: 'Pantry',
  curry: 'Pantry', coconut: 'Pantry', tomato_sauce: 'Pantry', corn_flour: 'Pantry',
  peanut: 'Pantry', palm_oil: 'Pantry', corn: 'Pantry',

  tomato: 'Produce', onion: 'Produce', garlic: 'Produce', pepper: 'Produce',
  carrot: 'Produce', broccoli: 'Produce', spinach: 'Produce', lettuce: 'Produce',
  mushroom: 'Produce', avocado: 'Produce', lemon: 'Produce', cucumber: 'Produce',
  zucchini: 'Produce', potato: 'Produce', basil: 'Produce', ginger: 'Produce',
  chili: 'Produce', yam: 'Produce', sweet_potato: 'Produce', plantain: 'Produce',
  cassava: 'Produce', okra: 'Produce', garden_egg: 'Produce',
};

/**
 * Everything a family list carries that the meal library has no reason to know.
 * Terms are accent-free and lowercase, matched as whole words or as a phrase,
 * in the four app languages.
 */
const EXTRA_TERMS: [ShoppingCategory, string[]][] = [
  ['Drinks', [
    'water', 'eau', 'agua', 'wasser', 'juice', 'jus', 'zumo', 'saft',
    'coffee', 'cafe', 'kaffee', 'tea', 'the', 'té', 'tee', 'wine', 'vin', 'vino', 'wein',
    'beer', 'biere', 'cerveza', 'bier', 'soda', 'cola', 'lemonade', 'limonade',
  ]],
  ['Snacks', [
    'chocolate', 'chocolat', 'schokolade', 'biscuit', 'biscuits', 'cookies', 'galletas', 'keks',
    'crisps', 'chips', 'sweets', 'bonbons', 'caramelos', 'candy', 'cake', 'gateau', 'kuchen',
    'ice cream', 'glace', 'helado', 'eis', 'nuts', 'noix', 'nueces', 'nusse',
  ]],
  ['Baby', [
    'nappy', 'nappies', 'diaper', 'diapers', 'couche', 'couches', 'panales', 'windeln',
    'formula', 'lait infantile', 'baby food', 'petit pot', 'babynahrung', 'wipes', 'lingettes',
  ]],
  ['Household', [
    'soap', 'savon', 'jabon', 'seife', 'detergent', 'lessive', 'detergente', 'waschmittel',
    'washing up', 'liquide vaisselle', 'spulmittel', 'bleach', 'javel', 'lejia',
    'toilet paper', 'papier toilette', 'papel higienico', 'toilettenpapier',
    'kitchen roll', 'essuie tout', 'bin bags', 'sacs poubelle', 'mullbeutel',
    'sponge', 'eponge', 'esponja', 'schwamm', 'foil', 'aluminium', 'papel aluminio',
  ]],
  ['Health', [
    'paracetamol', 'doliprane', 'ibuprofen', 'ibuprofene', 'aspirin', 'aspirine',
    'plaster', 'plasters', 'pansement', 'pansements', 'tirita', 'pflaster',
    'toothpaste', 'dentifrice', 'pasta de dientes', 'zahnpasta',
    'shampoo', 'shampooing', 'champu', 'vitamins', 'vitamines', 'vitaminas', 'vitamine',
    'sunscreen', 'creme solaire', 'protector solar', 'sonnencreme',
  ]],
  ['School', [
    'notebook', 'cahier', 'cuaderno', 'heft', 'pens', 'stylos', 'boligrafos', 'stifte',
    'pencil', 'pencils', 'crayon', 'crayons', 'lapiz', 'bleistift',
    'glue', 'colle', 'pegamento', 'kleber', 'scissors', 'ciseaux', 'tijeras', 'schere',
    'backpack', 'cartable', 'mochila', 'schulranzen',
  ]],
  ['Frozen', [
    'frozen', 'surgele', 'surgeles', 'congele', 'congelado', 'tiefkuhl', 'gefroren',
    'peas frozen', 'fish fingers', 'batonnets de poisson',
  ]],
  ['Bakery', [
    'baguette', 'croissant', 'croissants', 'brioche', 'roll', 'rolls', 'petits pains',
    'bollo', 'brotchen', 'flour', 'farine', 'harina', 'mehl',
  ]],
  ['Dairy', [
    'yoghurt', 'yogurt', 'yaourt', 'yogur', 'joghurt', 'creme fraiche', 'sour cream', 'quark',
  ]],
];

const ACCENTS: Record<string, string> = {
  à: 'a', â: 'a', ä: 'a', á: 'a', ã: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ï: 'i', î: 'i', ì: 'i', ó: 'o', ô: 'o', ö: 'o', ò: 'o', õ: 'o',
  ú: 'u', û: 'u', ü: 'u', ù: 'u', ñ: 'n', ç: 'c', ß: 'ss',
};

const norm = (value: string): string =>
  (value || '')
    .toLowerCase()
    .split('')
    .map((c) => ACCENTS[c] ?? c)
    .join('')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const matchesTerm = (words: string[], term: string): boolean => {
  if (term.includes(' ')) return ` ${words.join(' ')} `.includes(` ${term} `);
  return words.some(
    (w) => w === term || w === `${term}s` || w === `${term}es` || (term.length >= 5 && w.startsWith(term)),
  );
};

/**
 * Best guess at the aisle for an item name, or null when we genuinely do not
 * know. Callers store 'Other' for null rather than guessing — a wrong aisle
 * sends someone to the wrong end of the shop, which is worse than no aisle.
 */
export function categoriseShoppingItem(name: string): ShoppingCategory | null {
  const words = norm(name).split(' ').filter(Boolean);
  if (words.length === 0) return null;

  // The most specific term wins, measured by length. Ordering the lists by hand
  // does not scale: "corn flour" must beat "flour", "chocolate milk" must beat
  // "milk", and "baby wipes" must beat nothing at all. Longest match gives all
  // three without a precedence table to maintain.
  let best: { category: ShoppingCategory; length: number } | null = null;
  const consider = (category: ShoppingCategory, term: string) => {
    if (!matchesTerm(words, term)) return;
    if (!best || term.length > best.length) best = { category, length: term.length };
  };

  for (const [category, terms] of EXTRA_TERMS) {
    for (const term of terms) consider(category, term);
  }

  for (const { id, terms, not } of ingredientCategoryTerms()) {
    const aisle = INGREDIENT_AISLE[id];
    if (!aisle) continue;
    if (not.some((term) => ` ${words.join(' ')} `.includes(` ${term} `))) continue;
    for (const term of terms) consider(aisle, term);
  }

  return best ? (best as { category: ShoppingCategory }).category : null;
}

/**
 * How a photographed ingredient reads on a shopping list.
 *
 * A recipe carries structured amounts, but nobody writes "Tomatoes, qty 400,
 * unit g" on a list. "to taste" items carry no amount at all, which is why a
 * qty of 0 has to mean "no number" rather than "zero of these".
 */
export function shoppingLabel(item: { name: string; qty: number | null; unit: string }) {
  const qty = item.qty ?? 0;
  if (!qty || item.unit === 'to taste') return item.name;
  if (item.unit === 'piece') return `${item.name} x${qty}`;
  return `${item.name} ${qty}${item.unit}`;
}
