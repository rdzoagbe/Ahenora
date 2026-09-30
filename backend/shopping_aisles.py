# -*- coding: utf-8 -*-
"""Which aisle a shopping-list item belongs to, from its name.

Roland, 2026-09-30: "every item we put there just goes in, but the category
side is not given — tomatoes should go to one category, washing liquid and
toilet paper to cleaning". The list had thirteen aisles and only the Kitchen
screen ever filled one in; everything added from the + button, a typed
message, a scan, a meal plan or a reused list was stored as "Other".

So the server decides, for every way an item arrives:

1. what this household chose for this item before (it corrected the aisle
   once, and it stays corrected);
2. otherwise the word list below;
3. otherwise whatever the app guessed;
4. otherwise "Other" — a wrong aisle sends someone to the wrong end of the
   shop, which is worse than no aisle at all.

The words cover the app's four languages (English, French, Spanish, German),
the plural and accent-free spellings people actually type, and the brand names
that are really product names on a list ("Ariel", "Pampers", "Sopalin").

Matching is on whole words, and the LONGEST matching term wins. That one rule
replaces a precedence table: "jus d'orange" beats "orange", "watermelon" beats
"water", "sel lave-vaisselle" beats "sel", "lait infantile" beats "lait",
"black pepper" beats "pepper". When adding a word, add the longer phrase that
disambiguates it rather than special-casing code.
"""
import re
import unicodedata
from typing import Iterable, Optional

# Must stay the backend's SHOPPING_CATEGORIES, and in the order a shop is
# walked: the list is shown in this order, fresh food first, "Other" last.
AISLES = [
    "Produce", "Bakery", "Meat", "Dairy", "Frozen", "Pantry", "Snacks",
    "Drinks", "Household", "Health", "Baby", "School", "Other",
]

