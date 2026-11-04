"""The shopping list's price hints, from the household's own receipts.

The list shows, under what you type and under each thing on it, the last price
paid, where, and when. Every test is about the hint never saying more than the
receipts do: one receipt stays one receipt, an old price is not shown, another
family's receipts never leak in, and "cheapest" only appears when the
price comparison itself would say so.

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
class ShoppingPrices(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db

    def line(self, name, shop, total, qty=1.0, unit="piece", days_ago=7, family="fam1", expense_id=None):
        asyncio.run(self.db["expense_items"].insert_one({
            "line_id": server.new_id("eln"),
            "expense_id": expense_id or server.new_id("exp"),
            "family_id": family,
            "shop": shop,
            "spent_on": self.now - timedelta(days=days_ago),
            "name": name,
            "name_key": name.strip().lower(),
            "qty": qty,
            "unit": unit,
            "line_total": total,
            "unit_price": round(total / qty, 4) if qty else None,
        }))

    def prices(self):
        return asyncio.run(server.shopping_prices(user=dict(ME)))["items"]

    def test_the_last_price_shop_and_date_come_back(self):
        self.line("Sel fin", "Lidl", 0.95, days_ago=30)
        self.line("Sel fin", "Carrefour", 0.89, days_ago=14)
        [row] = self.prices()
        self.assertEqual(row["name"], "Sel fin")
        self.assertEqual(row["shop"], "Carrefour")
        self.assertAlmostEqual(row["price"], 0.89)
        self.assertEqual(row["seen"], 2)
        self.assertTrue(row["last_seen"])
        self.assertFalse(row["per_unit"])
        # One visit at each shop: a price, not yet a comparison.
        self.assertIsNone(row["cheapest"])

    def test_a_weighed_line_is_a_price_per_unit(self):
        self.line("Tomates", "Lidl", 2.99 * 1.5, qty=1.5, unit="kg")
        [row] = self.prices()
        self.assertTrue(row["per_unit"])
        self.assertAlmostEqual(row["price"], 2.99, places=2)
        self.assertEqual(row["unit"], "kg")

    def test_no_quantity_means_no_price_per_kilo(self):
        """What the line cost is all that is known; it must not be shown as a
        price per kilo."""
        self.line("Pommes", "Aldi", 3.20, qty=None, unit="kg")
        [row] = self.prices()
        self.assertFalse(row["per_unit"])
        self.assertAlmostEqual(row["price"], 3.20)

    def test_an_old_price_is_not_shown(self):
        self.line("Café", "Carrefour", 4.50, days_ago=server.PRICE_WINDOW_DAYS + 5)
        self.assertEqual(self.prices(), [])

    def test_another_familys_receipts_never_appear(self):
        self.line("Café", "Carrefour", 4.50, family="fam2")
        self.assertEqual(self.prices(), [])

    def test_cheapest_only_when_the_comparison_is_sure(self):
        for d in (5, 20):
            self.line("Volvic 6 x 1,5 L", "Marché Frais", 2.40, days_ago=d)
            self.line("Volvic 6 x 1,5 L", "Carrefour", 2.95, days_ago=d + 1)
        [row] = self.prices()
        self.assertIsNotNone(row["cheapest"])
        self.assertEqual(row["cheapest"]["shop"], "Marché Frais")
        self.assertEqual(row["cheapest"]["against"], "Carrefour")
        self.assertAlmostEqual(row["cheapest"]["saving"], 0.55, places=2)
        self.assertEqual([s["visits"] for s in row["cheapest"]["shops"]], [2, 2])

    def test_two_lines_on_one_ticket_are_still_one_ticket(self):
        self.line("Yaourt nature", "Carrefour", 0.99, expense_id="exp_one")
        self.line("Yaourt nature", "Carrefour", 0.99, expense_id="exp_one")
        [row] = self.prices()
        self.assertEqual(row["seen"], 1)

    def test_newest_first(self):
        self.line("Riz", "Lidl", 1.10, days_ago=40)
        self.line("Lait", "Lidl", 0.99, days_ago=2)
        self.assertEqual([r["name"] for r in self.prices()], ["Lait", "Riz"])


if __name__ == "__main__":
    unittest.main()
