"""A photographed recipe is repaired, not rejected.

Reported from a real phone on 2026-09-29: "Fleurs de courgettes à la romaine",
photographed from a cookbook, became a task in the feed with every ingredient
lost. The camera had recognised the recipe; the second read failed the recipe
gate, which was written for recipes the app WRITES (where the model controls
units and length) and threw the whole page away over one line it did not like
— "c. à soupe", "15 cl", "6 filets", "sel, poivre", a nine-step method.

These pin that the shape of a real cookbook page is repaired, while the
substance is not:
  * a unit the planner does not know is converted where it can be (cl -> ml,
    c. à soupe -> tbsp, a cup -> ml) and otherwise kept without an amount;
  * a long method is merged into the planner's eight steps, never dropped;
  * a missing or impossible cooking time becomes a default;
  * the food-safety screen and a refusal still fail exactly as before.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from ai_safety import (  # noqa: E402
    MAX_STEPS, UnsafeRecipe, repair_captured_recipe, validate_captured_recipe,
)

COURGETTES = {
    "title": "Fleurs de courgettes à la romaine", "minutes": "25", "servings": 4,
    "ingredients": [
        {"name": "fleurs de courgettes", "qty": 12, "unit": "pièces"},
        {"name": "mozzarella", "qty": 125, "unit": "g"},
        {"name": "anchois", "qty": 6, "unit": "filets"},
        {"name": "farine", "qty": 100, "unit": "g"},
        {"name": "eau gazeuse glacée", "qty": 15, "unit": "cl"},
        {"name": "huile de friture", "qty": None, "unit": ""},
        {"name": "sel", "qty": 1, "unit": "pincée"},
        {"name": "huile d'olive", "qty": 2, "unit": "c. à soupe"},
    ],
    "steps": [
        "Nettoyez les fleurs.",
        "Coupez la mozzarella en bâtonnets et glissez-en un dans chaque fleur avec un anchois.",
        "Préparez la pâte en mélangeant la farine et l'eau gazeuse glacée.",
        "Chauffez l'huile.", "Trempez les fleurs dans la pâte.", "Faites frire 2 minutes.",
        "Égouttez sur du papier absorbant.", "Salez.",
        "Servez aussitôt, bien chaud, avec des quartiers de citron.",
    ],
}


def by_name(recipe):
    return {i["name"]: i for i in recipe["ingredients"]}


class TheReportedPage(unittest.TestCase):
    def setUp(self):
        self.recipe = validate_captured_recipe(COURGETTES)

    def test_it_is_a_recipe_now(self):
        self.assertEqual(self.recipe["title"], "Fleurs de courgettes à la romaine")
        self.assertEqual(len(self.recipe["ingredients"]), 8, "no ingredient is lost")

    def test_cookbook_units_are_converted(self):
        items = by_name(self.recipe)
        self.assertEqual(items["eau gazeuse glacée"], {"name": "eau gazeuse glacée", "qty": 150, "unit": "ml"})
        self.assertEqual(items["huile d'olive"]["unit"], "tbsp")
        self.assertEqual(items["sel"]["unit"], "pinch")
        self.assertEqual(items["anchois"], {"name": "anchois", "qty": 6, "unit": "piece"})
        self.assertEqual(items["fleurs de courgettes"]["unit"], "piece")

    def test_an_amount_it_cannot_read_keeps_the_ingredient(self):
        self.assertEqual(by_name(self.recipe)["huile de friture"]["unit"], "to taste")

    def test_a_long_method_is_merged_not_dropped(self):
        self.assertLessEqual(len(self.recipe["steps"]), MAX_STEPS)
        method = " ".join(self.recipe["steps"])
        self.assertIn("quartiers de citron", method, "the last step survived")

    def test_the_time_is_kept(self):
        self.assertEqual(self.recipe["minutes"], 25)


class TheRepairsThemselves(unittest.TestCase):
    def test_an_unknown_unit_is_kept_without_an_amount(self):
        out = repair_captured_recipe({"ingredients": [{"name": "persil", "qty": 1, "unit": "poignée"}]})
        self.assertEqual(out["ingredients"], [{"name": "persil", "qty": 0, "unit": "to taste"}])

    def test_an_absurd_amount_is_kept_without_it(self):
        out = repair_captured_recipe({"ingredients": [{"name": "sucre", "qty": 90000, "unit": "g"}]})
        self.assertEqual(out["ingredients"][0]["unit"], "to taste")

    def test_a_bare_string_is_an_ingredient(self):
        out = repair_captured_recipe({"ingredients": ["sel", "poivre"]})
        self.assertEqual([i["name"] for i in out["ingredients"]], ["sel", "poivre"])

    def test_an_overlong_step_is_cut_at_a_sentence(self):
        long_step = ("Mélangez bien. " * 30).strip()
        out = repair_captured_recipe({"steps": [long_step]})
        self.assertLessEqual(len(out["steps"][0]), 240)
        self.assertTrue(out["steps"][0].endswith("."))

    def test_a_missing_time_gets_a_default(self):
        self.assertEqual(repair_captured_recipe({"minutes": None})["minutes"], 30)
        self.assertEqual(repair_captured_recipe({"minutes": 9999})["minutes"], 30)


class WhatIsNotRepaired(unittest.TestCase):
    def test_a_refusal_is_still_a_refusal(self):
        with self.assertRaises(UnsafeRecipe):
            validate_captured_recipe({"refused": True})

    def test_the_food_safety_screen_still_applies(self):
        bad = dict(COURGETTES)
        bad["steps"] = COURGETTES["steps"][:3] + ["Ajoutez une goutte de javel dans la pâte."]
        with self.assertRaises(UnsafeRecipe) as caught:
            validate_captured_recipe(bad)
        self.assertEqual(caught.exception.reason, "blocked content")

    def test_a_page_with_no_ingredients_is_still_not_a_recipe(self):
        with self.assertRaises(UnsafeRecipe):
            validate_captured_recipe({"title": "Rien", "minutes": 10, "steps": COURGETTES["steps"][:4],
                                      "ingredients": []})

    def test_too_little_method_is_still_not_a_recipe(self):
        with self.assertRaises(UnsafeRecipe):
            validate_captured_recipe({"title": "Rien", "minutes": 10, "steps": ["Mélangez tout."],
                                      "ingredients": [{"name": "farine", "qty": 100, "unit": "g"}]})


if __name__ == "__main__":
    unittest.main()
