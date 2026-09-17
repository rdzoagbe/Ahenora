"""The icon a card is about, guessed from its title.

Every task showed the same green list icon on the left, so a feed of ten
cards was ten identical marks and the words did all the work. Roland asked
for a birthday to carry a cake, cleaning a broom, the school run a car — the
thing a child who cannot read yet still recognises, and the thing a parent
scanning a day sees before the title.

WHY THE SERVER GUESSES

A card can arrive from typing, voice, the document scanner, the AI and a
Google Calendar import, on two phones and the web. If each app guessed for
itself, the same card would carry a cake on one parent's phone and nothing on
the other's until both had updated. Guessed here, at the moment the card is
written, every device and every source agree, and cards written before this
existed can be filled in once.

WHY A CLOSED SET, STORED AS A KEY

The card stores "birthday", not the cake. The glyph is the app's choice —
this emoji today, a drawn icon if that ever looks better — and a key survives
that change where a stored emoji would not. Twenty keys cover household life;
a free emoji keyboard would put a random sticker on every card and the column
would stop meaning anything.

WHY WORDS ARE MATCHED THE WAY THEY ARE

Whole words, accent-blind, in the four languages the app speaks. "car" must
not fire on "carrot", and it must not fire on the French conjunction "car"
either, which is why the car keywords are "carpool", "voiture", "coche" and
never the bare English word. "lit" is a bed in French and also the verb
"reads", so it only counts inside "faire le lit". Phrases are tried before
single words so "brush teeth" is a bath-time chore, not a dentist.
"""
import re
import unicodedata
from typing import Optional

# key -> glyph. The order is the order the picker shows them in.
ICONS = {
    "birthday": "🎂",
    "cleaning": "🧹",
    "bed": "🛏️",
    "car": "🚗",
    "school": "🎒",
    "sport": "⚽",
    "doctor": "🩺",
    "dentist": "🦷",
    "shopping": "🛒",
    "cooking": "🍳",
    "laundry": "🧺",
    "bins": "🗑️",
    "pet": "🐶",
    "music": "🎵",
    "party": "🎉",
    "travel": "✈️",
    "money": "💶",
    "homework": "📚",
    "bath": "🛁",
    "gift": "🎁",
}

_GLYPH_TO_KEY = {glyph: key for key, glyph in ICONS.items()}

# A card type that already says what the card is about.
TYPE_ICONS = {
    "BIRTHDAY": "birthday",
    "SCHOOL": "school",
    "VACATION": "travel",
}

