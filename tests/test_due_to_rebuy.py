"""Things the family buys regularly that are due again, from receipts.

"Lait · tous les ~6 jours · dernier achat il y a 7 jours". Each test is about
saying nothing the receipts cannot back: a rhythm needs three separate
receipts, one ticket is one purchase however many lines, and a long-stopped
habit is not nagged about.

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
class DueToRebuy(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.now = server.utcnow()

    def tearDown(self):
        server.get_db = self._get_db

    def bought(self, name, *days_ago, family="fam1", lines_per_receipt=1):
        for d in days_ago:
            receipt = server.new_id("exp")
            for _ in range(lines_per_receipt):
                asyncio.run(self.db["expense_items"].insert_one({
                    "line_id": server.new_id("eln"), "expense_id": receipt,
                    "family_id": family, "shop": "Carrefour",
                    "spent_on": self.now - timedelta(days=d),
                    "name": name, "name_key": name.strip().lower(),
                    "qty": 1.0, "unit": "piece", "line_total": 1.15, "unit_price": 1.15,
                }))

    def due(self):
        return asyncio.run(server.shopping_due(timezone_name=None, user=dict(ME)))["items"]

    def test_due_when_the_usual_gap_has_passed(self):
        # Bought 7, 13, 19 and 25 days ago: every 6 days, last 7 days ago.
        self.bought("Lait demi-écrémé", 7, 13, 19, 25)
        [row] = self.due()
        self.assertEqual(row["name"], "Lait demi-écrémé")
        self.assertEqual(row["every_days"], 6)
        self.assertEqual(row["last_days"], 7)

    def test_not_yet_due(self):
        self.bought("Lait", 2, 8, 14)
        self.assertEqual(self.due(), [])

    def test_two_purchases_are_not_a_habit(self):
        self.bought("Lait", 20, 26)
        self.assertEqual(self.due(), [])

    def test_two_lines_on_one_ticket_are_one_purchase(self):
        self.bought("Yaourts", 10, 20, lines_per_receipt=2)
        self.assertEqual(self.due(), [])

    def test_a_habit_long_stopped_is_not_nagged(self):
        # Every 5 days, but nothing for 40: probably stopped.
        self.bought("Jus d'orange", 40, 45, 50, 55)
        self.assertEqual(self.due(), [])

    def test_another_family_never_appears(self):
        self.bought("Lait", 7, 13, 19, family="fam2")
        self.assertEqual(self.due(), [])

    def test_the_familys_own_day_counts(self):
        # Just before midnight UTC it is already tomorrow in Auckland, so one
        # more day has passed there: never fewer days than the UTC count.
        self.bought("Lait", 7, 13, 19, 25)
        utc = self.due()[0]["last_days"]
        nz = asyncio.run(server.shopping_due(timezone_name="Pacific/Auckland", user=dict(ME)))["items"][0]["last_days"]
        self.assertIn(nz - utc, (0, 1))

    def test_most_overdue_first(self):
        self.bought("Pain", 3, 5, 7, 9)          # every 2, last 3: 1.5x
        self.bought("Lait", 7, 13, 19)           # every 6, last 7: 1.17x
        self.assertEqual([r["name"] for r in self.due()], ["Pain", "Lait"])


if __name__ == "__main__":
    unittest.main()
