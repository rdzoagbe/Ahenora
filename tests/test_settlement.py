"""Shared-expense settle-up: who owes whom on the split costs, and marking it paid.

A split expense is borne half each; whoever paid it is owed the other half. The
balance is what each parent put in minus their fair half, adjusted by recorded
settlements. Tracking only — no money moves. These tests cover the maths, the
direction, the settle action clearing it, and that it needs exactly two parents.

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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class Settlement(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db

        async def seed():
            for uid, nm in (("u1", "Roland"), ("u2", "Kim")):
                await self.db["family_members"].insert_one({
                    "member_id": f"m_{uid}", "family_id": "fam1", "user_id": uid,
                    "name": nm, "role": "Parent"})
        asyncio.run(seed())

    def tearDown(self):
        server.get_db = self._get_db

    def _user(self, uid="u1", name="Roland"):
        return {"user_id": uid, "family_id": "fam1", "name": name}

    def _expense(self, amount, payer="u1", split=True):
        asyncio.run(self.db["expenses"].insert_one({
            "expense_id": server.new_id("exp"), "family_id": "fam1",
            "description": "Shoes", "amount": float(amount), "category": "General",
            "paid_by_user_id": payer, "paid_by_name": payer,
            "created_at": server.utcnow(), "split": split}))

    def _get(self, uid="u1"):
        return asyncio.run(server.get_settlement(user=self._user(uid)))

    def test_disabled_without_two_parents(self):
        # Remove the co-parent → only one parent left.
        asyncio.run(self.db["family_members"].delete_one({"user_id": "u2"}))
        self.assertEqual(self._get()["enabled"], False)

    def test_payer_is_owed_half(self):
        self._expense(100, payer="u1")           # Roland paid 100, split
        info = self._get("u1")
        self.assertTrue(info["enabled"])
        self.assertAlmostEqual(info["balance"], 50.0)   # Kim owes Roland 50
        self.assertEqual(info["other_name"], "Kim")
        # And it is symmetric from Kim's side.
        self.assertAlmostEqual(self._get("u2")["balance"], -50.0)

    def test_non_split_expenses_are_ignored(self):
        self._expense(100, payer="u1", split=False)
        self.assertAlmostEqual(self._get("u1")["balance"], 0.0)

    def test_balances_net_across_both_payers(self):
        self._expense(100, payer="u1")   # Kim owes 50
        self._expense(40, payer="u2")    # Roland owes 20
        self.assertAlmostEqual(self._get("u1")["balance"], 30.0)  # net: Kim owes 30

    def test_settle_clears_the_balance_and_records_it(self):
        self._expense(100, payer="u1")   # Kim owes Roland 50
        out = asyncio.run(server.settle_up(user=self._user("u1")))
        self.assertAlmostEqual(out["balance"], 0.0)
        # A settlement was recorded: Kim -> Roland, 50.
        s = asyncio.run(self.db["expense_settlements"].find_one({"family_id": "fam1"}))
        self.assertEqual(s["from_user_id"], "u2")
        self.assertEqual(s["to_user_id"], "u1")
        self.assertAlmostEqual(s["amount"], 50.0)
        # Still square from both sides afterwards.
        self.assertAlmostEqual(self._get("u2")["balance"], 0.0)

    def test_settle_when_square_is_a_noop(self):
        out = asyncio.run(server.settle_up(user=self._user("u1")))
        self.assertAlmostEqual(out["balance"], 0.0)
        self.assertEqual(asyncio.run(self.db["expense_settlements"].count_documents({})), 0)

    def test_new_expense_after_settling_reopens_a_balance(self):
        self._expense(100, payer="u1")
        asyncio.run(server.settle_up(user=self._user("u1")))
        self._expense(60, payer="u1")    # a fresh split cost
        self.assertAlmostEqual(self._get("u1")["balance"], 30.0)


if __name__ == "__main__":
    unittest.main()
