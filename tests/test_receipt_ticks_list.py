"""A scanned receipt ticks things off the shopping list.

The app matches the receipt's lines to the list and, after the parent has
seen each match, ticks those items with the shop's name. These tests cover
the server side: the shop is remembered so the list can say why an item is
done, and it never outlives that tick.

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

ME = {"user_id": "u1", "family_id": "fam1", "name": "Roland", "email": "r@x.test"}
OTHER = {"user_id": "u2", "family_id": "fam2", "name": "Eve", "email": "e@x.test"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ReceiptTicksList(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        asyncio.run(self.db["shopping_list"].insert_one({
            "item_id": "shop_1", "family_id": "fam1", "name": "Sel", "category": "Pantry",
            "checked": False, "added_by": "Roland", "created_at": server.utcnow(),
        }))

    def tearDown(self):
        server.get_db = self._get_db

    def patch(self, user=ME, **kw):
        return asyncio.run(server.update_shopping_item(
            "shop_1", server.ShoppingItemPatchIn(**kw), user=dict(user)))

    def test_a_receipt_tick_remembers_the_shop_tidied(self):
        out = self.patch(checked=True, ticked_from="CARREFOUR CITY 14EME")
        self.assertTrue(out["checked"])
        self.assertEqual(out["ticked_from"], "Carrefour")

    def test_unticking_forgets_the_shop(self):
        self.patch(checked=True, ticked_from="Lidl")
        out = self.patch(checked=False)
        self.assertFalse(out["checked"])
        self.assertIsNone(out["ticked_from"])

    def test_a_tick_by_hand_carries_no_shop(self):
        self.patch(checked=True, ticked_from="Lidl")
        self.patch(checked=False)
        out = self.patch(checked=True)
        self.assertIsNone(out["ticked_from"])

    def test_a_shop_is_never_shown_on_an_item_not_ticked(self):
        out = self.patch(checked=False, ticked_from="Lidl")
        self.assertIsNone(out["ticked_from"])

    def test_another_family_cannot_tick_it(self):
        with self.assertRaises(server.HTTPException) as ctx:
            self.patch(user=OTHER, checked=True, ticked_from="Lidl")
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()
