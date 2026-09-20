"""Suggested spices are separate from what the dish needs, and always visible.

Asked for because a plain recipe tastes plain — and bounded the way it is
because taste in a household is not one person's. Somebody who cannot stand
coriander, or cannot eat chilli, has to be able to SEE what was suggested and
leave it out. That is only possible while these stay out of the ingredients
list and out of the steps, which is what these tests hold in place.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from ai_safety import RECIPE_SYSTEM_PROMPT, _validate_seasoning, MAX_SEASONING


class WhatSurvivesValidation(unittest.TestCase):
    def test_a_well_formed_suggestion_is_kept(self):
        out = _validate_seasoning(
            [{"name": "Smoked paprika", "note": "warmth, not heat"}], [])
        self.assertEqual(out, [{"name": "Smoked paprika", "note": "warmth, not heat",
                                "optional": True}])

    def test_optional_is_ours_to_decide_not_the_model_s(self):
        # Everything here is optional by construction. Taking the flag on
        # trust would let one arrive as required, which the app would then
        # render as part of the recipe — the exact failure this split exists
        # to prevent.
        out = _validate_seasoning(
            [{"name": "Chilli flakes", "note": "heat; leave out for children",
              "optional": False}], [])
        self.assertTrue(out[0]["optional"])

    def test_a_suggestion_the_dish_already_contains_is_dropped(self):
        # Suggesting the garlic already in the pan reads as a mistake, and
        # makes the list of "what was added" untrue.
        out = _validate_seasoning(
            [{"name": "Garlic", "note": "depth"}],
            [{"name": "garlic", "qty": 2, "unit": "clove"}])
        self.assertEqual(out, [])

    def test_a_repeat_of_itself_is_dropped(self):
        out = _validate_seasoning(
            [{"name": "Thyme", "note": "woody"}, {"name": "thyme", "note": "again"}], [])
        self.assertEqual(len(out), 1)

    def test_a_suggestion_with_no_reason_is_dropped(self):
        # A name with no note is a spice the cook cannot judge without having
        # tasted it, which is not a suggestion, it is an instruction.
        self.assertEqual(_validate_seasoning([{"name": "Cumin"}], []), [])
        self.assertEqual(_validate_seasoning([{"name": "Cumin", "note": "  "}], []), [])

    def test_a_nameless_suggestion_is_dropped(self):
        self.assertEqual(_validate_seasoning([{"note": "lovely"}], []), [])

    def test_rubbish_is_dropped_rather_than_fatal(self):
        # A missing suggestion costs a slightly duller dinner. Refusing the
        # whole recipe over one costs the dinner.
        self.assertEqual(_validate_seasoning("not a list", []), [])
        self.assertEqual(_validate_seasoning([None, 7, "salt"], []), [])

    def test_the_list_is_bounded(self):
        many = [{"name": f"Spice {n}", "note": "lifts it"} for n in range(12)]
        self.assertEqual(len(_validate_seasoning(many, [])), MAX_SEASONING)

    def test_a_model_s_own_bullet_is_stripped(self):
        out = _validate_seasoning([{"name": "- Sumac", "note": "1. sharp"}], [])
        self.assertEqual(out[0]["name"], "Sumac")
        self.assertEqual(out[0]["note"], "sharp")


class WhatThePromptAsksFor(unittest.TestCase):
    # The prompt is wrapped prose, so a phrase can straddle a newline. Compare
    # on collapsed whitespace: a test that breaks when a line is rewrapped
    # teaches people to stop editing the prompt.
    FLAT = " ".join(RECIPE_SYSTEM_PROMPT.split())

    def assertAsks(self, phrase: str):
        self.assertIn(" ".join(phrase.split()), self.FLAT)
    def test_it_asks_for_suggestions_that_are_kept_separate(self):
        self.assertAsks('"seasoning"')
        self.assertAsks("SEPARATE from the ingredients")

    def test_it_forbids_hiding_one_in_the_recipe_proper(self):
        # A suggestion the cook cannot identify is one they cannot refuse.
        self.assertAsks('Never put an optional spice in "ingredients"')
        self.assertAsks("never hide one inside a step")

    def test_it_asks_for_a_reason_the_cook_can_judge(self):
        self.assertAsks('"note"')

    def test_it_says_to_flag_heat(self):
        # "Some people don't like certain spices" includes the ones that hurt.
        self.assertAsks("where something is hot say so")

    def test_it_still_declares_seasoning_in_the_returned_keys(self):
        # A key the prompt never names is a key the model never returns.
        head = RECIPE_SYSTEM_PROMPT[:RECIPE_SYSTEM_PROMPT.index("- \"servings\"")]
        self.assertIn('"seasoning"', head)


if __name__ == "__main__":
    unittest.main()
