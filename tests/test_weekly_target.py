"""The weekly goal is a per-child number, not a constant.

It was 50 for everybody: seven perfect days of the three everyday jobs plus the
seventh-day bonus. A goal only a spotless week can reach is a goal that never
gets reached, and a ring that never fills teaches the same thing as no ring at
all. The default is now a good week rather than a perfect one, and any household
that counts differently can say so per child.
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
    from fastapi import HTTPException

PARENT = {"user_id": "u_p", "family_id": "fam1", "name": "Amara", "email": "a@x.com"}


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class WeeklyTarget(unittest.TestCase):
    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        server.get_db = lambda: self.db
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "kid1", "family_id": "fam1", "name": "Ama",
            "role": "child", "stars": 0, "week_earned": 0,
        }))

    def tearDown(self):
        server.get_db = self._get_db

    def _member(self):
        return asyncio.run(self.db["family_members"].find_one({"member_id": "kid1"}, {"_id": 0}))

    def _patch(self, **fields):
        return asyncio.run(server.update_family_member(
            "kid1", server.MemberPatchIn(**fields), user=dict(PARENT)))

    # ---- the default -------------------------------------------------------

    def test_the_default_is_a_good_week_not_a_perfect_one(self):
        # 7 a day over seven days plus the bonus is 50 — what the target used
        # to be. The default has to sit below that or a full week is the only
        # week that counts.
        perfect = 7 * 7 + server.FULL_WEEK_BONUS
        self.assertLess(server.DEFAULT_WEEKLY_TARGET, perfect)
        self.assertGreaterEqual(server.DEFAULT_WEEKLY_TARGET, server.MIN_WEEKLY_TARGET)

    def test_a_child_set_up_before_this_existed_gets_the_default(self):
        self.assertEqual(server.public_member(self._member())["weekly_target"],
                         server.DEFAULT_WEEKLY_TARGET)

    def test_a_stored_nonsense_target_falls_back_rather_than_breaking_the_ring(self):
        # Nothing writes these, but a ring dividing by 0 or by "" is a blank
        # screen, and a child's page is not the place to find that out.
        for junk in (0, -5, None, "", "lots", 10 ** 9):
            self.assertEqual(server.weekly_target_for({"weekly_target": junk}),
                             server.DEFAULT_WEEKLY_TARGET)

    # ---- setting it --------------------------------------------------------

    def test_a_parent_can_set_the_goal_for_one_child(self):
        out = self._patch(weekly_target=20)
        self.assertEqual(out["weekly_target"], 20)
        self.assertEqual(self._member()["weekly_target"], 20)

    def test_zero_puts_the_child_back_on_the_default(self):
        self._patch(weekly_target=20)
        out = self._patch(weekly_target=0)
        self.assertEqual(out["weekly_target"], server.DEFAULT_WEEKLY_TARGET)
        # Stored as "no opinion", NOT as today's default — otherwise changing
        # the default later would skip every child who had ever reset theirs.
        self.assertIsNone(self._member()["weekly_target"])

    def test_the_goal_is_bounded_at_both_ends(self):
        for bad in (server.MIN_WEEKLY_TARGET - 1, server.MAX_WEEKLY_TARGET + 1):
            with self.assertRaises(HTTPException) as ctx:
                self._patch(weekly_target=bad)
            self.assertEqual(ctx.exception.status_code, 400)

    def test_the_edges_themselves_are_allowed(self):
        for ok in (server.MIN_WEEKLY_TARGET, server.MAX_WEEKLY_TARGET):
            self.assertEqual(self._patch(weekly_target=ok)["weekly_target"], ok)

    def test_setting_the_goal_leaves_the_name_and_the_stars_alone(self):
        # The patch handler builds one $set from several optional fields; a
        # goal change must not blank the fields it was not given.
        asyncio.run(self.db["family_members"].update_one(
            {"member_id": "kid1"}, {"$set": {"stars": 12, "week_earned": 4, "age": 9}}))
        out = self._patch(weekly_target=25)
        self.assertEqual(out["name"], "Ama")
        self.assertEqual(out["stars"], 12)
        self.assertEqual(out["week_earned"], 4)
        self.assertEqual(out["age"], 9)

    def test_one_childs_goal_is_not_every_childs_goal(self):
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "kid2", "family_id": "fam1", "name": "Kofi",
            "role": "child", "stars": 0, "week_earned": 0,
        }))
        self._patch(weekly_target=15)
        other = asyncio.run(self.db["family_members"].find_one({"member_id": "kid2"}, {"_id": 0}))
        self.assertEqual(server.public_member(other)["weekly_target"],
                         server.DEFAULT_WEEKLY_TARGET)

    def test_a_goal_belonging_to_another_household_is_not_reachable(self):
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "kid9", "family_id": "otherfam", "name": "Zoe",
            "role": "child", "stars": 0, "week_earned": 0,
        }))
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(server.update_family_member(
                "kid9", server.MemberPatchIn(weekly_target=10), user=dict(PARENT)))
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(HAVE_DEPS, "backend dependencies not installed")
class TheLedgerSaysWhatEachEntryIs(unittest.TestCase):
    """A signed number is not enough to know whether the week moved.

    "-5, being stubborn" and "-30, Cinema" are both negative, and only the
    first comes off this week: the server never docks `week_earned` for a
    redemption, because the bank is savings and the week is a separate meter.
    The app reads this ledger to draw the row of day cells under the meter, so
    without a `kind` it had to guess from the sign — and guessing meant a
    saved-up reward wiping out the week the child had just earned.
    """

    def setUp(self):
        self.db = FakeDatabase()
        self._get_db = server.get_db
        self._alert = server.send_star_milestone_alert

        async def _no_alert(*a, **k):
            return None

        server.send_star_milestone_alert = _no_alert
        server.get_db = lambda: self.db
        asyncio.run(self.db["family_members"].insert_one({
            "member_id": "kid1", "family_id": "fam1", "name": "Ama",
            "role": "child", "stars": 40, "week_earned": 0,
        }))
        asyncio.run(self.db["rewards"].insert_one({
            "reward_id": "r1", "family_id": "fam1", "title": "Cinema", "cost_stars": 30,
        }))

    def tearDown(self):
        server.get_db = self._get_db
        server.send_star_milestone_alert = self._alert

    def _ledger(self):
        return asyncio.run(self.db["star_transactions"].find({}).to_list(None))

    def _member(self):
        return asyncio.run(self.db["family_members"].find_one({"member_id": "kid1"}, {"_id": 0}))

    def test_a_parents_adjustment_is_tagged_as_one(self):
        asyncio.run(server.adjust_member_stars(
            "kid1", server.StarAdjustmentIn(delta=5, reason="Tidied the garage"),
            user=dict(PARENT)))
        self.assertEqual(self._ledger()[0]["kind"], server.STAR_KIND_ADJUST)

    def test_a_job_done_is_tagged_as_earned(self):
        asyncio.run(server.award_stars_to_member(
            self.db, "fam1", "kid1", 5, "Chore done", dict(PARENT)))
        self.assertEqual(self._ledger()[0]["kind"], server.STAR_KIND_EARN)

    def test_a_redeemed_reward_is_tagged_as_a_spend_and_leaves_the_week_alone(self):
        payload = type("P", (), {"member_id": "kid1"})()
        asyncio.run(server.redeem_reward("r1", payload, user=dict(PARENT)))

        spend = [t for t in self._ledger() if t["delta"] < 0][0]
        self.assertEqual(spend["kind"], server.STAR_KIND_SPEND)
        # The two halves of the same rule: the bank pays, the week does not.
        self.assertEqual(self._member()["stars"], 10)
        self.assertEqual(self._member()["week_earned"], 0)

    def test_only_earning_and_adjusting_move_the_week(self):
        # The set the app filters on. Adding a kind here without deciding which
        # side of this line it falls on is the bug this names.
        self.assertEqual(
            server.STAR_KINDS_WEEKLY,
            frozenset({server.STAR_KIND_EARN, server.STAR_KIND_ADJUST}),
        )
        for kind in (server.STAR_KIND_SPEND, server.STAR_KIND_REFUND, server.STAR_KIND_STARTING):
            self.assertNotIn(kind, server.STAR_KINDS_WEEKLY)

    def test_the_transaction_the_app_receives_carries_the_kind(self):
        out = asyncio.run(server.adjust_member_stars(
            "kid1", server.StarAdjustmentIn(delta=3, reason="Homework"), user=dict(PARENT)))
        self.assertEqual(out["transaction"]["kind"], server.STAR_KIND_ADJUST)

    def test_an_entry_written_before_this_existed_reports_no_kind(self):
        # The app reads a null the way it used to behave — a positive counted
        # towards the week, a negative did not, which was true of all of them.
        legacy = {"transaction_id": "t_old", "family_id": "fam1", "member_id": "kid1",
                  "delta": -5, "reason": "Old row", "created_at": server.utcnow()}
        self.assertIsNone(server.public_star_transaction(legacy)["kind"])
