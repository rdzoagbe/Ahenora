// Rule-based "week of meals from your shopping" engine — no AI, fully offline.
// It matches what a family has bought (current shopping list + recent history)
// against a curated recipe library and proposes 7 dinners, best-matched first,
// filling any gaps with staples so the week is always complete.
//
// The food dataset (ingredient labels + recipe titles) lives here, localized
// inline, so it never bloats i18n.ts. Match terms are stored accent-free and
// lowercase across all four languages so a French "poulet" or Spanish "pollo"
// on the shopping list both map to the "chicken" ingredient.
//
// This is deliberately a stepping stone: the AI meal planner (Phase 2) plugs
// into the same MealSuggestion shape but replaces the matching + can invent
// recipes. Grow RECIPES/ING after Play Store launch.

export type SuggestLang = 'en' | 'es' | 'fr' | 'de';
type Loc = Record<SuggestLang, string>;

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

interface Ingredient {
  label: Loc;
  match: string[]; // accent-free, lowercase terms across en/es/fr/de
  // Phrases that look like a match but name a different ingredient. "Sweet
  // potato" contains the word "potato" and "corn flour" contains "corn", so
  // without this a shopping list of yam and corn flour reads as a European
  // pantry and gets shepherd's pie.
  not?: string[];
}

// Strip common accents without relying on String.prototype.normalize (Hermes).
const ACCENTS: Record<string, string> = {
  à: 'a', â: 'a', ä: 'a', á: 'a', ã: 'a', é: 'e', è: 'e', ê: 'e', ë: 'e',
  í: 'i', ï: 'i', î: 'i', ì: 'i', ó: 'o', ô: 'o', ö: 'o', ò: 'o', õ: 'o',
  ú: 'u', û: 'u', ü: 'u', ù: 'u', ñ: 'n', ç: 'c', ß: 'ss',
};

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .split('')
    .map((c) => ACCENTS[c] ?? c)
    .join('')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function itemMatchesTerm(itemWords: string[], term: string): boolean {
  if (term.includes(' ')) return ` ${itemWords.join(' ')} `.includes(` ${term} `);
  return itemWords.some(
    (w) => w === term || w === `${term}s` || w === `${term}es` || (term.length >= 5 && w.startsWith(term)),
  );
}

