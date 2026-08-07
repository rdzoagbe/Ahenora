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


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheWeekIsTheCurrency(unittest.TestCase):
    """Earn the week, claim a treat.

    Rewards stop carrying prices: which treat a week buys is a conversation, so
    the gate is the weekly target and nothing here spends the bank. The rules
    that matter are that a full week can actually reach the target, that a week
    pays out once, and that savings are never touched.
    """

    PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Amara", "email": "a@x.com"}

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        # Frozen to a Sunday. A whole week can only be filled in once its days
        # have happened — back-dating deliberately refuses the future — so
        # standing at the end of the week is the only place these rules can be
        # exercised. Left un-frozen, these tests would pass or fail depending
        # on which weekday they were run.
        self._utcnow = server.utcnow
        frozen = datetime(2026, 8, 9, 18, 0, tzinfo=timezone.utc)   # a Sunday
        server.utcnow = lambda: frozen
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "kid1", "family_id": "fam1", "name": "Kofi",
            "role": "Child", "stars": 0, "week_earned": 0,
            "week_start": server.current_week_start()}))

    def tearDown(self):
        server.get_db = self._get_db
        server.utcnow = self._utcnow

    def _member(self):
        return asyncio.run(self.db["family_members"].find_one({"member_id": "kid1"}, {"_id": 0}))

    def _earn(self, delta, day_offset=0):
        """Credit stars to a day of this week, the way a catching-up parent does."""
        when = server.current_week_start() + timedelta(days=day_offset, hours=9)
        return asyncio.run(server.adjust_member_stars(
            "kid1", server.StarAdjustmentIn(delta=delta, reason="Jobs",
                                            awarded_for=when.isoformat()),
            user=dict(self.PARENT)))

    def _claim(self, title="Movie night"):
        return asyncio.run(server.claim_weekly_treat(
            "kid1", server.WeeklyClaimIn(title=title), user=dict(self.PARENT)))

    def test_a_star_remembers_the_day_it_was_earned(self):
        # Logging Tuesday's job on Sunday must still count as Tuesday, or the
        # weekday row credits a whole week to one evening.
        self._earn(2, day_offset=1)
        txn = asyncio.run(self.db["star_transactions"].find_one({"member_id": "kid1"}, {"_id": 0}))
        self.assertEqual(txn["awarded_for"].date(),
                         (server.current_week_start() + timedelta(days=1)).date())

    def test_a_settled_week_cannot_be_edited(self):
        # Last week may already have paid out a treat; re-opening it would move
        # a meter that has been spent.
        last_week = server.current_week_start() - timedelta(days=3)
        with self.assertRaises(server.HTTPException) as e:
            asyncio.run(server.adjust_member_stars(
                "kid1", server.StarAdjustmentIn(delta=5, reason="Late",
                                                awarded_for=last_week.isoformat()),
                user=dict(self.PARENT)))
        self.assertEqual(e.exception.status_code, 400)

    def test_a_full_week_of_jobs_actually_reaches_the_target(self):
        # 7 a day over seven days is 49 — one short. The seventh active day
        # pays the last star so a perfect week lands exactly on the target.
        for day in range(7):
            self._earn(7, day_offset=day)
        member = self._member()
        self.assertEqual(member["week_earned"], server.WEEKLY_TARGET)
        self.assertEqual(member["stars"], server.WEEKLY_TARGET)

    def test_the_full_week_bonus_is_paid_once(self):
        for day in range(7):
            self._earn(7, day_offset=day)
        self._earn(3, day_offset=6)      # more work on an already-counted day
        self.assertEqual(self._member()["week_earned"], server.WEEKLY_TARGET + 3)

    def test_a_treat_can_be_claimed_before_the_week_is_full(self):
        # The loyalty-card rule: 50 is the celebration, not the gate. A child
        # ten stars in can still claim a treat, at no cost to the bank.
        self._earn(10, day_offset=0)
        before = self._member()["stars"]
        out = self._claim("Ice cream")
        self.assertEqual(out["redemption"]["cost_stars"], 0)
        self.assertEqual(out["redemption"]["reward_title"], "Ice cream")
        self.assertEqual(self._member()["stars"], before)   # bank untouched

    def test_still_only_one_treat_a_week_even_below_fifty(self):
        # Anytime, but not unlimited: the once-a-week guard holds regardless of
        # how many stars have been earned.
        self._earn(10, day_offset=0)
        self._claim("First")
        with self.assertRaises(server.HTTPException) as e:
            self._claim("Second")
        self.assertEqual(e.exception.status_code, 400)
        self.assertIn("already been claimed", e.exception.detail)

    def test_claiming_costs_no_saved_stars(self):
        # The whole point of (b): the week pays, the bank is savings.
        for day in range(7):
            self._earn(7, day_offset=day)
        before = self._member()["stars"]
        out = self._claim("Pizza night")
        self.assertEqual(out["redemption"]["cost_stars"], 0)
        self.assertEqual(self._member()["stars"], before)
        self.assertEqual(out["redemption"]["reward_title"], "Pizza night")

    def test_a_week_pays_out_once(self):
        for day in range(7):
            self._earn(7, day_offset=day)
        self._claim()
        with self.assertRaises(server.HTTPException) as e:
            self._claim()
        self.assertEqual(e.exception.status_code, 400)
        self.assertIn("already", e.exception.detail)

    def test_the_meter_survives_being_cashed_in(self):
        # Zeroing it would make a week look unworked the moment it paid off.
        for day in range(7):
            self._earn(7, day_offset=day)
        self._claim()
        self.assertEqual(self._member()["week_earned"], server.WEEKLY_TARGET)
        self.assertTrue(server.public_member(self._member())["week_claimed"])
