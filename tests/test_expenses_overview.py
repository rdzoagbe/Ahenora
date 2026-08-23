"""House expenses: months come from the receipt, and a number carries its coverage.

The failure this guards against is not a crash. It is the app telling a family
something confident and wrong — that they spent less in a month where four
receipts were simply never entered, or that a week of Sunday-evening
photographing all happened on one day.

Run with:  python3 -m unittest discover -s tests -v
"""
import asyncio
import os
import sys
import unittest
from datetime import datetime, timedelta, timezone

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

PARENT = {"user_id": "u_r", "family_id": "fam1", "name": "Roland", "email": "r@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class MerchantNames(unittest.TestCase):
    def test_a_till_slip_collapses_to_the_brand(self):
        # Without this, six months of shopping shows eleven Carrefours.
        for printed, expected in [
            ("CARREFOUR CITY 14EME", "Carrefour"),
            ("AUCHAN RETAIL FRANCE SAS 0472", "Auchan"),
            ("LIDL SARL 4402", "Lidl"),
            ("SUPER U ST NAZAIRE", "Super U"),
            ("  aldi  ", "Aldi"),
            ("E.LECLERC BRIVE", "E.Leclerc"),
        ]:
            self.assertEqual(server.tidy_merchant(printed), expected, printed)

    def test_an_unknown_shop_is_left_alone(self):
        # Guessing at a name we do not know is worse than keeping what was typed.
        self.assertEqual(server.tidy_merchant("Boucherie Martin"), "Boucherie Martin")
        self.assertEqual(server.tidy_merchant("BOULANGERIE DU COIN 22"), "Boulangerie Du Coin")

    def test_no_shop_is_not_a_shop_called_nothing(self):
        self.assertIsNone(server.tidy_merchant(""))
        self.assertIsNone(server.tidy_merchant(None))
        self.assertIsNone(server.tidy_merchant("   "))


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class ReceiptDates(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 8, 23, 14, 30, tzinfo=timezone.utc)

    def test_the_date_on_the_receipt_wins(self):
        got = server.parse_spent_on("2026-07-12", self.now)
        self.assertEqual((got.year, got.month, got.day), (2026, 7, 12))
        self.assertEqual((got.hour, got.minute, got.second), (0, 0, 0))

    def test_no_date_means_today(self):
        got = server.parse_spent_on(None, self.now)
        self.assertEqual((got.year, got.month, got.day), (2026, 8, 23))

    def test_nonsense_falls_back_rather_than_landing_in_a_strange_month(self):
        for bad in ["", "12/07/2026", "not a date", "2026-13-45", "2031-01-01", "1990-01-01"]:
            got = server.parse_spent_on(bad, self.now)
            self.assertEqual((got.year, got.month, got.day), (2026, 8, 23), bad)


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Overview(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        self.today = server.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    def tearDown(self):
        server.get_db = self._get_db

    def _month_start(self, months_back):
        year, month = self.today.year, self.today.month
        for _ in range(months_back):
            month -= 1
            if month == 0:
                year, month = year - 1, 12
        return datetime(year, month, 1, tzinfo=timezone.utc)

    def _spend(self, months_back, amount, merchant, day=5):
        when = self._month_start(months_back).replace(day=day)
        asyncio.run(self.db["expenses"].insert_one({
            "expense_id": f"e{amount}{merchant}{months_back}{day}", "family_id": "fam1",
            "description": merchant, "amount": amount, "category": "Groceries",
            "merchant": merchant, "spent_on": when, "created_at": self.today}))

    def _overview(self, months=6):
        return asyncio.run(server.expense_overview(user=PARENT, months=months, category=None))

    def test_a_shop_is_grouped_across_the_whole_window(self):
        self._spend(1, 30.00, "Carrefour", day=3)
        self._spend(1, 20.00, "Carrefour", day=17)
        self._spend(2, 40.00, "Aldi")
        rows = self._overview()["range"]["by_merchant"]
        self.assertEqual([r["merchant"] for r in rows], ["Carrefour", "Aldi"])
        self.assertEqual(rows[0]["total"], 50.00)
        self.assertEqual(rows[0]["visits"], 2)
        self.assertEqual(rows[0]["average"], 25.00)

    def test_every_total_carries_the_number_of_receipts_behind_it(self):
        # A total without its coverage is how an app lies without meaning to.
        self._spend(1, 30.00, "Aldi", day=3)
        self._spend(1, 20.00, "Aldi", day=9)
        month = [m for m in self._overview()["months"] if m["count"]][0]
        self.assertEqual(month["count"], 2)
        self.assertEqual(month["total"], 50.00)

    def test_the_month_still_running_is_never_compared(self):
        # On the 8th you have spent less than all of last month. It means nothing.
        for back in (1, 2, 3):
            self._spend(back, 200.00, "Aldi")
        self._spend(0, 10.00, "Aldi", day=1)
        data = self._overview()
        self.assertFalse(data["current"]["complete"])
        self.assertNotEqual(data["comparison"] and data["comparison"]["month"],
                            data["current"]["month"])

    def test_usual_is_three_months_not_last_month(self):
        self._spend(4, 120.00, "Aldi")   # older, and deliberately different
        self._spend(3, 180.00, "Aldi")
        self._spend(2, 180.00, "Aldi")
        self._spend(1, 240.00, "Aldi")   # the newest finished month
        comparison = self._overview()["comparison"]
        self.assertIsNotNone(comparison)
        # (120 + 180 + 180) / 3 = 160, not 180 (last month alone).
        self.assertEqual(comparison["usual"], 160.00)
        self.assertEqual(comparison["total"], 240.00)
        self.assertEqual(comparison["difference"], 80.00)
        self.assertEqual(len(comparison["basis_months"]), 3)

    def test_no_comparison_until_there_is_enough_to_compare_against(self):
        self._spend(2, 200.00, "Aldi")
        self._spend(1, 300.00, "Aldi")
        self.assertIsNone(self._overview()["comparison"])

    def test_an_old_expense_with_no_receipt_date_still_counts(self):
        # Rows written before shops existed have no spent_on. They must not
        # vanish from the family's own history.
        when = self._month_start(1).replace(day=6)
        asyncio.run(self.db["expenses"].insert_one({
            "expense_id": "old", "family_id": "fam1", "description": "Shop",
            "amount": 25.00, "category": "Groceries", "created_at": when}))
        data = self._overview()
        self.assertEqual(data["range"]["total"], 25.00)
        self.assertEqual(data["range"]["by_merchant"][0]["merchant"], "Shop")

    def test_another_household_is_never_counted(self):
        self._spend(1, 50.00, "Aldi")
        asyncio.run(self.db["expenses"].insert_one({
            "expense_id": "theirs", "family_id": "fam2", "description": "Aldi",
            "amount": 999.00, "category": "Groceries",
            "spent_on": self._month_start(1).replace(day=4), "created_at": self.today}))
        self.assertEqual(self._overview()["range"]["total"], 50.00)

    def test_spending_older_than_the_window_is_left_out(self):
        self._spend(1, 50.00, "Aldi")
        self._spend(9, 900.00, "Aldi")
        self.assertEqual(self._overview(months=6)["range"]["total"], 50.00)


if __name__ == "__main__":
    unittest.main()