const ING: Record<string, Ingredient> = {
  chicken: { label: { en: 'chicken', es: 'pollo', fr: 'poulet', de: 'Hähnchen' }, match: ['chicken', 'pollo', 'poulet', 'huhn', 'hahnchen'] },
  beef: { label: { en: 'beef', es: 'ternera', fr: 'bœuf', de: 'Rindfleisch' }, match: ['beef', 'ternera', 'res', 'boeuf', 'rind', 'rindfleisch'] },
  ground_beef: { label: { en: 'ground beef', es: 'carne picada', fr: 'viande hachée', de: 'Hackfleisch' }, match: ['ground beef', 'mince', 'carne picada', 'carne molida', 'viande hachee', 'hachee', 'hackfleisch'] },
  pork: { label: { en: 'pork', es: 'cerdo', fr: 'porc', de: 'Schweinefleisch' }, match: ['pork', 'cerdo', 'porc', 'schwein', 'schweinefleisch'] },
  fish: { label: { en: 'fish', es: 'pescado', fr: 'poisson', de: 'Fisch' }, match: ['fish', 'pescado', 'poisson', 'fisch', 'cod', 'bacalao'] },
  salmon: { label: { en: 'salmon', es: 'salmón', fr: 'saumon', de: 'Lachs' }, match: ['salmon', 'saumon', 'lachs'] },
  shrimp: { label: { en: 'shrimp', es: 'gambas', fr: 'crevettes', de: 'Garnelen' }, match: ['shrimp', 'prawn', 'gambas', 'camarones', 'crevettes', 'garnelen'] },
  eggs: { label: { en: 'eggs', es: 'huevos', fr: 'œufs', de: 'Eier' }, match: ['egg', 'eggs', 'huevo', 'huevos', 'oeuf', 'oeufs', 'ei', 'eier'], not: ['garden egg', 'garden eggs'] },
  pasta: { label: { en: 'pasta', es: 'pasta', fr: 'pâtes', de: 'Nudeln' }, match: ['pasta', 'spaghetti', 'penne', 'pates', 'nudeln', 'macaroni', 'fusilli'] },
  rice: { label: { en: 'rice', es: 'arroz', fr: 'riz', de: 'Reis' }, match: ['rice', 'arroz', 'riz', 'reis'] },
  potato: { label: { en: 'potatoes', es: 'patatas', fr: 'pommes de terre', de: 'Kartoffeln' }, match: ['potato', 'potatoes', 'patata', 'patatas', 'papa', 'pomme de terre', 'pommes de terre', 'kartoffel', 'kartoffeln'], not: ['sweet potato', 'sweet potatoes', 'patate douce', 'patates douces', 'susskartoffel'] },
  tomato: { label: { en: 'tomatoes', es: 'tomates', fr: 'tomates', de: 'Tomaten' }, match: ['tomato', 'tomatoes', 'tomate', 'tomates', 'tomaten'] },
  onion: { label: { en: 'onion', es: 'cebolla', fr: 'oignon', de: 'Zwiebel' }, match: ['onion', 'cebolla', 'oignon', 'zwiebel', 'zwiebeln'] },
  garlic: { label: { en: 'garlic', es: 'ajo', fr: 'ail', de: 'Knoblauch' }, match: ['garlic', 'ajo', 'ail', 'knoblauch'] },
  pepper: { label: { en: 'bell pepper', es: 'pimiento', fr: 'poivron', de: 'Paprika' }, match: ['bell pepper', 'pepper', 'pimiento', 'poivron', 'paprika'] },
  carrot: { label: { en: 'carrot', es: 'zanahoria', fr: 'carotte', de: 'Karotte' }, match: ['carrot', 'zanahoria', 'carotte', 'mohre', 'karotte', 'moehre'] },
  broccoli: { label: { en: 'broccoli', es: 'brócoli', fr: 'brocoli', de: 'Brokkoli' }, match: ['broccoli', 'brocoli', 'brokkoli'] },
  spinach: { label: { en: 'spinach', es: 'espinacas', fr: 'épinards', de: 'Spinat' }, match: ['spinach', 'espinaca', 'espinacas', 'epinard', 'epinards', 'spinat'] },
  lettuce: { label: { en: 'lettuce', es: 'lechuga', fr: 'laitue', de: 'Salat' }, match: ['lettuce', 'lechuga', 'laitue', 'salat', 'salade'] },
  cheese: { label: { en: 'cheese', es: 'queso', fr: 'fromage', de: 'Käse' }, match: ['cheese', 'queso', 'fromage', 'kase', 'kaese'] },
  mozzarella: { label: { en: 'mozzarella', es: 'mozzarella', fr: 'mozzarella', de: 'Mozzarella' }, match: ['mozzarella'] },
  cream: { label: { en: 'cream', es: 'nata', fr: 'crème', de: 'Sahne' }, match: ['cream', 'nata', 'crema', 'creme', 'sahne'] },
  butter: { label: { en: 'butter', es: 'mantequilla', fr: 'beurre', de: 'Butter' }, match: ['butter', 'mantequilla', 'beurre'] },
  bread: { label: { en: 'bread', es: 'pan', fr: 'pain', de: 'Brot' }, match: ['bread', 'pan', 'pain', 'brot', 'dough', 'masa', 'teig', 'baguette'] },
  tortilla: { label: { en: 'tortillas', es: 'tortillas', fr: 'tortillas', de: 'Tortillas' }, match: ['tortilla', 'tortillas', 'wrap', 'wraps'] },
  beans: { label: { en: 'beans', es: 'frijoles', fr: 'haricots', de: 'Bohnen' }, match: ['beans', 'frijoles', 'judias', 'alubias', 'haricots', 'bohnen'] },
  chickpeas: { label: { en: 'chickpeas', es: 'garbanzos', fr: 'pois chiches', de: 'Kichererbsen' }, match: ['chickpea', 'chickpeas', 'garbanzos', 'pois chiches', 'kichererbsen'] },
  lentils: { label: { en: 'lentils', es: 'lentejas', fr: 'lentilles', de: 'Linsen' }, match: ['lentil', 'lentils', 'lentejas', 'lentilles', 'linsen'] },
  corn: { label: { en: 'corn', es: 'maíz', fr: 'maïs', de: 'Mais' }, match: ['corn', 'maiz', 'mais'], not: ['corn flour', 'cornflour', 'maize flour', 'farine de mais', 'semoule de mais', 'harina de maiz'] },
  mushroom: { label: { en: 'mushrooms', es: 'champiñones', fr: 'champignons', de: 'Pilze' }, match: ['mushroom', 'mushrooms', 'champinon', 'champinones', 'champignon', 'champignons', 'pilz', 'pilze', 'seta'] },
  avocado: { label: { en: 'avocado', es: 'aguacate', fr: 'avocat', de: 'Avocado' }, match: ['avocado', 'aguacate', 'avocat'] },
  lemon: { label: { en: 'lemon', es: 'limón', fr: 'citron', de: 'Zitrone' }, match: ['lemon', 'limon', 'citron', 'zitrone'] },
  soy_sauce: { label: { en: 'soy sauce', es: 'salsa de soja', fr: 'sauce soja', de: 'Sojasauce' }, match: ['soy sauce', 'soy', 'salsa de soja', 'sauce soja', 'soja', 'sojasauce'] },
  curry: { label: { en: 'curry', es: 'curry', fr: 'curry', de: 'Curry' }, match: ['curry'] },
  coconut: { label: { en: 'coconut milk', es: 'leche de coco', fr: 'lait de coco', de: 'Kokosmilch' }, match: ['coconut', 'coco', 'kokos', 'kokosmilch'] },
  tomato_sauce: { label: { en: 'tomato sauce', es: 'salsa de tomate', fr: 'sauce tomate', de: 'Tomatensauce' }, match: ['tomato sauce', 'passata', 'salsa de tomate', 'sauce tomate', 'tomatensauce', 'sugo'] },
  bacon: { label: { en: 'bacon', es: 'bacon', fr: 'lardons', de: 'Speck' }, match: ['bacon', 'tocino', 'lardon', 'lardons', 'speck'] },
  ham: { label: { en: 'ham', es: 'jamón', fr: 'jambon', de: 'Schinken' }, match: ['ham', 'jamon', 'jambon', 'schinken'] },
  basil: { label: { en: 'basil', es: 'albahaca', fr: 'basilic', de: 'Basilikum' }, match: ['basil', 'albahaca', 'basilic', 'basilikum'] },
  noodles: { label: { en: 'noodles', es: 'fideos', fr: 'nouilles', de: 'Nudeln' }, match: ['noodles', 'fideos', 'nouilles'] },
  tuna: { label: { en: 'tuna', es: 'atún', fr: 'thon', de: 'Thunfisch' }, match: ['tuna', 'atun', 'thon', 'thunfisch'] },
  peas: { label: { en: 'peas', es: 'guisantes', fr: 'petits pois', de: 'Erbsen' }, match: ['peas', 'guisantes', 'petits pois', 'erbsen'] },
  milk: { label: { en: 'milk', es: 'leche', fr: 'lait', de: 'Milch' }, match: ['milk', 'leche', 'lait', 'milch'] },
  cucumber: { label: { en: 'cucumber', es: 'pepino', fr: 'concombre', de: 'Gurke' }, match: ['cucumber', 'pepino', 'concombre', 'gurke'] },
  zucchini: { label: { en: 'zucchini', es: 'calabacín', fr: 'courgette', de: 'Zucchini' }, match: ['zucchini', 'calabacin', 'courgette'] },
  // West African / Afro-Caribbean staples. The library began with a European
  // and American pantry, which left families shopping for yam, okra or plantain
  // with no matching dinners at all. Match terms cover English, French, Spanish
  // and German plus the spellings people actually write on a list ("okro",
  // "attieke", "groundnut").
  yam: { label: { en: 'yam', es: 'ñame', fr: 'igname', de: 'Yamswurzel' }, match: ['yam', 'yams', 'igname', 'ignames', 'yamswurzel'] },
  sweet_potato: { label: { en: 'sweet potato', es: 'boniato', fr: 'patate douce', de: 'Süßkartoffel' }, match: ['sweet potato', 'sweet potatoes', 'patate douce', 'patates douces', 'boniato', 'batata', 'susskartoffel'] },
  plantain: { label: { en: 'plantain', es: 'plátano macho', fr: 'banane plantain', de: 'Kochbanane' }, match: ['plantain', 'plantains', 'banane plantain', 'bananes plantains', 'platano macho', 'kochbanane', 'alloco'] },
  cassava: { label: { en: 'cassava', es: 'yuca', fr: 'manioc', de: 'Maniok' }, match: ['cassava', 'manioc', 'yuca', 'maniok', 'attieke', 'gari', 'tapioca'] },
  okra: { label: { en: 'okra', es: 'quimbombó', fr: 'gombo', de: 'Okra' }, match: ['okra', 'okro', 'okras', 'gombo', 'gombos', 'quimbombo'] },
  garden_egg: { label: { en: 'garden eggs', es: 'berenjena', fr: 'aubergine', de: 'Aubergine' }, match: ['garden egg', 'garden eggs', 'aubergine', 'aubergines', 'eggplant', 'eggplants', 'berenjena', 'berenjenas'] },
  corn_flour: { label: { en: 'corn flour', es: 'harina de maíz', fr: 'farine de maïs', de: 'Maismehl' }, match: ['corn flour', 'cornflour', 'maize flour', 'farine de mais', 'semoule de mais', 'harina de maiz', 'maismehl', 'banku', 'fufu'] },
  peanut: { label: { en: 'peanuts', es: 'cacahuetes', fr: 'arachide', de: 'Erdnüsse' }, match: ['peanut', 'peanuts', 'groundnut', 'groundnuts', 'arachide', 'arachides', 'cacahuete', 'cacahuetes', 'erdnuss', 'erdnusse', 'peanut butter'] },
  palm_oil: { label: { en: 'palm oil', es: 'aceite de palma', fr: 'huile de palme', de: 'Palmöl' }, match: ['palm oil', 'red oil', 'huile de palme', 'aceite de palma', 'palmol'] },
  ginger: { label: { en: 'ginger', es: 'jengibre', fr: 'gingembre', de: 'Ingwer' }, match: ['ginger', 'gingembre', 'jengibre', 'ingwer'] },
  chili: { label: { en: 'chilli', es: 'chile', fr: 'piment', de: 'Chili' }, match: ['chilli', 'chili', 'chile', 'piment', 'piments', 'scotch bonnet', 'habanero', 'pili pili'] },
  sausage: { label: { en: 'sausage', es: 'salchicha', fr: 'saucisse', de: 'Wurst' }, match: ['sausage', 'salchicha', 'chorizo', 'saucisse', 'wurst', 'bratwurst'] },
};