# Ordered: the first icon whose words appear wins, so the specific comes
# before the general (dentist before doctor, homework before school). A
# trailing * means "this stem and anything after it" (clean* takes cleaning,
# cleaned, cleaner). Everything is ASCII: accents are stripped from both
# sides before matching, ß becomes ss.
_KEYWORDS = [
    ("birthday", [
        "birthday", "bday", "anniversaire", "anniv", "cumpleanos", "cumple",
        "geburtstag", "geburi",
    ]),
    ("bath", [
        "brush teeth", "brush your teeth", "brosser les dents",
        "se brosser les dents", "lavarse los dientes", "zahne putzen",
        "bath", "bathe", "bathtime", "bath time", "shower", "bain", "douche",
        "bano", "ducha", "banar*", "baden", "dusche", "duschen",
    ]),
    ("dentist", [
        "dentist*", "orthodont*", "braces", "teeth", "tooth", "dents",
        "dientes", "zahn*", "kieferorthop*",
    ]),
    ("doctor", [
        "doctor", "docteur", "medecin", "medico", "medica", "arzt", "arztin",
        "pediatric*", "pediatre", "pediatra", "kinderarzt", "vaccin*",
        "vacuna*", "impfung", "impfen", "checkup", "check-up", "hospital",
        "hopital", "clinic", "clinique", "clinica", "klinik", "pharmacy",
        "pharmacie", "farmacia", "apotheke", "medicine", "medicament*",
        "medicina", "medikament*", "physio*", "kine", "optician", "opticien",
        "optometrist", "eye test", "prescription", "ordonnance", "receta medica",
    ]),
    ("homework", [
        "homework", "devoirs", "deberes", "hausaufgaben", "exam", "exams",
        "examen", "prufung", "revision", "revise", "reviser", "study",
        "studying", "etudier", "estudiar", "lernen", "spelling", "dictee",
        "reading log", "lecture du soir", "maths test", "test de",
    ]),
    ("car", [
        "carpool", "car pool", "car wash", "school run", "drive", "driving",
        "driver", "lift to", "pick up", "pick-up", "drop off", "drop-off",
        "covoiturage", "voiture", "conduire", "deposer", "chercher a",
        "aller chercher", "garage", "coche", "carro", "auto", "llevar a",
        "recoger a", "fahren", "fahrt", "abholen", "hinbringen", "mot",
        "controle technique", "itv", "tuv", "parking", "petrol", "essence",
        "gasolina", "tanken", "fuel", "tyres", "pneus",
    ]),
    ("school", [
        "school", "ecole", "colegio", "escuela", "schule", "teacher",
        "maitresse", "maitre", "maestra", "maestro", "lehrer*", "rentree",
        "parent-teacher", "parents evening", "reunion parents", "class trip",
        "field trip", "sortie scolaire", "excursion", "ausflug", "nursery",
        "creche", "kindergarten", "kita", "guarderia", "preschool", "maternelle",
        "uniform", "cartable", "backpack", "schulranzen", "mochila",
    ]),
    ("cleaning", [
        "clean*", "tidy*", "vacuum*", "hoover*", "dusting", "mop", "mopping",
        "sweep*", "dishes", "dishwasher", "nettoy*", "menage", "ranger",
        "rangement", "aspirateur", "vaisselle", "balayer", "limpi*", "ordenar",
        "aspiradora", "platos", "lavavajillas", "putzen", "aufraum*", "saugen",
        "staubsaug*", "spulen", "geschirr*", "wischen", "toys away",
        "ranger les jouets",
    ]),
    ("laundry", [
        "laundry", "washing", "lessive", "linge", "ropa", "lavadora",
        "wasche", "waschen", "iron", "ironing", "repassage", "repasser",
        "planchar", "bugeln", "dryer", "seche-linge", "secadora", "trockner",
        "fold clothes", "plier le linge", "doblar la ropa", "socks",
    ]),
    ("bins", [
        "bin", "bins", "trash", "garbage", "rubbish", "recycl*", "poubelle*",
        "basura", "reciclaje", "mull", "mulltonne", "papiertonne", "biotonne",
        "gelber sack", "compost", "recyclage",
    ]),
    ("bed", [
        "make the bed", "make your bed", "make my bed", "make bed", "bedtime",
        "bed time", "faire le lit", "faire son lit", "faire ton lit", "coucher",
        "dodo", "hacer la cama", "cama", "bett", "ins bett", "schlafen",
        "schlafenszeit", "bed", "sheets", "draps", "sabanas", "bettwasche",
        "nap", "sieste", "siesta", "pyjama*", "pajama*",
    ]),
    ("cooking", [
        "set the table", "mettre la table", "poner la mesa", "tisch decken",
        "cook*", "dinner", "lunch", "breakfast", "meal", "recipe", "cuisin*",
        "diner", "dejeuner", "petit-dejeuner", "petit dejeuner", "repas",
        "recette", "cocinar", "cena", "comida", "almuerzo", "desayuno",
        "receta", "kochen", "abendessen", "mittagessen", "fruhstuck", "rezept",
        "bake", "baking", "pizza", "bbq", "barbecue", "gouter", "snack",
        "merienda", "lunchbox", "lunch box", "packed lunch", "brotdose",
    ]),
    ("shopping", [
        "groceries", "grocery", "shopping", "supermarket", "supermarche",
        "courses", "compras", "supermercado", "einkauf*", "buy", "acheter",
        "comprar", "kaufen", "market", "marche", "mercado", "markt", "lidl",
        "aldi", "carrefour", "leclerc", "auchan", "tesco", "sainsbury*",
        "asda", "costco", "walmart", "mercadona", "rewe", "edeka", "ikea",
        "pharmacy run",
    ]),
    ("pet", [
        "walk the dog", "feed the cat", "feed the dog", "feed the fish",
        "promener le chien", "sortir le chien", "nourrir le chat",
        "pasear al perro", "gassi", "dog", "puppy", "cat", "kitten", "pet",
        "pets", "vet", "chien", "chat", "chaton", "chiot", "veterinaire",
        "veto", "perro", "gato", "mascota", "veterinario", "hund", "katze",
        "tierarzt", "hamster", "rabbit", "lapin", "conejo", "kaninchen",
        "litter", "litiere", "guinea pig", "cochon d'inde",
    ]),
    ("sport", [
        "football", "soccer", "foot", "futbol", "fussball", "basket",
        "basketball", "tennis", "swim*", "natation", "nadar", "schwimm*",
        "piscine", "piscina", "schwimmbad", "gym", "gymnastics", "gymnastique",
        "gimnasia", "turnen", "judo", "karate", "dance", "danse", "baile",
        "tanz*", "ballet", "practice", "entrainement", "entrenamiento",
        "training", "match", "rugby", "hockey", "athletics", "athletisme",
        "atletismo", "leichtathletik", "cycling", "velo", "bike", "bici",
        "fahrrad", "skating", "patin*", "ski", "climbing", "escalade",
        "escalada", "klettern", "yoga", "run", "running", "jogging",
        "tournament", "tournoi", "torneo", "turnier",
    ]),
    ("music", [
        "music", "musique", "musica", "musik", "piano", "guitar", "guitare",
        "guitarra", "gitarre", "violin", "violon", "violin", "geige", "drum*",
        "batterie", "bateria", "schlagzeug", "choir", "chorale", "coro",
        "chor", "concert", "concierto", "konzert", "recital", "solfege",
        "flute", "flote", "trumpet", "trompette", "trompeta", "trompete",
        "singing", "chant", "canto", "gesang",
    ]),
    ("travel", [
        "trip", "travel", "flight", "airport", "holiday", "holidays",
        "vacation", "voyage", "vol", "aeroport", "vacances", "train", "viaje",
        "vuelo", "aeropuerto", "vacaciones", "reise", "flug", "flughafen",
        "urlaub", "ferien", "hotel", "passport", "passeport", "pasaporte",
        "reisepass", "pack", "packing", "valise", "maleta", "koffer",
        "camping", "weekend away", "airbnb", "ferry", "boarding pass",
        "suitcase",
    ]),
    ("party", [
        "party", "fete", "fiesta", "feier", "celebration", "celebracion",
        "wedding", "mariage", "boda", "hochzeit", "anniversary", "baptism",
        "bapteme", "bautizo", "taufe", "communion", "playdate", "play date",
        "sleepover", "soiree", "halloween", "christmas", "noel", "navidad",
        "weihnachten", "easter", "paques", "pascua", "ostern", "carnival",
        "carnaval", "karneval", "new year", "nouvel an", "silvester",
        "invitation", "invitacion", "einladung",
    ]),
    ("gift", [
        "gift", "gifts", "present", "presents", "cadeau*", "regalo*",
        "geschenk*", "wrap", "wrapping", "emballer", "envolver", "einpacken",
        "wishlist", "wish list",
    ]),
    ("money", [
        "pocket money", "argent de poche", "paga", "taschengeld", "allowance",
        "pay", "payment", "bill", "bills", "invoice", "rent", "tax", "taxes",
        "bank", "budget", "insurance", "payer", "paiement", "facture*",
        "loyer", "impot*", "banque", "assurance", "pagar", "pago", "factura*",
        "alquiler", "impuesto*", "banco", "seguro", "zahlen", "bezahlen",
        "rechnung*", "miete", "steuer*", "versicherung", "subscription",
        "abonnement", "suscripcion", "abo", "mortgage", "hypotheque",
        "hipoteca", "hypothek", "refund", "remboursement", "reembolso",
        "salary", "salaire", "sueldo", "gehalt", "transfer", "virement",
        "transferencia", "uberweisung",
    ]),
]


