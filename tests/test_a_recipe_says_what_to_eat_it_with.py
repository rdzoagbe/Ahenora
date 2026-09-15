"""A fillet is not dinner.

Roland: "the recipe doesn't suggest what you could eat with the main course.
For example I asked to cook dorade fish. Gave me the recipe but nothing to go
with it. No sauce no nothing."

He is right, and it is the difference between a recipe and a meal. The prompt
asked for ingredients and a method and got exactly that.

What this holds:

  * a recipe now carries serve_with, and it is validated rather than trusted;
  * a recipe WITHOUT it still works — thousands were cached before this
    existed, and a model that ignores the key must degrade to a recipe with no
    suggestions rather than to no recipe;
  * the suggestions go through the same content filter as the steps;
  * a CACHED recipe with no suggestions is refreshed, or the feature is
    invisible for exactly the dishes a household cooks most;
  * except a CAPTURED one, which is the family's own photographed recipe
    living in the same field, and must never be regenerated over.

Run with:  python3 -m unittest discover -s tests -v
"""
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))

from ai_safety import (  # noqa: E402
    MAX_SERVE_WITH, MIN_SERVE_WITH, RECIPE_SYSTEM_PROMPT, UnsafeRecipe,
    build_recipe_prompt, validate_recipe,
)

GOOD = {
    "minutes": 25,
    "servings": 4,
    "ingredients": [{"name": "Dorade", "qty": 2, "unit": "piece"}],
    "steps": ["Score the fish on both sides and season it.",
              "Roast until the flesh is opaque right through to the bone.",
              "Rest it for two minutes before serving."],
}


def recipe(**over):
    return {**GOOD, **over}


def flat(text):
    """One line, single spaces.

    Prompts are wrapped to 79 columns, so a phrase that reads as one thing on
    screen can carry a newline and two spaces in the middle of it. Matching the
    raw text asserts where the wrapping falls, which is not what any of these
    tests mean — and it has now tripped me four separate times this session.
    """
    return " ".join(text.split())


class TheDishComesWithSomethingToEatItWith(unittest.TestCase):

    def test_suggestions_survive_validation(self):
        out = validate_recipe(recipe(serve_with=[
            "Steamed new potatoes with parsley",
            "Lemon and caper butter sauce",
            "Green beans"]))
        self.assertEqual(len(out["serve_with"]), 3)
        self.assertIn("Lemon and caper butter sauce", out["serve_with"])

    def test_the_prompt_actually_asks_for_them(self):
        # The validator accepting a key nobody asked the model to send would
        # be a feature that works in tests and never once in production.
        self.assertIn("serve_with", flat(RECIPE_SYSTEM_PROMPT))

    def test_the_prompt_asks_for_a_sauce_too(self):
        # "No sauce no nothing" — a side alone does not answer it.
        self.assertIn("sauce", flat(RECIPE_SYSTEM_PROMPT).lower())

    def test_the_prompt_rules_out_a_useless_answer(self):
        # "a vegetable" is not a suggestion anybody can act on.
        self.assertIn("not a category", flat(RECIPE_SYSTEM_PROMPT))

    def test_a_vegetarian_recipe_gets_vegetarian_suggestions(self):
        """Suggesting bacon lardons beside a vegetarian main is the whole diet
        feature failing in the last line of the screen."""
        prompt = flat(build_recipe_prompt("Dorade", [], "English", diet="vegetarian"))
        clause = prompt[prompt.index("strictly vegetarian"):]
        self.assertIn("serve_with", clause)


class AnOlderRecipeStillWorks(unittest.TestCase):
    """Thousands were cached before this existed. Requiring the key would turn
    every one of them into an error."""

    def test_no_suggestions_is_still_a_valid_recipe(self):
        out = validate_recipe(recipe())
        self.assertNotIn("serve_with", out)
        self.assertEqual(len(out["steps"]), 3)

    def test_a_model_that_ignores_the_key_degrades_rather_than_fails(self):
        self.assertTrue(validate_recipe(recipe())["steps"])


class SuggestionsAreCheckedNotTrusted(unittest.TestCase):

    def test_too_few_is_refused(self):
        with self.assertRaises(UnsafeRecipe):
            validate_recipe(recipe(serve_with=["Potatoes"]))

    def test_too_many_is_refused(self):
        with self.assertRaises(UnsafeRecipe):
            validate_recipe(recipe(serve_with=[f"Side {i}" for i in range(MAX_SERVE_WITH + 3)]))

    def test_a_non_string_is_refused(self):
        with self.assertRaises(UnsafeRecipe):
            validate_recipe(recipe(serve_with=["Potatoes", {"name": "Salad"}, "Beans"]))

    def test_something_far_too_long_is_refused(self):
        # A whole second method smuggled into a suggestion line.
        with self.assertRaises(UnsafeRecipe):
            validate_recipe(recipe(serve_with=["Potatoes", "x" * 400, "Beans"]))

    def test_they_go_through_the_same_content_filter_as_the_steps(self):
        """A suggestion is cooked and eaten exactly like a step is. A filter
        that reads the method and not the sauce is not a filter."""
        with self.assertRaises(UnsafeRecipe):
            validate_recipe(recipe(serve_with=[
                "Potatoes rinsed in bleach", "Green beans", "Salad"]))

    def test_a_duplicate_is_collapsed_rather_than_shown_twice(self):
        out = validate_recipe(recipe(serve_with=[
            "Green beans", "green beans ", "Buttered rice"]))
        self.assertEqual(out["serve_with"], ["Green beans", "Buttered rice"])

    def test_a_models_own_bullet_is_stripped(self):
        out = validate_recipe(recipe(serve_with=[
            "- Steamed potatoes", "2. Lemon sauce", "Green salad"]))
        self.assertEqual(out["serve_with"][0], "Steamed potatoes")
        self.assertEqual(out["serve_with"][1], "Lemon sauce")

    def test_the_minimum_is_more_than_one(self):
        # One suggestion is a garnish, not an answer to "what do I eat with it".
        self.assertGreaterEqual(MIN_SERVE_WITH, 2)