interface Recipe {
  id: string;
  title: Loc;
  ing: string[];
  staple?: boolean; // good gap-filler when few matches
}

const RECIPES: Recipe[] = [
  { id: 'bolognese', title: { en: 'Spaghetti Bolognese', es: 'Espaguetis boloñesa', fr: 'Spaghettis bolognaise', de: 'Spaghetti Bolognese' }, ing: ['pasta', 'ground_beef', 'tomato_sauce', 'onion', 'garlic'], staple: true },
  { id: 'chicken_rice', title: { en: 'Grilled Chicken & Rice', es: 'Pollo a la plancha con arroz', fr: 'Poulet grillé et riz', de: 'Gegrilltes Hähnchen mit Reis' }, ing: ['chicken', 'rice', 'broccoli', 'garlic'], staple: true },
  { id: 'tacos', title: { en: 'Beef Tacos', es: 'Tacos de carne', fr: 'Tacos de bœuf', de: 'Rindfleisch-Tacos' }, ing: ['ground_beef', 'tortilla', 'cheese', 'tomato', 'onion', 'lettuce'] },
  { id: 'stir_fry', title: { en: 'Veggie Stir-Fry', es: 'Salteado de verduras', fr: 'Sauté de légumes', de: 'Gemüsepfanne' }, ing: ['rice', 'pepper', 'broccoli', 'carrot', 'soy_sauce'], staple: true },
  { id: 'pizza', title: { en: 'Margherita Pizza', es: 'Pizza margarita', fr: 'Pizza margherita', de: 'Pizza Margherita' }, ing: ['bread', 'tomato_sauce', 'mozzarella', 'basil'] },
  { id: 'chicken_curry', title: { en: 'Chicken Curry', es: 'Curry de pollo', fr: 'Curry de poulet', de: 'Hähnchen-Curry' }, ing: ['chicken', 'curry', 'coconut', 'rice', 'onion'] },
  { id: 'salmon_potato', title: { en: 'Salmon & Potatoes', es: 'Salmón con patatas', fr: 'Saumon et pommes de terre', de: 'Lachs mit Kartoffeln' }, ing: ['salmon', 'potato', 'lemon', 'butter'] },
  { id: 'omelette', title: { en: 'Cheese Omelette', es: 'Tortilla de queso', fr: 'Omelette au fromage', de: 'Käse-Omelett' }, ing: ['eggs', 'cheese', 'mushroom', 'onion'], staple: true },
  { id: 'beef_stew', title: { en: 'Beef Stew', es: 'Estofado de ternera', fr: 'Ragoût de bœuf', de: 'Rindfleischeintopf' }, ing: ['beef', 'potato', 'carrot', 'onion'] },
  { id: 'shrimp_pasta', title: { en: 'Shrimp Pasta', es: 'Pasta con gambas', fr: 'Pâtes aux crevettes', de: 'Garnelen-Pasta' }, ing: ['pasta', 'shrimp', 'garlic', 'cream'] },
  { id: 'caesar', title: { en: 'Chicken Caesar Salad', es: 'Ensalada César con pollo', fr: 'Salade César au poulet', de: 'Caesar-Salat mit Hähnchen' }, ing: ['chicken', 'lettuce', 'cheese', 'bread'] },
  { id: 'tuna_sandwich', title: { en: 'Tuna Sandwich', es: 'Sándwich de atún', fr: 'Sandwich au thon', de: 'Thunfisch-Sandwich' }, ing: ['bread', 'tuna', 'tomato', 'lettuce'], staple: true },
  { id: 'lentil_soup', title: { en: 'Lentil Soup', es: 'Sopa de lentejas', fr: 'Soupe de lentilles', de: 'Linsensuppe' }, ing: ['lentils', 'carrot', 'onion', 'garlic'] },
  { id: 'fried_rice', title: { en: 'Fried Rice', es: 'Arroz frito', fr: 'Riz sauté', de: 'Gebratener Reis' }, ing: ['rice', 'eggs', 'peas', 'carrot', 'soy_sauce'], staple: true },
  { id: 'pork_veg', title: { en: 'Pork Chops & Veggies', es: 'Chuletas de cerdo con verduras', fr: 'Côtes de porc et légumes', de: 'Schweinekotelett mit Gemüse' }, ing: ['pork', 'potato', 'carrot', 'broccoli'] },
  { id: 'chili', title: { en: 'Bean Chili', es: 'Chili de frijoles', fr: 'Chili de haricots', de: 'Bohnen-Chili' }, ing: ['beans', 'ground_beef', 'tomato', 'onion', 'corn'] },
  { id: 'caprese_pasta', title: { en: 'Caprese Pasta', es: 'Pasta caprese', fr: 'Pâtes caprese', de: 'Caprese-Pasta' }, ing: ['pasta', 'tomato', 'mozzarella', 'basil'] },
  { id: 'fish_rice', title: { en: 'Fish & Rice', es: 'Pescado con arroz', fr: 'Poisson et riz', de: 'Fisch mit Reis' }, ing: ['fish', 'rice', 'lemon', 'spinach'] },
  { id: 'quesadilla', title: { en: 'Ham & Cheese Quesadilla', es: 'Quesadilla de jamón y queso', fr: 'Quesadilla jambon-fromage', de: 'Schinken-Käse-Quesadilla' }, ing: ['tortilla', 'ham', 'cheese'], staple: true },
  { id: 'veggie_curry', title: { en: 'Chickpea Curry', es: 'Curry de garbanzos', fr: 'Curry de pois chiches', de: 'Kichererbsen-Curry' }, ing: ['chickpeas', 'curry', 'coconut', 'rice', 'spinach'] },
  { id: 'carbonara', title: { en: 'Pasta Carbonara', es: 'Pasta carbonara', fr: 'Pâtes carbonara', de: 'Pasta Carbonara' }, ing: ['pasta', 'bacon', 'eggs', 'cheese'] },
  { id: 'noodle_soup', title: { en: 'Chicken Noodle Soup', es: 'Sopa de pollo con fideos', fr: 'Soupe poulet-nouilles', de: 'Hühnernudelsuppe' }, ing: ['chicken', 'noodles', 'carrot', 'onion'] },
  { id: 'stuffed_peppers', title: { en: 'Stuffed Peppers', es: 'Pimientos rellenos', fr: 'Poivrons farcis', de: 'Gefüllte Paprika' }, ing: ['pepper', 'rice', 'ground_beef', 'tomato'] },
  { id: 'avocado_eggs', title: { en: 'Avocado Toast & Eggs', es: 'Tostada de aguacate con huevo', fr: 'Toast à l’avocat et œufs', de: 'Avocado-Toast mit Ei' }, ing: ['bread', 'avocado', 'eggs'], staple: true },
  { id: 'chicken_fajitas', title: { en: 'Chicken Fajitas', es: 'Fajitas de pollo', fr: 'Fajitas de poulet', de: 'Hähnchen-Fajitas' }, ing: ['chicken', 'pepper', 'onion', 'tortilla'] },
  { id: 'mac_cheese', title: { en: 'Mac & Cheese', es: 'Macarrones con queso', fr: 'Gratin de macaronis', de: 'Käse-Makkaroni' }, ing: ['pasta', 'cheese', 'milk', 'butter'], staple: true },
  { id: 'blt', title: { en: 'BLT Sandwich', es: 'Sándwich BLT', fr: 'Sandwich BLT', de: 'BLT-Sandwich' }, ing: ['bread', 'bacon', 'lettuce', 'tomato'], staple: true },
  { id: 'frittata', title: { en: 'Veggie Frittata', es: 'Frittata de verduras', fr: 'Frittata aux légumes', de: 'Gemüse-Frittata' }, ing: ['eggs', 'potato', 'pepper', 'cheese'], staple: true },
  { id: 'teriyaki_salmon', title: { en: 'Teriyaki Salmon', es: 'Salmón teriyaki', fr: 'Saumon teriyaki', de: 'Teriyaki-Lachs' }, ing: ['salmon', 'rice', 'soy_sauce', 'broccoli'] },
  { id: 'minestrone', title: { en: 'Minestrone Soup', es: 'Sopa minestrone', fr: 'Soupe minestrone', de: 'Minestrone-Suppe' }, ing: ['pasta', 'beans', 'tomato', 'carrot', 'onion'] },
  { id: 'pesto_pasta', title: { en: 'Pesto Pasta', es: 'Pasta al pesto', fr: 'Pâtes au pesto', de: 'Pesto-Pasta' }, ing: ['pasta', 'basil', 'cheese', 'garlic'], staple: true },
  { id: 'chicken_quesadilla', title: { en: 'Chicken Quesadilla', es: 'Quesadilla de pollo', fr: 'Quesadilla au poulet', de: 'Hähnchen-Quesadilla' }, ing: ['tortilla', 'chicken', 'cheese', 'pepper'] },
  { id: 'shepherds_pie', title: { en: "Shepherd's Pie", es: 'Pastel de carne', fr: 'Hachis Parmentier', de: 'Shepherd’s Pie' }, ing: ['ground_beef', 'potato', 'carrot', 'peas', 'onion'] },
  { id: 'fish_tacos', title: { en: 'Fish Tacos', es: 'Tacos de pescado', fr: 'Tacos de poisson', de: 'Fisch-Tacos' }, ing: ['fish', 'tortilla', 'lettuce', 'lemon'] },
  { id: 'noodle_stirfry', title: { en: 'Noodle Stir-Fry', es: 'Fideos salteados', fr: 'Nouilles sautées', de: 'Gebratene Nudeln' }, ing: ['noodles', 'eggs', 'carrot', 'soy_sauce', 'spinach'] },
  { id: 'greek_salad', title: { en: 'Greek Salad', es: 'Ensalada griega', fr: 'Salade grecque', de: 'Griechischer Salat' }, ing: ['cucumber', 'tomato', 'onion', 'cheese'] },
  { id: 'sausage_peppers', title: { en: 'Sausage & Peppers', es: 'Salchichas con pimientos', fr: 'Saucisses aux poivrons', de: 'Wurst mit Paprika' }, ing: ['sausage', 'pepper', 'onion', 'bread'] },
  // West African and Afro-Caribbean dinners. Added after a household shopping
  // for yam, okra, garden eggs and corn flour was offered a week of shepherd's
  // pie and BLTs — the library only knew a European pantry.
  { id: 'jollof_rice', title: { en: 'Jollof Rice', es: 'Arroz jollof', fr: 'Riz jollof', de: 'Jollof-Reis' }, ing: ['rice', 'tomato', 'onion', 'pepper', 'chicken'], staple: true },
  { id: 'chicken_yassa', title: { en: 'Chicken Yassa', es: 'Pollo yassa', fr: 'Poulet yassa', de: 'Yassa-Hähnchen' }, ing: ['chicken', 'onion', 'lemon', 'rice', 'chili'] },
  { id: 'groundnut_stew', title: { en: 'Groundnut Stew', es: 'Guiso de cacahuete', fr: 'Mafé à l’arachide', de: 'Erdnusseintopf' }, ing: ['beef', 'peanut', 'tomato', 'onion', 'rice'] },
  { id: 'okra_soup', title: { en: 'Okra Soup', es: 'Sopa de quimbombó', fr: 'Sauce gombo', de: 'Okra-Suppe' }, ing: ['okra', 'fish', 'tomato', 'onion', 'palm_oil'] },
  { id: 'yam_tomato', title: { en: 'Boiled Yam & Tomato Sauce', es: 'Ñame con salsa de tomate', fr: 'Igname sauce tomate', de: 'Yamswurzel mit Tomatensauce' }, ing: ['yam', 'tomato', 'onion', 'fish'], staple: true },
  { id: 'red_red', title: { en: 'Red Red — Beans & Fried Plantain', es: 'Frijoles con plátano frito', fr: 'Haricots et bananes plantains frites', de: 'Bohnen mit gebratener Kochbanane' }, ing: ['beans', 'plantain', 'tomato', 'onion', 'palm_oil'] },
  { id: 'garden_egg_stew', title: { en: 'Garden Egg Stew', es: 'Guiso de berenjena', fr: 'Sauce d’aubergines', de: 'Auberginen-Eintopf' }, ing: ['garden_egg', 'tomato', 'onion', 'fish'] },
  { id: 'grilled_tilapia', title: { en: 'Grilled Fish & Pepper Sauce', es: 'Pescado a la parrilla con salsa picante', fr: 'Poisson braisé sauce piment', de: 'Gegrillter Fisch mit Chilisauce' }, ing: ['fish', 'chili', 'onion', 'lemon'] },
  { id: 'attieke_fish', title: { en: 'Attiéké & Fish', es: 'Attiéké con pescado', fr: 'Attiéké poisson', de: 'Attiéké mit Fisch' }, ing: ['cassava', 'fish', 'tomato', 'onion'] },
  { id: 'banku_okra', title: { en: 'Banku & Okra', es: 'Banku con quimbombó', fr: 'Banku au gombo', de: 'Banku mit Okra' }, ing: ['corn_flour', 'okra', 'fish', 'tomato'] },
  { id: 'peanut_spinach', title: { en: 'Spinach & Peanut Stew', es: 'Guiso de espinacas y cacahuete', fr: 'Sauce épinards arachide', de: 'Spinat-Erdnuss-Eintopf' }, ing: ['spinach', 'peanut', 'tomato', 'onion', 'rice'], staple: true },
  { id: 'sweet_potato_chicken', title: { en: 'Roast Sweet Potato & Chicken', es: 'Boniato asado con pollo', fr: 'Patates douces rôties et poulet', de: 'Ofen-Süßkartoffeln mit Hähnchen' }, ing: ['sweet_potato', 'chicken', 'onion', 'pepper'], staple: true },
  { id: 'zucchini_pasta', title: { en: 'Zucchini Pasta', es: 'Pasta con calabacín', fr: 'Pâtes aux courgettes', de: 'Zucchini-Pasta' }, ing: ['pasta', 'zucchini', 'tomato', 'garlic'], staple: true },
];