def _fold(text: str) -> str:
    """Lower-case, accent-stripped, ß→ss, so "Gâteau" and "gateau" agree."""
    text = (text or "").replace("ß", "ss")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return text.lower()


def _pattern(word: str) -> re.Pattern:
    stem = word.endswith("*")
    body = re.escape(_fold(word.rstrip("*")))
    # Spaces in a phrase match any run of whitespace or hyphens.
    body = body.replace(r"\ ", r"[\s\-]+")
    tail = r"\w*" if stem else r"(?!\w)"
    return re.compile(r"(?<!\w)" + body + tail)


def _compile():
    phrases, words = [], []
    for key, entries in _KEYWORDS:
        for word in entries:
            target = phrases if " " in word or "-" in word else words
            target.append((key, _pattern(word)))
    return phrases, words


_PHRASES, _WORDS = _compile()


def guess_icon(title: str, card_type: Optional[str] = None) -> Optional[str]:
    """The icon key a title suggests, or None when nothing in it is sure.

    None is a real answer: a card with no icon looks exactly as it did
    before icons existed. A wrong guess is worse than no guess, which is why
    only the title is read — a description is where people put the
    ambiguity ("after the dentist, buy a cake") — and why the type is only
    consulted when the words said nothing.
    """
    text = _fold(title)
    if text:
        for key, pattern in _PHRASES:
            if pattern.search(text):
                return key
        for key, pattern in _WORDS:
            if pattern.search(text):
                return key
    return TYPE_ICONS.get((card_type or "").upper())


class UnknownIcon(ValueError):
    pass


def normalize_icon(value) -> Optional[str]:
    """A key the app may store, or None to mean "no icon".

    Accepts the key ("birthday") or its glyph ("🎂"), since a client that
    shows the glyph will sometimes send it back. Anything else is refused
    rather than stored: a card carrying "bithday" would render blank on
    every screen and nothing would ever say why.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    key = text.lower()
    if key in ICONS:
        return key
    if text in _GLYPH_TO_KEY:
        return _GLYPH_TO_KEY[text]
    raise UnknownIcon(text)