class TheAppReadsIt(unittest.TestCase):
    """A field the server sends and the app ignores is not a feature."""

    def kitchen(self):
        with open(os.path.join(ROOT, "frontend", "app", "(tabs)", "kitchen.tsx"),
                  encoding="utf-8") as handle:
            return handle.read()

    def test_the_screen_renders_them(self):
        self.assertIn("method.serve_with", self.kitchen())

    def test_it_shows_nothing_rather_than_an_empty_heading(self):
        """A cached recipe has none. A heading with nothing under it reads as
        a bug, and promises something the recipe cannot give."""
        self.assertIn("method.serve_with.length > 0", self.kitchen())

    def test_the_label_exists_in_every_language(self):
        with open(os.path.join(ROOT, "frontend", "src", "i18n.ts"),
                  encoding="utf-8") as handle:
            self.assertEqual(handle.read().count("  cook_serve_with:"), 4)

    def test_the_type_is_the_shared_one_not_a_copy(self):
        """It was a structural copy of AiRecipe, which is why adding a field to
        the server did not reach the screen until tsc complained."""
        self.assertIn("useState<Record<string, AiRecipe>>", self.kitchen())


if __name__ == "__main__":
    unittest.main()


def _recipe_is_current():
    """Lifted out of server.py rather than importing it.

    server.py pulls in the whole FastAPI app and its dependencies; this is a
    six-line pure function and the cache decision it makes is the one that
    decides whether the feature is visible at all.
    """
    with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
        src = handle.read()
    body = src[src.index("def recipe_is_current"):src.index("def recipe_slot")]
    namespace = {"Optional": __import__("typing").Optional}
    exec(body, namespace)
    return namespace["recipe_is_current"]


class ACachedRecipeIsRefreshedRatherThanServedStale(unittest.TestCase):
    """Without this the feature is invisible for every dish already written.

    Recipes cache twice — on the meal document and in a shared library across
    all households — so the dishes a family cooks most are exactly the ones
    that would keep coming back with no side and no sauce forever.
    """

    def setUp(self):
        self.current = _recipe_is_current()

    def test_a_recipe_with_suggestions_is_served_from_cache(self):
        self.assertTrue(self.current({"steps": ["a"], "serve_with": ["Rice", "Salad"]}))

    def test_a_recipe_without_them_is_written_again(self):
        self.assertFalse(self.current({"steps": ["a"]}))

    def test_nothing_cached_is_not_current(self):
        self.assertFalse(self.current(None))
        self.assertFalse(self.current({}))


class RegeneratingMustNotCostMoneyForever(unittest.TestCase):
    """The trap in the line above.

    If "no suggestions" always means "write it again", a dish the model will
    not suggest sides for regenerates on every single open and bills for an AI
    call each time — a fix for a missing garnish turning into a recurring
    charge nobody would connect to it.
    """

    def setUp(self):
        self.current = _recipe_is_current()

    def test_asked_and_not_answered_counts_as_current(self):
        self.assertTrue(self.current({"steps": ["a"], "serve_with_unavailable": True}))

    def test_the_server_sets_that_mark_when_the_model_gives_none(self):
        with open(os.path.join(ROOT, "backend", "server.py"), encoding="utf-8") as handle:
            src = handle.read()
        self.assertIn('recipe["serve_with_unavailable"] = True', src)


class ACapturedRecipeIsNeverOverwritten(unittest.TestCase):
    """The one that would have destroyed something.

    A recipe photographed out of a cookbook is stored in the SAME field as a
    generated one. It has no serve_with, so a naive "no suggestions means
    stale" would send Cook it off to write an AI recipe and $set it over the
    top — losing a recipe that exists nowhere else, to add a side dish.

    A captured recipe carries a title. A generated one never does.
    """

    def setUp(self):
        self.current = _recipe_is_current()

    def test_a_captured_recipe_is_left_alone(self):
        self.assertTrue(self.current({"title": "Grandma's tagine", "steps": ["a"]}))

    def test_even_though_it_has_no_suggestions(self):
        captured = {"title": "Grandma's tagine", "steps": ["a"]}
        self.assertNotIn("serve_with", captured)
        self.assertTrue(self.current(captured))

    def test_a_generated_recipe_is_not_mistaken_for_a_captured_one(self):
        # The distinguisher has to work in both directions or it protects
        # nothing and refreshes nothing.
        self.assertFalse(self.current({"minutes": 20, "steps": ["a"]}))