export interface MealSuggestion {
  day: string;
  recipeId: string;
  title: string;
  haveLabels: string[];
  needLabels: string[];
  allLabels: string[];
  matched: number;
}

/**
 * Propose 7 dinners for the week from what the family has bought.
 * @param ownedNames current shopping-list item names + recent history names.
 */
export function suggestWeek(ownedNames: string[], lang: SuggestLang): MealSuggestion[] {
  const ownedWords = ownedNames
    .map((n) => norm(n))
    .filter(Boolean)
    .map((s) => s.split(' '));

  const hasIngredient = (id: string): boolean => {
    const ing = ING[id];
    if (!ing) return false;
    const excluded = (words: string[]) =>
      (ing.not || []).some((term) => ` ${words.join(' ')} `.includes(` ${term} `));
    return ing.match.some((term) =>
      ownedWords.some((words) => itemMatchesTerm(words, term) && !excluded(words)),
    );
  };

  const scored = RECIPES.map((r) => {
    const matchedIds = r.ing.filter(hasIngredient);
    return { r, matchedIds, matched: matchedIds.length, ratio: matchedIds.length / r.ing.length };
  });

  scored.sort(
    (a, b) => b.matched - a.matched || b.ratio - a.ratio || (b.r.staple ? 1 : 0) - (a.r.staple ? 1 : 0),
  );

  return scored.slice(0, 7).map((s, i) => {
    const need = s.r.ing.filter((id) => !s.matchedIds.includes(id));
    return {
      day: DAYS[i],
      recipeId: s.r.id,
      title: s.r.title[lang],
      haveLabels: s.matchedIds.map((id) => ING[id].label[lang]),
      needLabels: need.map((id) => ING[id].label[lang]),
      allLabels: s.r.ing.map((id) => ING[id].label[lang]),
      matched: s.matched,
    };
  });
}