TERMS: dict[str, list[str]] = {
    "Produce": [
        # generic
        "fruit", "fruits", "vegetables", "veg", "veggies", "legume", "legumes",
        "fruta", "frutas", "verdura", "verduras", "obst", "gemuse", "salad", "salade",
        "ensalada", "salat", "lettuce", "laitue", "lechuga", "herbs", "fines herbes",
        # vegetables
        "tomato", "tomatoes", "tomate", "tomates", "tomaten", "cherry tomatoes",
        "tomates cerises", "potato", "potatoes", "pomme de terre", "pommes de terre",
        "patate", "patates", "patata", "patatas", "kartoffel", "kartoffeln",
        "onion", "onions", "oignon", "oignons", "cebolla", "cebollas", "zwiebel",
        "zwiebeln", "shallot", "shallots", "echalote", "echalotes", "spring onion",
        "garlic", "ail", "ajo", "knoblauch", "carrot", "carrots", "carotte", "carottes",
        "zanahoria", "zanahorias", "karotte", "karotten", "mohre", "mohren",
        "cucumber", "concombre", "pepino", "gurke", "courgette", "courgettes",
        "zucchini", "calabacin", "aubergine", "eggplant", "berenjena",
        "pepper", "peppers", "bell pepper", "poivron", "poivrons", "pimiento",
        "paprika schote", "chili", "chilli", "piment", "spinach", "epinard",
        "epinards", "espinaca", "espinacas", "spinat", "broccoli", "brocoli",
        "cauliflower", "chou fleur", "coliflor", "blumenkohl", "cabbage", "chou",
        "repollo", "kohl", "leek", "leeks", "poireau", "puerro", "lauch",
        "mushroom", "mushrooms", "champignon", "champignons", "champinon",
        "champinones", "setas", "pilze", "celery", "celeri", "apio", "sellerie",
        "green beans", "haricots verts", "judias verdes", "radish", "radis",
        "beetroot", "betterave", "pumpkin", "potiron", "citrouille", "butternut",
        "sweet potato", "patate douce", "boniato", "corn on the cob", "mais doux",
        "avocado", "avocat", "aguacate", "asparagus", "asperge", "asperges",
        "artichoke", "artichaut", "fennel", "fenouil", "kale", "chou kale",
        "rocket", "roquette", "basil", "basilic", "albahaca", "parsley", "persil",
        "perejil", "petersilie", "coriander", "cilantro", "coriandre", "mint",
        "menthe", "dill", "aneth", "chives", "ciboulette", "thyme fresh",
        "ginger", "gingembre", "jengibre", "ingwer",
        # West African and Caribbean staples
        "plantain", "plantains", "banane plantain", "yam", "igname", "cassava",
        "manioc", "okra", "gombo", "garden egg", "garden eggs", "taro", "macabo",
        "okro", "quimbombo", "yamswurzel", "batata", "susskartoffel", "kochbanane",
        "alloco", "yuca", "maniok", "tapioca", "papa", "papas", "moehre", "brokkoli",
        "pilz", "seta", "chile", "scotch bonnet", "habanero", "pili pili",
        # fruit
        "apple", "apples", "pomme", "pommes", "manzana", "manzanas", "apfel",
        "apfel", "banana", "bananas", "banane", "bananes", "platano", "platanos",
        "orange", "oranges", "naranja", "naranjas", "clementine", "clementines",
        "mandarine", "mandarina", "lemon", "lemons", "citron", "citrons", "limon",
        "zitrone", "lime", "limes", "citron vert", "pear", "pears", "poire",
        "poires", "pera", "birne", "grapes", "raisin", "uvas", "trauben",
        "strawberry", "strawberries", "fraise", "fraises", "fresa", "fresas",
        "erdbeere", "erdbeeren", "raspberries", "framboise", "framboises",
        "blueberries", "myrtille", "myrtilles", "cherries", "cerise", "cerises",
        "peach", "peaches", "peche", "peches", "melocoton", "pfirsich",
        "nectarine", "apricot", "abricot", "abricots", "plum", "prune", "prunes",
        "kiwi", "mango", "mangue", "pineapple", "ananas", "pina", "melon", "melone",
        "watermelon", "pasteque", "sandia", "wassermelone", "papaya", "papaye",
        "coconut fresh", "noix de coco fraiche", "pomegranate", "grenade",
        "fig", "figs", "figue", "figues",
    ],
    "Bakery": [
        "bread", "loaf", "pain", "pains", "pan", "brot", "baguette", "baguettes",
        "pain de mie", "pain complet", "croissant", "croissants", "pain au chocolat",
        "pains au chocolat", "chocolatine", "chocolatines", "brioche", "brioches",
        "roll", "rolls", "bread rolls", "petits pains", "bun", "buns", "bagel",
        "bagels", "pitta", "pita", "naan", "wraps", "tortilla", "tortillas",
        "crumpets", "muffins", "wrap", "dough", "pizza dough", "pate a pizza",
        "masa", "teig", "bollo", "bollos", "barra de pan", "brotchen",
        "toast bread", "biscottes", "brioche tranchee",
    ],
    "Meat": [
        "meat", "viande", "carne", "fleisch", "chicken", "poulet", "pollo",
        "hahnchen", "huhn", "chicken breast", "blanc de poulet", "escalope",
        "escalopes", "beef", "boeuf", "ternera", "rind", "rindfleisch", "steak",
        "steaks", "mince", "minced beef", "ground beef", "viande hachee",
        "steak hache", "steaks haches", "carne picada", "hackfleisch", "pork",
        "porc", "cerdo", "schwein", "schweinefleisch", "lamb", "agneau", "cordero",
        "lamm", "veal", "veau", "turkey", "dinde", "pavo", "pute", "duck", "canard",
        "sausage", "sausages", "saucisse", "saucisses", "salchicha", "salchichas",
        "wurst", "wurstchen", "merguez", "ham", "jambon", "jamon", "schinken",
        "bacon", "lardons", "chorizo", "salami", "pate", "rillettes", "ribs",
        "cotes", "cote de porc", "roti", "gigot", "fish", "poisson", "pescado",
        "fisch", "salmon", "saumon", "lachs", "cod", "cabillaud", "bacalao",
        "tuna", "thon", "atun", "thunfisch", "hake", "merlu", "sea bass", "burger", "burgers", "hamburger",
        "hamburgers", "meatballs", "boulettes",
        "sardines", "sardine", "mackerel", "maquereau", "tilapia", "shrimp",
        "shrimps", "prawns", "crevette", "crevettes", "gambas", "garnelen",
        "mussels", "moules", "mejillones", "seafood", "fruits de mer", "mariscos",
        "smoked salmon", "saumon fume", "prawn", "camarones", "carne de res",
        "res", "hachee", "tocino", "lardon", "speck", "bratwurst", "surimi", "goat meat", "viande de chevre",
    ],
    "Dairy": [
        "milk", "lait", "leche", "milch", "semi skimmed", "demi ecreme",
        "whole milk", "lait entier", "almond milk", "lait d amande", "oat milk",
        "lait d avoine", "soy milk", "lait de soja", "butter", "beurre",
        "mantequilla", "cheese", "fromage", "fromages", "queso", "kase",
        "cheddar", "emmental", "gruyere", "comte", "camembert", "brie",
        "mozzarella", "parmesan", "parmigiano", "feta", "chevre", "raclette",
        "reblochon", "roquefort", "cottage cheese", "cream cheese", "philadelphia",
        "fromage frais", "fromage blanc", "petit suisse", "petits suisses",
        "yoghurt", "yogurt", "yoghurts", "yogurts", "yaourt", "yaourts", "yogur",
        "yogures", "joghurt", "skyr", "cream", "creme", "creme fraiche",
        "creme liquide", "sour cream", "nata", "sahne", "quark", "eggs", "egg",
        "oeuf", "oeufs", "huevo", "huevos", "eier", "margarine", "creme dessert", "ei", "kaese", "crema",
        "danette",
    ],
    "Frozen": [
        "frozen", "surgele", "surgeles", "surgelee", "surgelees", "congele",
        "congeles", "congelado", "congelados", "tiefkuhl", "gefroren",
        "ice cream", "glace", "glaces", "helado", "helados", "eis", "sorbet",
        "ice", "ice cubes", "glacons", "fish fingers", "batonnets de poisson",
        "poisson pane", "frozen peas", "petits pois surgeles", "frozen chips",
        "frites surgelees", "frozen pizza", "pizza surgelee", "frozen vegetables",
        "legumes surgeles", "magnum", "cornetto",
    ],
    "Pantry": [
        "pasta", "pates", "spaghetti", "penne", "fusilli", "tagliatelle",
        "macaroni", "lasagne", "nudeln", "noodles", "nouilles", "rice", "riz",
        "arroz", "reis", "basmati", "couscous", "semoule", "quinoa", "bulgur",
        "flour", "farine", "harina", "mehl", "sugar", "sucre", "azucar", "zucker",
        "brown sugar", "cassonade", "salt", "sel", "sal", "salz", "black pepper",
        "poivre", "pimienta", "pfeffer", "oil", "olive oil", "huile",
        "huile d olive", "huile de tournesol", "sunflower oil", "vegetable oil",
        "aceite", "aceite de oliva", "olivenol", "vinegar", "vinaigre", "vinagre",
        "essig", "mustard", "moutarde", "mostaza", "senf", "ketchup", "mayonnaise",
        "mayo", "mayonesa", "sauce", "sauce tomate", "tomato sauce",
        "passata", "coulis de tomate", "tinned tomatoes", "canned tomatoes",
        "tomates pelees", "concentre de tomate", "tomato puree", "pesto",
        "soy sauce", "sauce soja", "stock", "stock cube", "stock cubes",
        "bouillon", "cube", "maggi", "spices", "epices", "especias", "gewurze",
        "curry", "cumin", "paprika", "cinnamon", "cannelle", "oregano", "origan",
        "thyme", "thym", "herbes de provence", "bay leaves", "laurier", "nutmeg",
        "muscade", "vanilla", "vanille", "baking powder", "levure",
        "levure chimique", "yeast", "cereal", "cereals", "cereales", "muesli",
        "granola", "porridge", "oats", "flocons d avoine", "avena", "haferflocken",
        "cornflakes", "jam", "confiture", "confitures", "mermelada",
        "marmelade", "marmalade", "honey", "miel", "honig", "nutella",
        "peanut butter", "beurre de cacahuete", "spread", "pate a tartiner",
        "tinned", "canned", "tin", "tins", "conserve", "conserves", "boite",
        "lata", "latas", "dose", "beans", "baked beans", "haricots", "haricots rouges",
        "red kidney beans", "judias", "alubias", "bohnen", "chickpeas",
        "pois chiches", "garbanzos", "lentils", "lentilles", "lentejas",
        "linsen", "thon en boite", "canned tuna", "tinned tuna", "sardines en boite",
        "coconut milk", "lait de coco", "palm oil", "huile de palme",
        "tomato paste", "coconut", "noix de coco", "noix de muscade", "corn",
        "sweetcorn", "gari",
        # what the recipe library already knew, so no item sorts worse than before
        "peas", "petits pois", "guisantes", "erbsen", "peanut", "peanuts",
        "groundnut", "groundnuts", "arachide", "arachides", "cacahuete",
        "cacahuetes", "erdnuss", "erdnusse", "palmol", "chickpea", "kichererbsen",
        "lentil", "frijoles", "maiz", "mais", "maismehl", "banku", "soy", "soja",
        "salsa de soja", "sojasauce", "coco", "kokos", "kokosmilch",
        "salsa de tomate", "tomatensauce", "sugo", "fideos", "fufu", "attieke", "semolina", "corn flour",
        "farine de mais", "maizena", "cornflour", "breadcrumbs", "chapelure",
        "raisins secs", "dried fruit", "fruits secs", "compote", "compotes",
        "apple sauce", "puree", "puree mousseline", "croutons", "olives",
        "cornichons", "gherkins", "capers", "capres", "chocolate spread",
    ],
    "Snacks": [
        "snacks", "snack", "chocolate", "chocolates", "chocolat", "schokolade",
        "biscuits", "biscuit", "cookies", "cookie", "galletas", "galleta",
        "kekse", "keks", "crisps", "chips", "patatas fritas", "sweets", "candy",
        "bonbons", "bonbon", "caramelos", "chuches", "sussigkeiten", "cake",
        "cakes", "gateau", "gateaux", "pastel", "kuchen", "popcorn", "pop corn",
        "nuts", "noix", "nueces", "nusse", "almonds", "amandes", "cashews", "noix de cajou", "pistachios",
        "pistaches", "crackers", "tuc", "pringles", "doritos", "haribo",
        "kinder", "oreo", "oreos", "petit beurre", "madeleines", "brownies",
        "cereal bars", "barres de cereales", "granola bars", "dried mango",
        "aperitif", "biscuits aperitif", "chewing gum", "chewing-gum",
    ],
    "Drinks": [
        "water", "eau", "eaux", "agua", "wasser", "sparkling water",
        "eau gazeuse", "eau petillante", "mineral water", "eau minerale",
        "evian", "volvic", "vittel", "perrier", "cristaline", "badoit",
        "san pellegrino", "juice", "juices", "jus", "zumo", "zumos", "saft",
        "orange juice", "jus d orange", "apple juice", "jus de pomme",
        "orangeade", "lemonade", "limonade", "soda", "sodas", "cola", "coke",
        "coca", "coca cola", "pepsi", "fanta", "sprite", "orangina", "ice tea",
        "iced tea", "squash", "sirop", "sirup", "coffee", "cafe", "cafe moulu",
        "coffee beans", "capsules", "nespresso", "kaffee", "tea", "tea bags",
        "the vert", "the noir", "sachets de the", "infusion", "tisane", "chai",
        "beer", "beers", "biere", "bieres", "cerveza", "cervezas", "bier",
        "wine", "wines", "vin", "vins", "vino", "vinos", "wein", "red wine",
        "vin rouge", "white wine", "vin blanc", "rose wine", "champagne",
        "prosecco", "sirop de menthe", "sirop de grenadine", "sirop de fraise",
        "cider", "cidre", "sidra", "whisky", "vodka", "rum", "rhum",
        "gin", "malt", "hot chocolate", "chocolat chaud", "energy drink",
        "red bull", "smoothie", "smoothies", "milkshake", "kombucha",
    ],
    "Household": [
        # the words Roland used
        "washing liquid", "washing up liquid", "washing-up liquid", "dish soap",
        "dishwashing liquid", "liquide vaisselle", "produit vaisselle",
        "lavavajillas", "spulmittel", "toilet paper", "toilet roll", "toilet rolls",
        "loo roll", "loo rolls", "papier toilette", "papier wc", "pq",
        "papel higienico", "toilettenpapier", "klopapier",
        # laundry and dishes
        "detergent", "laundry", "laundry detergent", "washing powder",
        # Soap that washes clothes or the house, not hands: "soap" alone stays
        # in Health & beauty, so these are listed as the longer phrases.
        "washing soap", "laundry soap", "soap powder", "soap flakes",
        "savon noir", "savon de marseille", "savon lessive", "savon a linge",
        "jabon de lavar", "jabon para la ropa", "jabon de marsella", "kernseife",
        "gallseife",
        "lessive", "lessive liquide", "detergente", "waschmittel",
        "fabric softener", "softener", "adoucissant", "suavizante",
        "weichspuler", "dishwasher tablets", "dishwasher pods",
        "tablettes lave vaisselle", "pastilles lave vaisselle",
        "sel lave vaisselle", "dishwasher salt", "rinse aid",
        "liquide de rincage", "cleaning wipes", "lingettes menage",
        "lingettes desinfectantes", "stain remover", "detachant", "vanish",
        "ariel", "persil", "skip", "le chat", "dash", "lenor", "fairy", "dreft",
        "mir", "paic", "finish", "sun lave vaisselle", "cajoline",
        # cleaning
        "cleaning", "cleaner", "cleaning products", "produits menagers",
        "produit menager", "menage", "nettoyant", "nettoyant multi usage",
        "limpiador", "reiniger", "bleach", "javel", "eau de javel", "lejia",
        "disinfectant", "desinfectant", "desinfectante", "anti bacterial spray",
        "multi surface", "glass cleaner", "vitres", "window cleaner",
        "floor cleaner", "toilet cleaner", "wc gel", "harpic", "domestos",
        "cif", "ajax", "st marc", "dettol", "sponge", "sponges", "eponge",
        "eponges", "esponja", "schwamm", "scourer", "cloths", "microfibre",
        "chiffon", "chiffons", "serpilliere", "mop", "rubber gloves",
        "gants menage", "gants de menage",
        # paper, bags, kitchen
        "kitchen roll", "kitchen paper", "paper towels", "essuie tout",
        "sopalin", "papel de cocina", "kuchenrolle", "tissues", "mouchoirs",
        "kleenex", "napkins", "serviettes en papier", "bin bags", "bin liners",
        "sacs poubelle", "sac poubelle", "bolsas de basura", "mullbeutel",
        "foil", "aluminium foil", "tin foil", "papier aluminium", "alu",
        "papel aluminio", "cling film", "film alimentaire", "baking paper",
        "papier cuisson", "freezer bags", "sacs congelation", "zip bags",
        # around the house
        "batteries", "battery", "piles", "pilas", "batterien", "light bulb",
        "light bulbs", "ampoule", "ampoules", "bombilla", "candles", "bougies",
        "matches", "allumettes", "lighter", "briquet", "air freshener",
        "desodorisant", "febreze", "insecticide", "anti moustique",
        "cat food", "dog food", "pet food", "croquettes", "patee", "cat litter",
        "litiere", "charcoal", "charbon",
    ],
    "Health": [
        # medicine
        "medicine", "medicines", "medicament", "medicaments", "medicamentos",
        "paracetamol", "doliprane", "dafalgan", "efferalgan", "ibuprofen",
        "ibuprofene", "ibuprofeno", "advil", "nurofen", "aspirin", "aspirine",
        "aspirina", "vitamins", "vitamines", "vitaminas", "vitamine",
        "plasters", "plaster", "band aid", "pansement", "pansements", "tirita",
        "tiritas", "pflaster", "thermometer", "thermometre", "cough syrup",
        "sirop pour la toux", "antiseptic", "antiseptique", "betadine",
        "biseptine", "saline", "serum physiologique", "strepsils",
        # hygiene and beauty
        "toothpaste", "dentifrice", "pasta de dientes", "zahnpasta", "colgate",
        "signal", "sensodyne", "toothbrush", "toothbrushes", "brosse a dents",
        "cepillo de dientes", "zahnburste", "mouthwash", "bain de bouche",
        "dental floss", "fil dentaire", "shampoo", "shampooing", "champu",
        "conditioner", "apres shampoing", "shower gel", "gel douche",
        "gel de ducha", "duschgel", "body wash", "soap", "savon", "savons",
        "jabon", "seife", "hand soap", "savon liquide", "hand wash",
        "deodorant", "deo", "desodorante", "razor", "razors", "rasoir",
        "rasoirs", "shaving foam", "mousse a raser", "cotton", "coton",
        "cotton wool", "cotton pads", "cotton buds", "coton tige", "cotons tiges",
        "tampons", "sanitary pads", "serviettes hygieniques", "protege slip",
        "panty liners", "compresas", "sunscreen", "sun cream", "creme solaire",
        "protector solar", "sonnencreme", "moisturiser", "moisturizer",
        "creme hydratante", "body lotion", "lait corporel", "lait demaquillant",
        "makeup", "maquillage", "hand cream", "creme mains", "lip balm",
        "baume a levres", "nivea", "dove", "hair gel", "gel cheveux",
        "hairspray", "laque", "eau de toilette", "perfume", "parfum",
        "lingettes demaquillantes", "makeup remover", "demaquillant", "nail polish", "vernis", "condoms", "preservatifs",
        "contact lens solution", "solution lentilles",
    ],
    "Baby": [
        "baby", "bebe", "nappy", "nappies", "diaper", "diapers", "couche",
        "couches", "panal", "panales", "windeln", "pampers", "huggies", "lotus baby",
        "formula", "baby formula", "baby milk", "lait infantile", "lait bebe",
        "lait 1er age", "lait 2eme age", "leche infantil", "babynahrung",
        "baby food", "petit pot", "petits pots", "blédina", "bledina",
        "baby wipes", "wipes", "lingettes", "lingettes bebe", "toallitas",
        "feuchttucher", "baby bottle", "biberon", "biberons",
        "dummy", "pacifier", "tetine", "chupete", "nappy cream", "creme change",
        "liniment", "baby shampoo", "teething", "calpol",
    ],
    "School": [
        "school supplies", "fournitures scolaires", "fournitures",
        "material escolar", "schulsachen", "notebook", "notebooks", "exercise book",
        "cahier", "cahiers", "cuaderno", "cuadernos", "heft", "hefte",
        "pens", "pen", "stylo", "stylos", "bic", "boligrafo", "boligrafos",
        "kugelschreiber", "stifte", "pencil", "pencils", "crayon", "crayons",
        "crayon a papier", "crayons de couleur", "colouring pencils",
        "felt tips", "feutres", "lapiz", "lapices", "bleistift", "buntstifte",
        "glue", "glue stick", "colle", "baton de colle", "pegamento", "kleber",
        "scissors", "ciseaux", "tijeras", "schere", "ruler", "regle", "regla",
        "lineal", "rubber", "eraser", "gomme", "goma", "radiergummi",
        "sharpener", "taille crayon", "sacapuntas", "anspitzer", "highlighter",
        "surligneur", "surligneurs", "folder", "folders", "binder", "classeur",
        "chemise", "pochettes", "copies doubles", "copies simples",
        "printer paper", "ramette", "calculator", "calculatrice", "calculadora",
        "backpack", "school bag", "cartable", "sac a dos", "mochila",
        "schulranzen", "pencil case", "trousse", "agenda scolaire", "compass",
        "compas", "protractor", "rapporteur", "equerre", "tipex", "correcteur",
    ],
}

