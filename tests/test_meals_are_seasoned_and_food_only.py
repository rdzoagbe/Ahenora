"""Meal ideas use food only, and every savoury recipe is seasoned.

Roland, 2026-10-02: "verify that the meals recipes generated from shopping
list all have good seasoning? Also when I click on generate meals for the
week does it make the difference between what can be cooked and what not?"

Run with:  python3 -m unittest tests.test_meals_are_seasoned_and_food_only -v
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

try:
    import fastapi  # noqa: F401
    HAVE = True
except ImportError:
    HAVE = False

if HAVE:
    import server
    import ai_safety


def ing(*names):
    return {"steps": ["x" * 20] * 3,
            "ingredients": [{"name": n, "qty": 1, "unit": "piece"} for n in names]}


@unittest.skipUnless(HAVE, "backend deps not installed")
class OnlyFoodIsPlannedWith(unittest.TestCase):
    def test_household_toiletries_baby_and_school_items_are_left_out(self):
        for name in ("toilet paper", "washing liquid", "lessive", "eau de javel",
                     "shampoo", "dentifrice", "Pampers", "cat food", "cahiers"):
            self.assertFalse(server.cookable_item(name), name)

    def test_food_and_unknown_items_stay_in(self):
        for name in ("chicken thigh", "tomatoes", "rice", "plantain", "yam",
                     "orange juice", "present for Ama"):
            self.assertTrue(server.cookable_item(name), name)

    def test_the_model_is_told_to_ignore_what_is_not_food(self):
        self.assertIn("Only FOOD goes into a dinner", ai_safety.SUGGEST_SYSTEM_PROMPT)


@unittest.skipUnless(HAVE, "backend deps not installed")
class EverySavouryRecipeIsSeasoned(unittest.TestCase):
    def names(self, recipe):
        return [i["name"] for i in recipe["ingredients"]]

    def test_an_unseasoned_recipe_gets_salt_and_pepper_in_its_language(self):
        self.assertEqual(self.names(ai_safety.ensure_seasoned(ing("Chicken", "Rice"), "en"))[-2:],
                         ["Salt", "Black pepper"])
        self.assertEqual(self.names(ai_safety.ensure_seasoned(ing("Poulet", "Riz"), "fr"))[-2:],
                         ["Sel", "Poivre noir"])
        added = ai_safety.ensure_seasoned(ing("Pollo"), "es")["ingredients"][-1]
        self.assertEqual((added["qty"], added["unit"]), (0, "to taste"))

    def test_a_seasoned_recipe_is_left_alone(self):
        for names in (("Chicken", "Salt", "Black pepper"), ("Beef", "Soy sauce"),
                      ("Okra", "Stock cube"), ("Hähnchen", "Salz")):
            recipe = ing(*names)
            self.assertEqual(ai_safety.ensure_seasoned(recipe, "en"), recipe, names)

    def test_pepper_alone_still_gets_salt(self):
        self.assertEqual(self.names(ai_safety.ensure_seasoned(ing("Fish", "Pepper"), "en")),
                         ["Fish", "Pepper", "Salt"])

    def test_a_sweet_dish_is_not_salted_and_peppered(self):
        recipe = ing("Flour", "Sugar", "Eggs")
        self.assertEqual(ai_safety.ensure_seasoned(recipe, "en"), recipe)

    def test_a_recipe_without_ingredients_is_untouched(self):
        self.assertEqual(ai_safety.ensure_seasoned({"steps": []}, "en"), {"steps": []})


if __name__ == "__main__":
    unittest.main()
