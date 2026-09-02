"""The App Store listing, held to Apple's limits.

A field over its limit is not rejected — it is truncated, silently, and the
tail simply never ranks. Nothing tells you. The listing therefore lives in
docs/APP_STORE_LISTING.md and is checked here, so an edit that overflows a
field fails the build rather than quietly costing search coverage.

Also checked: the things that waste characters rather than break anything.
Apple indexes name + subtitle + keywords TOGETHER, so a word already spent in
the name earns nothing in the keyword field; and Apple builds phrases from
single terms itself, so a multi-word entry is paid for twice.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import re
import unicodedata
import unittest

DOC = os.path.join(os.path.dirname(__file__), "..", "docs", "APP_STORE_LISTING.md")

# Apple's limits, in characters.
LIMITS = {
    "Name": 30,
    "Subtitle": 30,
    "Keywords": 100,
    "Promotional Text": 170,
    "Description": 4000,
}


def listing():
    """Parse the doc into {locale: {field: value}}.

    Reads the same document a person edits, rather than a second copy that
    would drift from it.
    """
    with open(DOC, encoding="utf-8") as fh:
        text = fh.read()
    out, locale = {}, None
    # "## English (U.S.) — live"  /  "#### Name" then a fenced block.
    for match in re.finditer(
        r"^## (?!How|Where|Still)(.+?)$|^#### (.+?)\n```\n(.*?)\n```",
        text, re.M | re.S,
    ):
        if match.group(1):
            locale = match.group(1).split("—")[0].strip()
            out[locale] = {}
        elif locale:
            out[locale][match.group(2).strip()] = match.group(3)
    return out


def forms(word):
    """Word shapes two entries could collide on.

    A single stemming regex gets this wrong: r"(s|es)$" turns "chores" into
    "chor" while "chore" stays "chore", so a real duplicate never matches.
    Comparing sets has no such ordering trap.
    """
    w = unicodedata.normalize("NFD", word.lower())
    w = "".join(c for c in w if unicodedata.category(c) != "Mn")
    shapes = {w, w + "s"}
    for suffix in ("s", "es"):
        if w.endswith(suffix) and len(w) > len(suffix) + 1:
            shapes.add(w[: -len(suffix)])
    return shapes


def collide(a, b):
    return bool(forms(a) & forms(b))


class TheListing(unittest.TestCase):
    def setUp(self):
        self.locales = listing()

    def test_the_document_parses_into_locales(self):
        # If this breaks, the doc's shape changed and every check below would
        # otherwise pass by examining nothing.
        self.assertIn("English (U.S.)", self.locales)
        self.assertIn("French (France)", self.locales)
        for name, fields in self.locales.items():
            self.assertIn("Keywords", fields, "%s has no keywords" % name)

    def test_no_field_is_over_its_limit(self):
        for locale, fields in self.locales.items():
            for field, value in fields.items():
                limit = LIMITS.get(field)
                if limit is None:
                    continue
                self.assertLessEqual(
                    len(value), limit,
                    "%s / %s is %d characters, %d over — Apple truncates it "
                    "silently" % (locale, field, len(value), len(value) - limit))

    def test_keywords_waste_nothing(self):
        for locale, fields in self.locales.items():
            kws = [k for k in fields["Keywords"].split(",") if k]
            self.assertGreater(len(kws), 5, "%s has too few keywords" % locale)

            for keyword in kws:
                self.assertNotIn(
                    " ", keyword,
                    "%s: '%s' is a phrase — Apple combines single terms itself"
                    % (locale, keyword))

            for i, keyword in enumerate(kws):
                for earlier in kws[:i]:
                    self.assertFalse(
                        collide(keyword, earlier),
                        "%s: '%s' duplicates '%s'" % (locale, keyword, earlier))

            spent = re.findall(
                r"\w+", fields.get("Name", "") + " " + fields.get("Subtitle", ""))
            for keyword in kws:
                for word in spent:
                    self.assertFalse(
                        collide(keyword, word),
                        "%s: '%s' is already in the name or subtitle (as '%s') — "
                        "Apple indexes them together, so it earns nothing"
                        % (locale, keyword, word))

    def test_keywords_have_no_space_after_the_comma(self):
        # Each one is a character spent on nothing.
        for locale, fields in self.locales.items():
            self.assertNotIn(", ", fields["Keywords"],
                             "%s wastes characters on spaces" % locale)

    def test_the_two_deliberate_omissions_stay_omitted(self):
        """Both were removed for meaning, and both look like obvious additions.

        "planning familial" is the French term for a family-planning clinic,
        not a family schedule. "Amme" is a wet nurse, not a childminder.
        """
        french = self.locales["French (France)"]["Keywords"]
        self.assertNotIn("planning", french)
        german = self.locales["German"]["Keywords"]
        self.assertFalse(
            any(collide(k, "amme") for k in german.split(",")))


class TheStemmer(unittest.TestCase):
    """The collision check the waste rules depend on."""

    def test_it_catches_plurals(self):
        for a, b in (("chore", "chores"), ("kid", "kids"), ("tarea", "tareas")):
            self.assertTrue(collide(a, b), "%s vs %s" % (a, b))

    def test_it_ignores_accents(self):
        self.assertTrue(collide("corvée", "corvee"))

    def test_it_does_not_collide_unrelated_words(self):
        # A check that flags everything is as useless as one that flags nothing.
        for a, b in (("liste", "list"), ("garde", "gardien"), ("maison", "menage")):
            self.assertFalse(collide(a, b), "%s vs %s" % (a, b))


if __name__ == "__main__":
    unittest.main()