_WORD = re.compile(r"[^a-z0-9\s]")


def normalise(text: str) -> str:
    """Lowercase, accents off, punctuation to spaces, one space between words."""
    text = unicodedata.normalize("NFKD", (text or "").lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.replace("œ", "oe").replace("æ", "ae").replace("ß", "ss")
    text = _WORD.sub(" ", text)
    return " ".join(text.split())


def item_key(name: str) -> str:
    """What a household's remembered choice is keyed on: the words of the
    name without quantities, so "Tomatoes 400g" and "tomatoes x2" share one."""
    words = [w for w in normalise(name).split()
             if not any(ch.isdigit() for ch in w) and w not in ("x", "g", "kg", "ml", "l", "cl")]
    return " ".join(words)[:80]


def _build():
    phrases: list[tuple[str, str]] = []
    single: dict[str, str] = {}
    for aisle, terms in TERMS.items():
        for raw in terms:
            term = normalise(raw)
            if not term:
                continue
            if " " in term:
                phrases.append((term, aisle))
            else:
                # First aisle to claim a single word keeps it, so the order of
                # TERMS decides a tie; ties are listed deliberately (none today
                # that matter: see tests).
                single.setdefault(term, aisle)
    return phrases, single


_PHRASES, _SINGLE = _build()


def _word_matches(word: str, term: str) -> bool:
    if word == term or word in (term + "s", term + "es", term + "x"):
        return True
    # A long stem also matches its longer forms ("tomate" -> "tomaten",
    # "kartoffel" -> "kartoffeln"). Short words must match exactly, or "ail"
    # would claim "aile" and "pain" would claim "painting".
    return len(term) >= 5 and word.startswith(term)


def classify(name: str) -> Optional[str]:
    """The aisle for an item name, or None when no word is recognised."""
    text = normalise(name)
    if not text:
        return None
    words = text.split()
    padded = f" {text} "
    best: Optional[tuple[int, str]] = None

    def consider(length: int, aisle: str):
        nonlocal best
        if best is None or length > best[0]:
            best = (length, aisle)

    for term, aisle in _PHRASES:
        if f" {term} " in padded:
            consider(len(term), aisle)
    for word in words:
        # The word itself, the word less a plural ending, and every stem of five
        # letters or more; _word_matches decides which of those really match.
        candidates = {word, word[:-1], word[:-2]}
        candidates.update(word[:k] for k in range(5, len(word)))
        for term in candidates:
            aisle = _SINGLE.get(term)
            if aisle and _word_matches(word, term):
                consider(len(term), aisle)
    return best[1] if best else None


def choose_aisle(name: str, remembered: Optional[str] = None,
                 supplied: Optional[str] = None) -> str:
    """The aisle to store: the household's own choice, then the word list,
    then the app's guess, then "Other"."""
    if remembered in AISLES:
        return remembered
    found = classify(name)
    if found:
        return found
    if supplied in AISLES:
        return supplied
    return "Other"


async def remembered_aisles(database, family_id: str, names: Iterable[str]) -> dict[str, str]:
    """This household's corrections for these names, by item_key."""
    keys = sorted({item_key(n) for n in names if item_key(n)})
    if not keys:
        return {}
    found: dict[str, str] = {}
    async for row in database["shopping_aisles"].find(
        {"family_id": family_id, "key": {"$in": keys}}, {"_id": 0, "key": 1, "category": 1}
    ):
        if row.get("category") in AISLES:
            found[row["key"]] = row["category"]
    return found
