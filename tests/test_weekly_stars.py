"""The soft-weekly star economy.

Stars live in one bank (`stars`) — nothing about spending or migration changes
that. A separate meter (`week_earned`) counts what a child earned since Monday
and gates the *weekend treats*: you can't buy one on old savings alone, you
have to have earned enough this week. The meter resets each Monday; the bank
never does, so no star is ever lost to a reset.

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
    from fastapi import HTTPException

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Amara", "email": "a@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WeeklyStars(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "kid1", "family_id": "fam1", "name": "Kofi",
            "role": "Child", "stars": 40, "week_earned": 0,
            "week_start": server.current_week_start()}))

    def tearDown(self):
        server.get_db = self._get_db

    def _member(self):
        return asyncio.run(self.db["family_members"].find_one({"member_id": "kid1"}, {"_id": 0}))

    def _award(self, delta):
        return asyncio.run(server.adjust_member_stars(
            "kid1", server.StarAdjustmentIn(delta=delta, reason="Chore"), user=dict(PARENT)))

    def _reward(self, cost, weekend):
        r = asyncio.run(server.create_reward(
            server.RewardIn(title="Treat" if weekend else "Big toy", cost_stars=cost, weekend=weekend),
            user=dict(PARENT)))
        return r["reward_id"]

    def _redeem(self, reward_id):
        return asyncio.run(server.redeem_reward(
            reward_id, server.RedeemIn(member_id="kid1"), user=dict(PARENT)))

    def test_earning_banks_and_ticks_the_week_meter(self):
        self._award(6)
        m = self._member()
        self.assertEqual(m["stars"], 46)          # bank grew
        self.assertEqual(m["week_earned"], 6)     # meter ticked

    def test_a_removal_touches_the_bank_but_not_the_meter(self):
        # Undoing a mis-award must not quietly leave weekly credit behind.
        self._award(6)
        asyncio.run(server.adjust_member_stars(
            "kid1", server.StarAdjustmentIn(delta=-4, reason="Mistake"), user=dict(PARENT)))
        m = self._member()
        self.assertEqual(m["stars"], 42)
        self.assertEqual(m["week_earned"], 6)

    def test_a_saved_reward_spends_the_bank_and_ignores_the_week(self):
        # Big saved-up reward: affordable from the 40-star bank with zero earned
        # this week.
        rid = self._reward(cost=30, weekend=False)
        self._redeem(rid)
        m = self._member()
        self.assertEqual(m["stars"], 10)
        self.assertEqual(m["week_earned"], 0)

    def test_a_weekend_treat_needs_stars_earned_this_week(self):
        rid = self._reward(cost=20, weekend=True)
        # Bank is 40 but nothing earned this week — refused.
        with self.assertRaises(HTTPException) as ctx:
            self._redeem(rid)
        self.assertEqual(ctx.exception.status_code, 400)
        self.assertIn("this week", ctx.exception.detail)

    def test_a_weekend_treat_redeems_once_the_week_is_earned(self):
        self._award(25)
        rid = self._reward(cost=20, weekend=True)
        self._redeem(rid)
        m = self._member()
        self.assertEqual(m["stars"], 45)          # 40 + 25 earned − 20 spent
        self.assertEqual(m["week_earned"], 5)     # 25 earned − 20 drawn down

    def test_the_same_week_cannot_fund_two_weekend_treats(self):
        self._award(20)
        rid = self._reward(cost=20, weekend=True)
        self._redeem(rid)                         # uses all 20 of the week's meter
        with self.assertRaises(HTTPException):
            self._redeem(rid)                     # bank still has stars, meter does not

    def test_monday_resets_the_meter_but_never_the_bank(self):
        self._award(18)
        # Backdate the week so the next read rolls it over.
        asyncio.run(self.db["family_members"].update_one(
            {"member_id": "kid1"},
            {"$set": {"week_start": server.current_week_start() - timedelta(days=8)}}))
        members = asyncio.run(server.family_members(user=dict(PARENT)))
        kid = next(m for m in members if m["member_id"] == "kid1")
        self.assertEqual(kid["week_earned"], 0)   # meter reset
        self.assertEqual(kid["stars"], 58)        # bank kept every earned star

    def test_a_new_week_earns_toward_a_fresh_weekend(self):
        self._award(18)
        asyncio.run(self.db["family_members"].update_one(
            {"member_id": "kid1"},
            {"$set": {"week_start": server.current_week_start() - timedelta(days=8)}}))
        # Roll happens on the award path too; earning starts the new week at 5.
        self._award(5)
        self.assertEqual(self._member()["week_earned"], 5)

    def test_weekend_goal_must_point_at_a_weekend_treat(self):
        saved = self._reward(cost=50, weekend=False)
        with self.assertRaises(HTTPException):
            asyncio.run(server.set_weekend_goal("kid1", {"reward_id": saved}, user=dict(PARENT)))
        treat = self._reward(cost=20, weekend=True)
        out = asyncio.run(server.set_weekend_goal("kid1", {"reward_id": treat}, user=dict(PARENT)))
        self.assertEqual(out["weekend_goal_reward_id"], treat)


if __name__ == "__main__":
    unittest.main()
