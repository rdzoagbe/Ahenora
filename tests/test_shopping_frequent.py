"""'Your regulars' — the items a household buys often, from past shopping trips.

Receipts keep only a total, so frequency can only come from the shopping-list
archive. These tests cover the counting (once per trip), the min-trips floor,
excluding what's already on the current list, ordering, and family isolation.

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

USER = {"user_id": "u1", "family_id": "fam1", "name": "Roland"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class FrequentShopping(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

    def tearDown(self):
        server.get_db = self._get_db

    def _trip(self, items, fid="fam1"):
        asyncio.run(self.db["shopping_history"].insert_one({
            "history_id": server.new_id("shist"), "family_id": fid,
            "items": items, "created_at": server.utcnow()}))

    def _on_list(self, name, fid="fam1"):
        asyncio.run(self.db["shopping_list"].insert_one({
            "item_id": server.new_id("shop"), "family_id": fid,
            "name": name, "category": "Other", "checked": False,
            "created_at": server.utcnow()}))

    def _run(self):
        return asyncio.run(server.frequent_shopping_items(user=dict(USER)))["items"]

    def test_counts_trips_and_applies_floor(self):
        self._trip(["Milk", "Bread", "Eggs"])
        self._trip(["Milk", "Bread"])
        self._trip(["Milk"])
        out = self._run()
        by = {r["name"]: r["count"] for r in out}
        self.assertEqual(by.get("Milk"), 3)
        self.assertEqual(by.get("Bread"), 2)
        # Eggs only once → below the 2-trip floor, not a regular.
        self.assertNotIn("Eggs", by)

    def test_same_item_twice_in_one_trip_counts_once(self):
        self._trip(["Milk", "milk", " MILK "])
        self._trip(["Milk"])
        by = {r["name"]: r["count"] for r in self._run()}
        self.assertEqual(by.get("Milk"), 2)  # two trips, not four

    def test_excludes_items_already_on_the_list(self):
        self._trip(["Milk", "Bread"])
        self._trip(["Milk", "Bread"])
        self._on_list("milk")  # case-insensitive match
        names = {r["name"] for r in self._run()}
        self.assertNotIn("Milk", names)
        self.assertIn("Bread", names)

    def test_ordered_most_bought_first(self):
        self._trip(["Bread", "Milk"])
        self._trip(["Bread", "Milk"])
        self._trip(["Bread"])
        out = self._run()
        self.assertEqual(out[0]["name"], "Bread")  # 3 trips
        self.assertEqual(out[1]["name"], "Milk")    # 2 trips

    def test_family_isolation(self):
        self._trip(["Milk"], fid="fam2")
        self._trip(["Milk"], fid="fam2")
        self.assertEqual(self._run(), [])  # fam1 sees none of fam2's habits


if __name__ == "__main__":
    unittest.main()
