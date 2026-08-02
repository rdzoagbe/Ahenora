"""One box for "where did I put the school form".

The rule these guard: search must never widen what a screen would show. A
co-parent's private task and a private vault document have to stay invisible
here exactly as they are on the feed and in the vault.

Run with:  python3 -m unittest discover -s tests -v
"""

import asyncio
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
    from fake_mongo import FakeDatabase

ROLAND = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}
KEIGH = {"user_id": "u_k", "family_id": "fam1", "name": "Keigh", "email": "k@x.com"}
OTHER = {"user_id": "u_o", "family_id": "fam2", "name": "Other", "email": "o@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Search(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def _search(self, q, user=ROLAND):
        return asyncio.run(server.search_everything(q=q, user=dict(user)))

    def _titles(self, q, user=ROLAND):
        return [h["title"] for h in self._search(q, user)["results"]]

    def _card(self, user, title, description="", shared=True):
        payload = server.CardIn(type="TASK", title=title, description=description, shared=shared)
        return asyncio.run(server.create_card(payload, user=dict(user)))

    def _doc(self, owner, title, visibility="shared"):
        asyncio.run(self.db["vault"].insert_one({
            "doc_id": f"d_{title.replace(' ', '')}", "family_id": owner["family_id"],
            "title": title, "category": "School", "image_base64": "x",
            "visibility": visibility, "owner_user_id": owner["user_id"],
            "owner_name": owner["name"], "created_at": server.utcnow(),
        }))

    # --- finding things -------------------------------------------------
    def test_finds_a_task_by_its_title(self):
        self._card(ROLAND, "Return the school form")
        self.assertEqual(self._titles("school"), ["Return the school form"])

    def test_finds_a_task_by_something_written_in_its_notes(self):
        self._card(ROLAND, "Call back", "the plumber about the boiler")
        self.assertEqual(self._titles("plumber"), ["Call back"])

    def test_finds_a_document_in_the_vault(self):
        self._doc(ROLAND, "Passport renewal")
        hits = self._search("passport")["results"]
        self.assertEqual([h["kind"] for h in hits], ["document"])

    def test_finds_a_shopping_item(self):
        asyncio.run(self.db["shopping_list"].insert_one({
            "item_id": "s1", "family_id": "fam1", "name": "Olive oil",
            "category": "Pantry", "checked": False, "created_at": server.utcnow()}))
        self.assertEqual(self._titles("olive"), ["Olive oil"])

    def test_finds_a_meal_by_one_of_its_ingredients(self):
        asyncio.run(self.db["meals"].insert_one({
            "meal_id": "m1", "family_id": "fam1", "day": "tuesday",
            "meal_type": "dinner", "title": "Tray bake", "notes": "",
            "ingredients": ["chorizo", "peppers"], "created_at": server.utcnow()}))
        self.assertEqual(self._titles("chorizo"), ["Tray bake"])

    def test_ignores_case_and_surrounding_spaces(self):
        self._card(ROLAND, "Dentist appointment")
        self.assertEqual(self._titles("  DENTIST "), ["Dentist appointment"])

    def test_a_title_match_outranks_a_match_buried_in_the_notes(self):
        self._card(ROLAND, "Buy milk", "")
        self._card(ROLAND, "Weekly shop", "milk, bread, eggs")
        self.assertEqual(self._titles("milk")[0], "Buy milk")

    # --- not finding things ---------------------------------------------
    def test_one_letter_is_not_a_search(self):
        self._card(ROLAND, "Something")
        self.assertEqual(self._search("s")["results"], [])

    def test_another_household_is_invisible(self):
        self._card(ROLAND, "Return the school form")
        self.assertEqual(self._titles("school", OTHER), [])

    def test_a_co_parents_private_task_stays_private(self):
        self._card(KEIGH, "Therapy appointment", shared=False)
        self.assertEqual(self._titles("therapy", ROLAND), [])
        # ...but its owner can still find it.
        self.assertEqual(self._titles("therapy", KEIGH), ["Therapy appointment"])

    def test_a_co_parents_private_document_stays_private(self):
        self._doc(KEIGH, "Medical results", visibility="private")
        self.assertEqual(self._titles("medical", ROLAND), [])
        self.assertEqual(self._titles("medical", KEIGH), ["Medical results"])

    def test_a_shared_document_is_findable_by_the_whole_family(self):
        self._doc(KEIGH, "House insurance", visibility="shared")
        self.assertEqual(self._titles("insurance", ROLAND), ["House insurance"])

    def test_a_long_result_set_is_capped_and_says_so(self):
        for i in range(server.SEARCH_LIMIT + 5):
            self._card(ROLAND, f"Recurring chore {i}")
        result = self._search("chore")
        self.assertEqual(len(result["results"]), server.SEARCH_LIMIT)
        self.assertTrue(result["truncated"])


if __name__ == "__main__":
    unittest.main()