const RECIPES_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

// Every library title, in every language, pointing back at its recipe.
const TITLE_TO_ID: Record<string, string> = {};
for (const r of RECIPES) {
  for (const lang of ['en', 'es', 'fr', 'de'] as SuggestLang[]) {
    TITLE_TO_ID[norm(r.title[lang])] = r.id;
  }
}

/**
 * Recover the recipe behind a meal that was saved before recipe ids existed.
 *
 * Meals created by earlier builds stored only their rendered title, so they
 * cannot show a cooking method even when it is a dish we ship. Matching the
 * stored text back against every library title, in every language, recovers
 * most of them — a plan built in French still resolves after the app is
 * switched to English.
 *
 * Exact match only, after stripping accents and punctuation. A fuzzy match
 * that showed the wrong method for someone else's dinner would be worse than
 * showing none.
 */
export function resolveRecipeId(
  recipeId: string | null | undefined,
  storedTitle: string,
): string | null {
  if (recipeId) return recipeId;
  if (!storedTitle) return null;
  return TITLE_TO_ID[norm(storedTitle)] ?? null;
}

/** A recipe's ingredients as id + localized label, so callers can pair each one
 *  with an amount without re-deriving the ids from display text. */
export function recipeIngredients(
  recipeId: string | null | undefined,
  lang: SuggestLang,
): { id: string; label: string }[] {
  if (!recipeId) return [];
  const recipe = RECIPES_BY_ID[recipeId];
  if (!recipe) return [];
  return recipe.ing.map((id) => ({ id, label: ING[id]?.label[lang] ?? id }));
}

