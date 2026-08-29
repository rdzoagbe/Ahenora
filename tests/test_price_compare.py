"""Which shop is cheaper for a thing, from the household's own receipts.

Reading receipt lines instead of totals exists for exactly this. A total says
ninety euros at one shop and eighty at another, which compares basket SIZES.
This compares prices, which is what a family can act on: these onions cost less
per kilo there than here.

Every test below is about saying LESS rather than saying something wrong. A
confident wrong saving — comparing a 500g bag against a kilo, or quoting a
promotion as a price — is worse than no advice, because the family acts on it.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest
from datetime import timedelta

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class PriceCompare(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db

    def line(self, name, shop, unit_price, unit="kg", days_ago=7, family="fam1"):
        asyncio.run(self.db["expense_items"].insert_one({
            "line_id": server.new_id("eln"),
            "family_id": family,
            "shop": shop,
            "spent_on": self.now - timedelta(days=days_ago),
            "name": name,
            "name_key": name.strip().lower(),
            "qty": 1.0,
            "unit": unit,
            "line_total": unit_price,
            "unit_price": unit_price,
        }))

    def run_compare(self):
        return asyncio.run(server.price_compare(user=dict(ME)))

    def test_it_names_the_cheaper_shop_and_the_difference(self):
        for d in (5, 12):
            self.line("Oignons", "Aldi", 0.89, days_ago=d)
            self.line("Oignons", "Carrefour", 1.35, days_ago=d)
        out = self.run_compare()
        self.assertEqual(len(out["comparable"]), 1)
        row = out["comparable"][0]
        self.assertEqual(row["cheapest"], "Aldi")
        self.assertAlmostEqual(row["saving"]["per_unit"], 0.46, places=3)
        self.assertEqual(row["saving"]["against"], "Carrefour")

    def test_one_visit_is_not_a_price(self):
        """A single observation is a promotion, a clearance, a bad week. It is
        not what the shop charges, and quoting it as one is how the advice
        starts lying."""
        self.line("Oignons", "Aldi", 0.50)
        for d in (5, 12):
            self.line("Oignons", "Carrefour", 1.35, days_ago=d)
        out = self.run_compare()
        self.assertEqual(out["comparable"], [])

    def test_a_promotion_does_not_move_the_price(self):
        """The median, never the latest. One cheap week among several normal
        ones must not turn into a standing claim about the shop."""
        for price in (1.30, 1.35, 1.40, 0.10):
            self.line("Beurre", "Carrefour", price)
        for d in (3, 9):
            self.line("Beurre", "Aldi", 1.00, days_ago=d)
        out = self.run_compare()
        row = next(r for r in out["items"] if r["name_key"] == "beurre")
        carrefour = next(s for s in row["shops"] if s["shop"] == "Carrefour")
        self.assertGreater(carrefour["unit_price"], 1.0)
        self.assertEqual(row["cheapest"], "Aldi")

    def test_different_units_are_never_compared(self):
        """The one that would embarrass us. A 500g bag against a kilo reads as
        a saving and is the opposite of one."""
        for d in (4, 11):
            self.line("Tomates", "Aldi", 2.00, unit="kg", days_ago=d)
            self.line("Tomates", "Carrefour", 1.20, unit="piece", days_ago=d)
        out = self.run_compare()
        self.assertEqual(out["comparable"], [])
        # Both are still known, just kept apart.
        self.assertEqual(len(out["items"]), 2)
        self.assertEqual({r["unit"] for r in out["items"]}, {"kg", "piece"})

    def test_stale_prices_are_dropped(self):
        for d in (200, 210):
            self.line("Lait", "Aldi", 0.80, days_ago=d)
        for d in (3, 10):
            self.line("Lait", "Carrefour", 1.10, days_ago=d)
        out = self.run_compare()
        self.assertEqual(out["comparable"], [])

    def test_the_date_comes_back_so_the_app_can_say_how_old_it_is(self):
        for d in (6, 20):
            self.line("Oeufs", "Aldi", 0.30, unit="piece", days_ago=d)
        out = self.run_compare()
        shop = out["items"][0]["shops"][0]
        self.assertIsNotNone(shop["last_seen"])
        self.assertEqual(shop["visits"], 2)

    def test_a_line_with_no_unit_price_is_ignored(self):
        """A receipt line whose quantity could not be read carries no price.
        It is spending, not evidence."""
        asyncio.run(self.db["expense_items"].insert_one({
            "line_id": "x", "family_id": "fam1", "shop": "Aldi",
            "spent_on": self.now, "name": "Mystery", "name_key": "mystery",
            "qty": None, "unit": "piece", "line_total": 3.0, "unit_price": None,
        }))
        self.assertEqual(self.run_compare()["items"], [])

    def test_another_household_is_never_read(self):
        for d in (4, 9):
            self.line("Oignons", "Aldi", 0.10, days_ago=d, family="famOTHER")
            self.line("Oignons", "Carrefour", 9.99, days_ago=d, family="famOTHER")
        self.assertEqual(self.run_compare()["items"], [])

    def test_one_shop_alone_is_reported_without_a_saving(self):
        """Honest: the household buys it, but there is nothing to compare
        against, so no claim is made."""
        for d in (2, 8):
            self.line("Pain", "Aldi", 1.10, unit="piece", days_ago=d)
        out = self.run_compare()
        self.assertEqual(len(out["items"]), 1)
        self.assertIsNone(out["items"][0]["saving"])
        self.assertEqual(out["comparable"], [])

    def test_the_biggest_difference_comes_first(self):
        for d in (3, 10):
            self.line("Small", "Aldi", 1.00, days_ago=d)
            self.line("Small", "Carrefour", 1.10, days_ago=d)
            self.line("Big", "Aldi", 2.00, days_ago=d)
            self.line("Big", "Carrefour", 5.00, days_ago=d)
        out = self.run_compare()
        self.assertEqual(out["comparable"][0]["name_key"], "big")

    def test_it_survives_a_household_with_no_receipts(self):
        out = self.run_compare()
        self.assertEqual(out["items"], [])
        self.assertEqual(out["comparable"], [])
        self.assertEqual(out["min_observations"], server.PRICE_MIN_OBSERVATIONS)


if __name__ == "__main__":
    unittest.main()
