"""A dish is written once, not once per household per week.

A subscriber on 100 AI scans a month ran out preparing the week's meals. Not by
overusing anything — recipes cached on the MEAL DOCUMENT, so reopening a planned
meal was free, but next week is new meal documents. The same seven dinners were
generated and charged again every week, and every household paid separately for
the same "poulet rôti".

A recipe is written from the dish name, the language and the diet. It contains
nothing about the household that asked, so it can be shared: the library is
keyed on the dish, and the second household to want a dish pays nothing.
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server


@unittest.skipUnless(HAVE_DEPS, "fastapi not installed")
class TheRecipeLibraryKey(unittest.TestCase):
    def test_the_same_dish_written_differently_is_one_entry(self):
        # Accents and capitals are how the same dinner gets typed twice. If they
        # keyed separately the library would fill up with duplicates and charge
        # for every one of them.
        a = server.recipe_library_key("Poulet Rôti", "fr", "")
        b = server.recipe_library_key("  poulet roti  ", "fr", "")
        c = server.recipe_library_key("POULET-RÔTI!", "fr", "")
        self.assertEqual(a, b)
        self.assertEqual(a, c)

    def test_language_and_diet_are_part_of_the_dish(self):
        # A vegetarian rewrite is a different recipe, and a French recipe is not
        # an English one. Sharing across either would serve the wrong thing.
        base = server.recipe_library_key("lasagne", "fr", "")
        self.assertNotEqual(base, server.recipe_library_key("lasagne", "en", ""))
        self.assertNotEqual(base, server.recipe_library_key("lasagne", "fr", "vegetarian"))

    def test_a_sentence_somebody_typed_never_becomes_a_shared_key(self):
        # The box takes free text. A dish name is short; anything long enough to
        # be a note stays out of a library other households read from.
        long_enough_to_be_a_note = "a" * (server.RECIPE_KEY_MAX + 1)
        self.assertIsNone(server.recipe_library_key(long_enough_to_be_a_note, "en", ""))

    def test_nothing_too_short_to_be_a_dish(self):
        for junk in ("", "  ", "a", "!!", "  ?  "):
            self.assertIsNone(server.recipe_library_key(junk, "en", ""))


@unittest.skipUnless(HAVE_DEPS, "fastapi not installed")
class TheLibraryItself(unittest.TestCase):
    def test_a_missing_key_reads_as_a_miss_rather_than_an_error(self):
        import asyncio

        class NoDatabase:
            def __getitem__(self, _name):
                raise AssertionError("a null key must not reach the database")

        # None means "do not share this one" — it must short-circuit before any
        # lookup, not go and ask for a document called None.
        got = asyncio.run(server.recipe_from_library(NoDatabase(), None))
        self.assertIsNone(got)

    def test_a_failed_write_never_costs_the_reader_their_recipe(self):
        import asyncio

        class BrokenDatabase:
            def __getitem__(self, _name):
                raise RuntimeError("library unavailable")

        # The family can already read this recipe. Losing the shared copy is a
        # missed saving; raising here would turn it into a failed request.
        asyncio.run(server.store_recipe_in_library(BrokenDatabase(), "k", {"steps": ["x"]}))