/** Every recipe, for the browse-and-search list. */
export function allRecipes(lang: SuggestLang): { id: string; title: string; ingredients: string[] }[] {
  return RECIPES.map((r) => ({
    id: r.id,
    title: r.title[lang],
    ingredients: r.ing.map((id) => ING[id]?.label[lang] ?? id),
  }));
}

/** Case- and accent-insensitive search over titles and ingredient names, so
 *  "gombo", "okra" and "Okra Soup" all find the same dish. */
export function searchRecipes(
  query: string,
  lang: SuggestLang,
): { id: string; title: string; ingredients: string[] }[] {
  const q = norm(query);
  const all = allRecipes(lang);
  if (!q) return all;
  return all.filter((r) => {
    if (norm(r.title).includes(q)) return true;
    if (r.ingredients.some((i) => norm(i).includes(q))) return true;
    // Also match the other languages' words, so a French speaker with the app
    // in English still finds "gombo".
    const recipe = RECIPES_BY_ID[r.id];
    return recipe.ing.some((id) => (ING[id]?.match || []).some((term) => term.includes(q)));
  });
}

/** Every recipe the library ships. Used to assert the method data stays in step. */
export const RECIPE_IDS: string[] = RECIPES.map((r) => r.id);

/**
 * Title for a saved meal, in the language the user is reading right now.
 *
 * Meals accepted from the suggestion library are stored with their `recipe_id`,
 * so their title can be looked up again rather than replayed in whatever
 * language happened to be active when the plan was made. Meals the user typed
 * themselves have no recipe id, and their own words are returned untouched.
 */
export function localizedMealTitle(
  recipeId: string | null | undefined,
  storedTitle: string,
  lang: SuggestLang,
): string {
  const id = resolveRecipeId(recipeId, storedTitle);
  if (!id) return storedTitle;
  return RECIPES_BY_ID[id]?.title[lang] ?? storedTitle;
}

/** Ingredient labels for a saved meal, localized the same way. */
export function localizedMealIngredients(
  recipeId: string | null | undefined,
  storedIngredients: string[],
  lang: SuggestLang,
  storedTitle = '',
): string[] {
  const id = resolveRecipeId(recipeId, storedTitle);
  if (!id) return storedIngredients;
  const recipe = RECIPES_BY_ID[id];
  if (!recipe) return storedIngredients;
  return recipe.ing.map((id) => ING[id]?.label[lang] ?? id);
}
