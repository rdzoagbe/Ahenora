"""A cake's flour and sugar come in grams, not "×2½".

A gâteau au yaourt is traditionally measured in yoghurt pots. The recipe
writer had no "pot" unit, so it wrote flour, sugar and oil as pieces, and the
recipe read "farine de blé ×2½": nobody can shop or bake from that. Now the
prompt forbids it, the server asks once more when the model does it anyway,
and recipes saved before the rule are written again the next time they open.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import json
import os
import sys
import unittest

ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, os.path.join(ROOT, "backend"))
sys.path.insert(0, os.path.join(ROOT, "scripts"))

try:
    import fastapi  # noqa: F401
    HAVE_DEPS = True
except ImportError:
    HAVE_DEPS = False

if HAVE_DEPS:
    import server
    from ai_safety import weighed_as_pieces, RECIPE_SYSTEM_PROMPT, RECIPE_PHOTO_SYSTEM_PROMPT

from fake_mongo import FakeDatabase  # noqa: E402

USER = {"user_id": "u1", "family_id": "fam_1", "email": "a@b.test", "name": "Roland"}


def run(coro):
    return asyncio.run(coro)


def recipe(*ings, serve_with=True):
    out = {"minutes": 40, "servings": 4, "steps": [
        "Préchauffez le four à 180°C et beurrez un moule rond.",
        "Mélangez le yaourt, le sucre et les œufs dans un grand bol.",
        "Ajoutez la farine, la levure et l'huile, puis mélangez bien.",
        "Versez dans le moule et faites cuire environ 35 minutes."],
           "ingredients": [{"name": n, "qty": q, "unit": u} for n, q, u in ings]}
    if serve_with:
        out["serve_with"] = ["Crème anglaise", "Fruits rouges"]
    return out


POTS = recipe(("yaourt nature", 1, "piece"), ("sucre en poudre", 2, "piece"),
              ("farine de blé", 3, "piece"), ("huile de tournesol", 0.5, "piece"),
              ("œuf", 3, "piece"), ("sachet de levure chimique", 1, "piece"))
GRAMS = recipe(("yaourt nature", 1, "piece"), ("sucre en poudre", 200, "g"),
               ("farine de blé", 210, "g"), ("huile de tournesol", 60, "ml"),
               ("œuf", 3, "piece"), ("sachet de levure chimique", 1, "piece"))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheChecker(unittest.TestCase):
    def test_flour_sugar_and_oil_in_pieces_are_caught(self):
        self.assertEqual(weighed_as_pieces(POTS),
                         ["sucre en poudre", "farine de blé", "huile de tournesol"])

    def test_counted_things_are_left_alone(self):
        # Eggs, a yoghurt, a sachet, a brioche: really counted.
        self.assertEqual(weighed_as_pieces(GRAMS), [])
        self.assertEqual(weighed_as_pieces(recipe(("pain au lait", 4, "piece"))), [])

    def test_other_languages(self):
        r = recipe(("Mehl", 2, "piece"), ("azúcar", 1, "piece"), ("flour", 2, "piece"))
        self.assertEqual(len(weighed_as_pieces(r)), 3)

    def test_both_prompts_say_it(self):
        for prompt in (RECIPE_SYSTEM_PROMPT, RECIPE_PHOTO_SYSTEM_PROMPT):
            prompt = " ".join(prompt.split())
            self.assertIn('never "piece"', prompt)
            self.assertIn("yoghurt pot holds 125 ml", prompt)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class SavedRecipesHeal(unittest.TestCase):
    def test_an_old_recipe_in_pots_is_written_again(self):
        self.assertFalse(server.recipe_is_current(POTS))

    def test_a_recipe_in_grams_is_kept(self):
        self.assertTrue(server.recipe_is_current(GRAMS))

    def test_one_already_checked_is_kept_even_if_imperfect(self):
        # Otherwise a dish the model still gets wrong regenerates, and bills,
        # on every single open.
        self.assertTrue(server.recipe_is_current(dict(POTS, units_checked=True)))

    def test_a_photographed_recipe_is_never_rewritten(self):
        self.assertTrue(server.recipe_is_current(dict(POTS, title="Gâteau de mamie")))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class AskingForADish(unittest.TestCase):
    def setUp(self):
        self._get_db, self._text = server.get_db, server._gemini_text
        self.db = FakeDatabase()
        server.get_db = lambda: self.db
        self._key = server.GOOGLE_API_KEY
        server.GOOGLE_API_KEY = "test-key"
        run(self.db["families"].insert_one({
            "family_id": "fam_1", "name": "Test", "plan": "household",
            "billing_cycle": "monthly", "created_at": server.utcnow()}))
        self.prompts = []

    def tearDown(self):
        server.get_db, server._gemini_text = self._get_db, self._text
        server.GOOGLE_API_KEY = self._key

    def answers(self, *replies):
        replies = list(replies)

        async def fake(prompt, **kw):
            self.prompts.append(prompt)
            return json.dumps(replies.pop(0))
        server._gemini_text = fake

    def ask(self, title="Gâteau yaourt"):
        return run(server.generate_recipe_from_name(
            {"title": title}, lang="fr", user=dict(USER), database=self.db))

    def amounts(self, out):
        return {i["name"]: (i["qty"], i["unit"]) for i in out["recipe"]["ingredients"]}

    def test_pots_are_asked_again_and_grams_kept(self):
        self.answers(POTS, GRAMS)
        out = self.ask()
        self.assertEqual(len(self.prompts), 2)
        self.assertIn("farine de blé", self.prompts[1])
        self.assertEqual(self.amounts(out)["farine de blé"], (210, "g"))
        self.assertTrue(out["recipe"]["units_checked"])

    def test_grams_first_time_needs_no_second_ask(self):
        self.answers(GRAMS)
        self.ask()
        self.assertEqual(len(self.prompts), 1)

    def test_a_worse_second_answer_keeps_the_first(self):
        self.answers(POTS, {"nonsense": True})
        out = self.ask()
        self.assertEqual(self.amounts(out)["farine de blé"], (3, "piece"))
        self.assertTrue(out["recipe"]["units_checked"])

    def test_an_old_library_copy_in_pots_is_written_again(self):
        key = server.recipe_library_key("Gâteau yaourt", "fr", "")
        run(server.store_recipe_in_library(self.db, key, POTS))
        self.answers(GRAMS)
        out = self.ask()
        self.assertEqual(len(self.prompts), 1)
        self.assertEqual(self.amounts(out)["sucre en poudre"], (200, "g"))
        # And the shared copy is healed for the next family.
        healed = run(server.recipe_from_library(self.db, key))
        self.assertEqual(weighed_as_pieces(healed), [])


if __name__ == "__main__":
    unittest.main()
